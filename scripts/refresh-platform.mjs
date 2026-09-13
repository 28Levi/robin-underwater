import fs from 'node:fs';
import {keccak256} from 'ethers';
const endpoints={discovery:'https://programmable.market/.well-known/programmable.json',
 capabilities:'https://api.programmable.market/v4/chains/4663/capabilities',
 coverage:'https://api.programmable.market/v4/chains/4663/launch-coverage',
 guide:'https://api.programmable.market/v4/chains/4663/launch-guide',
 readiness:'https://api.programmable.market/v4/chains/4663/readiness',
 quote:'https://api.programmable.market/v4/chains/4663/initial-buy-quote'};
const dir='research/current';fs.mkdirSync(dir,{recursive:true});
const results=await Promise.allSettled(Object.entries(endpoints).map(async([name,url])=>{
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(`${name}: HTTP ${r.status}`);
 const data=await r.json();fs.writeFileSync(`${dir}/${name}.json`,JSON.stringify(data,null,2));
 return {name,schemaVersion:data.schemaVersion,status:data.readiness??data.status??null};
}));
for(const r of results)console.log(JSON.stringify(r.status==='fulfilled'?r.value:{error:r.reason.message}));
async function rpc(method,params){const r=await fetch('https://rpc.mainnet.chain.robinhood.com',{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(`RPC HTTP ${r.status}`);const d=await r.json();if(d.error||d.result===undefined)throw Error(`RPC ${method} failed (code ${d.error?.code??'missing result'})`);return d.result;}
try{
 const chain=await rpc('eth_chainId',[]);if(BigInt(chain)!==4663n)throw Error('Wrong chain');
 const block=await rpc('eth_getBlockByNumber',['finalized',false]);
 const cap=JSON.parse(fs.readFileSync(`${dir}/capabilities.json`));
 const rows=await Promise.all(Object.entries(cap.chainDeployment.contracts).map(async([name,c])=>{try{
  const code=await rpc('eth_getCode',[c.address,'latest']);
  fs.writeFileSync(`${dir}/${name}-runtime.txt`,code);
  return {name,address:c.address,readBlockTag:'latest',expected:c.runtimeCodeHash,actual:keccak256(code),matches:keccak256(code)===c.runtimeCodeHash};
 }catch(e){return {name,address:c.address,error:e.message,matches:false};}
 }));
 const wallet='0x9479ac7ED3A72866F63F37013F2c7Cc68936B519';
 const report={checkedAt:new Date().toISOString(),chainId:4663,checkpoint:{number:block.number,hash:block.hash,timestamp:block.timestamp},
  infrastructure:rows,launchWallet:wallet,walletBalanceWei:BigInt(await rpc('eth_getBalance',[wallet,'latest'])).toString(),
  walletNonce:BigInt(await rpc('eth_getTransactionCount',[wallet,'latest'])).toString()};
 fs.writeFileSync(`${dir}/rpc-readback.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){console.log(JSON.stringify({rpcError:e.message}));process.exitCode=2;}

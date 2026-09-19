import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {JsonRpcProvider,HDNodeWallet,keccak256} from 'ethers';
import {native20Fixture,E} from '../test/helpers/native20-fixture.mjs';
import {buildSnapshot} from '../src/replay.mjs';
import {LossLedger,stringify} from '../src/ledger.mjs';
const require=createRequire(import.meta.url),root=path.resolve('.'),rpcUrl='http://127.0.0.1:18545';
const runDirectory=path.join(root,'output','rehearsal',String(Date.now()));fs.mkdirSync(runDirectory,{recursive:true});
const report={schemaVersion:'robin.local-rehearsal.v1',startedAt:new Date().toISOString(),network:'disposable local Hardhat EVM',
 mainnetTransactionsSent:0,realFundsSpentWei:'0',publicTestMnemonicOnly:true,graphFactorySimulated:true,checks:[],cycles:[]};
const server=spawn(process.execPath,[require.resolve('hardhat/internal/cli/cli.js'),'node','--hostname','127.0.0.1','--port','18545'],
 {cwd:root,env:{...process.env,LOCALAPPDATA:path.join(runDirectory,'runtime'),APPDATA:path.join(runDirectory,'runtime'),
  HARDHAT_CONFIG:path.join(root,'hardhat.rehearsal.config.cjs')},stdio:'ignore',windowsHide:true});
const rpc=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});
let f,slowRpc;
const check=(name,details={})=>{report.checks.push({name,passed:true,...details});console.log('PASS: '+name);};
try{
 let online=false;
 for(let i=0;i<60;i++){
  if(server.exitCode!==null)throw Error('Local node failed to start; port may be in use.');
  try{const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'hardhat_metadata',params:[]})});
   const b=await r.json();if(b.result?.chainId===4663){online=true;break;}}catch{}
  await delay(200);
 }
 if(!online)throw Error('Local node unavailable');
 const remote={network:{provider:{send:(method,params)=>rpc.send(method,params),request:({method,params})=>rpc.send(method,params??[])}}};
 f=await native20Fixture(remote,{operatorIndex:3});
 const {provider,owner,alice,bob,token,hook,feeVault,reward,c,swap}=f;
 const addresses={early:await owner.getAddress(),alice:await alice.getAddress(),bob:await bob.getAddress(),recipient:await(await provider.getSigner(4)).getAddress()};
 const lateBuyer=await provider.getSigner(5);
 const receipts=[f.launched,await swap(bob,true,E),await swap(alice,true,E/10n),await swap(lateBuyer,true,E/5n),
  await swap(bob,false,(await token.balanceOf(addresses.bob))/2n)];
 const fees=receipts.flatMap(r=>r.logs.map(l=>{try{return hook.interface.parseLog(l);}catch{return null;}})).filter(l=>l?.name==='NativeFeesAccrued');
 for(const fee of fees){assert.equal(fee.args.creatorFee+fee.args.platformFee,(fee.args.grossNative*200n+9999n)/10000n);
  assert.equal(fee.args.platformFee,(fee.args.grossNative*20n+9999n)/10000n);}
 assert.equal(await feeVault.creatorAccrued(),fees.reduce((sum,p)=>sum+p.args.creatorFee,0n));
 check('Real swaps charge 2% total and separate project/platform fee balances',{swaps:fees.length});
 await rpc.send('evm_increaseTime',[3700]);await rpc.send('evm_mine',[]);
 const beforeSnapshot=await buildSnapshot(provider,c),beforeLedger=LossLedger.restore(beforeSnapshot.ledger);
 const original={...beforeLedger.get(addresses.alice)};
 const transferAmount=(await token.balanceOf(addresses.alice))/2n;
 await(await token.connect(alice).transfer(addresses.recipient,transferAmount)).wait();
 const afterTransfer=LossLedger.restore((await buildSnapshot(provider,c)).ledger);
 assert.equal(afterTransfer.get(addresses.alice).cost+afterTransfer.get(addresses.recipient).cost,original.cost);
 assert.equal(afterTransfer.get(addresses.alice).balance+afterTransfer.get(addresses.recipient).balance,original.balance);
 assert.equal(afterTransfer.get(addresses.alice).cost,original.cost-original.cost*transferAmount/original.balance);
 await rpc.send('evm_increaseTime',[3700]);await rpc.send('evm_mine',[]);
 const matured=await buildSnapshot(provider,c),ledger=LossLedger.restore(matured.ledger);
 const lossMap=new Map(ledger.shortfalls({...matured.oracle,now:matured.checkpoint.timestamp}).map(a=>[a.account,a.loss]));
 const originalLoss=beforeLedger.shortfalls({...beforeSnapshot.oracle,now:beforeSnapshot.checkpoint.timestamp}).find(a=>a.account===addresses.alice.toLowerCase()).loss;
 const combined=(lossMap.get(addresses.alice.toLowerCase())??0n)+(lossMap.get(addresses.recipient.toLowerCase())??0n);
 assert.ok(combined<=originalLoss+1n && combined>=originalLoss-1n);
 assert.ok(!lossMap.has(addresses.early.toLowerCase()));
 check('Transferring half the tokens carries half the basis; combined loss stays the same within 1 wei');
 const operator=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/3");
 const config={...c,rpcUrlEnvironment:'ROBIN_REHEARSAL_RPC_URL',execution:{mode:'local-only',operator:operator.address,feeVault:await feeVault.getAddress(),
  maxGasPerTransactionWei:(E/100n).toString(),maxTotalGasWei:E.toString(),minimumHarvestWei:'1000',minimumBatchWei:'1000',retryIntervalSeconds:3600,codeHashes:{}}};
 for(const name of ['token','hook','distributor','feeVault'])config.execution.codeHashes[name]=keccak256(await provider.getCode(name==='feeVault'?config.execution.feeVault:config[name]));
 const configFile=path.join(runDirectory,'config.json');fs.writeFileSync(configFile,stringify(config));
 const stateDirectory=path.join(runDirectory,'bot-state');
 async function cycle(endpoint=rpcUrl){
  const child=spawn(process.execPath,['scripts/executor.mjs',configFile,'--once'],{cwd:root,windowsHide:true,
   env:{...process.env,ROBIN_REHEARSAL_RPC_URL:endpoint,ROBIN_LOCAL_OPERATOR_PRIVATE_KEY:operator.privateKey,ROBIN_STATE_DIRECTORY:stateDirectory},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>{output+=b.toString();});child.stderr.resume();
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  const status=JSON.parse(output.trim().split('\n').at(-1));report.cycles.push({pid:child.pid,exitCode:code,...status});
  console.log(`Bot process ${child.pid}: ${status.state}${status.kind?' / '+status.kind:''}`);
  return status;
 }
 const platformBefore=await feeVault.platformAccrued();
 assert.equal((await cycle()).kind,'harvest');assert.equal((await cycle()).state,'confirmed');
 assert.equal(await feeVault.creatorAccrued(),0n);assert.equal(await feeVault.platformAccrued(),platformBefore);
 const snapshot=await buildSnapshot(provider,c),expected=LossLedger.restore(snapshot.ledger).plan(await reward.available(),{...snapshot.oracle,now:snapshot.checkpoint.timestamp});
 assert.ok(expected.allocations.length>=3);
 assert.ok(expected.allocated<expected.totalLoss,'Use a scarce reward pot so proportional sharing is actually exercised.');
 const balances=new Map(await Promise.all(expected.allocations.map(async a=>[a.account,await provider.getBalance(a.account)])));
 assert.equal((await cycle()).kind,'payout');assert.equal((await cycle()).state,'confirmed');
 for(const a of expected.allocations)assert.equal((await provider.getBalance(a.account))-balances.get(a.account),a.amount);
 const ordered=[...expected.allocations].sort((a,b)=>a.loss>b.loss?1:-1);
 for(let i=1;i<ordered.length;i++)assert.ok(ordered[i].amount>=ordered[i-1].amount);
 check('Separate bot processes harvest fees and pay every eligible holder the exact loss-weighted amount',
  {recipients:expected.allocations,allocatedWei:expected.allocated,profitableEarlyBuyerPaid:false});
 const paidSnapshot=await buildSnapshot(provider,c),paidLedger=LossLedger.restore(paidSnapshot.ledger);
 for(const a of expected.allocations)assert.equal(paidLedger.get(a.account).relief,a.amount);
 assert.equal((await cycle()).state,'idle');assert.equal((await cycle()).state,'idle');
 const journal=JSON.parse(fs.readFileSync(path.join(stateDirectory,'journal.json'))).state;
 assert.equal(journal.history.length,2);assert.equal(journal.pending,null);
 assert.equal(new Set(report.cycles.map(s=>s.pid)).size,report.cycles.length);
 check('Six fresh bot processes share the durable journal without duplicate payouts');
 // Post-relief transfer must move already-paid relief as well as basis.
 const costBefore=paidLedger.get(addresses.alice).cost,reliefBefore=paidLedger.get(addresses.alice).relief;
 const recipientCost=paidLedger.get(addresses.recipient).cost,recipientRelief=paidLedger.get(addresses.recipient).relief;
 await(await token.connect(alice).transfer(addresses.recipient,await token.balanceOf(addresses.alice))).wait();
 const moved=LossLedger.restore((await buildSnapshot(provider,c)).ledger);
 assert.equal(moved.get(addresses.alice).cost,0n);assert.equal(moved.get(addresses.alice).relief,0n);
 assert.equal(moved.get(addresses.recipient).cost,costBefore+recipientCost);
 assert.equal(moved.get(addresses.recipient).relief,reliefBefore+recipientRelief);
 check('Moving tokens after a payout also moves prior relief and cannot reset the reward history');
 // Empty new blocks are routine on the live chain; a safe bot must still make progress.
 await swap(bob,true,E/1000n);
 slowRpc=http.createServer(async(req,res)=>{
  try{let body='';for await(const chunk of req)body+=chunk;
   const upstream=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body});
   const reply=await upstream.text();await delay(250);res.writeHead(200,{'content-type':'application/json'});res.end(reply);
  }catch{res.writeHead(502);res.end();}
 });
 await new Promise(resolve=>slowRpc.listen(18546,'127.0.0.1',resolve));
 await rpc.send('evm_setIntervalMining',[100]);
 const moving=await cycle('http://127.0.0.1:18546');
 if(moving.state==='submitted')assert.equal((await cycle('http://127.0.0.1:18546')).state,'confirmed');
 await rpc.send('evm_setIntervalMining',[0]);
 report.movingBlockProbe={intervalMs:100,rpcResponseDelayMs:250,state:moving.state,kind:moving.kind??null,passed:moving.state==='submitted'};
 assert.ok(report.movingBlockProbe.passed,'Bot cannot submit while empty blocks advance and RPC replies take 250ms; fix liveness before live testing.');
 check('Bot makes progress while new empty blocks arrive every 100 milliseconds');
 report.passed=true;
}catch(error){report.passed=false;report.failure=error.message;console.error('REHEARSAL FAILED: '+error.message);process.exitCode=1;}
finally{
 report.finishedAt=new Date().toISOString();fs.writeFileSync('output/local-rehearsal.json',stringify(report)+'\n');
 slowRpc?.close();f?.provider.destroy();rpc.destroy();server.kill();
 console.log('Evidence: output/local-rehearsal.json (local funds only)');
}

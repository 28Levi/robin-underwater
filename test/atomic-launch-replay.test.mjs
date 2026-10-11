import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {AbiCoder,Contract,Interface,JsonRpcSigner,ZeroAddress,keccak256,toBeHex} from 'ethers';
import {native20Fixture,E,artifact} from './helpers/native20-fixture.mjs';
import {compileRobinLaunchContracts,buildRobinLaunchPlan,ATOMIC,GRAPH} from '../src/launch-plan.mjs';
import {DISTRIBUTOR,DISTRIBUTOR_HASH} from '../signing-ui/robin-launch-guards.mjs';
import {normalizeNative20Receipt,poolInterface} from '../src/native20-adapter.mjs';
import {decodeReceipt} from '../src/receipt-adapter.mjs';
import {applyReceipt} from '../src/replay.mjs';
import {LossLedger,address} from '../src/ledger.mjs';

process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');
process.env.HARDHAT_NETWORK='hardhat';
const {default:hre}=await import('hardhat');
assert.equal(hre.network.name,'hardhat');
assert.equal(hre.network.config.forking?.enabled??false,false);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const transfer=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);

test('exact GraphFactory runtime atomically mints, seeds and buys while preserving initial buyer basis',async t=>{
 const f=await native20Fixture(hre,{name:'Local setup',symbol:'SETUP',feeProfile:'robin-native30'});
 try{
  const {provider}=f,intent=read('launch-intent.json'),factory=read('vendor/programmable-launch-plan-v1/graph-factory.json');
  const now=(await provider.getBlock('latest')).timestamp;
  const built=buildRobinLaunchPlan({intent,compiled:compileRobinLaunchContracts(process.cwd(),solc),factory,
   capabilities:read('vendor/programmable-launch-plan-v1/capabilities-observed.json'),sourceRevision:'1'.repeat(40),
   nonce:'0x'+'a7'.repeat(32),now,distributor:{verified:true,finalized:true,chainId:4663,address:DISTRIBUTOR,
    operator:intent.operator,runtimeCodeHash:DISTRIBUTOR_HASH,checkedAt:new Date(now*1000).toISOString()}});
  // In-process Hardhat only. The reviewed GraphFactory runtime and real creation
  // bytecode execute together; no permit or live-chain admission is simulated.
  await hre.network.provider.send('hardhat_setCode',[GRAPH,factory.runtimeCode]);
  assert.equal(keccak256(await provider.getCode(GRAPH)),factory.runtimeCodeHash);
  await hre.network.provider.send('hardhat_setBalance',[ATOMIC,toBeHex(E)]);
  await hre.network.provider.send('hardhat_impersonateAccount',[ATOMIC]);
  const graph=new Contract(GRAPH,factory.abi,new JsonRpcSigner(provider,ATOMIC));
  const receipt=await(await graph.deployGraph(built.authorization,built.targets,{value:BigInt(intent.initialBuyWei),gasLimit:12000000})).wait();
  const addresses=built.report.addresses;
  const c={...f.c,name:intent.name,symbol:intent.symbol,token:addresses.token,hook:addresses.hook,initializer:addresses.initializer,
   distributor:intent.creatorFeeRecipient,poolId:keccak256(AbiCoder.defaultAbiCoder().encode(
    ['address','address','uint24','int24','address'],[ZeroAddress,addresses.token,0,60,addresses.hook])),
   deploymentBlock:receipt.blockNumber,excludedAddresses:[addresses.initializer,addresses.feeVault]};
  const block=await provider.getBlock(receipt.blockNumber),token=new Contract(c.token,artifact('RobinhoodNative20Token').abi,provider);
  const tokenLogs=receipt.logs.filter(log=>address(log.address)===address(c.token));
  assert.equal(tokenLogs.length,3,'constructor mint, seed transfer and initial buy must share one transaction');
  assert.equal(transfer.parseLog(tokenLogs[0]).args.from,ZeroAddress);
  assert.equal(transfer.parseLog(tokenLogs[0]).args.value,10n**27n);
  const normalized=normalizeNative20Receipt(receipt,c),decoded=decodeReceipt(normalized.receipt,{...c,time:block.timestamp});
  assert.equal(decoded.supported,true);
  const result=applyReceipt(new LossLedger(c),receipt,c,block.timestamp),buyer=result.ledger.get(intent.launchWallet);
  assert.equal(result.unsupported,null);
  assert.equal(buyer.cost,E/100n);
  assert.equal(buyer.balance,await token.balanceOf(intent.launchWallet));
  assert.equal(result.ledger.accounts.size,1,'system inventory must not become holder rewards');
  assert.equal(result.observations.length,2,'initial pool and purchase prices remain available for TWAP');
  const price=buyer.cost*E/buyer.balance/2n;
  assert.equal(result.ledger.shortfalls({priceWeiPerToken:price,observedAt:block.timestamp+3599,now:block.timestamp+3599}).length,0);
  const mature=result.ledger.shortfalls({priceWeiPerToken:price,observedAt:block.timestamp+3600,now:block.timestamp+3600});
  assert.equal(mature.length,1);assert.equal(mature[0].basis,E/100n);assert.ok(mature[0].loss>0n);

  await t.test('atomic mint exemption rejects altered origins, amounts, duplicates and incomplete launch evidence',()=>{
   const original=receipt.logs.map(log=>({...log}));
   const mintIndex=original.findIndex(log=>log===tokenLogs[0]||log.index===tokenLogs[0].index);
   const seedIndex=original.findIndex(log=>log.index===tokenLogs[1].index);
   const outputIndex=original.findIndex(log=>log.index===tokenLogs[2].index);
   const mutations=[
    logs=>{Object.assign(logs[mintIndex],transfer.encodeEventLog('Transfer',[ZeroAddress,f.ownerAddress,10n**27n]));},
    logs=>{Object.assign(logs[mintIndex],transfer.encodeEventLog('Transfer',[ZeroAddress,c.initializer,10n**27n-1n]));},
    logs=>{logs[mintIndex].address=f.ownerAddress;},
    logs=>{Object.assign(logs[seedIndex],transfer.encodeEventLog('Transfer',[c.initializer,c.poolManager,1n]));},
    logs=>{Object.assign(logs[outputIndex],transfer.encodeEventLog('Transfer',[c.poolManager,f.ownerAddress,buyer.balance]));},
    logs=>{logs.push({...logs[mintIndex],index:999});},
    logs=>{const i=logs.findIndex(log=>address(log.address)===address(c.poolManager)&&log.topics[0]===poolInterface.getEvent('Initialize').topicHash);logs.splice(i,1);},
   ];
   for(const mutate of mutations){
    const logs=original.map(log=>({...log}));mutate(logs);
    const altered=normalizeNative20Receipt({...receipt,logs},c);
    // Removing the mint origin makes the remaining initial buy a valid separate
    // initialization, but it must not be mistaken for an exempted token mint.
    if(logs[mintIndex].address!==original[mintIndex].address){
     assert.ok(altered.receipt.logs.some(log=>log.index===tokenLogs[0].index&&log.address===f.ownerAddress));
    }else assert.equal(decodeReceipt(altered.receipt,{...c,time:block.timestamp}).supported,false);
   }
  });

  await t.test('ordinary mint retains zero basis and ordinary transfer still carries measured basis',()=>{
   const minted={hash:'0x'+'ba'.repeat(32),status:1,logs:[{address:c.token,index:0,
    ...transfer.encodeEventLog('Transfer',[ZeroAddress,f.ownerAddress,123n])}]};
   const ordinary=applyReceipt(new LossLedger(c),minted,c,block.timestamp);
   assert.equal(ordinary.ledger.get(f.ownerAddress).balance,123n);assert.equal(ordinary.ledger.get(f.ownerAddress).cost,0n);
   const amount=buyer.balance/2n,recipient=f.ownerAddress;
   const moved=applyReceipt(result.ledger,{hash:'0x'+'bc'.repeat(32),status:1,logs:[{address:c.token,index:0,
    ...transfer.encodeEventLog('Transfer',[intent.launchWallet,recipient,amount])}]},c,block.timestamp+3600);
   assert.equal(moved.ledger.get(recipient).cost,buyer.cost*amount/buyer.balance);
   assert.equal(moved.ledger.get(recipient).balance,amount);
   assert.equal(moved.ledger.get(intent.launchWallet).cost+moved.ledger.get(recipient).cost,buyer.cost);
  });
 }finally{f.provider.destroy();}
});

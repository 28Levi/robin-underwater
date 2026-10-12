import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {HDNodeWallet,keccak256,toBeHex} from 'ethers';
import {native20Fixture,E} from './helpers/native20-fixture.mjs';
import {executeCycle} from '../src/executor.mjs';
import {buildSnapshot} from '../src/replay.mjs';
import {preparePlan} from '../src/payout-plan.mjs';
import {operatorFailureStatus} from '../src/operator-status.mjs';
import {runProductionOperatorLoop} from '../src/production-operator-loop.mjs';
import {requireInitialPriceWindow} from '../src/price-window-warmup.mjs';
process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');process.env.HARDHAT_NETWORK='hardhat';
const {default:hre}=await import('hardhat');
assert.equal(hre.network.name,'hardhat');assert.equal(hre.network.config.forking?.enabled??false,false);
const alter=(provider,overrides)=>new Proxy(provider,{get(target,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});

test('real EVM early launch harvest survives delayed finality and first price-window warmup before paying',async()=>{
 const f=await native20Fixture(hre,{name:'ROBINHOOK',symbol:'ROBIN',firstBuyWei:E/100n,feeProfile:'robin-native30'}),realNow=Date.now;
 try{
  const {provider,owner,ownerAddress,token,reward,feeVault}=f;
  const portion=(await token.balanceOf(ownerAddress))/4n;
  await(await token.transfer(await f.alice.getAddress(),portion)).wait();await(await token.transfer(await f.bob.getAddress(),portion)).wait();
  await f.swap(owner,false,await token.balanceOf(ownerAddress));
  const launched=await provider.getBlock(f.launched.blockNumber),anchor=launched.timestamp;
  const c={...f.c,deploymentBlock:f.launched.blockNumber,minimumAgeSeconds:300,maxFinalityLagSeconds:1800,payoutStartTimestamp:anchor,
   execution:{mode:'local-only',operator:ownerAddress,feeVault:await feeVault.getAddress(),payoutIntervalSeconds:900,
    maxGasPerTransactionWei:'200000000000000',maxTotalGasWei:'5000000000000000',minimumHarvestWei:'10000000000000',minimumBatchWei:'10000000000000',retryIntervalSeconds:3600,codeHashes:{}}};
  for(const name of ['token','hook','distributor','feeVault'])c.execution.codeHashes[name]=keccak256(await provider.getCode(name==='feeVault'?c.execution.feeVault:c[name]));
  fs.mkdirSync('output/test',{recursive:true});const dir=fs.mkdtempSync('output/test/initial-price-window-'),journalFile=path.join(dir,'journal.json');
  const journal=()=>JSON.parse(fs.readFileSync(journalFile,'utf8')).state;
  let finalized=launched,clock=anchor,signed=0;
  const wallet=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
  const signer={getAddress:()=>wallet.getAddress(),signTransaction:tx=>{signed++;return wallet.signTransaction(tx);}};
  const rpc=alter(provider,{getBlock:tag=>provider.getBlock(tag==='finalized'?finalized.number:tag),getFeeData:async()=>({maxFeePerGas:41420000n,maxPriorityFeePerGas:0n})});
  Date.now=()=>clock*1000;
  const at=async offset=>{await hre.network.provider.send('evm_setNextBlockTimestamp',[anchor+offset]);await hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas',[toBeHex(20710000n)]);await hre.network.provider.send('evm_mine');clock=(await provider.getBlock('latest')).timestamp;return provider.getBlock('latest');};
  const cycle=async()=>{clock=(await provider.getBlock('latest')).timestamp;return executeCycle(rpc,signer,c,dir);};

  await at(900);const claim=await cycle();assert.equal(claim.state,'submitted');assert.equal(claim.kind,'harvest');assert.equal(signed,1);
  const claimReceipt=await provider.getTransactionReceipt(claim.hash),claimBlock=await provider.getBlock(claimReceipt.blockNumber);
  assert.equal((await cycle()).state,'waiting-for-finality');assert.equal(signed,1);
  const beforeWindow=await at(1799),fullWindow=await at(1800);await at(1801);
  finalized=claimBlock;assert.equal((await cycle()).state,'confirmed');assert.equal(journal().schedule.active.phase,'allocation');
  assert.equal(journal().pending,null);const durableAfterHarvest=fs.readFileSync(journalFile,'utf8');
  assert.equal(fs.existsSync(path.join(dir,'snapshot.json')),false);

  // Run the actual long-running loop: a warmup status keeps it alive through
  // repeated cycles and durable reload, without consuming the round or signing.
  const stop=new AbortController(),statuses=[];
  await runProductionOperatorLoop({cycle,signal:stop.signal,
   report:status=>{statuses.push(status);if(status.state==='submitted')stop.abort();},
   wait:async()=>{
    assert.equal(signed,1);assert.equal(fs.readFileSync(journalFile,'utf8'),durableAfterHarvest);
    assert.equal(fs.existsSync(path.join(dir,'snapshot.json')),false);
    if(statuses.length===1){await at(2700);finalized=beforeWindow;}else finalized=fullWindow;
   }});
  assert.deepEqual(statuses.map(s=>s.code??s.state),['INITIAL_PRICE_WINDOW_WARMUP','INITIAL_PRICE_WINDOW_WARMUP','submitted']);
  assert.equal(statuses[0].priceWindowReadyAt,anchor+1800);assert.equal(statuses[1].finalizedTimestamp,anchor+1799);
  assert.equal(statuses[2].kind,'payout');assert.equal(signed,2);
  const snapshot=JSON.parse(JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8')).payload);
  assert.equal(snapshot.checkpoint.timestamp,anchor+1800);assert.equal(snapshot.oracle.windowSeconds,1800);
  const payoutReceipt=await provider.getTransactionReceipt(statuses[2].hash);
  const paid=payoutReceipt.logs.flatMap(log=>{let p;try{p=reward.interface.parseLog(log);}catch{}return p?.name==='RewardPaid'?[p]:[];});
  assert.equal(paid.length,2);assert.ok(paid.every(p=>p.args.amount>0n));
  assert.equal((await cycle()).state,'waiting-for-finality');assert.equal(signed,2);

  // Once the full window is possible, missing/malformed history is a real
  // failure. A previously valid cache may never re-enter initial warmup.
  const emptyHistory=alter(rpc,{getLogs:async()=>[]});
  await assert.rejects(buildSnapshot(emptyHistory,c),error=>error.message==='Missing window history'&&operatorFailureStatus(error).state==='blocked');
  await assert.rejects(buildSnapshot(rpc,c,{...snapshot,observations:[]}),error=>error.message==='Missing window history'&&operatorFailureStatus(error).state==='blocked');
  await assert.rejects(buildSnapshot(rpc,c,{...snapshot,observations:[{time:anchor,sqrtPriceX96:'0'}]}),error=>error.message==='Invalid sqrt price'&&operatorFailureStatus(error).state==='blocked');
  const historical=alter(rpc,{getBlock:tag=>provider.getBlock(tag==='latest'||tag==='finalized'?fullWindow.number:tag)});
  await assert.rejects(preparePlan(historical,c,{...snapshot,generatedAt:anchor+3700},{now:anchor+3700}),
   error=>error.message==='Finality is stalled'&&operatorFailureStatus(error).state==='blocked');
  await assert.rejects(preparePlan(historical,c,{...snapshot,oracle:{...snapshot.oracle,observedAt:anchor+1499}},{now:snapshot.generatedAt}),
   error=>error.message==='Stale or future price'&&operatorFailureStatus(error).state==='blocked');
  const changedAnchor=alter(rpc,{getBlock:async tag=>tag===fullWindow.number?{...fullWindow,hash:toBeHex(42,32)}:rpc.getBlock(tag)});
  await assert.rejects(buildSnapshot(changedAnchor,c),error=>error.message==='Finalized checkpoint changed'&&operatorFailureStatus(error).state==='blocked');
  await at(3602);finalized=await provider.getBlock(payoutReceipt.blockNumber);
  assert.equal((await cycle()).state,'confirmed');assert.equal(journal().pending,null);assert.equal(journal().round,null);
  assert.equal((await cycle()).state,'idle');assert.equal(signed,2,'durable final recovery must not create another payout');
 }finally{Date.now=realNow;f.provider.destroy();}
});

test('only validated initial finalized-window waits are retryable; stale, future and malformed anchors block',()=>{
 const deployment={number:10,timestamp:1000,hash:toBeHex(10,32)},finalized={number:20,timestamp:2799,hash:toBeHex(20,32)};
 const c={deploymentBlock:10,twapWindowSeconds:1800,maxFinalityLagSeconds:1800};
 assert.throws(()=>requireInitialPriceWindow(deployment,finalized,c,3000),error=>operatorFailureStatus(error).code==='INITIAL_PRICE_WINDOW_WARMUP');
 assert.doesNotThrow(()=>requireInitialPriceWindow(deployment,{...finalized,timestamp:2800},c,3000));
 for(const call of [()=>requireInitialPriceWindow(deployment,finalized,c,5000),()=>requireInitialPriceWindow(deployment,finalized,c,2000),
  ()=>requireInitialPriceWindow({...deployment,hash:'wrong'},finalized,c,3000),()=>requireInitialPriceWindow({...deployment,number:11},finalized,c,3000)])
  assert.throws(call,error=>operatorFailureStatus(error).state==='blocked');
 assert.equal(operatorFailureStatus({code:'INITIAL_PRICE_WINDOW_WARMUP',message:'Missing window history'}).state,'blocked');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {HDNodeWallet,keccak256} from 'ethers';
import {native20Fixture,E} from './helpers/native20-fixture.mjs';
import {executeCycle} from '../src/executor.mjs';

process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');
process.env.HARDHAT_NETWORK='hardhat';
const {default:hre}=await import('hardhat');
assert.equal(hre.network.name,'hardhat');
assert.equal(hre.network.config.forking?.enabled??false,false);
const altered=(provider,overrides)=>new Proxy(provider,{get(target,key){
 if(Object.hasOwn(overrides,key))return overrides[key];
 const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
}});

test('operator failure recovery preserves nonce, gas and journal boundaries on the local 170/30 contracts',async t=>{
 const f=await native20Fixture(hre,{name:'ROBINHOOK',symbol:'ROBIN',firstBuyWei:E/100n,feeProfile:'robin-native30'});
 const realNow=Date.now;
 try{
  const {provider,owner,alice,feeVault}=f;
  const signer=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
  assert.equal(signer.address,f.ownerAddress);
  const c={...f.c,maxFinalityLagSeconds:1800,execution:{mode:'local-only',operator:signer.address,
   feeVault:await feeVault.getAddress(),maxGasPerTransactionWei:'200000000000000',maxTotalGasWei:'5000000000000000',
   minimumHarvestWei:'10000000000000',minimumBatchWei:'10000000000000',retryIntervalSeconds:3600,codeHashes:{}}};
  for(const name of ['token','hook','distributor','feeVault'])c.execution.codeHashes[name]=keccak256(await provider.getCode(name==='feeVault'?c.execution.feeVault:c[name]));
  await hre.network.provider.send('evm_increaseTime',[3700]);await hre.network.provider.send('evm_mine');
  let saved=await hre.network.provider.send('evm_snapshot');
  fs.mkdirSync('output/test',{recursive:true});
  async function setup({broadcast=true}={}){
   await hre.network.provider.send('evm_revert',[saved]);saved=await hre.network.provider.send('evm_snapshot');
   let localTime=(await provider.getBlock('latest')).timestamp;
   Date.now=()=>(localTime*1000);
   const dir=fs.mkdtempSync('output/test/executor-fault-');
   const sending=broadcast?provider:altered(provider,{broadcastTransaction:async()=>{throw Error('Local test: request not accepted');}});
   const result=await executeCycle(sending,signer,c,dir);
   assert.equal(result.kind,'harvest');assert.equal(result.state,broadcast?'submitted':'broadcast-uncertain');
   const file=path.join(dir,'journal.json'),bytes=()=>fs.readFileSync(file,'utf8'),state=()=>JSON.parse(bytes()).state;
   const pending=state().pending;assert.ok(pending);assert.ok(BigInt(state().reservedGasWei)>0n);
   assert.ok(BigInt(state().reservedGasWei)<=BigInt(c.execution.maxGasPerTransactionWei));
   let signatures=0,broadcasts=0;
   const prohibitedSigner={getAddress:()=>signer.getAddress(),signTransaction:async()=>{signatures++;throw Error('Unexpected additional signature');}};
   const probe=overrides=>altered(provider,{broadcastTransaction:async()=>{broadcasts++;throw Error('Unexpected additional broadcast');},...overrides});
   const noAdditionalWork=()=>{assert.equal(signatures,0);assert.equal(broadcasts,0);};
   return {dir,file,bytes,state,pending,probe,prohibitedSigner,noAdditionalWork,advanceClock:async()=>{localTime=(await provider.getBlock('latest')).timestamp;}};
  }

  await t.test('a different mined transaction consuming the saved nonce blocks without replacing the payment',async()=>{
   const s=await setup({broadcast:false}),before=s.bytes();
   await(await owner.sendTransaction({to:await alice.getAddress(),value:1n})).wait();
   assert.equal(await provider.getTransactionCount(signer.address,'latest'),s.pending.nonce+1);
   await s.advanceClock();
   await assert.rejects(executeCycle(s.probe({}),s.prohibitedSigner,c,s.dir),/nonce was consumed by an unknown transaction/);
   assert.equal(s.bytes(),before);s.noAdditionalWork();
  });

  await t.test('a pending receipt on a noncanonical block preserves signed bytes and awaits reconciliation',async()=>{
   const s=await setup(),receipt=await provider.getTransactionReceipt(s.pending.hash),before=s.bytes();
   const rpc=s.probe({getBlock:async tag=>{
    const block=await provider.getBlock(tag);return tag===receipt.blockNumber?{...block,hash:'0x'+'ab'.repeat(32)}:block;
   }});
   await assert.rejects(executeCycle(rpc,s.prohibitedSigner,c,s.dir),/Receipt is no longer canonical/);
   assert.equal(s.bytes(),before);s.noAdditionalWork();
  });

  await t.test('changed already-finalized execution history blocks the next cycle before signing',async()=>{
   const s=await setup();
   assert.equal((await executeCycle(provider,signer,c,s.dir)).state,'confirmed');
   assert.equal(s.state().pending,null);assert.equal(s.state().history.length,1);
   const previous=s.state().history[0],before=s.bytes();
   const rpc=s.probe({getBlock:async tag=>{
    const block=await provider.getBlock(tag);return tag===previous.blockNumber?{...block,hash:'0x'+'cd'.repeat(32)}:block;
   }});
   await assert.rejects(executeCycle(rpc,s.prohibitedSigner,c,s.dir),/Finalized execution history changed/);
   assert.equal(s.bytes(),before);s.noAdditionalWork();
  });

  await t.test('a real finalized reverted harvest is recorded as a durable fault with its gas still reserved',async()=>{
   const s=await setup({broadcast:false}),before=s.state();
   // Another permissionless caller harvests first, making the already-signed
   // claim revert. Reuse its exact bytes; no replacement transaction is made.
   await(await feeVault.connect(alice).claimCreator()).wait();
   try{await provider.broadcastTransaction(s.pending.raw);}catch{}
   const receipt=await provider.getTransactionReceipt(s.pending.hash);
   assert.ok(receipt);assert.equal(receipt.status,0);
   await s.advanceClock();
   const result=await executeCycle(s.probe({}),s.prohibitedSigner,c,s.dir);
   assert.equal(result.state,'blocked');assert.match(result.reason,/Finalized transaction reverted/);
   const fault=s.state();assert.equal(fault.pending,null);assert.equal(fault.history.length,1);
   assert.equal(fault.history[0].hash,s.pending.hash);assert.equal(fault.history[0].status,0);
   assert.equal(fault.reservedGasWei,before.reservedGasWei);assert.equal(fault.round,before.round);
   const persisted=s.bytes();
   await assert.rejects(executeCycle(s.probe({}),s.prohibitedSigner,c,s.dir),/Finalized transaction reverted/);
   assert.equal(s.bytes(),persisted);s.noAdditionalWork();
  });
 }finally{Date.now=realNow;f.provider.destroy();}
});

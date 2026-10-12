import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {HDNodeWallet,keccak256,toBeHex} from 'ethers';
import {native20Fixture,E} from './helpers/native20-fixture.mjs';
import {executeCycle} from '../src/executor.mjs';
import {operatorFailureStatus} from '../src/operator-status.mjs';

process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');process.env.HARDHAT_NETWORK='hardhat';
const {default:hre}=await import('hardhat');
assert.equal(hre.network.name,'hardhat');assert.equal(hre.network.config.forking?.enabled??false,false);
const alter=(provider,overrides)=>new Proxy(provider,{get(target,key){
 if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
}});

test('pipeline harvests during warmup and pays finalized treasury while a later actual fee claim remains unfinalized',async()=>{
 const f=await native20Fixture(hre,{operatorIndex:3,name:'ROBINHOOK',symbol:'ROBIN',firstBuyWei:E/100n,feeProfile:'robin-native30'}),realNow=Date.now;
 try{
  const {provider,owner,ownerAddress,token,reward,feeVault}=f;
  const portion=(await token.balanceOf(ownerAddress))/4n;
  await(await token.transfer(await f.alice.getAddress(),portion)).wait();
  await(await token.transfer(await f.bob.getAddress(),portion)).wait();
  await f.swap(owner,false,await token.balanceOf(ownerAddress));
  const launch=await provider.getBlock(f.launched.blockNumber),anchor=launch.timestamp;
  const operator=await f.keeper.getAddress(),wallet=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/3");
  assert.equal(wallet.address,operator);
  const c={...f.c,deploymentBlock:f.launched.blockNumber,minimumAgeSeconds:300,maxFinalityLagSeconds:1800,payoutStartTimestamp:anchor,
   execution:{mode:'local-only',operator,feeVault:await feeVault.getAddress(),payoutIntervalSeconds:900,
    confirmationMode:'pipelined-finalized-v1',maxInflightTransactions:8,maxGasPerTransactionWei:'200000000000000',
    maxTotalGasWei:'5000000000000000',minimumHarvestWei:'10000000000',minimumBatchWei:'1000000000',retryIntervalSeconds:3600,codeHashes:{}}};
  for(const name of ['token','hook','distributor','feeVault'])c.execution.codeHashes[name]=keccak256(await provider.getCode(name==='feeVault'?c.execution.feeVault:c[name]));
  fs.mkdirSync('output/test',{recursive:true});const dir=fs.mkdtempSync('output/test/executor-pipeline-harvest-');
  const state=()=>JSON.parse(fs.readFileSync(path.join(dir,'journal.json'),'utf8')).state,signs=[];
  let finalized=launch,clock=anchor;
  const rpc=alter(provider,{getBlock:tag=>provider.getBlock(tag==='finalized'?finalized.number:tag),
   getFeeData:async()=>({maxFeePerGas:41420000n,maxPriorityFeePerGas:0n})});
  const signer={getAddress:()=>wallet.getAddress(),signTransaction:async tx=>{signs.push(tx);return wallet.signTransaction(tx);}};
  Date.now=()=>clock*1000;
  const at=async offset=>{
   await hre.network.provider.send('evm_setNextBlockTimestamp',[anchor+offset]);
   await hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas',[toBeHex(20710000n)]);
   await hre.network.provider.send('evm_mine');clock=(await provider.getBlock('latest')).timestamp;
   return provider.getBlock('latest');
  };
  const cycle=async()=>{clock=(await provider.getBlock('latest')).timestamp;return executeCycle(rpc,signer,c,dir);};

  await at(900);const firstClaim=await cycle();assert.equal(firstClaim.kind,'harvest');assert.equal(firstClaim.state,'submitted');
  assert.equal((await cycle()).state,'mined');assert.equal(state().inflight[0].finalized,false);
  await assert.rejects(cycle(),error=>operatorFailureStatus(error).code==='INITIAL_PRICE_WINDOW_WARMUP');
  assert.equal(signs.length,1);assert.equal(fs.existsSync(path.join(dir,'snapshot.json')),false);
  const mature=await at(1800);await at(2700);finalized=mature;
  const firstPayout=await cycle();assert.equal(firstPayout.kind,'payout');assert.equal(firstPayout.state,'submitted');
  assert.equal(state().history.find(row=>row.hash===firstClaim.hash)?.status,1);
  assert.equal((await cycle()).state,'mined');assert.equal(signs.length,2);
  const firstReceipt=await provider.getTransactionReceipt(firstPayout.hash);
  assert.equal(Number(firstReceipt.status),1);

  // This independent, finalized treasury tranche is spendable next round. The
  // fresh hook fees claimed below must remain excluded until their own finality.
  const tranche=10000000000n;
  await(await owner.sendTransaction({to:c.distributor,value:tranche})).wait();
  const nextCheckpoint=await at(2800);
  const finalizedTreasury=await reward.available({blockTag:nextCheckpoint.number});
  assert.ok(finalizedTreasury>=tranche);
  await at(3000);await f.swap(owner,true,E/1000n);
  assert.ok(await feeVault.creatorAccrued()>=BigInt(c.execution.minimumHarvestWei));
  await at(3600);finalized=nextCheckpoint;
  const secondClaim=await cycle();assert.equal(secondClaim.kind,'harvest');assert.equal(secondClaim.state,'submitted');
  assert.equal((await cycle()).state,'mined');
  assert.equal(state().inflight.find(row=>row.hash===secondClaim.hash)?.finalized,false);
  assert.ok(await reward.available()>finalizedTreasury,'newly collected fees are present but not yet spendable');
  const secondPayout=await cycle();assert.equal(secondPayout.kind,'payout');assert.equal(secondPayout.state,'submitted');
  const pending=state().pending,total=pending.allocations.reduce((sum,row)=>sum+BigInt(row.amount),0n);
  assert.ok(total>0n&&total<=finalizedTreasury,'payment must fit only the older finalized treasury');
  assert.equal(signs.length,4);
  assert.equal((await cycle()).state,'mined');
  assert.ok(state().inflight.some(row=>row.hash===secondClaim.hash&&!row.finalized));
  assert.ok(state().inflight.some(row=>row.hash===secondPayout.hash&&!row.finalized));
  assert.ok((await provider.getBlock('latest')).timestamp<anchor+3610,'delivery did not wait for either new receipt to finalize');
  assert.equal(state().pending,null);assert.equal(state().round,null);assert.equal(state().schedule.nextDueAt,anchor+4500);
 }finally{Date.now=realNow;f.provider.destroy();}
});

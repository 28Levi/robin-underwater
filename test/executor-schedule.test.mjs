import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {HDNodeWallet,keccak256,toBeHex} from 'ethers';
import {native20Fixture,E} from './helpers/native20-fixture.mjs';
import {executeCycle} from '../src/executor.mjs';
process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');process.env.HARDHAT_NETWORK='hardhat';
const {default:hre}=await import('hardhat');
assert.equal(hre.network.name,'hardhat');assert.equal(hre.network.config.forking?.enabled??false,false);
const alter=(provider,overrides)=>new Proxy(provider,{get(target,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});

test('scheduled executor harvests first, continues durable batches, and does not release another round early',async t=>{
 const f=await native20Fixture(hre,{name:'ROBINHOOK',symbol:'ROBIN',firstBuyWei:E/100n,feeProfile:'robin-native30'}),realNow=Date.now;
 try{
  const {provider,owner,ownerAddress,token,reward,feeVault}=f;
  const portion=(await token.balanceOf(ownerAddress))/4n;
  await(await token.transfer(await f.alice.getAddress(),portion)).wait();await(await token.transfer(await f.bob.getAddress(),portion)).wait();
  await f.swap(owner,false,await token.balanceOf(ownerAddress));
  await hre.network.provider.send('evm_increaseTime',[3700]);
  // Use the same observed low-fee profile as our transaction quote; the short
  // fixture has not mined the hundred transfers that lower Hardhat's base fee.
  await hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas',[toBeHex(20710000n)]);await hre.network.provider.send('evm_mine');
  const anchor=(await provider.getBlock(f.launched.blockNumber)).timestamp;
  const baseConfig={...f.c,minimumAgeSeconds:300,batchSize:1,maxFinalityLagSeconds:1800,payoutStartTimestamp:anchor,execution:{mode:'local-only',operator:ownerAddress,feeVault:await feeVault.getAddress(),payoutIntervalSeconds:900,maxGasPerTransactionWei:'200000000000000',maxTotalGasWei:'5000000000000000',minimumHarvestWei:'10000000000000',minimumBatchWei:'10000000000000',retryIntervalSeconds:3600,codeHashes:{}}};
  for(const name of ['token','hook','distributor','feeVault'])baseConfig.execution.codeHashes[name]=keccak256(await provider.getCode(name==='feeVault'?baseConfig.execution.feeVault:baseConfig[name]));
  const feeRpc=alter(provider,{getFeeData:async()=>({maxFeePerGas:41420000n,maxPriorityFeePerGas:0n})});
  let saved=await hre.network.provider.send('evm_snapshot');fs.mkdirSync('output/test',{recursive:true});
  async function setup(changes={}){
   await hre.network.provider.send('evm_revert',[saved]);saved=await hre.network.provider.send('evm_snapshot');
   const c={...baseConfig,execution:{...baseConfig.execution,...changes}},dir=fs.mkdtempSync('output/test/executor-schedule-'),file=path.join(dir,'journal.json');
   const wallet=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk'),signed=[];
   const journal=()=>JSON.parse(fs.readFileSync(file,'utf8')).state;
   const signer={getAddress:()=>wallet.getAddress(),signTransaction:async tx=>{
    const before=journal();assert.ok(before.schedule,'schedule must be durable before any signature');
    if(tx.to.toLowerCase()===c.execution.feeVault.toLowerCase())assert.equal(before.schedule.active?.phase,'harvest');
    else if(tx.data.startsWith(reward.interface.getFunction('distributeEligible').selector)){assert.equal(before.schedule.active?.phase,'allocation');assert.equal(before.schedule.active.roundId,before.round.id);}
    signed.push(tx);return wallet.signTransaction(tx);
   }};
   const cycle=async(rpc=feeRpc)=>{Date.now=()=>(currentTime*1000);currentTime=(await provider.getBlock('latest')).timestamp;return executeCycle(rpc,signer,c,dir);};
   let currentTime=(await provider.getBlock('latest')).timestamp;
   const at=async timestamp=>{await hre.network.provider.send('evm_setNextBlockTimestamp',[timestamp]);await hre.network.provider.send('evm_mine');};
   return {c,dir,file,journal,signed,cycle,at};
  }

  await t.test('finality recovery and restarted sub-batches finish one interval without another harvest or catch-up round',async()=>{
   const s=await setup();const first=await s.cycle();assert.equal(first.kind,'harvest');assert.equal(first.state,'submitted');
   const initial=s.journal(),dueAt=initial.schedule.active.dueAt;
   assert.equal(initial.round,null,'allocation must wait for the harvest');
   const receipt=await provider.getTransactionReceipt(first.hash);
   const blockedFinality=alter(feeRpc,{getBlock:async tag=>provider.getBlock(tag==='finalized'?receipt.blockNumber-1:tag)});
   assert.equal((await s.cycle(blockedFinality)).state,'waiting-for-finality');assert.equal(s.signed.length,1);assert.equal(s.journal().schedule.active.phase,'harvest');
   assert.equal((await s.cycle()).state,'confirmed');assert.equal(s.journal().schedule.active.phase,'allocation');
   const paidAccounts=new Set();let payouts=0;
   while(true){
    const result=await s.cycle();assert.equal(result.kind,'payout');assert.equal(result.state,'submitted');payouts++;
    const txReceipt=await provider.getTransactionReceipt(result.hash);
    for(const log of txReceipt.logs){let parsed;try{parsed=reward.interface.parseLog(log);}catch{}
     if(parsed?.name==='RewardAllocated'){assert.ok(!paidAccounts.has(parsed.args.recipient));paidAccounts.add(parsed.args.recipient);}}
    assert.equal(s.journal().schedule.active.dueAt,dueAt);
    if(payouts===1)await s.at((await provider.getBlock('latest')).timestamp+950);
    assert.equal((await s.cycle()).state,'confirmed');
    if(!s.journal().round)break;
    assert.equal(s.journal().schedule.active.phase,'allocation');
   }
   assert.equal(payouts,2);assert.equal(paidAccounts.size,2);assert.equal(s.signed.length,3);
   const completed=s.journal();assert.equal(completed.schedule.active,null);assert.ok(completed.schedule.nextDueAt>(await provider.getBlock('latest')).timestamp);
   assert.equal((completed.schedule.nextDueAt-anchor)%900,0);assert.equal((await s.cycle()).state,'idle');assert.equal(s.signed.length,3);
  });

  await t.test('empty funding closes a slot; funds arriving before the next boundary cannot cause an early payout',async()=>{
   // High local harvest threshold isolates empty distributor funding while the
   // normal plan/payout minimum and all gas constraints remain enforced.
   const s=await setup({minimumHarvestWei:E.toString()});assert.equal((await s.cycle()).state,'idle');
   const due=s.journal().schedule.nextDueAt;assert.equal(s.journal().schedule.lastCompleted.outcome,'no-eligible-funded-round');assert.equal(s.signed.length,0);
   await(await owner.sendTransaction({to:await reward.getAddress(),value:E/1000n})).wait();
   await s.at(due-1);assert.equal((await s.cycle()).state,'idle');assert.equal(s.signed.length,0);
   await s.at(due);const result=await s.cycle();assert.equal(result.kind,'payout');assert.equal(s.signed.length,1);assert.equal(s.journal().schedule.active.dueAt,due);
  });

  await t.test('already deferred recipient retry is independent of the next allocation boundary',async()=>{
   const s=await setup({minimumHarvestWei:E.toString()});assert.equal((await s.cycle()).state,'idle');const due=s.journal().schedule.nextDueAt;
   const reject=await f.deploy('RejectEther'),recipient=await reject.getAddress();
   await(await owner.sendTransaction({to:await reward.getAddress(),value:10000000000000n})).wait();
   await(await reward.distribute(toBeHex(999,32),toBeHex(998,32),[recipient],[10000000000000n])).wait();
   assert.ok((await provider.getBlock('latest')).timestamp<due);
   assert.equal((await s.cycle()).kind,'retry');assert.equal(s.journal().schedule.active,null);assert.equal(s.journal().schedule.nextDueAt,due);
   assert.equal((await s.cycle()).state,'confirmed');assert.equal(s.journal().schedule.active,null);
   assert.equal((await s.cycle()).state,'idle');assert.equal(s.signed.length,1);
  });
 }finally{Date.now=realNow;f.provider.destroy();}
});

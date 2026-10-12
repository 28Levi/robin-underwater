import test from 'node:test';
import assert from 'node:assert/strict';
import {HDNodeWallet,Interface,Transaction,toBeHex} from 'ethers';
import {LossLedger} from '../src/ledger.mjs';
import {preparePlan,payoutInterface} from '../src/payout-plan.mjs';
import {rewardInterface,transferInterface} from '../src/replay.mjs';
import {validatePipelineReceipt} from '../src/pipeline-reservations.mjs';

const E=10n**18n,addr=n=>toBeHex(n,20),h=n=>toBeHex(n,32),now=10000;
const wallet=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
const account=addr(1),distributor=addr(2),token=addr(3);
const vault=new Interface(['function available() view returns(uint256)','function operator() view returns(address)','function processed(bytes32) view returns(bool)']);
const skipped=new Interface(['event RewardSkipped(bytes32 indexed batchId,address indexed recipient)']);

async function fixture({skip=false}={}){
 const c={chainId:4663,token,distributor,maxSnapshotAgeSeconds:300,maxFinalityLagSeconds:1800,batchSize:100,
  execution:{operator:wallet.address,feeVault:addr(4),confirmationMode:'pipelined-finalized-v1',maxInflightTransactions:8}};
 const cp={chainId:4663,blockNumber:100,blockHash:h(100),timestamp:9000},head={number:160,hash:h(160),timestamp:now};
 const ledger=new LossLedger({minimumAgeSeconds:300});
 ledger.apply({id:'buy',type:'buy',account,amount:E,costWei:2n*E,time:0});ledger.checkpoint=cp;
 const snapshot={ledger:ledger.serialize(),checkpoint:cp,generatedAt:now,oracle:{priceWeiPerToken:E,observedAt:cp.timestamp}};
 const allocations=[{account,amount:(E*6n/10n).toString(),balance:E.toString()}];
 const batchId=h(1),auditHash=h(2),data=payoutInterface.encodeFunctionData('distributeEligible',
  [batchId,auditHash,token,now+300,[account],[allocations[0].amount],[E]]);
 const raw=await wallet.signTransaction({chainId:4663,type:2,nonce:5,to:distributor,value:0,data,gasLimit:200000,maxFeePerGas:2,maxPriorityFeePerGas:0});
 const record={kind:'payout',raw,hash:Transaction.from(raw).hash,nonce:5,deadline:now+300,roundId:h(3),roundEnd:1,
  batchId,auditHash,allocations,mined:{blockNumber:120,blockHash:h(120),status:1},finalized:false};
 const event=(iface,name,args)=>({...iface.encodeEventLog(iface.getEvent(name),args),address:distributor,
  blockNumber:120,blockHash:h(120),transactionHash:record.hash});
 const logs=[event(rewardInterface,'BatchRecorded',[batchId,auditHash,skip?0:allocations[0].amount]),
  skip?event(skipped,'RewardSkipped',[batchId,account]):event(rewardInterface,'RewardAllocated',[batchId,account,allocations[0].amount])];
 const receipt={hash:record.hash,from:wallet.address,to:distributor,status:1,blockNumber:120,blockHash:h(120),logs};
 const f={c,cp,head,ledger,snapshot,record,receipt,logs,pastBudget:E,currentBudget:5n*E};
 f.provider={getNetwork:async()=>({chainId:4663n}),getTransactionReceipt:async()=>f.receipt,
  getBlock:async tag=>tag==='latest'?head:tag==='finalized'?{...f.cp,number:f.cp.blockNumber,hash:f.cp.blockHash}:
   {number:tag,hash:h(tag),timestamp:tag===100?9000:tag===160?now:9500},
  getLogs:async filter=>filter.address===distributor?f.logs.filter(l=>l.topics[0]===rewardInterface.getEvent('BatchRecorded').topicHash
   &&l.blockNumber>=filter.fromBlock&&l.blockNumber<=filter.toBlock):[],
  call:async request=>{
   const fn=vault.getFunction(request.data.slice(0,10));
   const budget=Number(request.blockTag)===f.cp.blockNumber?f.pastBudget:f.currentBudget;
   return vault.encodeFunctionResult(fn,[fn.name==='available'?budget:fn.name==='operator'?wallet.address:false]);
  }};
 return f;
}
const plan=f=>preparePlan(f.provider,f.c,f.snapshot,{now,reservations:[f.record]});

test('mined payout reserves finalized funds and loss despite newer deposits; overlay never changes durable snapshot',async()=>{
 const f=await fixture(),before=f.snapshot.ledger;
 const p=await plan(f);
 assert.equal(p.plan.budgetWei,E*4n/10n);assert.equal(p.plan.allocated,E*4n/10n);
 assert.equal(LossLedger.restore(p.reservationLedger).get(account).relief,E*6n/10n);
 assert.equal(f.snapshot.ledger,before);assert.equal(LossLedger.restore(before).get(account).relief,0n);
 // Repeating preparation/restart cannot compound the ephemeral credit.
 assert.equal((await plan(f)).plan.allocated,p.plan.allocated);
});

test('finalized replay replaces reservation once without applying the same compensation twice',async()=>{
 const f=await fixture();f.ledger.acknowledge(f.record.batchId,f.record.allocations);
 f.cp={...f.cp,blockNumber:140,blockHash:h(140),timestamp:9500};f.ledger.checkpoint=f.cp;
 f.snapshot={...f.snapshot,ledger:f.ledger.serialize(),checkpoint:f.cp,oracle:{priceWeiPerToken:E,observedAt:9500}};
 f.record.finalized=true;f.pastBudget=E*4n/10n;
 const p=await plan(f);
 assert.equal(p.pipelineReservations.reservedWei,'0');assert.equal(p.plan.allocated,E*4n/10n);
 assert.equal(LossLedger.restore(p.reservationLedger).get(account).relief,E*6n/10n);
});

test('skipped contract recipient stays conservatively reserved until finalized replay',async()=>{
 const f=await fixture({skip:true}),p=await plan(f);
 assert.equal(p.pipelineReservations.reservedWei,(E*6n/10n).toString());
 assert.equal(p.plan.allocated,E*4n/10n);
});

test('unknown, missing, duplicated or conflicting mined evidence stops planning',async()=>{
 for(const mutate of [
  f=>{f.logs=[{...f.logs[0],transactionHash:h(900)},f.logs[1]];},
  f=>{f.logs=[];},
  f=>{f.logs=[f.logs[0],f.logs[0],f.logs[1]];},
  f=>{f.receipt={...f.receipt,blockHash:h(999)};},
  f=>{f.record={...f.record,allocations:[{...f.record.allocations[0],amount:'1'}]};},
  f=>{f.receipt={...f.receipt,logs:[f.logs[0]]};}
 ]){
  const f=await fixture();mutate(f);await assert.rejects(plan(f));
 }
 const f=await fixture();
 await assert.rejects(preparePlan(f.provider,f.c,f.snapshot,{now}),/requires durable/);
 await assert.rejects(preparePlan(f.provider,f.c,f.snapshot,{now,reservations:[f.record,f.record]}));
});

test('outgoing token transfers still exclude recipients while reward reservations are in flight',async()=>{
 const f=await fixture(),original=f.provider.getLogs;
 const transfer={...transferInterface.encodeEventLog(transferInterface.getEvent('Transfer'),[account,addr(9),1n]),address:token};
 f.provider.getLogs=async filter=>filter.address===token?[transfer]:original(filter);
 const p=await plan(f);assert.equal(p.plan.allocated,0n);assert.deepEqual(p.changedAccountsExcluded,[account]);
});

test('receipt cannot substitute an amount, signer, contract, or replay identity',async()=>{
 const f=await fixture();assert.doesNotThrow(()=>validatePipelineReceipt(f.record,f.receipt,f.c));
 for(const receipt of [{...f.receipt,status:0},{...f.receipt,hash:h(10)},{...f.receipt,from:addr(20)},
  {...f.receipt,to:addr(21)}])assert.throws(()=>validatePipelineReceipt(f.record,receipt,f.c));
});

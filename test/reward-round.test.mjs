import test from 'node:test';import assert from 'node:assert/strict';
import {LossLedger} from '../src/ledger.mjs';
import {createRound,nextRoundBatch} from '../src/reward-round.mjs';
import {transferInterface} from '../src/replay.mjs';
const E=10n**18n,a=n=>'0x'+n.toString(16).padStart(40,'0'),hash='0x'+'a'.repeat(64);
function setup(){
 const ledger=new LossLedger({minimumAgeSeconds:0});
 for(let i=1;i<=101;i++)ledger.apply({id:String(i),type:'buy',account:a(i),amount:E,costWei:2n*E,time:0});
 const checkpoint={blockNumber:10,blockHash:hash,timestamp:100},oracle={priceWeiPerToken:E,observedAt:100,now:100};
 const prepared={checkpoint,plan:ledger.plan(101n,oracle),checkedHead:{number:11,hash},changedAccountsExcluded:[]};
 const snapshot={checkpoint,oracle},c={token:a(200),distributor:a(201),chainId:4663,batchSize:100};
 const provider={getBlock:async()=>({hash}),getLogs:async()=>[]};
 return {ledger,prepared,snapshot,c,provider,round:createRound(prepared)};
}
test('101 entitlements survive splitting and later batches cannot restart at the first recipient',async()=>{
 const x=setup(),first=await nextRoundBatch(x.provider,x.c,x.round,x.prepared,x.ledger,x.snapshot);
 assert.equal(first.entries.length,100);assert.equal(first.total,100n);assert.equal(x.round.nextIndex,0);
 x.round.nextIndex=first.end;
 const last=await nextRoundBatch(x.provider,x.c,x.round,x.prepared,x.ledger,x.snapshot);
 assert.equal(last.entries.length,1);assert.equal(last.entries[0].account,a(101));assert.equal(last.total,1n);
 assert.notEqual(last.batchId,first.batchId);
});
test('later batches skip recovered holders and holders who transferred out and back',async()=>{
 const x=setup();x.round.nextIndex=100;
 const profitable=await nextRoundBatch(x.provider,x.c,x.round,x.prepared,x.ledger,{...x.snapshot,oracle:{...x.snapshot.oracle,priceWeiPerToken:3n*E}});
 assert.equal(profitable.entries.length,0);
 const log=(from,to)=>({...transferInterface.encodeEventLog(transferInterface.getEvent('Transfer'),[from,to,E])});
 const moved={...x.provider,getLogs:async()=>[log(a(101),a(102)),log(a(102),a(101))]};
 assert.equal((await nextRoundBatch(moved,x.c,x.round,x.prepared,x.ledger,x.snapshot)).entries.length,0);
});

test('incoming dust after the round snapshot does not cancel the recipient entitlement',async()=>{
 const x=setup();x.round.nextIndex=100;
 const log={...transferInterface.encodeEventLog(transferInterface.getEvent('Transfer'),[a(102),a(101),1n])};
 const gifted={...x.provider,getLogs:async()=>[log]};
 const batch=await nextRoundBatch(gifted,x.c,x.round,x.prepared,x.ledger,x.snapshot);
 assert.equal(batch.entries.length,1);assert.equal(batch.entries[0].account,a(101));assert.equal(batch.entries[0].amount,1n);
});

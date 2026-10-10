import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface} from 'ethers';
import {LossLedger} from '../src/ledger.mjs';
import {preparePlan} from '../src/payout-plan.mjs';
import {transferInterface, rewardInterface} from '../src/replay.mjs';

const E=10n**18n, now=10000, account='0x'+'1'.repeat(40), other='0x'+'2'.repeat(40);
const c={chainId:4663,token:'0x'+'3'.repeat(40),distributor:'0x'+'4'.repeat(40),
 maxSnapshotAgeSeconds:300,maxFinalityLagSeconds:1800,batchSize:100};
const cp={chainId:4663,blockNumber:100,blockHash:'0x'+'a'.repeat(64),timestamp:9000};
const head={number:2600,hash:'0x'+'b'.repeat(64),timestamp:now};
const vault=new Interface(['function available() view returns(uint256)','function operator() view returns(address)',
 'function processed(bytes32) view returns(bool)']);

function fixture({rewardBlock=null,transferBlock=null}={}){
 const ledger=new LossLedger();
 ledger.apply({id:'buy',type:'buy',account,amount:E,costWei:2n*E,time:0});ledger.checkpoint=cp;
 const snapshot={ledger:ledger.serialize(),checkpoint:cp,generatedAt:now,
  oracle:{priceWeiPerToken:E,observedAt:cp.timestamp}};
 const ranges=[];
 const provider={getNetwork:async()=>({chainId:4663n}),
  getBlock:async n=>n==='latest'?head:{number:cp.blockNumber,hash:cp.blockHash,timestamp:cp.timestamp},
  getLogs:async filter=>{
   assert.ok(filter.toBlock-filter.fromBlock+1<=1000,'provider rejects ranges larger than 1,000 blocks');ranges.push(filter);
   const eventBlock=filter.address===c.distributor?rewardBlock:transferBlock;
   if(eventBlock===null||eventBlock<filter.fromBlock||eventBlock>filter.toBlock)return [];
   return filter.address===c.distributor
    ?[rewardInterface.encodeEventLog(rewardInterface.getEvent('BatchRecorded'),['0x'+'c'.repeat(64),'0x'+'d'.repeat(64),1n])]
    :[transferInterface.encodeEventLog(transferInterface.getEvent('Transfer'),[account,other,1n])];
  },
  call:async request=>{const fn=vault.getFunction(request.data.slice(0,10));
   return vault.encodeFunctionResult(fn,[fn.name==='available'?E:fn.name==='operator'?other:false]);},
 };
 return {provider,snapshot,ranges};
}

test('payout preparation bounds both event streams across a long finalized-to-head gap',async()=>{
 const f=fixture(),prepared=await preparePlan(f.provider,c,f.snapshot,{now});
 assert.equal(prepared.plan.allocated,E);assert.equal(prepared.transactions.length,1);
 for(const address of [c.token,c.distributor])assert.deepEqual(f.ranges.filter(r=>r.address===address).map(r=>[r.fromBlock,r.toBlock]),
  [[101,1100],[1101,2100],[2101,2600]]);
});

test('unfinalized allocations in any event chunk prevent another payout plan',async()=>{
 for(const rewardBlock of [101,1100,1101,2100,2101,2600]){
  const f=fixture({rewardBlock});
  await assert.rejects(preparePlan(f.provider,c,f.snapshot,{now}),/Wait for previous reward allocations/);
 }
});

test('outgoing inventory in the final event chunk still excludes that holder',async()=>{
 const f=fixture({transferBlock:2500}),prepared=await preparePlan(f.provider,c,f.snapshot,{now});
 assert.equal(prepared.plan.allocated,0n);assert.deepEqual(prepared.changedAccountsExcluded,[account]);
 assert.deepEqual(prepared.transactions,[]);
});

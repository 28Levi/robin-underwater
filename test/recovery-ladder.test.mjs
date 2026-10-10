import test from 'node:test';import assert from 'node:assert/strict';
import {allocateRecoveryLadder as allocate} from '../src/recovery-ladder.mjs';
import {LossLedger} from '../src/ledger.mjs';
const E=10n**18n;
const rows=[{account:'alice',basis:100n*E,loss:60n*E},{account:'bob',basis:100n*E,loss:30n*E},{account:'charlie',basis:100n*E,loss:10n*E}];
const amounts=p=>Object.fromEntries(p.allocations.map(x=>[x.account,x.amount/E]));
test('recovery climbs through 60%, 30%, 10% tiers and stops at recovery',()=>{
 assert.deepEqual(amounts(allocate(rows,20n*E)),{alice:20n});
 assert.deepEqual(amounts(allocate(rows,30n*E)),{alice:30n});
 assert.deepEqual(amounts(allocate(rows,50n*E)),{alice:40n,bob:10n});
 assert.deepEqual(amounts(allocate(rows,70n*E)),{alice:50n,bob:20n});
 assert.deepEqual(amounts(allocate(rows,85n*E)),{alice:55n,bob:25n,charlie:5n});
 const full=allocate(rows,120n*E);assert.equal(full.allocated,100n*E);assert.equal(full.carryForward,20n*E);
});
test('a deeper small position outranks a large shallow one; ties share by basis',()=>{
 const p=[{account:'small',basis:100n,loss:60n},{account:'large',basis:10000n,loss:1000n}];
 assert.deepEqual(allocate(p,40n).allocations.map(x=>[x.account,x.amount]),[['small',40n]]);
 const tied=allocate([{account:'a',basis:100n,loss:50n},{account:'b',basis:300n,loss:150n}],40n);
 assert.deepEqual(tied.allocations.map(x=>x.amount),[10n,30n]);
});
test('identical position splitting cannot increase combined payment; order is deterministic',()=>{
 for(let n=0;n<120;n++){
  const whole=allocate(rows,BigInt(n)*E);
  const split=allocate([{account:'a1',basis:25n*E,loss:15n*E},{account:'a2',basis:75n*E,loss:45n*E},...rows.slice(1)],BigInt(n)*E);
  const original=whole.allocations.find(x=>x.account==='alice')?.amount??0n;
  const pieces=split.allocations.filter(x=>x.account.startsWith('a')).reduce((s,x)=>s+x.amount,0n);
  assert.ok(pieces<=original&&original-pieces<=1n);
  assert.deepEqual(allocate([...rows].reverse(),BigInt(n)*E),whole);
 }
});
test('integer rounding is conservative and priority levels agree across varied positions',()=>{
 for(let n=1;n<300;n++){
  const positions=Array.from({length:7},(_,i)=>{const basis=BigInt(1+(n*37+i*19)%300);return {account:String(i),basis,loss:1n+BigInt(n+i*7)%basis};});
  const budget=BigInt(n*3),p=allocate(positions,budget),paid=new Map(p.allocations.map(x=>[x.account,x.amount]));
  assert.ok(p.allocated<=budget&&p.allocated<=p.totalLoss);assert.equal(p.allocated+p.carryForward,budget);
  for(const row of positions){const amount=paid.get(row.account)??0n;assert.ok(amount>=0n&&amount<=row.loss);
   if(amount>0n){const {numerator,denominator}=p.targetLossRatio;
    const error=(row.loss-amount)*denominator-row.basis*numerator;
    assert.ok(error>=0n&&error<denominator);
   }
  }
 }
});
test('prior relief and partial maturity determine remaining percentage; old policy snapshots fail closed',()=>{
 const l=new LossLedger(),a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40);
 l.apply({id:'a',type:'buy',account:a,amount:40n*E,costWei:100n*E,time:0});
 l.apply({id:'b',type:'buy',account:b,amount:70n*E,costWei:100n*E,time:0});
 l.acknowledge('aid',[{account:a,amount:40n*E}]);
 const oracle={priceWeiPerToken:E,observedAt:7200,now:7200};
 assert.equal(l.plan(5n*E,oracle).allocations[0].account,b);
 l.apply({id:'new',type:'buy',account:b,amount:70n*E,costWei:100n*E,time:7100});
 const position=l.shortfalls(oracle).find(p=>p.account===b);
 assert.equal(position.basis,100n*E);assert.equal(position.loss,30n*E);
 const old=JSON.parse(l.serialize());old.version=3;assert.throws(()=>LossLedger.restore(JSON.stringify(old)),/Unsupported ledger/);
});
test('invalid and empty inputs fail safely',()=>{
 assert.equal(allocate([],5n).carryForward,5n);assert.equal(allocate(rows,0n).allocated,0n);
 assert.throws(()=>allocate(rows,-1n));assert.throws(()=>allocate([rows[0],rows[0]],1n));
 assert.throws(()=>allocate([{account:'a',basis:0n,loss:1n}],1n));
});
test('payment recipients remain sorted for the deployed distributor despite priority ranking',()=>{
 const result=allocate([{account:'0x01',basis:100n,loss:20n},{account:'0x03',basis:100n,loss:60n},{account:'0x02',basis:100n,loss:40n}],80n);
 assert.deepEqual(result.allocations.map(x=>x.account),['0x01','0x02','0x03']);
 assert.ok(result.allocations[2].amount>result.allocations[0].amount);
});

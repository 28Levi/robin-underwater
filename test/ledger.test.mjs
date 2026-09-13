import test from 'node:test';
import assert from 'node:assert/strict';
import {LossLedger} from '../src/ledger.mjs';
import {twap} from '../src/oracle.mjs';
const E=10n**18n,A='0x0000000000000000000000000000000000000001',B='0x0000000000000000000000000000000000000002',C='0x0000000000000000000000000000000000000003';
const oracle={priceWeiPerToken:E,observedAt:7200,now:7200};
function buy(l,a,quantity,cost,id=a,time=0){l.apply({id,type:'buy',account:a,amount:quantity*E,costWei:cost*E,time});}
test('only underwater holders receive funds, weighted by absolute loss',()=>{
 const l=new LossLedger();buy(l,A,4n,2n);buy(l,B,4n,6n);buy(l,C,4n,5n);
 const p=l.plan(3n*E/10n,oracle);
 assert.deepEqual(p.allocations.map(a=>[a.account,a.amount]),[[B,E/5n],[C,E/10n]]);
 assert.equal(p.carryForward,0n);
});
test('partial sale removes proportional cost and prior relief; exit removes eligibility',()=>{
 const l=new LossLedger();buy(l,A,4n,8n);l.acknowledge('b1',[{account:A,amount:E}]);
 l.apply({id:'sell1',type:'sell',account:A,amount:2n*E,time:50});
 assert.equal(l.get(A).cost,4n*E);assert.equal(l.get(A).relief,E/2n);
 assert.equal(l.shortfalls(oracle)[0].loss,3n*E/2n);
 l.apply({id:'sell2',type:'sell',account:A,amount:2n*E,time:60});assert.equal(l.plan(E,oracle).allocated,0n);
});
test('transferring between wallets preserves total basis and cannot duplicate loss',()=>{
 const l=new LossLedger();buy(l,A,10n,20n);l.acknowledge('batch',[{account:A,amount:2n*E}]);
 l.apply({id:'transfer',type:'transfer',from:A,to:B,amount:4n*E,time:10});
 const losses=l.shortfalls(oracle);assert.equal(losses.reduce((n,w)=>n+w.loss,0n),8n*E);
 assert.equal(l.get(A).cost+l.get(B).cost,20n*E);
 assert.equal(l.get(A).relief+l.get(B).relief,2n*E);
});
test('self transfer does not reset age or create basis',()=>{
 const l=new LossLedger();buy(l,A,2n,4n);const before=l.serialize();
 l.apply({id:'self',type:'transfer',from:A,to:A,amount:E,time:7100});
 assert.equal(l.get(A).lastAcquired,0);assert.equal(l.get(A).cost,4n*E);
 assert.equal(l.plan(E,oracle).allocated,E);assert.notEqual(l.serialize(),before);
});
test('prior aid reduces shortfall; oversized budget cannot pay beyond recovery',()=>{
 const l=new LossLedger();buy(l,A,1n,2n);l.acknowledge('b',[{account:A,amount:E/4n}]);
 const p=l.plan(10n*E,oracle);assert.equal(p.allocated,3n*E/4n);
 l.acknowledge('c',p.allocations);assert.equal(l.plan(E,oracle).allocated,0n);
});
test('unknown gifted supply starts at zero basis and earns no made-up loss',()=>{
 const l=new LossLedger();l.apply({id:'genesis',type:'transfer',from:'0x'+'0'.repeat(40),to:A,amount:E,time:0});
 assert.equal(l.plan(E,oracle).allocated,0n);
});
test('age gate, stale oracle, future oracle and quarantined account fail closed',()=>{
 const l=new LossLedger();buy(l,A,1n,2n,'buy',7100);assert.equal(l.plan(E,oracle).allocated,0n);
 assert.throws(()=>l.plan(E,{...oracle,observedAt:1}),/Stale/);
 assert.throws(()=>l.plan(E,{...oracle,observedAt:8000}),/future/);
 l.get(A).lastAcquired=0;l.quarantine(A);assert.equal(l.plan(E,oracle).allocated,0n);
});
test('replay protection and persistence preserve exact integer accounting',()=>{
 const l=new LossLedger();buy(l,A,2n,4n);assert.throws(()=>buy(l,A,2n,4n),/duplicate/);
 l.acknowledge('batch',[{account:A,amount:1n}]);assert.throws(()=>l.acknowledge('batch',[]),/Duplicate/);
 const restored=LossLedger.restore(l.serialize());assert.equal(restored.serialize(),l.serialize());
 assert.equal(restored.plan(E,oracle).auditHash,l.plan(E,oracle).auditHash);
});
test('random split allocations never exceed budget, loss or available funds',()=>{
 for(let seed=1;seed<=100;seed++){
  const l=new LossLedger();buy(l,A,1n,BigInt(2+seed%9));buy(l,B,2n,BigInt(3+seed%11));
  const budget=BigInt(seed)*12345678901234567n,p=l.plan(budget,oracle);
  assert.ok(p.allocated<=budget&&p.allocated<=p.totalLoss);
  assert.equal(p.allocated+p.carryForward,budget);
  for(const a of p.allocations)assert.ok(a.amount<=a.loss);
 }
});
test('TWAP respects duration and does not give a last-second move the full window',()=>{
 const Q=1n<<96n;
 const price=twap([{time:0,sqrtPriceX96:Q},{time:99,sqrtPriceX96:2n*Q}],0,100);
 assert.equal(price.priceWeiPerToken,(99n*E+E/4n)/100n);
 assert.throws(()=>twap([{time:2,sqrtPriceX96:Q}],0,100),/Missing/);
 assert.throws(()=>twap([{time:2,sqrtPriceX96:Q},{time:1,sqrtPriceX96:Q}],0,100));
});

test('fresh buys and gifts wait independently without borrowing old inventory maturity',()=>{
 const l=new LossLedger();buy(l,A,1n,2n);buy(l,A,9n,18n,'fresh',7100);
 assert.equal(l.shortfalls(oracle)[0].loss,E);
 assert.equal(l.shortfalls({...oracle,now:10700,observedAt:10700})[0].loss,10n*E);
 const gift=new LossLedger();buy(gift,A,1n,2n);buy(gift,B,9n,18n);
 gift.apply({id:'gift',type:'transfer',from:B,to:A,amount:9n*E,time:7100});
 assert.equal(gift.shortfalls(oracle)[0].loss,E);
 assert.equal(gift.get(B).balance,0n);assert.deepEqual(gift.get(B).ageLots,[]);
});

test('exits consume oldest age inventory while cost and relief remain proportional',()=>{
 const l=new LossLedger();buy(l,A,2n,4n);buy(l,A,2n,4n,'fresh',7100);
 l.acknowledge('aid',[{account:A,amount:E}]);
 l.apply({id:'partial',type:'transfer',from:A,to:B,amount:E,time:7150});
 assert.equal(l.get(A).cost,6n*E);assert.equal(l.get(A).relief,3n*E/4n);
 assert.equal(l.get(B).cost,2n*E);assert.equal(l.get(B).relief,E/4n);
 assert.deepEqual(l.get(A).ageLots,[{unlockAt:0,amount:E},{unlockAt:10700,amount:2n*E}]);
 assert.equal(l.shortfalls(oracle)[0].loss,3n*E/4n);
 l.apply({id:'sell-old',type:'sell',account:A,amount:E,time:7190});
 assert.deepEqual(l.shortfalls(oracle),[]);
 l.apply({id:'exit',type:'sell',account:A,amount:2n*E,time:7191});
 assert.equal(l.get(A).cost,0n);assert.equal(l.get(A).relief,0n);assert.deepEqual(l.get(A).ageLots,[]);
});

test('age inventory survives restart and rejects old or inconsistent snapshots',()=>{
 const l=new LossLedger();buy(l,A,1n,2n);buy(l,A,2n,4n,'fresh',7100);
 const saved=l.serialize(),restored=LossLedger.restore(saved);
 assert.equal(restored.serialize(),saved);assert.equal(restored.plan(E,oracle).auditHash,l.plan(E,oracle).auditHash);
 const old=JSON.parse(saved);old.version=1;assert.throws(()=>LossLedger.restore(JSON.stringify(old)),/replay chain history/);
 const broken=JSON.parse(saved);broken.accounts[0][1].ageLots[0].amount='1';
 assert.throws(()=>LossLedger.restore(JSON.stringify(broken)),/age inventory/);
 const before=l.serialize();l.plan(E,oracle);assert.equal(l.serialize(),before,'planning must not mutate maturity');
});

test('many partial transfers preserve age quantities, basis and relief with integer rounding',()=>{
 const l=new LossLedger();buy(l,A,10n,20n);l.acknowledge('aid',[{account:A,amount:E}]);
 for(let i=1;i<=80;i++){
  const from=i%2?A:B,to=i%2?B:A,amount=l.get(from).balance/3n;
  l.apply({id:'move'+i,type:'transfer',from,to,amount,time:7000+i});
  for(const account of [A,B])assert.equal(l.get(account).ageLots.reduce((sum,lot)=>sum+lot.amount,0n),l.get(account).balance);
  assert.equal(l.get(A).cost+l.get(B).cost,20n*E);assert.equal(l.get(A).relief+l.get(B).relief,E);
  assert.ok(l.plan(100n*E,oracle).totalLoss<=9n*E);
 }
 assert.equal(LossLedger.restore(l.serialize()).serialize(),l.serialize());
});

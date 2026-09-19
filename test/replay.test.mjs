import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {Interface} from 'ethers';
import {LossLedger} from '../src/ledger.mjs';
import {applyReceipt,rewardInterface} from '../src/replay.mjs';
import {readSnapshot,writeSnapshot,acquireLock} from '../src/store.mjs';
import {hookInterface} from '../src/receipt-adapter.mjs';
const a=n=>'0x'+n.toString(16).padStart(40,'0'),E=10n**18n;
const c={token:a(1),hook:a(2),poolManager:a(3),distributor:a(4),poolId:'0x'+'1'.repeat(64),excludedAddresses:[],chainId:31337};
const erc20=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const transfer=(from,to,amount,index)=>({address:c.token,index,...erc20.encodeEventLog(erc20.getEvent('Transfer'),[from,to,amount])});
const receipt=logs=>({hash:'0x'+'2'.repeat(64),status:1,logs});
function ledger(){const l=new LossLedger();l.apply({id:'buy',type:'buy',account:a(9),amount:E,costWei:2n*E,time:0});return l;}

test('sending 90 percent then the remaining tokens cannot manufacture a loss at an unchanged price',()=>{
 const l=new LossLedger();l.apply({id:'original-buy',type:'buy',account:a(9),amount:100n*E,costWei:E,time:0});
 const partial=applyReceipt(l,receipt([transfer(a(9),a(10),90n*E,1)]),c,100).ledger;
 const flat={priceWeiPerToken:E/100n,observedAt:7200,now:7200};
 assert.equal(partial.get(a(9)).balance,10n*E);assert.equal(partial.get(a(9)).cost,E/10n);
 assert.equal(partial.get(a(10)).cost,9n*E/10n);assert.equal(partial.plan(E,flat).totalLoss,0n);
 const nextReceipt={...receipt([transfer(a(9),a(10),10n*E,2)]),hash:'0x'+'7'.repeat(64)};
 const complete=applyReceipt(partial,nextReceipt,c,200).ledger;
 assert.equal(complete.get(a(9)).balance,0n);assert.equal(complete.get(a(9)).cost,0n);
 assert.equal(complete.get(a(10)).cost,E);assert.equal(complete.plan(E,flat).allocated,0n);
 // A later genuine price decline belongs only to the wallet still holding the tokens.
 const fallen=complete.plan(E,{...flat,priceWeiPerToken:E/200n});
 assert.deepEqual(fallen.allocations.map(x=>[x.account,x.loss]),[[a(10),E/2n]]);
});
test('ambiguous incoming dust cannot quarantine or reset the age of an existing holder',()=>{
 const l=ledger(),result=applyReceipt(l,receipt([transfer(a(3),a(9),1n,1)]),c,7100);
 assert.equal(result.ledger.get(a(9)).quarantined,false);
 assert.deepEqual(result.ledger.get(a(9)).ageLots,[{unlockAt:0,amount:E},{unlockAt:10700,amount:1n}]);
 assert.equal(result.ledger.get(a(9)).cost,2n*E);assert.equal(result.ledger.get(a(9)).balance,E+1n);
 assert.ok(result.ledger.plan(E,{priceWeiPerToken:E,observedAt:7200,now:7200}).allocated>0n);
 assert.equal(l.get(a(9)).balance,E);
});
test('a malformed later transfer rolls back the complete receipt',()=>{
 const l=ledger(),before=l.serialize();
 assert.throws(()=>applyReceipt(l,receipt([transfer(a(9),a(10),E/2n,1),transfer(a(9),a(11),E,2)]),c,100),/Insufficient/);
 assert.equal(l.serialize(),before);
});
test('replaying an ambiguous receipt is rejected',()=>{
 const r=receipt([transfer(a(3),a(9),1n,1)]),next=applyReceipt(ledger(),r,c,100).ledger;
 assert.throws(()=>applyReceipt(next,r,c,100),/Duplicate/);
});
test('reward replay counts each new allocation, never a retry of old pending ETH',()=>{
 const batch='0x'+'3'.repeat(64),audit='0x'+'4'.repeat(64);
 const log=(name,args,index)=>({address:c.distributor,index,...rewardInterface.encodeEventLog(rewardInterface.getEvent(name),args)});
 const r=receipt([log('BatchRecorded',[batch,audit,E/2n],1),log('RewardAllocated',[batch,a(9),E/2n],2)]);
 const next=applyReceipt(ledger(),r,c,100).ledger;assert.equal(next.get(a(9)).relief,E/2n);
 assert.throws(()=>applyReceipt(next,r,c,100),/Duplicate reward/);
 const bad=receipt([log('BatchRecorded',[batch,audit,E],1),log('RewardAllocated',[batch,a(9),E/2n],2)]);
 assert.throws(()=>applyReceipt(ledger(),bad,c,100),/sum mismatch/);
});
test('snapshot cache is atomic, configuration-bound and detects corruption',()=>{
 fs.mkdirSync('output/test',{recursive:true});const dir=fs.mkdtempSync('output/test/store-'),file=path.join(dir,'snapshot.json');
 assert.equal(readSnapshot(file,c),null);writeSnapshot(file,c,{value:'one'});assert.deepEqual(readSnapshot(file,c),{value:'one'});
 writeSnapshot(file,c,{value:'two'});assert.deepEqual(readSnapshot(file,c),{value:'two'});
 assert.throws(()=>readSnapshot(file,{...c,chainId:4663}),/mismatch/);
 const raw=JSON.parse(fs.readFileSync(file));raw.payload='{}';fs.writeFileSync(file,JSON.stringify(raw));
 assert.throws(()=>readSnapshot(file,c),/integrity/);
});
test('worker lock rejects concurrent runs and releases cleanly',()=>{
 fs.mkdirSync('output/test',{recursive:true});const dir=fs.mkdtempSync('output/test/lock-'),file=path.join(dir,'worker.lock');
 const release=acquireLock(file);assert.throws(()=>acquireLock(file),/lock/);release();acquireLock(file)();
});

const batch='0x'+'3'.repeat(64),audit='0x'+'4'.repeat(64);
const rewardLog=(name,args,index)=>({address:c.distributor,index,...rewardInterface.encodeEventLog(rewardInterface.getEvent(name),args)});
const allocation=(amount=E/2n)=>[rewardLog('BatchRecorded',[batch,audit,amount],1),rewardLog('RewardAllocated',[batch,a(9),amount],2)];
test('full and partial callback transfers carry prior relief in log order',()=>{
 for(const amount of [E,E/2n]){
  const r=receipt([...allocation(),transfer(a(9),a(10),amount,3)]);
  const next=applyReceipt(ledger(),r,c,100).ledger;
  assert.equal(next.get(a(10)).relief,amount/2n);assert.equal(next.get(a(9)).relief,(E-amount)/2n);
  assert.equal(next.get(a(10)).cost,2n*amount);
  assert.equal(applyReceipt(ledger(),{...r,logs:[...r.logs].reverse()},c,100).ledger.serialize(),next.serialize());
 }
});
test('allocation after a transfer stays with its actual recipient; logIndex is supported',()=>{
 const r=receipt([transfer(a(9),a(10),E/2n,0),...allocation()].map(({index,...log})=>({...log,logIndex:index})));
 const next=applyReceipt(ledger(),r,c,100).ledger;
 assert.equal(next.get(a(10)).relief,0n);assert.equal(next.get(a(9)).relief,E/2n);
});
test('bad callback and malformed allocation leave original ledger unchanged',()=>{
 for(const logs of [[...allocation(),transfer(a(9),a(10),2n*E,3)],
  [...allocation(),rewardLog('RewardAllocated',[batch,a(9),1n],3)],
  [rewardLog('RewardAllocated',[batch,a(9),1n],3)]]){
  const l=ledger(),before=l.serialize();assert.throws(()=>applyReceipt(l,receipt(logs),c,100));assert.equal(l.serialize(),before);
 }
});
test('payment retries and all-skipped batches add no relief',()=>{
 const logs=[rewardLog('BatchRecorded',[batch,audit,0n],1),rewardLog('RewardPaid',[a(9),E],2)];
 const next=applyReceipt(ledger(),receipt(logs),c,100).ledger;assert.equal(next.get(a(9)).relief,0n);
 assert.throws(()=>applyReceipt(next,receipt(logs),c,100),/Duplicate reward/);
});
test('reward crossing a collapsed swap route is conservatively unsupported',()=>{
 const trade={address:c.hook,index:0,...hookInterface.encodeEventLog(hookInterface.getEvent('TradeObserved'),[c.poolId,a(8),true,E,E,1n,1n<<96n,0])};
 const logs=[trade,transfer(c.poolManager,a(9),E,1),rewardLog('BatchRecorded',[batch,audit,E/2n],2),
  rewardLog('RewardAllocated',[batch,a(9),E/2n],3),transfer(a(9),a(10),E,4)];
 const next=applyReceipt(ledger(),receipt(logs),c,100);
 assert.match(next.unsupported.reason,/crosses swap/);
 assert.equal(next.ledger.get(a(9)).relief,E/4n);
 assert.equal(next.ledger.get(a(10)).cost,0n); // Unsupported new ownership never invents purchase basis.
});
test('pre-fix ledgers cannot be reused after chronology migration',()=>{
 const old=JSON.parse(ledger().serialize());old.version=2;
 assert.throws(()=>LossLedger.restore(JSON.stringify(old)),/Unsupported ledger/);
});

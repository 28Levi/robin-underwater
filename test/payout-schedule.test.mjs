import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {payoutSchedulePolicy,openPayoutCycle,completeScheduledHarvest,bindScheduledRound,finishPayoutCycle,validatePayoutSchedule} from '../src/payout-schedule.mjs';
import {executionBinding,readJournal,writeJournal} from '../src/execution-journal.mjs';
import {fingerprint} from '../src/store.mjs';
import {stringify,address} from '../src/ledger.mjs';
const policy={intervalSeconds:900,anchorTimestamp:1000},empty=()=>({pending:null,round:null});
const roundId='0x'+'a'.repeat(64);
test('first interval is not due at 899 seconds and opens exactly at 900',()=>{
 const state=empty();assert.equal(openPayoutCycle(state,policy,1899),false);assert.equal(state.schedule.nextDueAt,1900);
 assert.equal(openPayoutCycle(state,policy,1900),true);assert.deepEqual(state.schedule.active,{dueAt:1900,startedAt:1900,phase:'harvest',roundId:null});
});
test('harvest and every chunk share one durable interval until the whole round completes',()=>{
 const state=empty();openPayoutCycle(state,policy,1900);completeScheduledHarvest(state);
 state.round={id:roundId,allocations:[1,2,3],nextIndex:0};bindScheduledRound(state);
 const restarted=JSON.parse(JSON.stringify(state));restarted.round.nextIndex=1;
 assert.equal(openPayoutCycle(restarted,policy,1905),true);assert.equal(restarted.schedule.active.dueAt,1900);assert.equal(restarted.schedule.active.roundId,roundId);
 assert.throws(()=>finishPayoutCycle(restarted,1905),/unresolved/);
 restarted.round=null;finishPayoutCycle(restarted,1910);
 assert.equal(restarted.schedule.nextDueAt,2800);assert.equal(openPayoutCycle(restarted,policy,2799),false);
});
test('empty funded allocation closes the interval and delayed completion never queues catch-up bursts',()=>{
 const state=empty();openPayoutCycle(state,policy,1900);completeScheduledHarvest(state);finishPayoutCycle(state,1902);
 assert.equal(state.schedule.lastCompleted.outcome,'no-eligible-funded-round');assert.equal(openPayoutCycle(state,policy,2300),false);
 assert.equal(openPayoutCycle(state,policy,5501),true);assert.equal(state.schedule.active.dueAt,5500);
 completeScheduledHarvest(state);finishPayoutCycle(state,7300);
 assert.equal(state.schedule.nextDueAt,8200);assert.equal(openPayoutCycle(state,policy,7300),false);
});
test('a pending transaction cannot close or advance its scheduled interval',()=>{
 const state=empty();openPayoutCycle(state,policy,1900);completeScheduledHarvest(state);state.pending={kind:'payout'};
 assert.throws(()=>finishPayoutCycle(state,4000),/unresolved/);assert.equal(state.schedule.nextDueAt,1900);
});
test('invalid anchors and corrupted persisted schedule are rejected; missing interval retains legacy behavior',()=>{
 assert.equal(payoutSchedulePolicy({execution:{}}),null);assert.equal(openPayoutCycle(empty(),null,1900),false);
 for(const c of [{execution:{payoutIntervalSeconds:900}},{execution:{payoutIntervalSeconds:900},payoutStartTimestamp:0},{execution:{payoutIntervalSeconds:0},payoutStartTimestamp:1000}])assert.throws(()=>payoutSchedulePolicy(c),/Invalid/);
 const state=empty();openPayoutCycle(state,policy,1900);state.schedule.active.phase='paid';assert.throws(()=>validatePayoutSchedule(state.schedule),/Invalid/);
});
test('journal reload preserves interval phase; anchor changes are bound while historical bindings remain exact',()=>{
 const c={name:'ROBINHOOK',symbol:'ROBIN',chainId:4663,token:'0x'+'1'.repeat(40),hook:'0x'+'2'.repeat(40),distributor:'0x'+'3'.repeat(40),excludedAddresses:[],minimumAgeSeconds:300,batchSize:100,maxSnapshotAgeSeconds:300,maxFinalityLagSeconds:1800,execution:{mode:'local-only'}};
 const operator='0x'+'4'.repeat(40);
 const historical=createHash('sha256').update(stringify({payoutPolicy:'minimum-balance-skip-v1',tokenIdentity:{name:c.name,symbol:c.symbol},ledger:fingerprint(c),execution:c.execution,operator:address(operator),batchSize:c.batchSize,maxSnapshotAgeSeconds:c.maxSnapshotAgeSeconds,maxFinalityLagSeconds:c.maxFinalityLagSeconds})).digest('hex');
 assert.equal(executionBinding(c,operator),historical);
 const configured={...c,payoutStartTimestamp:1000,execution:{...c.execution,payoutIntervalSeconds:900}},binding=executionBinding(configured,operator);
 assert.notEqual(binding,executionBinding({...configured,payoutStartTimestamp:1001},operator));
 fs.mkdirSync('output/test',{recursive:true});const dir=fs.mkdtempSync('output/test/payout-schedule-'),file=path.join(dir,'journal.json');
 const state=readJournal(file,binding);openPayoutCycle(state,policy,1900);writeJournal(file,state);completeScheduledHarvest(state);writeJournal(file,state);
 const restored=readJournal(file,binding);assert.equal(restored.schedule.active.phase,'allocation');assert.equal(restored.schedule.active.dueAt,1900);
 assert.throws(()=>readJournal(file,executionBinding({...configured,payoutStartTimestamp:1001},operator)),/mismatch/);
});

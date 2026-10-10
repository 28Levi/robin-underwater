import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {allocateRecoveryLadder} from '../src/recovery-ladder.mjs';import {stringify} from '../src/ledger.mjs';
const input=process.argv[2];if(!input)throw Error('Usage: node scripts/verify-recovery-report.mjs <payout-plan-or-report.json>');
const saved=JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,''));const plan=saved.plan??saved;
if(plan.schemaVersion!=='robin.loss-allocation.v3')throw Error('Expected a recovery-ladder report');
const {auditHash,...content}=plan;
assert.equal(auditHash,'0x'+createHash('sha256').update(stringify(content)).digest('hex'),'Report commitment mismatch');
const result=JSON.parse(stringify(allocateRecoveryLadder(plan.eligiblePositions,plan.budgetWei)));
for(const [field,value] of Object.entries(result))assert.deepEqual(plan[field],value,`Allocation mismatch: ${field}`);
console.log(JSON.stringify({status:'arithmetic-and-commitment-verified',policy:result.policy,
 recipients:result.allocations.length,allocatedWei:result.allocated,
 limitation:'This verifies the calculation from supplied inputs, not their completeness or agreement with chain history.'}));

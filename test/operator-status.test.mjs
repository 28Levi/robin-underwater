import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorFailureStatus} from '../src/operator-status.mjs';

test('production gas failures retain distinct stable blocked codes without leaking supplied messages',()=>{
 for(const code of ['PER_TRANSACTION_GAS_CAP','CUMULATIVE_GAS_CAP','PAYOUT_GAS_MINIMUM_CONFLICT']){
  const status=operatorFailureStatus({code,message:'https://rpc.invalid/private-api-key',maxFeePerGas:123n});
  assert.equal(status.state,'blocked');assert.equal(status.code,code);
  assert.match(status.reason,code==='CUMULATIVE_GAS_CAP'?/cumulative gas allowance/:/per-transaction gas cap/);
  if(code==='PAYOUT_GAS_MINIMUM_CONFLICT')assert.match(status.reason,/minimum batch value/);
  assert.match(status.reason,/preserve/);assert.doesNotMatch(JSON.stringify(status),/private-api-key|123/);
 }
});
test('only existing finalized-history waits remain automatic; other failures stay blocked',()=>{
 for(const message of ['Deployment is not finalized','Wait for previous reward allocations to finalize before another plan',
  'Head changed during preparation; rebuild next cycle','Head changed during estimation; rebuild next cycle'])
  assert.equal(operatorFailureStatus(new Error(message)).state,'waiting');
 for(const error of [new Error('Missing window history'),new Error('Initial finalized price window is warming up'),
  new Error('Finalized transaction reverted; reconcile before resuming'),new Error('Operator nonce was consumed by an unknown transaction'),
  {code:'https://rpc.invalid/private-api-key',message:'secret keystore error'},null]){
  const status=operatorFailureStatus(error);assert.equal(status.state,'blocked');
  assert.deepEqual(Object.keys(status).sort(),['reason','state']);assert.doesNotMatch(JSON.stringify(status),/private-api-key|secret/);
 }
});

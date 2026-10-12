import test from 'node:test';
import assert from 'node:assert/strict';
import {withReadOnlyRpcRetries,isRetryableRpcReadError,assertOperatorRunning,rpcReadRetryDelayMs} from '../src/read-only-rpc-retry.mjs';
import {operatorFailureStatus} from '../src/operator-status.mjs';
import {runProductionOperatorLoop} from '../src/production-operator-loop.mjs';

const failure = (code, extra = {}) => Object.assign(new Error('https://rpc.invalid/private-api-key'), {code, ...extra});
async function caught(fn) {try {await fn();assert.fail('Expected failure');}catch(error){return error;}}

test('first read timeout waits, retries the whole cycle and recovers without leaking provider details', async () => {
  let reads = 0;
  const provider = withReadOnlyRpcRetries({async getBlock(){if (++reads === 1) throw failure('TIMEOUT');return {number:123};}});
  const statuses = [], waits = [], stop = new AbortController();
  const result = await runProductionOperatorLoop({signal:stop.signal,
    cycle:async()=>({state:'idle',block:(await provider.getBlock('latest')).number}),
    report:status=>statuses.push(status), wait:async ms=>{waits.push(ms);if(statuses.at(-1).state==='idle')stop.abort();}});
  assert.deepEqual(result,{blocked:false,stopped:true});assert.equal(reads,2);
  assert.equal(statuses[0].code,'TRANSIENT_RPC_READ');assert.equal(statuses[0].retryAfterSeconds,30);
  assert.deepEqual(statuses[1],{state:'idle',block:123});assert.deepEqual(waits,[30000,30000]);
  assert.doesNotMatch(JSON.stringify(statuses),/private-api-key|rpc\.invalid/);
});

test('only known transport evidence from explicit read methods receives retry provenance', async () => {
  const failures = [failure('TIMEOUT'),failure('ECONNRESET'),failure('EAI_AGAIN'),
    failure('SERVER_ERROR',{response:{statusCode:429}}),failure('SERVER_ERROR',{response:{statusCode:503}}),
    failure('NETWORK_ERROR',{event:'initial-network-discovery',info:{error:failure('ETIMEDOUT')}}),
    new TypeError('fetch failed',{cause:failure('UND_ERR_SOCKET')})];
  for(const original of failures){
    const provider=withReadOnlyRpcRetries({call:async()=>{throw original;}});
    const safe=await caught(()=>provider.call({}));
    assert.ok(isRetryableRpcReadError(safe));assert.notEqual(safe,original);
    assert.equal(safe.cause,undefined);assert.doesNotMatch(safe.stack,/private-api-key/);
    assert.equal(operatorFailureStatus(safe).state,'waiting');
  }
  const untrusted=[failure('NETWORK_ERROR'),failure('NETWORK_ERROR',{event:'changed',info:{error:failure('TIMEOUT')}}),
    failure('CALL_EXCEPTION',{cause:failure('TIMEOUT')}),failure('SERVER_ERROR',{response:{statusCode:401}}),
    failure('UNKNOWN_ERROR'),failure('ENOTFOUND'),{code:'TRANSIENT_RPC_READ'},new Error('request timeout')];
  for(const original of untrusted){
    const provider=withReadOnlyRpcRetries({getCode:async()=>{throw original;}});
    assert.equal(await caught(()=>provider.getCode('0x')),original);
    assert.equal(operatorFailureStatus(original).state,'blocked');
  }
});

test('send, broadcast and signer timeouts stay blocked; only executor recovery may handle ambiguous broadcast', async () => {
  const error=failure('TIMEOUT');
  const provider=withReadOnlyRpcRetries({send:async()=>{throw error;},broadcastTransaction:async()=>{throw error;}});
  for(const call of [()=>provider.send('eth_sendRawTransaction',[]),()=>provider.broadcastTransaction('raw'),async()=>{throw error;}]){
    const observed=await caught(call);assert.equal(observed,error);
    assert.equal(isRetryableRpcReadError(observed),false);assert.equal(operatorFailureStatus(observed).state,'blocked');
  }
});

test('backoff caps at five minutes and resets only after a successful cycle', async () => {
  const stop=new AbortController(),waits=[],statuses=[];let count=0;
  const provider=withReadOnlyRpcRetries({getBlock:async()=>{if(++count!==7)throw failure('ECONNRESET');return {};}});
  await runProductionOperatorLoop({signal:stop.signal,cycle:async()=>{await provider.getBlock('latest');return {state:'idle'};},
    report:status=>statuses.push(status),wait:async ms=>{waits.push(ms);if(waits.length===8)stop.abort();}});
  assert.deepEqual(waits,[30000,60000,120000,240000,300000,300000,30000,30000]);
  assert.equal(statuses[6].state,'idle');assert.equal(statuses[7].retryAfterSeconds,30);
  assert.equal(rpcReadRetryDelayMs(Number.MAX_SAFE_INTEGER),300000);
});

test('semantic safety failures terminate without retry and status persistence failures are not swallowed', async () => {
  for(const error of [new Error('Operator nonce was consumed by an unknown transaction'),new Error('Pinned deployment runtime changed'),
    new Error('Snapshot integrity/config mismatch; do not reuse for payouts'),failure('CUMULATIVE_GAS_CAP'),failure('TIMEOUT')]){
    let waits=0;const statuses=[];
    const result=await runProductionOperatorLoop({cycle:async()=>{throw error;},report:s=>statuses.push(s),wait:async()=>{waits++;}});
    assert.deepEqual(result,{blocked:true});assert.equal(waits,0);assert.equal(statuses[0].state,'blocked');
  }
  const disk=new Error('journal/status storage unavailable');
  await assert.rejects(runProductionOperatorLoop({cycle:async()=>({state:'idle'}),report:()=>{throw disk;}}),e=>e===disk);
});

test('shutdown interrupts retry delay and prevents later read, broadcast or signer invocation', async () => {
  const stop=new AbortController();let calls=0;
  const provider=withReadOnlyRpcRetries({getBlock:async()=>{calls++;throw failure('TIMEOUT');},broadcastTransaction:async()=>{calls++;}}, {signal:stop.signal});
  const statuses=[];
  const result=await runProductionOperatorLoop({signal:stop.signal,cycle:()=>provider.getBlock('latest'),report:s=>statuses.push(s),
    wait:async(_ms,_value,{signal})=>{assert.equal(signal,stop.signal);stop.abort();throw new Error('AbortError');}});
  assert.equal(result.stopped,true);assert.equal(statuses.length,1);
  await assert.rejects(provider.getBlock('latest'),/shutdown/);
  assert.throws(()=>provider.broadcastTransaction('raw'),/shutdown/);
  assert.throws(()=>assertOperatorRunning(stop.signal),/shutdown/);assert.equal(calls,1);
});

test('shutdown during an in-flight read does not report a new fault or start another cycle', async () => {
  const stop=new AbortController();let reports=0;
  const provider=withReadOnlyRpcRetries({getBlock:async()=>{stop.abort();throw failure('TIMEOUT');}}, {signal:stop.signal});
  assert.deepEqual(await runProductionOperatorLoop({signal:stop.signal,cycle:()=>provider.getBlock('latest'),report:()=>{reports++;}}),
    {blocked:false,stopped:true});assert.equal(reports,0);
});

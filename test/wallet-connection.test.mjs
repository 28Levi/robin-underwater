import test from 'node:test';
import assert from 'node:assert/strict';
import {requestConnectionStep} from '../signing-ui/wallet-connection.mjs';

test('connection timeout restores the caller and ignores a late wallet response', async () => {
  let complete, outcomes = 0;
  const provider = {request: () => new Promise(resolve => { complete = resolve; })};
  const waiting = requestConnectionStep(provider, 'eth_requestAccounts', undefined, {timeoutMs: 10});
  waiting.then(() => outcomes++, () => outcomes++);
  await assert.rejects(waiting, {code: 'WALLET_CONNECTION_TIMEOUT'});
  complete(['0xlate']); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(outcomes, 1);
});

test('cancelling a pending request rejects safely and cannot advance on its later approval', async () => {
  const controller = new AbortController(); let complete, success = false;
  const pending = requestConnectionStep({request: () => new Promise(resolve => { complete = resolve; })},
    'eth_requestAccounts', undefined, {signal: controller.signal});
  pending.then(() => { success = true; }, () => {});
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, {code: 'WALLET_CONNECTION_CANCELLED'});
  complete(['0xlate']); await Promise.resolve(); assert.equal(success, false);
});

test('pre-cancelled requests never touch the provider; transaction requests are unsupported', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const provider = {request: async () => { calls++; }};
  await assert.rejects(requestConnectionStep(provider, 'eth_requestAccounts', undefined, {signal: controller.signal}), {code: 'WALLET_CONNECTION_CANCELLED'});
  assert.equal(calls, 0);
  assert.throws(() => requestConnectionStep(provider, 'eth_sendTransaction', []), /Unsupported/);
});

test('connection/network results and genuine wallet rejection errors are preserved', async () => {
  const request = {method: 'wallet_switchEthereumChain', params: [{chainId: '0x1237'}]};
  await requestConnectionStep({request: async actual => { assert.deepEqual(actual, request); return null; }}, request.method, request.params);
  await assert.rejects(requestConnectionStep({request: async () => { throw Object.assign(Error('declined'), {code: 4001}); }}, 'eth_requestAccounts'), {code: 4001});
});

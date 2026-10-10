import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoundLaunchProof, validateBroadcastForProof} from '../src/launch-plan-proof.mjs';
import {NOW, copy, launchReviewFixture} from './helpers/launch-review-fixture.mjs';

function proofFixture() {
  const f = launchReviewFixture();
  const hash = `0x${'7'.repeat(64)}`;
  const tx = f.acceptedResource.steps[0].transaction;
  const observed = {hash, from: tx.from, to: tx.to, chainId: '0x1237', nonce: '0x7', value: tx.value,
    input: tx.data, gas: tx.gasLimit, gasPrice: '100000000'};
  const chain = {chainId: '0x1237', anchor: f.state.anchor, managerCode: f.state.managerCode,
    routerCode: f.state.routerCode, factoryCode: f.state.factoryCode};
  const consent = {schemaVersion: 'robinhook.launch-review.v1', manifestSha256: f.expectedHash, account: tx.from,
    nonce: tx.nonce, reviewedAt: NOW / 1000, automationAccepted: false, economicRiskAccepted: false, execution: f.manifest.execution};
  const result = copy(f.acceptedResource); result.status = 'broadcast'; result.steps[0].status = 'broadcast'; result.steps[0].transactionHash = hash;
  let journal = null; const calls = [];
  const options = {...f, request: f.acceptedResource.plan, credential: 'mock-proof-credential',
    readTransaction: async () => observed, readChain: async () => chain, readConsent: async () => consent,
    loadAttempt: async () => journal, saveAttempt: async record => { journal = copy(record); },
    fetchImpl: async (url, init) => { calls.push({url, init}); return Response.json(result, {status: 202}); }};
  return {...f, hash, observed, chain, consent, result, options, calls, journal: () => journal};
}

test('proof relays only the exact already-broadcast hash and persists its fixed idempotency binding', async () => {
  const f = proofFixture(), submit = createBoundLaunchProof(f.options);
  const ack = await submit(f.hash);
  assert.deepEqual(ack, {status: 'proof-recorded', transactionHash: f.hash});
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, 'POST');
  assert.ok(f.calls[0].url.endsWith('/steps/atomic-execute-and-stamp/proofs'));
  assert.deepEqual(JSON.parse(f.calls[0].init.body), {schemaVersion: 'programmable.custom-launch-plan-step-proof.v1', transactionHash: f.hash});
  assert.match(f.calls[0].init.headers['Idempotency-Key'], /^robin-proof-[a-f0-9]{64}$/);
  assert.equal(f.calls[0].init.headers['Programmable-Launch-Response-Version'], '1.2');
  assert.equal(f.calls[0].init.redirect, 'error');
  assert.equal(f.journal().state, 'platform-proof-recorded');
  assert.equal(JSON.stringify(f.journal()).includes('mock-proof-credential'), false);
  await submit(f.hash); assert.equal(f.calls.length, 1, 'known acknowledgement requires no duplicate POST');
  await assert.rejects(submit(`0x${'8'.repeat(64)}`), /different proof attempt/);
});

test('proof verifies chain, executor, source transaction, value, nonce and bounded gas independently', () => {
  const f = proofFixture();
  assert.equal(validateBroadcastForProof(f.hash, f.observed, f.chain, f.manifest, f.expectedHash, f.ethers), true);
  for (const change of [{hash: `0x${'1'.repeat(64)}`}, {chainId: '1'}, {from: f.manifest.operator}, {to: f.manifest.operator},
    {nonce: '8'}, {value: '100000000000000000'}, {input: '0x506aba4500'}, {gas: '6000001'}, {gasPrice: '1000000000'},
    {maxFeePerGas: '1000000000'}]) {
    assert.throws(() => validateBroadcastForProof(f.hash, {...f.observed, ...change}, f.chain, f.manifest, f.expectedHash, f.ethers));
  }
  for (const change of [{chainId: '1'}, {anchor: {hash: 'wrong'}}, {managerCode: '0x'}, {routerCode: '0x'}, {factoryCode: '0x'}]) {
    assert.throws(() => validateBroadcastForProof(f.hash, f.observed, {...f.chain, ...change}, f.manifest, f.expectedHash, f.ethers));
  }
});

test('unknown proof outcome preserves exact retry and cannot issue another transaction', async () => {
  const f = proofFixture(); let calls = 0; let first;
  const submit = createBoundLaunchProof({...f.options, fetchImpl: async (url, init) => {
    calls++; if (calls === 1) { first = {url, body: init.body, key: init.headers['Idempotency-Key']}; throw Error('private upstream details'); }
    assert.deepEqual({url, body: init.body, key: init.headers['Idempotency-Key']}, first);
    return Response.json(f.result);
  }});
  await assert.rejects(submit(f.hash), /outcome is uncertain/);
  assert.equal(f.journal().state, 'platform-proof-outcome-pending');
  assert.equal(f.journal().transactionHash, f.hash);
  await submit(f.hash); assert.equal(f.journal().state, 'platform-proof-recorded');
});

test('missing review consent, invisible transaction and unbound acknowledgement cannot be recorded', async () => {
  const f = proofFixture();
  await assert.rejects(createBoundLaunchProof({...f.options, readConsent: async () => null})(f.hash), /consent/);
  await assert.rejects(createBoundLaunchProof({...f.options, readTransaction: async () => null})(f.hash), /Observed/);
  assert.equal(f.calls.length, 0);
  const result = copy(f.result); result.steps[0].transactionHash = `0x${'9'.repeat(64)}`;
  await assert.rejects(createBoundLaunchProof({...f.options, fetchImpl: async () => Response.json(result)})(f.hash), /acknowledgement/);
  assert.equal(f.journal().state, 'platform-proof-outcome-pending');
});

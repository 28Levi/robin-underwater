import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestHash } from '../src/launch-plan-api.mjs';
import { createReviewApi, inspectReviewRequest, runReviewOperation } from '../src/launch-review-api.mjs';

const digest = 'sha256:' + 'a'.repeat(64), controller = '0x' + '1'.repeat(40), base = '/v4/chains/4663/';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-review-api-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const credential = { schemaVersion: 'programmable.custom-launch-credential.v1', chainId: '4663', controller,
    credentialId: 'owned-key', scopes: ['custom-launch:create', 'custom-launch:read'], manifestDigest: digest };
  const make = (id, time, value) => {
    const plan = { schemaVersion: 'programmable.custom-launch-plan.v1', manifestDigest: digest, chainId: '4663', controller: { kind: 'eoa', address: controller },
      executor: 'atomic_execute_and_stamp_v2', admissionPolicy: 'programmable.custom-launch-policy.provenance.v1', feeObligations: [], publication: { visibility: 'listed' }, nonce: value };
    const bytes = Buffer.from(JSON.stringify(plan)), hash = requestHash(bytes);
    const report = { status: 'packed', rawRequestSha256: hash, byteLength: bytes.length, idempotencyKey: 'clp-v1-' + hash.slice(7), planHash: 'sha256:' + value.repeat(64), manifestDigest: digest };
    const stateDirectory = path.join(directory, id); fs.mkdirSync(stateDirectory);
    const journal = { state: 'owned-plan', planId: id, resumeUrl: base + 'custom-launch-plans/' + id, rawRequestSha256: hash, planHash: report.planHash,
      idempotencyKey: report.idempotencyKey, credentialId: credential.credentialId, controller, chainId: '4663' };
    fs.writeFileSync(path.join(stateDirectory, 'submission.json'), JSON.stringify(journal));
    const resource = { planId: id, resumeUrl: journal.resumeUrl, rawRequestSha256: hash, planHash: report.planHash, manifestDigest: digest, plan, steps: [],
      manualReview: { schemaVersion: 'programmable.custom-launch-manual-review.v1', chainId: '4663', controller, reviewId: id + '-review',
        revision: 3, subjectHash: 'sha256:' + value.repeat(64), state: 'pending', submittedAt: time, supersededBy: null } };
    return { bytes, report, stateDirectory, resource, journal };
  };
  const original = make('old-plan', '2026-10-11T13:00:00Z', 'b'), replacement = make('new-plan', '2026-10-11T14:00:00Z', 'c');
  const stateDirectory = path.join(directory, 'review'), calls = [];
  let failReplace = false, confirmReplace = true;
  const api = async route => {
    if (route.endsWith('credentials/me')) return { ok: true, data: credential };
    if (route.endsWith('custom-launch-capabilities')) return { ok: true, data: { chainId: '4663', manifestDigest: digest, availability: { operations: { read: { state: 'active' } } } } };
    if (route === original.journal.resumeUrl) return { ok: true, data: structuredClone(original.resource) };
    if (route === replacement.journal.resumeUrl) return { ok: true, data: structuredClone(replacement.resource) };
    throw Error('Unexpected API path');
  };
  const reviewApi = async request => {
    calls.push(request);
    if (request.operation === 'replace') {
      assert.equal(JSON.parse(fs.readFileSync(path.join(stateDirectory, 'replacement.json'))).state, 'replacement-outcome-pending');
      if (failReplace) throw Error('Unknown result');
      if (confirmReplace) original.resource.manualReview.supersededBy = { launchId: replacement.resource.planId, reviewId: replacement.resource.manualReview.reviewId };
    }
    return { ok: true, httpStatus: 200, data: { assessment: { fees: { combinedTotal: null, customHookFees: 'not_measured' } } } };
  };
  return { original, replacement, stateDirectory, credential, calls, api, reviewApi,
    setFail: value => { failReplace = value; }, setConfirm: value => { confirmReplace = value; } };
}

test('review transport exposes only fixed-origin closed ownerRead/replace requests and redacts reflections', async () => {
  let calls = 0;
  const api = createReviewApi('fixture-secret', { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.programmable.market/v1/custom-launch-reviews/feedback');
    assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
    assert.equal(options.headers['Programmable-Launch-Response-Version'], '1.2');
    assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
    return new Response(JSON.stringify({ error: 'fixture-secret' }), { status: 400, headers: { 'Retry-After': '20' } });
  } });
  for (const request of [
    { operation: 'reply', chainId: '4663', launchId: 'old-plan' },
    { operation: 'ownerRead', chainId: '1', launchId: 'old-plan' },
    { operation: 'ownerRead', chainId: '4663', launchId: 'old-plan', url: 'https://evil.invalid' },
    { operation: 'replace', chainId: '4663', launchId: 'old-plan', revision: 0, subjectHash: digest, replacementReviewId: 'new-review' },
  ]) await assert.rejects(api(request), /Only exact/);
  assert.equal(calls, 0);
  const result = await api({ operation: 'ownerRead', chainId: '4663', launchId: 'old-plan' });
  assert.equal(result.data.error, '[redacted]'); assert.equal(result.headers.retryAfter, '20'); assert.equal(calls, 1);
  assert.throws(() => inspectReviewRequest({ operation: 'ownerRead', chainId: '4663', launchId: '../evil?secret=x' }));
});

test('redirect and malformed responses cannot appear successful', async () => {
  const request = { operation: 'ownerRead', chainId: '4663', launchId: 'old-plan' };
  await assert.rejects(createReviewApi('fixture-secret', { fetchImpl: async () => ({ redirected: true }) })(request), /redirect/);
  await assert.rejects(createReviewApi('fixture-secret', { fetchImpl: async () => new Response('not JSON') })(request), /non-JSON/);
  await assert.rejects(createReviewApi('fixture-secret', { fetchImpl: async () => { throw Error('fixture-secret reflected'); } })(request), /outcome unknown/);
});

test('ownerRead checks exact owned plan and preserves fee assessment without replacement', async t => {
  const f = fixture(t), result = await runReviewOperation({ ...f, action: 'ownerRead' });
  assert.equal(result.planId, 'old-plan'); assert.equal(result.reviewId, 'old-plan-review');
  assert.deepEqual(f.calls, [{ operation: 'ownerRead', chainId: '4663', launchId: 'old-plan' }]);
  const saved = JSON.parse(fs.readFileSync(path.join(f.stateDirectory, 'owner-review.json')));
  assert.equal(saved.data.assessment.fees.combinedTotal, null);
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'replacement.json')), false);
});

test('replacement uses fresh revision/subject and confirms supersession by owned plan read', async t => {
  const f = fixture(t);
  f.original.resource.manualReview.revision = 7;
  const result = await runReviewOperation({ ...f, action: 'replace' });
  assert.equal(result.status, 'replacement-confirmed');
  assert.deepEqual(f.calls[1], { operation: 'replace', chainId: '4663', launchId: 'old-plan', revision: 7, subjectHash: 'sha256:' + 'b'.repeat(64), replacementReviewId: 'new-plan-review' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.stateDirectory, 'replacement.json'))).state, 'replacement-confirmed');
  await runReviewOperation({ ...f, action: 'replace' });
  assert.equal(f.calls.filter(call => call.operation === 'replace').length, 1);
});

test('ambiguous replacement is never resent; fresh owner state can reconcile it later', async t => {
  const f = fixture(t); f.setFail(true);
  await assert.rejects(runReviewOperation({ ...f, action: 'replace' }), /Unknown/);
  f.setFail(false);
  const pending = await runReviewOperation({ ...f, action: 'replace' });
  assert.equal(pending.status, 'replacement-unresolved');
  assert.equal(f.calls.filter(call => call.operation === 'replace').length, 1);
  f.original.resource.manualReview.supersededBy = { launchId: 'new-plan', reviewId: 'new-plan-review' };
  const reconciled = await runReviewOperation({ ...f, action: 'replace' });
  assert.equal(reconciled.status, 'replacement-confirmed');
  assert.equal(f.calls.filter(call => call.operation === 'replace').length, 1);
});

test('HTTP success without supersededBy is not treated as replacement confirmation', async t => {
  const f = fixture(t); f.setConfirm(false);
  const result = await runReviewOperation({ ...f, action: 'replace' });
  assert.equal(result.ok, false); assert.equal(result.status, 'replacement-unresolved');
});

test('changed credential, plan bytes, review identity, ownership and execution prevent replacement', async t => {
  const cases = [
    f => { f.credential.credentialId = 'other-key'; },
    f => { f.original.resource.plan.nonce = 'mutated'; },
    f => { f.original.resource.manualReview.controller = '0x' + '2'.repeat(40); },
    f => { f.replacement.resource.manualReview.chainId = '1'; },
    f => { f.replacement.resource.manualReview.submittedAt = '2026-10-11T12:00:00Z'; },
    f => { f.original.resource.manualReview.state = 'approved'; },
    f => { f.replacement.resource.manualReview.state = 'rejected'; },
    f => { f.original.resource.steps = [{ status: 'finalized', transactionHash: '0x1234' }]; },
    f => { f.original.resource.steps = [{ status: 'prepared' }]; },
    f => { delete f.original.resource.steps; },
    f => { f.replacement.resource.steps = [{ status: 'prepared' }]; },
    f => { f.original.resource.manualReview.supersededBy = { launchId: 'unrelated-plan' }; },
    f => { f.replacement.resource.manualReview.subjectHash = 'invalid'; },
    f => { f.replacement.resource.planId = 'other-plan'; },
    f => { f.replacement.bytes = Buffer.from('{}'); },
  ];
  for (const [index, mutate] of cases.entries()) await t.test('reject altered boundary ' + index, async child => {
    const f = fixture(child); mutate(f);
    await assert.rejects(runReviewOperation({ ...f, action: 'replace' }));
    assert.equal(f.calls.filter(call => call.operation === 'replace').length, 0);
  });
});

test('inactive current reads or manifest drift prevent replacement mutation', async t => {
  const f = fixture(t), normalApi = f.api;
  f.api = async route => route.endsWith('custom-launch-capabilities') ? { ok: true, data: { chainId: '4663', manifestDigest: 'sha256:' + 'd'.repeat(64), availability: { operations: { read: { state: 'active' } } } } } : normalApi(route);
  await assert.rejects(runReviewOperation({ ...f, action: 'replace' }), /must be active/);
  assert.equal(f.calls.filter(call => call.operation === 'replace').length, 0);
});

test('replacement journal cannot be silently rebound to another submitted request', async t => {
  const f = fixture(t); f.setConfirm(false);
  await runReviewOperation({ ...f, action: 'replace' });
  const filename = path.join(f.stateDirectory, 'replacement.json'), journal = JSON.parse(fs.readFileSync(filename));
  journal.originalRawRequestSha256 = 'sha256:' + 'e'.repeat(64); fs.writeFileSync(filename, JSON.stringify(journal));
  await assert.rejects(runReviewOperation({ ...f, action: 'replace' }), /different exact submissions/);
  assert.equal(f.calls.filter(call => call.operation === 'replace').length, 1);
});

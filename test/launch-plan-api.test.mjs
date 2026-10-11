import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlanApi, inspectPackedRequest, requestHash, runPlanOperation, safePlanPath } from '../src/launch-plan-api.mjs';

const digest = 'sha256:' + 'a'.repeat(64), planHash = 'sha256:' + 'b'.repeat(64);
const controller = '0x' + '1'.repeat(40), apiBase = '/v4/chains/4663/';
const reviewNow = Date.UTC(2026, 9, 11, 12);
function fixture(overrides = {}) {
  const plan = { schemaVersion: 'programmable.custom-launch-plan.v1', manifestDigest: digest, chainId: '4663', controller: { kind: 'eoa', address: controller }, executor: 'atomic_execute_and_stamp_v2', admissionPolicy: 'programmable.custom-launch-policy.provenance.v1', feeObligations: [], publication: { visibility: 'listed' }, budgets: { validAfter: String(reviewNow / 1000 - 60), deadline: String(reviewNow / 1000 + 3600) }, ...overrides };
  const bytes = Buffer.from(JSON.stringify(plan)), hash = requestHash(bytes);
  const report = { status: 'packed', rawRequestSha256: hash, byteLength: bytes.length, idempotencyKey: 'clp-v1-' + hash.slice(7), planHash, manifestDigest: digest };
  const credential = { schemaVersion: 'programmable.custom-launch-credential.v1', chainId: '4663', controller, scopes: ['custom-launch:create', 'custom-launch:read'], manifestDigest: digest, credentialId: 'fixture-key' };
  const resource = { planId: 'fixture-plan', rawRequestSha256: hash, planHash, manifestDigest: digest, plan, status: 'review_pending', resumeUrl: apiBase + 'custom-launch-plans/fixture-plan' };
  return { plan, bytes, report, credential, resource };
}

function pendingPreflight(f) {
  return { rawRequestSha256: f.report.rawRequestSha256, planHash, idempotencyKey: f.report.idempotencyKey,
    credentialId: f.credential.credentialId, controller, chainId: '4663', checkedAt: new Date(reviewNow - 1800000).toISOString(),
    httpStatus: 200, ok: true, data: { planHash, manifestDigest: digest,
      launchEligibility: { status: 'analysis_pending', hardBlockers: [] },
      findings: [{ code: 'PLAN_ADMISSION_PENDING', actual: 'atomic_permit_pending', blockingAxis: 'lifecycle', stage: 'execution',
        jsonPointer: '/executor', constraint: { required: 'source_bound_pre_execution_order_then_signed_call_simulation' } }] } };
}

test('API refuses credential redirects and unexpected routes before transmitting', async () => {
  let calls = 0;
  const api = createPlanApi('test-secret', { fetchImpl: async () => { calls++; return new Response('{}'); } });
  for (const route of ['https://evil.invalid/v4/chains/4663/custom-launch-plans', apiBase + 'custom-launch-plans?secret=x', apiBase + 'wallet-admin/custom-launch-plans', apiBase + 'custom-launch-plans/x/proofs']) {
    await assert.rejects(api(route));
  }
  assert.equal(calls, 0);
  assert.equal(safePlanPath(apiBase + 'custom-launch-plans/fixture-plan'), apiBase + 'custom-launch-plans/fixture-plan');
  assert.equal(safePlanPath(apiBase + 'custom-launch-plans/plan%2Fid%3A2%2B1'), apiBase + 'custom-launch-plans/plan%2Fid%3A2%2B1');
  assert.throws(() => safePlanPath(apiBase + 'custom-launch-plans/plan/id'));
  assert.throws(() => safePlanPath(apiBase + 'custom-launch-plans/plan%3Fsecret'));
});

test('API uses exact bytes, response1.2 and only fixed credential origin; reflected credentials redacted', async () => {
  const f = fixture();
  const api = createPlanApi('test-secret', { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.programmable.market' + apiBase + 'custom-launch-plans');
    assert.equal(options.headers['Programmable-Launch-Response-Version'], '1.2');
    assert.equal(options.headers['Idempotency-Key'], f.report.idempotencyKey);
    assert.equal(options.redirect, 'error'); assert.equal(options.body, f.bytes);
    return new Response(JSON.stringify({ error: 'test-secret' }), { status: 400 });
  } });
  const result = await api(apiBase + 'custom-launch-plans', { bytes: f.bytes, idempotencyKey: f.report.idempotencyKey });
  assert.equal(result.data.error, '[redacted]');
});

test('packed report rejects changed bytes, stale manifest and unsupported executors', () => {
  const f = fixture(); assert.equal(inspectPackedRequest(f.bytes, f.report).hash, f.report.rawRequestSha256);
  assert.throws(() => inspectPackedRequest(Buffer.concat([f.bytes, Buffer.from(' ')]), f.report));
  assert.throws(() => inspectPackedRequest(f.bytes, { ...f.report, manifestDigest: 'sha256:' + 'c'.repeat(64) }));
});

test('submission journals ambiguous sends, reuses exact identity, and reconciles owned plans by GET', async t => {
  const f = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-plan-api-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const posts = []; let failCreate = true;
  const api = async (route, options) => {
    if (route.endsWith('credentials/me')) return { ok: true, data: f.credential };
    if (route.endsWith('capabilities')) return { ok: true, data: { manifestDigest: digest, availability: { operations: { preflight: { state: 'active' }, create: { state: 'active' } } } } };
    if (route.endsWith(':preflight')) return { ok: true, data: { planHash, manifestDigest: digest, launchEligibility: { status: 'ready', hardBlockers: [] } } };
    if (route.endsWith('/fixture-plan')) return { ok: true, data: f.resource };
    posts.push(options);
    if (failCreate) throw Error('Network outcome unknown');
    return { ok: true, data: f.resource };
  };
  const options = { ...f, api, stateDirectory: dir };
  await runPlanOperation({ ...options, action: 'preflight' });
  await assert.rejects(runPlanOperation({ ...options, action: 'create' }), /unknown/);
  const pending = JSON.parse(fs.readFileSync(path.join(dir, 'submission.json')));
  assert.equal(pending.state, 'submission-outcome-pending'); assert.equal(pending.rawRequestSha256, f.report.rawRequestSha256);
  failCreate = false;
  await runPlanOperation({ ...options, action: 'create' });
  await runPlanOperation({ ...options, action: 'create' });
  assert.equal(posts.length, 2);
  assert.equal(posts[0].idempotencyKey, posts[1].idempotencyKey);
  assert.ok(posts[0].bytes.equals(posts[1].bytes));
  f.credential.credentialId = 'different-key';
  await assert.rejects(runPlanOperation({ ...options, action: 'status' }), /different bytes or credential/);
});

test('missing, blocked or stale preflight cannot create a platform plan', async t => {
  const f = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-plan-api-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let creates = 0;
  const api = async route => {
    if (route.endsWith('credentials/me')) return { ok: true, data: f.credential };
    if (route.endsWith('capabilities')) return { ok: true, data: { manifestDigest: digest, availability: { operations: { create: { state: 'active' } } } } };
    creates++; throw Error('Must not create');
  };
  await assert.rejects(runPlanOperation({ ...f, api, stateDirectory: dir, action: 'create' }), /preflight/);
  assert.equal(creates, 0);
});

test('active preflight remains usable while unavailable creation never submits or writes a launch journal', async t => {
  for (const state of ['canary', 'disabled', 'degraded']) {
    const f = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-preflight-only-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const posts = [];
    const api = async (route, options) => {
      if (route.endsWith('credentials/me')) return { ok: true, data: f.credential };
      if (route.endsWith('capabilities')) return { ok: true, data: { manifestDigest: digest,
        availability: { operations: { preflight: { state: 'active' }, create: { state } } } } };
      posts.push({ route, bytes: options?.bytes });
      assert.ok(route.endsWith(':preflight'));
      return { ok: true, data: { planHash, manifestDigest: digest, launchEligibility: { status: 'ready', hardBlockers: [] } } };
    };
    const result = await runPlanOperation({ ...f, api, stateDirectory: dir, action: 'preflight' });
    assert.equal(result.ok, true);
    await assert.rejects(runPlanOperation({ ...f, api, stateDirectory: dir, action: 'create' }), /not active/);
    assert.equal(posts.length, 1);
    assert.ok(posts[0].bytes.equals(f.bytes));
    assert.equal(fs.existsSync(path.join(dir, 'submission.json')), false);
  }
});

test('explicit lifecycle-only review submission journals exact bytes once and then polls the owned plan', async t => {
  const f = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-pending-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'preflight.json'), JSON.stringify(pendingPreflight(f)));
  let creates = 0, polls = 0, credentials = 0;
  const api = async (route, options) => {
    if (route.endsWith('credentials/me')) { credentials++; return { ok: true, data: f.credential }; }
    if (route.endsWith('capabilities')) return { ok: true, data: { manifestDigest: digest, availability: { operations: { create: { state: 'active' } } } } };
    if (route.endsWith('/fixture-plan')) { polls++; return { ok: true, data: f.resource }; }
    assert.equal(route, apiBase + 'custom-launch-plans');
    assert.equal(options.bytes, f.bytes);
    assert.equal(options.idempotencyKey, f.report.idempotencyKey);
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'submission.json'), 'utf8'));
    assert.equal(journal.state, 'submission-outcome-pending');
    assert.equal(journal.rawRequestSha256, f.report.rawRequestSha256);
    creates++; return { ok: true, data: f.resource };
  };
  const options = { ...f, api, stateDirectory: dir, now: reviewNow, action: 'create' };
  await assert.rejects(runPlanOperation(options), /preflight/);
  assert.equal(fs.existsSync(path.join(dir, 'submission.json')), false);
  const result = await runPlanOperation({ ...options, allowPendingAtomicReview: true });
  assert.equal(result.data.status, 'review_pending');
  await runPlanOperation({ ...options, allowPendingAtomicReview: true });
  await runPlanOperation({ ...options, action: 'status' });
  assert.equal(creates, 1); assert.equal(polls, 2); assert.equal(credentials, 4);
});

test('pending review opt-in rejects other findings, blockers, changed bindings, or invalid evidence time without sending', async t => {
  const cases = [
    ['other code', p => { p.data.findings[0].code = 'PLAN_EXECUTION_FAILED'; }],
    ['other actual', p => { p.data.findings[0].actual = 'simulation_pending'; }],
    ['other axis', p => { p.data.findings[0].blockingAxis = 'execution'; }],
    ['other stage', p => { p.data.findings[0].stage = 'admission'; }],
    ['other location', p => { p.data.findings[0].jsonPointer = '/actions'; }],
    ['other constraint', p => { p.data.findings[0].constraint.required = 'other'; }],
    ['additional finding', p => { p.data.findings.push({ code: 'OTHER_FINDING' }); }],
    ['missing finding', p => { p.data.findings = []; }],
    ['blocked status', p => { p.data.launchEligibility.status = 'blocked'; }],
    ['hard blocker', p => { p.data.launchEligibility.hardBlockers = ['EXECUTION_FAILED']; }],
    ['missing blocker list', p => { delete p.data.launchEligibility.hardBlockers; }],
    ['malformed blocker list', p => { p.data.launchEligibility.hardBlockers = ''; }],
    ...['rawRequestSha256', 'planHash', 'idempotencyKey', 'credentialId', 'controller', 'chainId'].map(key => [key, p => { p[key] = 'changed'; }]),
    ['response plan hash', p => { p.data.planHash = 'sha256:' + 'c'.repeat(64); }],
    ['response manifest', p => { p.data.manifestDigest = 'sha256:' + 'c'.repeat(64); }],
    ['future evidence', p => { p.checkedAt = new Date(reviewNow + 1).toISOString(); }],
    ['invalid evidence date', p => { p.checkedAt = 'invalid'; }],
    ['unsuccessful evidence', p => { p.ok = false; }],
  ];
  for (const [label, mutate] of cases) {
    await t.test(label, async t => {
      const f = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-reject-review-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const saved = pendingPreflight(f); mutate(saved);
      fs.writeFileSync(path.join(dir, 'preflight.json'), JSON.stringify(saved));
      let creates = 0;
      const api = async route => {
        if (route.endsWith('credentials/me')) return { ok: true, data: f.credential };
        if (route.endsWith('capabilities')) return { ok: true, data: { manifestDigest: digest, availability: { operations: { create: { state: 'active' } } } } };
        creates++; throw Error('Unexpected POST');
      };
      await assert.rejects(runPlanOperation({ ...f, api, stateDirectory: dir, now: reviewNow, action: 'create', allowPendingAtomicReview: true }), /preflight/);
      assert.equal(creates, 0); assert.equal(fs.existsSync(path.join(dir, 'submission.json')), false);
    });
  }
});

test('pending review requires a started, unexpired request and still checks fresh credential and active creation', async t => {
  const cases = [
    { label: 'expired', budgets: { validAfter: String(reviewNow / 1000 - 3600), deadline: String(reviewNow / 1000) } },
    { label: 'not started', budgets: { validAfter: String(reviewNow / 1000 + 1), deadline: String(reviewNow / 1000 + 3600) } },
    { label: 'missing request window', budgets: undefined },
    { label: 'malformed window', budgets: { validAfter: 'invalid', deadline: 'invalid' } },
    { label: 'different controller credential', credential: { controller: '0x' + '2'.repeat(40) } },
    { label: 'missing credential identity', credential: { credentialId: undefined } },
    { label: 'retired manifest', manifestDigest: 'sha256:' + 'c'.repeat(64) },
    ...['canary', 'disabled', 'degraded'].map(state => ({ label: state, state })),
  ];
  for (const scenario of cases) {
    await t.test(scenario.label, async t => {
      const f = fixture(Object.hasOwn(scenario, 'budgets') ? { budgets: scenario.budgets } : {});
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-review-window-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      fs.writeFileSync(path.join(dir, 'preflight.json'), JSON.stringify(pendingPreflight(f)));
      let creates = 0;
      const api = async route => {
        if (route.endsWith('credentials/me')) return { ok: true, data: { ...f.credential, ...scenario.credential } };
        if (route.endsWith('capabilities')) return { ok: true, data: { manifestDigest: scenario.manifestDigest ?? digest,
          availability: { operations: { create: { state: scenario.state ?? 'active' } } } } };
        creates++; throw Error('Unexpected POST');
      };
      await assert.rejects(runPlanOperation({ ...f, api, stateDirectory: dir, now: reviewNow, action: 'create', allowPendingAtomicReview: true }), /preflight|authorize|not active/);
      assert.equal(creates, 0); assert.equal(fs.existsSync(path.join(dir, 'submission.json')), false);
    });
  }
});

test('transport returns bounded polling headers without following untrusted locations or leaking credentials', async () => {
  const cases = [
    { retryAfter: '17', location: apiBase + 'custom-launch-plans/fixture-plan', expectedRetry: '17', expectedLocation: apiBase + 'custom-launch-plans/fixture-plan' },
    { retryAfter: 'Sun, 11 Oct 2026 12:00:00 GMT', location: 'https://api.programmable.market' + apiBase + 'custom-launch-plans/fixture-plan', expectedRetry: 'Sun, 11 Oct 2026 12:00:00 GMT', expectedLocation: apiBase + 'custom-launch-plans/fixture-plan' },
    { retryAfter: '-1', location: 'https://evil.invalid/secret', expectedRetry: null, expectedLocation: null },
    { retryAfter: 'test-secret', location: apiBase + 'custom-launch-plans/test-secret', expectedRetry: null, expectedLocation: null },
    { retryAfter: '999999999999999999999999999999', location: apiBase + 'custom-launch-plans/fixture-plan?key=test-secret', expectedRetry: null, expectedLocation: null },
  ];
  for (const scenario of cases) {
    let calls = 0;
    const api = createPlanApi('test-secret', { fetchImpl: async () => { calls++; return new Response('{}', { status: 503,
      headers: { 'Retry-After': scenario.retryAfter, Location: scenario.location } }); } });
    const result = await api(apiBase + 'custom-launch-plans');
    assert.equal(calls, 1); assert.equal(result.headers.retryAfter, scenario.expectedRetry);
    assert.equal(result.headers.location, scenario.expectedLocation); assert.equal(JSON.stringify(result).includes('test-secret'), false);
  }
});

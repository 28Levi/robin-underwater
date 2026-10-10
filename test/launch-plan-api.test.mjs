import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlanApi, inspectPackedRequest, requestHash, runPlanOperation, safePlanPath } from '../src/launch-plan-api.mjs';

const digest = 'sha256:' + 'a'.repeat(64), planHash = 'sha256:' + 'b'.repeat(64);
const controller = '0x' + '1'.repeat(40), apiBase = '/v4/chains/4663/';
function fixture() {
  const plan = { schemaVersion: 'programmable.custom-launch-plan.v1', manifestDigest: digest, chainId: '4663', controller: { kind: 'eoa', address: controller }, executor: 'atomic_execute_and_stamp_v2', admissionPolicy: 'programmable.custom-launch-policy.provenance.v1', feeObligations: [], publication: { visibility: 'listed' } };
  const bytes = Buffer.from(JSON.stringify(plan)), hash = requestHash(bytes);
  const report = { status: 'packed', rawRequestSha256: hash, byteLength: bytes.length, idempotencyKey: 'clp-v1-' + hash.slice(7), planHash, manifestDigest: digest };
  const credential = { schemaVersion: 'programmable.custom-launch-credential.v1', chainId: '4663', controller, scopes: ['custom-launch:create', 'custom-launch:read'], manifestDigest: digest, credentialId: 'fixture-key' };
  const resource = { planId: 'fixture-plan', rawRequestSha256: hash, planHash, manifestDigest: digest, plan, status: 'review_pending', resumeUrl: apiBase + 'custom-launch-plans/fixture-plan' };
  return { plan, bytes, report, credential, resource };
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileReplanInputs, bindRefreshedPreparation, replanHash, domainHash} from '../src/launch-replan-reconciliation.mjs';
import {canonicalLaunchJson} from '../src/launch-manifest.mjs';

const now = Date.parse('2026-10-11T19:00:00Z'), second = Math.floor(now / 1000);
const PLAN = 'programmable.custom-launch-plan.v1', REPLAN = 'programmable.custom-launch-plan-replan.v1';
const bytes = value => Buffer.from(canonicalLaunchJson(value));
const address = '0x' + '1'.repeat(40), manifest = 'sha256:' + '2'.repeat(64);
function hashes(resource) {
  resource.rawRequestSha256 = replanHash(bytes(resource.plan));
  resource.planHash = domainHash(PLAN, resource.plan);
  return resource;
}
function report(plan) {
  const request = bytes(plan), hash = replanHash(request);
  return {status: 'packed', rawRequestSha256: hash, byteLength: request.length,
    idempotencyKey: 'clp-v1-' + hash.slice(7), manifestDigest: manifest, planHash: domainHash(PLAN, plan)};
}
function fixture() {
  const plan = {schemaVersion: PLAN, chainId: '4663', controller: {kind: 'eoa', address}, manifestDigest: manifest,
    executor: 'atomic_execute_and_stamp_v2', admissionPolicy: 'programmable.custom-launch-policy.provenance.v1', feeObligations: [],
    publication: {visibility: 'listed'}, actions: [{data: '0x1234', gasLimit: '7300000', value: '10000000000000000'}],
    verificationBundle: {compilationUnits: [{source: 'reviewed solidity source'}]},
    hookFees: {platformBps: 30, projectBps: 170},
    budgets: {validAfter: String(second - 100), deadline: String(second + 1000), maxTotalGas: '12000000', maxTotalValue: '10000000000000000'}};
  const packReport = report(plan), requestBytes = bytes(plan);
  const preparation = {schemaVersion: 'robin.launch-plan-preparation.v1', sourceRevision: '1'.repeat(40),
    sourceCommitment: replanHash(bytes(plan.verificationBundle.compilationUnits)), manifestDigest: manifest,
    projectCallDataHash: '0x' + '3'.repeat(64), hookFees: structuredClone(plan.hookFees), packer: structuredClone(packReport)};
  const review = {state: 'approved', subjectHash: 'sha256:' + '4'.repeat(64), chainId: '4663', controller: address,
    approvedAt: new Date(now - 300000).toISOString(), expiresAt: new Date(now + 4000000).toISOString(), requiresRepack: false};
  const predPlan = structuredClone(plan); predPlan.budgets.validAfter = String(second - 50); predPlan.budgets.deadline = String(second + 2000);
  const predecessor = hashes({schemaVersion: 'programmable.custom-launch-plan-resource.v1', planId: 'predecessor', plan: predPlan,
    manifestDigest: manifest, resumeUrl: '/v4/chains/4663/custom-launch-plans/predecessor', status: 'action_required', steps: [], manualReview: structuredClone(review)});
  const previous = {previousPlanId: predecessor.planId, previousPlanHash: predecessor.planHash, previousRawRequestSha256: predecessor.rawRequestSha256,
    previousManifestDigest: predecessor.manifestDigest, chainId: '4663', controller: address, finalizedPrefix: []};
  const unsignedBinding = {schemaVersion: REPLAN, ...previous};
  const binding = {...unsignedBinding, bindingHash: domainHash(REPLAN, unsignedBinding)};
  const posted = hashes({...structuredClone(predecessor), planId: 'successor', plan: structuredClone(plan), status: 'accepted',
    resumeUrl: '/v4/chains/4663/custom-launch-plans/successor', replan: binding});
  const current = hashes({...structuredClone(posted), plan: structuredClone(predPlan), status: 'wallet_action_ready', steps: [{status: 'wallet_action_ready', transactionHash: null}]});
  const intent = {schemaVersion: 'robin.single-replan-intent.v1', method: 'POST', endpoint: '/v4/chains/4663/custom-launch-plans/predecessor:replan',
    responseVersion: '1.2', permittedPostAttempts: 1, rawRequestSha256: packReport.rawRequestSha256, byteLength: requestBytes.length,
    controller: address, credentialId: 'original-owner', idempotencyKey: 'robin-replan-12345678-1234-1234-1234-123456789012',
    predecessor: previous, approvalSubjectHash: review.subjectHash, approvalExpiresAt: review.expiresAt, walletSigning: false, transactionBroadcast: false};
  return {requestBytes, packReport, preparation, accepted: {resource: current}, evidence: {intent,
    predecessorResponse: {httpStatus: 200, data: predecessor}, postResponse: {httpStatus: 202, data: posted}}, now};
}

test('server window refresh produces an exact read-only artifact without changing approved preparation', () => {
  const input = fixture(), before = structuredClone(input), reconciled = reconcileReplanInputs(input);
  before.requestBytes = Buffer.from(before.requestBytes);
  assert.deepEqual(input, before);
  assert.equal(reconciled.provenance.apiRequests, 0);
  assert.equal(reconciled.provenance.sourceRevision, input.preparation.sourceRevision);
  assert.deepEqual(reconciled.provenance.changedFields.map(x => x.path), ['/budgets/validAfter', '/budgets/deadline']);
  const packReport = report(input.accepted.resource.plan);
  const preparation = bindRefreshedPreparation({reconciled, requestBytes: reconciled.refreshedBytes, packReport, preparation: input.preparation});
  assert.deepEqual({...preparation, packer: input.preparation.packer}, input.preparation);
  assert.equal(preparation.packer.rawRequestSha256, input.accepted.resource.rawRequestSha256);
  assert.equal(preparation.sourceRevision, input.preparation.sourceRevision);
});

test('rehashing a changed call, source, fee or spending limit cannot disguise execution tampering', () => {
  const changes = [p => p.actions[0].data = '0xbeef', p => p.actions[0].value = '20000000000000000',
    p => p.verificationBundle.compilationUnits[0].source += ' changed', p => p.hookFees.projectBps = 180,
    p => p.budgets.maxTotalGas = '14000000', p => p.budgets.maxTotalValue = '20000000000000000'];
  for (const change of changes) {
    const input = fixture(); change(input.accepted.resource.plan); hashes(input.accepted.resource);
    assert.throws(() => reconcileReplanInputs(input), /Only the server budget timestamps/);
  }
});

test('changed approval, owner, successor, predecessor proof or binding fails closed', () => {
  const mutations = [x => x.accepted.resource.manualReview.subjectHash = 'sha256:' + '7'.repeat(64),
    x => x.accepted.resource.manualReview.expiresAt = new Date(now + 5000000).toISOString(),
    x => x.accepted.resource.manualReview.state = 'pending', x => x.accepted.resource.manualReview.requiresRepack = true,
    x => x.accepted.resource.manualReview.controller = '0x' + '9'.repeat(40),
    x => { x.accepted.resource.planId = 'different'; x.accepted.resource.resumeUrl = '/v4/chains/4663/custom-launch-plans/different'; },
    x => x.evidence.intent.predecessor.previousPlanHash = 'sha256:' + '7'.repeat(64),
    x => x.evidence.postResponse.httpStatus = 500, x => x.evidence.postResponse.data.replan.bindingHash = 'sha256:' + '7'.repeat(64),
    x => x.accepted.resource.replan.previousPlanId = 'different',
    x => x.accepted.resource.rawRequestSha256 = 'sha256:' + '7'.repeat(64),
    x => x.evidence.intent.rawRequestSha256 = 'sha256:' + '7'.repeat(64)];
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => reconcileReplanInputs(input)); }
});

test('refreshed windows cannot start in the future, expire, extend approval, or exceed 24 hours', () => {
  const cases = [p => p.budgets.validAfter = String(second + 1), p => p.budgets.deadline = String(second - 1),
    p => p.budgets.deadline = String(second + 4001), p => p.budgets.validAfter = String(second - 86401)];
  for (const mutate of cases) {
    const input = fixture(); mutate(input.accepted.resource.plan); hashes(input.accepted.resource);
    assert.throws(() => reconcileReplanInputs(input), /Server window/);
  }
});

test('prior or current transaction execution cannot be reconciled into a new signing handoff', () => {
  for (const location of ['predecessor', 'current']) {
    const input = fixture(), resource = location === 'predecessor' ? input.evidence.predecessorResponse.data : input.accepted.resource;
    resource.steps = [{status: 'broadcast', transactionHash: '0x' + 'f'.repeat(64)}];
    assert.throws(() => reconcileReplanInputs(input), /transaction execution|unsubmitted/);
  }
});

test('original request/preparation and refreshed packer outputs remain bound across phases', () => {
  let input = fixture(); input.requestBytes = Buffer.concat([input.requestBytes, Buffer.from('\n')]);
  assert.throws(() => reconcileReplanInputs(input));
  input = fixture(); input.preparation.sourceCommitment = 'sha256:' + '0'.repeat(64);
  assert.throws(() => reconcileReplanInputs(input), /approved source commitment/);
  input = fixture(); const reconciled = reconcileReplanInputs(input), packReport = report(input.accepted.resource.plan);
  const args = {reconciled, requestBytes: reconciled.refreshedBytes, packReport, preparation: input.preparation};
  assert.throws(() => bindRefreshedPreparation({...args, requestBytes: Buffer.concat([args.requestBytes, Buffer.from('\n')])}), /packer changed/);
  const changed = structuredClone(input.preparation); changed.sourceRevision = '2'.repeat(40);
  assert.throws(() => bindRefreshedPreparation({...args, preparation: changed}), /preparation changed/);
  assert.throws(() => bindRefreshedPreparation({...args, packReport: {...packReport, planHash: 'sha256:' + '0'.repeat(64)}}), /exact submitted plan/);
});

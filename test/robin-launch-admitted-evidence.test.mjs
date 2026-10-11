import test from 'node:test';
import assert from 'node:assert/strict';
import * as ethers from 'ethers';
import {validateLaunchPackage, validateAdmittedAtomicEvidence, MANAGER} from '../signing-ui/robin-launch-guards.mjs';
import {MANAGER_HASH} from '../signing-ui/guards.mjs';
import {canonicalLaunchJson, launchManifestHash} from '../src/launch-manifest.mjs';
import {ATOMIC_LAUNCH_ABI} from '../src/launch-manifest-builder.mjs';
import {launchReviewFixture, NOW} from './helpers/launch-review-fixture.mjs';

const hash = text => ethers.keccak256(ethers.toUtf8Bytes(text));
const sha = text => 'sha256:' + ethers.sha256(ethers.toUtf8Bytes(text)).slice(2);
function reseal(resource) {
  const e = resource.admissionEvidence;
  resource.admission.evidenceDigest = sha(e.schemaVersion + '\0' + canonicalLaunchJson(e));
}
function fixture() {
  const f = launchReviewFixture(), r = f.pkg.resource, p = r.plan, pin = f.manifest.transaction;
  const compilationDigest = sha('fixture compiler evidence'), policyBindingHash = sha('fixture policy');
  const order = {chainId: '4663', executor: pin.to, executorRuntimeCodeHash: pin.routerRuntimeCodeHash,
    controller: pin.from, controllerRuntimeCodeHash: ethers.ZeroHash, launchId: hash('launch'),
    planHash: '0x' + r.planHash.slice(7), manifestDigest: '0x' + r.manifestDigest.slice(7), callsHash: hash('calls'),
    totalValue: pin.valueWei, componentsHash: hash('components'), marketsHash: hash('markets'), effectsHash: hash('effects'),
    feeObligationsHash: hash('fees'), nonce: hash('nonce'), validAfter: p.budgets.validAfter, deadline: p.budgets.deadline};
  const prep = {binding: {chainId: '4663', manifestDigest: r.manifestDigest, address: pin.to, runtimeCodeHash: pin.routerRuntimeCodeHash,
    policyBindingHash, poolManager: MANAGER, poolManagerRuntimeCodeHash: MANAGER_HASH,
    permitAuthority: '0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06',
    permitAuthorityRuntimeCodeHash: '0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c'},
    order: structuredClone(order), sourceEvidenceDigest: compilationDigest, calls: [], components: [], markets: []};
  r.walletAuthorization = {atomicPreparation: prep, executionOrder: order};
  const atomic = new ethers.Interface(ATOMIC_LAUNCH_ABI);
  r.steps[0].transaction.data = atomic.encodeFunctionData('executeAndStampV2', [order, [], [], [], '0x1234']);
  pin.calldataHash = ethers.keccak256(r.steps[0].transaction.data);
  r.preflight = null;
  const claims = [{claimType: 'launch_admission_policy', status: 'verified', subject: r.planHash, observedValue: p.admissionPolicy},
    ...p.components.map(c => ({claimType: 'source_matches_creation_and_runtime', status: 'verified', subject: c.componentId,
      observedValue: c.runtimeCodeHash, witness: {details: {compilationDigest}}}))];
  r.admission.assuranceClaims = structuredClone(claims);
  r.admission.schemaVersion = 'programmable.custom-launch-plan-admission.v1';
  // A short-lived metadata receipt does not shorten the independently signed order.
  r.admission.expiresAt = new Date(NOW + 120000).toISOString();
  r.admissionEvidence = {schemaVersion: 'programmable.custom-launch-plan-evidence.v1', planHash: r.planHash, manifestDigest: r.manifestDigest,
    walletAuthorization: structuredClone(r.walletAuthorization), assuranceClaims: claims, compilationDigest, policyBindingHash,
    transactionDigests: [pin.transactionDigest], inspection: {chainId: '4663', blockHash: hash('block'), blockNumber: '123', controller: {address: pin.from, nonce: pin.nonce}},
    simulation: {chainId: '4663', planHash: r.planHash, blockHash: hash('block'), blockNumber: '123', violations: [],
      steps: [{stepId: pin.stepId, transactionDigest: pin.transactionDigest, outcome: 'success'}]}};
  reseal(r);
  f.expectedHash = launchManifestHash(f.manifest, ethers);
  return f;
}

test('nullable preflight accepts complete admitted Atomic evidence and separately bounded receipt/order windows', () => {
  const f = fixture();
  assert.equal(validateLaunchPackage(f.pkg, f.manifest, f.expectedHash, ethers, NOW), f.pkg.resource);
  assert.ok(Date.parse(f.manifest.transaction.expiresAt) > Date.parse(f.pkg.resource.admission.expiresAt));
});

test('nullable preflight rejects missing proof, changed evidence digest, failed simulation and source claims', () => {
  const mutations = [r => delete r.admissionEvidence, r => r.admission.evidenceDigest = sha('wrong'),
    r => { r.admissionEvidence.simulation.steps[0].outcome = 'reverted'; reseal(r); },
    r => { r.admissionEvidence.simulation.violations.push({code: 'FAILED'}); reseal(r); },
    r => { r.admissionEvidence.transactionDigests[0] = sha('different'); reseal(r); },
    r => { r.admissionEvidence.assuranceClaims[1].status = 'disclosed'; r.admission.assuranceClaims = structuredClone(r.admissionEvidence.assuranceClaims); reseal(r); },
    r => { r.admissionEvidence.inspection.controller.nonce = '8'; reseal(r); },
    r => { r.admissionEvidence.simulation.blockHash = hash('other block'); reseal(r); }];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f.pkg.resource);
    assert.throws(() => validateLaunchPackage(f.pkg, f.manifest, f.expectedHash, ethers, NOW));
  }
});

test('rehashing admission evidence cannot replace the order encoded in the signed wallet calldata', () => {
  const f = fixture(), r = f.pkg.resource;
  r.walletAuthorization.executionOrder.callsHash = hash('different calls');
  r.walletAuthorization.atomicPreparation.order = structuredClone(r.walletAuthorization.executionOrder);
  r.admissionEvidence.walletAuthorization = structuredClone(r.walletAuthorization);
  reseal(r);
  assert.throws(() => validateAdmittedAtomicEvidence(r, f.manifest, ethers), /signed calldata/);
});

test('missing signature, different authority and another replan cannot substitute for preflight', () => {
  let f = fixture(), r = f.pkg.resource;
  r.walletAuthorization.atomicPreparation.binding.permitAuthority = f.manifest.operator;
  r.admissionEvidence.walletAuthorization = structuredClone(r.walletAuthorization); reseal(r);
  assert.throws(() => validateAdmittedAtomicEvidence(r, f.manifest, ethers), /preparation/);
  f = fixture(); r = f.pkg.resource; r.replan = {bindingHash: sha('bound')}; r.admissionEvidence.replan = {bindingHash: sha('other')}; reseal(r);
  assert.throws(() => validateAdmittedAtomicEvidence(r, f.manifest, ethers), /different replan/);
  f = fixture(); r = f.pkg.resource;
  r.steps[0].transaction.data = new ethers.Interface(ATOMIC_LAUNCH_ABI).encodeFunctionData('executeAndStampV2', [r.walletAuthorization.executionOrder, [], [], [], '0x']);
  assert.throws(() => validateAdmittedAtomicEvidence(r, f.manifest, ethers), /signed calldata/);
});

test('a failed explicit preflight or expired admission still blocks a wallet handoff', () => {
  let f = fixture(); f.pkg.resource.preflight = {planHash: f.manifest.planHash, manifestDigest: f.manifest.platformManifestDigest,
    launchEligibility: {status: 'action_required', hardBlockers: [{code: 'FAILED'}]}};
  assert.throws(() => validateLaunchPackage(f.pkg, f.manifest, f.expectedHash, ethers, NOW), /not ready/);
  f = fixture(); f.pkg.resource.admission.expiresAt = new Date(NOW - 1).toISOString();
  assert.throws(() => validateLaunchPackage(f.pkg, f.manifest, f.expectedHash, ethers, NOW), /stale, expired/);
  f = fixture(); f.pkg.resource.preflight = undefined;
  assert.throws(() => validateLaunchPackage(f.pkg, f.manifest, f.expectedHash, ethers, NOW), /unavailable/);
});

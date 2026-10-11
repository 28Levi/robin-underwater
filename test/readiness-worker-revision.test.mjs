import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {launchReviewFixture, NOW} from './helpers/launch-review-fixture.mjs';
import {canonicalLaunchJson, validateLaunchManifest, launchManifestHash, validateLaunchConsent,
  effectiveWorkerSourceRevision} from '../src/launch-manifest.mjs';
import {validateLaunchHostReady} from '../src/launch-host-ready.mjs';
import {installLaunchAdmission} from '../src/launch-admission-install.mjs';
import {inspectLaunchAdmission} from '../src/launch-standby.mjs';
import {verifyLaunchReviewInputs} from '../src/launch-review-server.mjs';

const workerRevision = '2'.repeat(40);
const v2 = manifest => ({...structuredClone(manifest), schemaVersion: 'robinhook.launch-bootstrap.v2', workerSourceRevision: workerRevision});
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const consentFor = (manifest, ethers) => ({schemaVersion: 'robinhook.launch-review.v1', manifestSha256: launchManifestHash(manifest, ethers),
  account: manifest.transaction.from, nonce: manifest.transaction.nonce, reviewedAt: NOW / 1000,
  automationAccepted: true, economicRiskAccepted: true, execution: manifest.execution});
const ackFor = (manifest, ethers, consentBytes) => ({schemaVersion: 'robinhook.launch-host-ready.v1',
  manifestSha256: launchManifestHash(manifest, ethers), sourceRevision: effectiveWorkerSourceRevision(manifest), consentSha256: sha(consentBytes),
  account: manifest.transaction.from, nonce: manifest.transaction.nonce, checkedAt: new Date(NOW).toISOString(),
  automationApprovedManifestSha256: launchManifestHash(manifest, ethers), servicesEnabled: true, admissionInstalled: true,
  consentInstalled: true, watcherRunning: true, noStopMarkers: true, state: 'waiting-for-launch'});

test('v1 keeps its canonical hash and single revision; v2 requires an explicit strictly bound worker revision', () => {
  const f = launchReviewFixture(), before = canonicalLaunchJson(f.manifest);
  assert.equal(launchManifestHash(f.manifest, f.ethers), 'sha256:dfa7e20d5e0762045091e3127a4c617bbc770799fbcc4c28a30f56f97ee677e0');
  assert.equal(effectiveWorkerSourceRevision(f.manifest), f.manifest.sourceRevision);
  assert.equal(canonicalLaunchJson(f.manifest), before);
  const manifest = v2(f.manifest);
  assert.equal(effectiveWorkerSourceRevision(manifest), workerRevision);
  assert.equal(manifest.sourceRevision, f.manifest.sourceRevision);
  assert.notEqual(launchManifestHash(manifest, f.ethers), f.expectedHash);
  for (const bad of [
    {...f.manifest, workerSourceRevision: workerRevision}, {...manifest, schemaVersion: 'robinhook.launch-bootstrap.v3'},
    {...manifest, workerSourceRevision: undefined}, {...manifest, workerSourceRevision: 'main'},
    {...manifest, workerSourceRevision: 'G'.repeat(40)}, {...manifest, extra: true},
  ]) assert.throws(() => validateLaunchManifest(bad));
  const missing = structuredClone(manifest); delete missing.workerSourceRevision;
  assert.throws(() => effectiveWorkerSourceRevision(missing));
});

test('worker release binds new consent and host acknowledgement while retaining the exact platform request and transaction', () => {
  const f = launchReviewFixture({automatic: true}), manifest = v2(f.manifest);
  const expectedHash = launchManifestHash(manifest, f.ethers), oldConsent = consentFor(f.manifest, f.ethers);
  const oldConsentBytes = Buffer.from(JSON.stringify(oldConsent)), oldAck = ackFor(f.manifest, f.ethers, oldConsentBytes);
  assert.throws(() => validateLaunchConsent(oldConsent, manifest, f.ethers), /consent/);
  const consent = consentFor(manifest, f.ethers), consentBytes = Buffer.from(JSON.stringify(consent));
  validateLaunchConsent(consent, manifest, f.ethers);
  const args = {manifest, expectedHash, ethers: f.ethers, consentBytes, now: NOW};
  assert.throws(() => validateLaunchHostReady(oldAck, args), /acknowledgement/);
  const ack = ackFor(manifest, f.ethers, consentBytes);
  assert.equal(validateLaunchHostReady(ack, args).ready, true);
  assert.throws(() => validateLaunchHostReady({...ack, sourceRevision: manifest.sourceRevision}, args), /acknowledgement/);
  for (const changed of [
    {...manifest, workerSourceRevision: '3'.repeat(40)},
    {...manifest, sourceRevision: manifest.workerSourceRevision, workerSourceRevision: manifest.sourceRevision},
  ]) {
    assert.throws(() => validateLaunchConsent(consent, changed, f.ethers), /consent/);
    assert.throws(() => validateLaunchHostReady(ack, {...args, manifest: changed, expectedHash: launchManifestHash(changed, f.ethers)}));
  }
  const before = Buffer.from(f.requestBytes), resource = canonicalLaunchJson(f.acceptedResource);
  verifyLaunchReviewInputs({...f, manifest, expectedHash, now: NOW});
  assert.deepEqual(f.requestBytes, before); assert.equal(canonicalLaunchJson(f.acceptedResource), resource);
  assert.deepEqual(manifest.transaction, f.manifest.transaction);
  assert.equal(manifest.planHash, f.manifest.planHash); assert.equal(manifest.requestSha256, f.manifest.requestSha256);
});

test('v2 installer and standby bind the running worker and refuse to replace previous admission or journals', t => {
  const f = launchReviewFixture({automatic: true}), manifest = v2(f.manifest), expectedHash = launchManifestHash(manifest, f.ethers);
  const root = path.resolve('output/test'); fs.mkdirSync(root, {recursive: true});
  const dir = fs.mkdtempSync(path.join(root, 'worker-revision-'));
  t.after(() => {assert.equal(path.dirname(path.resolve(dir)), root); fs.rmSync(dir, {recursive: true, force: true});});
  const manifestFile = path.join(dir, 'manifest.json'), stateDirectory = path.join(dir, 'state');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const options = {manifestFile, stateDirectory, expectedManifestSha256: expectedHash, sourceRevision: workerRevision, now: NOW};
  assert.throws(() => installLaunchAdmission({...options, sourceRevision: manifest.sourceRevision}), /revision/);
  assert.equal(fs.existsSync(stateDirectory), false);
  const installed = installLaunchAdmission(options);
  const settings = {dir: stateDirectory, admissionFile: installed.admissionFile, sourceRevision: workerRevision};
  assert.equal(inspectLaunchAdmission(settings).state, 'reviewed-package-admitted');
  assert.throws(() => inspectLaunchAdmission({...settings, sourceRevision: manifest.sourceRevision}), /revision/);
  const runtime = path.join(stateDirectory, 'runtime'); fs.mkdirSync(runtime);
  const journal = path.join(runtime, 'operator-journal.json'); fs.writeFileSync(journal, 'preserve existing journal');
  const before = fs.readFileSync(installed.admissionFile);
  const changed = {...manifest, workerSourceRevision: '3'.repeat(40)};
  fs.writeFileSync(manifestFile, JSON.stringify(changed));
  assert.throws(() => installLaunchAdmission({...options, sourceRevision: changed.workerSourceRevision,
    expectedManifestSha256: launchManifestHash(changed, f.ethers)}), /existing admission/);
  assert.deepEqual(fs.readFileSync(installed.admissionFile), before);
  assert.equal(fs.readFileSync(journal, 'utf8'), 'preserve existing journal');
});

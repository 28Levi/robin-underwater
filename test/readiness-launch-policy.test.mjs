import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {launchReviewFixture, NOW} from './helpers/launch-review-fixture.mjs';
import {canonicalLaunchJson, validateLaunchManifest, launchManifestHash, validateLaunchConsent,
  effectiveWorkerSourceRevision} from '../src/launch-manifest.mjs';
import {validateLaunchHostReady} from '../src/launch-host-ready.mjs';
import {verifyLaunchReviewInputs} from '../src/launch-review-server.mjs';
import {installLaunchAdmission} from '../src/launch-admission-install.mjs';
import {inspectLaunchAdmission} from '../src/launch-standby.mjs';

const workerSourceRevision = '2'.repeat(40);
const v2 = manifest => ({...structuredClone(manifest), schemaVersion: 'robinhook.launch-bootstrap.v2', workerSourceRevision});
function v3(manifest) {
  const updated = v2(manifest); updated.schemaVersion = 'robinhook.launch-bootstrap.v3';
  updated.accounting.minimumAgeSeconds = 300; updated.execution.payoutIntervalSeconds = 900;
  return updated;
}
function v4(manifest) {
  const updated = v3(manifest); updated.schemaVersion = 'robinhook.launch-bootstrap.v4';
  Object.assign(updated.execution, {confirmationMode: 'pipelined-finalized-v1', maxInflightTransactions: 8});
  return updated;
}
const consentFor = (manifest, ethers) => ({schemaVersion: 'robinhook.launch-review.v1', manifestSha256: launchManifestHash(manifest, ethers),
  account: manifest.transaction.from, nonce: manifest.transaction.nonce, reviewedAt: NOW / 1000,
  automationAccepted: true, economicRiskAccepted: true, execution: structuredClone(manifest.execution)});
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function ackFor(manifest, ethers, consentBytes) {
  return {schemaVersion: 'robinhook.launch-host-ready.v1', manifestSha256: launchManifestHash(manifest, ethers),
    sourceRevision: effectiveWorkerSourceRevision(manifest), consentSha256: sha(consentBytes), account: manifest.transaction.from,
    nonce: manifest.transaction.nonce, checkedAt: new Date(NOW).toISOString(),
    automationApprovedManifestSha256: launchManifestHash(manifest, ethers), servicesEnabled: true, admissionInstalled: true,
    consentInstalled: true, watcherRunning: true, noStopMarkers: true, state: 'waiting-for-launch'};
}

test('v3 requires the exact five-minute holding and fifteen-minute payout policy; historical manifests retain their own policy', () => {
  const f = launchReviewFixture(), historical = [f.manifest, v2(f.manifest)], manifest = v3(f.manifest);
  assert.equal(validateLaunchManifest(manifest), manifest);
  assert.equal(effectiveWorkerSourceRevision(manifest), workerSourceRevision);
  for (const old of historical) {
    const before = canonicalLaunchJson(old), oldHash = launchManifestHash(old, f.ethers);
    assert.equal(validateLaunchManifest(old), old);
    assert.equal(old.accounting.minimumAgeSeconds, 3600);
    assert.equal(Object.hasOwn(old.execution, 'payoutIntervalSeconds'), false);
    assert.notEqual(launchManifestHash(manifest, f.ethers), oldHash);
    const changedAge = structuredClone(old); changedAge.accounting.minimumAgeSeconds = 300;
    assert.throws(() => validateLaunchManifest(changedAge), /accounting policy/);
    const changedInterval = structuredClone(old); changedInterval.execution.payoutIntervalSeconds = 900;
    assert.throws(() => validateLaunchManifest(changedInterval), /operator policy/);
    assert.equal(canonicalLaunchJson(old), before);
  }
  for (const mutate of [m => delete m.workerSourceRevision, m => m.workerSourceRevision = 'main',
    m => m.schemaVersion = 'robinhook.launch-bootstrap.v4', m => m.accounting.minimumAgeSeconds = 3600,
    m => m.accounting.minimumAgeSeconds = 299, m => m.execution.payoutIntervalSeconds = 899,
    m => m.execution.payoutIntervalSeconds = '900', m => delete m.execution.payoutIntervalSeconds,
    m => m.execution.extra = true, m => m.extra = true]) {
    const changed = structuredClone(manifest); mutate(changed); assert.throws(() => validateLaunchManifest(changed));
  }
});

test('changed policy requires new consent and host acknowledgement without replacing the approved platform package', () => {
  const f = launchReviewFixture({automatic: true}), old = v2(f.manifest), manifest = v3(f.manifest);
  const oldConsent = consentFor(old, f.ethers), oldBytes = Buffer.from(JSON.stringify(oldConsent));
  const oldAck = ackFor(old, f.ethers, oldBytes), expectedHash = launchManifestHash(manifest, f.ethers);
  assert.throws(() => validateLaunchConsent(oldConsent, manifest, f.ethers), /consent/);
  assert.throws(() => validateLaunchConsent({...oldConsent, execution: manifest.execution}, manifest, f.ethers), /consent/);
  assert.throws(() => validateLaunchConsent({...oldConsent, manifestSha256: expectedHash}, manifest, f.ethers), /consent/);
  const consent = consentFor(manifest, f.ethers), consentBytes = Buffer.from(JSON.stringify(consent));
  validateLaunchConsent(consent, manifest, f.ethers);
  const args = {manifest, expectedHash, ethers: f.ethers, consentBytes, now: NOW};
  assert.throws(() => validateLaunchHostReady(oldAck, args), /acknowledgement/);
  assert.equal(validateLaunchHostReady(ackFor(manifest, f.ethers, consentBytes), args).ready, true);
  const requestBefore = Buffer.from(f.requestBytes), resourceBefore = canonicalLaunchJson(f.acceptedResource);
  verifyLaunchReviewInputs({...f, manifest, expectedHash, now: NOW});
  assert.deepEqual(f.requestBytes, requestBefore); assert.equal(canonicalLaunchJson(f.acceptedResource), resourceBefore);
  for (const key of ['sourceRevision', 'transaction', 'components', 'requestSha256', 'planHash', 'projectMetadataHash', 'fundingPlanHash'])
    assert.deepEqual(manifest[key], old[key]);
});

test('v4 requires explicit bounded finalized pipeline while v1-v3 keep their canonical identities', () => {
  const f = launchReviewFixture(), manifest = v4(f.manifest);
  validateLaunchManifest(manifest);
  const historical = [f.manifest, v2(f.manifest), v3(f.manifest)];
  const hashes = ['dfa7e20d5e0762045091e3127a4c617bbc770799fbcc4c28a30f56f97ee677e0',
    '334d73f85d31294bf6a7202c783d1c03bcc12b1c367c28afa508a1233c45790f',
    'f13e321f8932ec1b11743d42278435e38bea90313856cc462a8ee7054b380082'];
  for (const [index, old] of historical.entries()) {
    assert.equal(launchManifestHash(old, f.ethers), `sha256:${hashes[index]}`);
    const changed = structuredClone(old);
    Object.assign(changed.execution, {confirmationMode: 'pipelined-finalized-v1', maxInflightTransactions: 8});
    assert.throws(() => validateLaunchManifest(changed), /operator policy/);
  }
  for (const mutate of [m => m.schemaVersion = 'robinhook.launch-bootstrap.v5', m => delete m.workerSourceRevision,
    m => delete m.execution.confirmationMode, m => m.execution.confirmationMode = 'latest',
    m => delete m.execution.maxInflightTransactions, m => m.execution.maxInflightTransactions = 7,
    m => m.execution.maxInflightTransactions = 9, m => m.execution.maxInflightTransactions = '8',
    m => m.accounting.minimumAgeSeconds = 0, m => m.accounting.maxFinalityLagSeconds = 7200,
    m => delete m.execution.payoutIntervalSeconds]) {
    const changed = structuredClone(manifest); mutate(changed); assert.throws(() => validateLaunchManifest(changed));
  }
});

test('v4 pipeline requires fresh exact consent and host acknowledgement and leaves the platform transaction unchanged', () => {
  const f = launchReviewFixture({automatic: true}), old = v3(f.manifest), manifest = v4(f.manifest);
  const oldConsent = consentFor(old, f.ethers), oldBytes = Buffer.from(JSON.stringify(oldConsent));
  const oldAck = ackFor(old, f.ethers, oldBytes), expectedHash = launchManifestHash(manifest, f.ethers);
  assert.throws(() => validateLaunchConsent(oldConsent, manifest, f.ethers), /consent/);
  assert.throws(() => validateLaunchConsent({...oldConsent, manifestSha256: expectedHash}, manifest, f.ethers), /consent/);
  const consent = consentFor(manifest, f.ethers), consentBytes = Buffer.from(JSON.stringify(consent));
  validateLaunchConsent(consent, manifest, f.ethers);
  const args = {manifest, expectedHash, ethers: f.ethers, consentBytes, now: NOW};
  assert.throws(() => validateLaunchHostReady(oldAck, args), /acknowledgement/);
  assert.equal(validateLaunchHostReady(ackFor(manifest, f.ethers, consentBytes), args).ready, true);
  verifyLaunchReviewInputs({...f, manifest, expectedHash, now: NOW});
  for (const key of ['sourceRevision', 'transaction', 'components', 'requestSha256', 'planHash', 'projectMetadataHash', 'fundingPlanHash'])
    assert.deepEqual(manifest[key], old[key]);
});

test('v4 admission installs only the actual reviewed policy and never replaces a serial admission', t => {
  const f = launchReviewFixture({automatic: true}), manifest = v4(f.manifest), serial = v3(f.manifest);
  const root = path.resolve('output/test'); fs.mkdirSync(root, {recursive: true});
  const dir = fs.mkdtempSync(path.join(root, 'pipeline-admission-'));
  t.after(() => {assert.equal(path.dirname(path.resolve(dir)), root); fs.rmSync(dir, {recursive: true, force: true});});
  const manifestFile = path.join(dir, 'manifest.json'), consentFile = path.join(dir, 'review.json');
  const stateDirectory = path.join(dir, 'state'), expectedManifestSha256 = launchManifestHash(manifest, f.ethers);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.writeFileSync(consentFile, JSON.stringify(consentFor(serial, f.ethers)));
  const options = {manifestFile, consentFile, stateDirectory, expectedManifestSha256, sourceRevision: workerSourceRevision, now: NOW};
  assert.throws(() => installLaunchAdmission(options), /consent/);
  assert.equal(fs.existsSync(stateDirectory), false);
  const reviewedBytes = Buffer.from(JSON.stringify(consentFor(manifest, f.ethers), null, 2));
  fs.writeFileSync(consentFile, reviewedBytes);
  const installed = installLaunchAdmission(options);
  const settings = {dir: stateDirectory, admissionFile: installed.admissionFile, sourceRevision: workerSourceRevision};
  assert.equal(inspectLaunchAdmission(settings).state, 'reviewed-package-admitted');
  assert.deepEqual(fs.readFileSync(path.join(stateDirectory, 'launch-review.json')), reviewedBytes);
  const before = fs.readFileSync(installed.admissionFile);
  fs.writeFileSync(manifestFile, JSON.stringify(serial));
  fs.writeFileSync(consentFile, JSON.stringify(consentFor(serial, f.ethers)));
  assert.throws(() => installLaunchAdmission({...options, expectedManifestSha256: launchManifestHash(serial, f.ethers)}), /existing admission|review differs/);
  assert.deepEqual(fs.readFileSync(installed.admissionFile), before);
});

test('wallet review renders each manifest holding rule and schedule without relabeling historical policy', () => {
  const f = launchReviewFixture(), app = fs.readFileSync('signing-ui/robin-launch-app.js', 'utf8');
  const start = app.indexOf('function details('), end = app.indexOf('async function loadPackage()', start);
  assert.ok(start >= 0 && end > start);
  for (const [manifest, holding, scheduled] of [[f.manifest, '60 minutes', false], [v2(f.manifest), '60 minutes', false],
    [v3(f.manifest), '5 minutes', true], [v4(f.manifest), '5 minutes of finalized history; blockchain confirmation adds a delay (about 15–20 minutes in the live test)', true]]) {
    const elements = new Map();
    const element = () => ({children: [], textContent: '', replaceChildren(...children) {this.children = children;}});
    const $ = id => {if (!elements.has(id)) elements.set(id, element()); return elements.get(id);};
    const context = vm.createContext({manifest, pkg: f.pkg, session: {manifestSha256: launchManifestHash(manifest, f.ethers)},
      ethers: f.ethers, $, document: {createElement: element}, effectiveWorkerSourceRevision,
      automatic: () => manifest.activation.mode === 'after-reviewed-launch'});
    vm.runInContext(app.slice(start, end) + '\nshowPackage();', context);
    const children = $('automation-details').children, rows = new Map();
    for (let i = 0; i < children.length; i += 2) rows.set(children[i].textContent, children[i + 1].textContent);
    assert.equal(rows.get('Holding requirement'), holding);
    assert.equal(rows.get('Price averaging window'), '30 minutes');
    if (manifest.execution.confirmationMode) {
      assert.match(rows.get('Payout interval'), /^Target every 15 minutes after initial warmup/);
      assert.match(rows.get('Payout interval'), /Exact arrival and finality times are not guaranteed/);
      assert.match(rows.get('First payout'), /30 minutes of finalized price history: approximately 45–50 minutes/);
      assert.match(rows.get('Confirmation policy'), /finalized history and finalized funds/);
      assert.match(rows.get('Transactions awaiting finality'), /^Maximum 8/);
    } else if (scheduled) assert.match(rows.get('Payout interval'), /^15 minutes from the finalized launch timestamp; eligible, funded batches only$/);
    else assert.equal(rows.get('Payout interval'), 'No scheduled interval in this historical policy');
    assert.equal($('source-revision').textContent, manifest.sourceRevision);
    assert.equal($('worker-source-revision').textContent, effectiveWorkerSourceRevision(manifest));
  }
});

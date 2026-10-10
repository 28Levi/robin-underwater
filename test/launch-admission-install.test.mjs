import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as ethers from 'ethers';
import {launchReviewFixture, NOW} from './helpers/launch-review-fixture.mjs';
import {launchManifestHash} from '../src/launch-manifest.mjs';
import {installLaunchAdmission} from '../src/launch-admission-install.mjs';
import {inspectLaunchAdmission} from '../src/launch-standby.mjs';
import {parseAdmissionInstallOptions} from '../scripts/install-launch-admission.mjs';

function fixture(t, {automatic = false} = {}) {
  const root = path.resolve('output/test'); fs.mkdirSync(root, {recursive: true});
  const dir = fs.mkdtempSync(path.join(root, 'admission-install-'));
  t.after(() => { if (!dir.startsWith(`${root}${path.sep}`)) throw Error('Unsafe cleanup'); fs.rmSync(dir, {recursive: true, force: true}); });
  const {manifest, expectedHash} = launchReviewFixture({automatic});
  const manifestFile = path.join(dir, 'manifest.json'), consentFile = path.join(dir, 'review.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  // Same server-recorded format: this is a test fixture, never production consent.
  const consent = {schemaVersion: 'robinhook.launch-review.v1', manifestSha256: expectedHash, account: manifest.transaction.from,
    nonce: manifest.transaction.nonce, reviewedAt: NOW / 1000, automationAccepted: automatic,
    economicRiskAccepted: automatic, execution: structuredClone(manifest.execution)};
  fs.writeFileSync(consentFile, JSON.stringify(consent, null, 2) + '\n');
  const options = {manifestFile, expectedManifestSha256: expectedHash, stateDirectory: path.join(dir, 'state'),
    sourceRevision: manifest.sourceRevision, now: NOW};
  return {dir, manifest, expectedHash, consentFile, consent, options};
}

test('offline installer atomically delivers a standby-compatible package and exact retries preserve files', t => {
  const f = fixture(t), installed = installLaunchAdmission(f.options);
  assert.equal(installed.admissionInstalled, true); assert.equal(installed.consentFile, null);
  assert.equal(installed.signing, false); assert.equal(installed.broadcast, false); assert.equal(installed.servicesStarted, false);
  const bytes = fs.readFileSync(installed.admissionFile), before = fs.statSync(installed.admissionFile);
  const status = inspectLaunchAdmission({dir: f.options.stateDirectory, admissionFile: installed.admissionFile, sourceRevision: f.manifest.sourceRevision});
  assert.equal(status.manifestSha256, f.expectedHash); assert.equal(status.state, 'reviewed-package-admitted');
  const again = installLaunchAdmission(f.options);
  assert.equal(again.admissionInstalled, false); assert.equal(again.reviewInstalled, false);
  assert.deepEqual(fs.readFileSync(installed.admissionFile), bytes);
  assert.equal(fs.statSync(installed.admissionFile).mtimeMs, before.mtimeMs);
  assert.equal(fs.existsSync(path.join(f.options.stateDirectory, 'runtime')), false);
  assert.equal(fs.existsSync(path.join(f.options.stateDirectory, 'admission-install.lock')), false);
});

test('bad manifest, changed digest and changed running source fail before destination creation', t => {
  const f = fixture(t);
  for (const change of [{expectedManifestSha256: `sha256:${'f'.repeat(64)}`}, {sourceRevision: '2'.repeat(40)}, {stateDirectory: 'relative'}]) {
    assert.throws(() => installLaunchAdmission({...f.options, ...change}));
    assert.equal(fs.existsSync(f.options.stateDirectory), false);
  }
  f.manifest.fees.projectBuyFeeBps = 179; fs.writeFileSync(f.options.manifestFile, JSON.stringify(f.manifest));
  assert.throws(() => installLaunchAdmission(f.options), /Invalid reviewed/);
  assert.equal(fs.existsSync(f.options.stateDirectory), false);
});

test('existing admission is immutable even when a different valid package has a correct digest', t => {
  const f = fixture(t), first = installLaunchAdmission(f.options), original = fs.readFileSync(first.admissionFile);
  f.manifest.execution.minimumBatchWei = '2'; fs.writeFileSync(f.options.manifestFile, JSON.stringify(f.manifest));
  assert.throws(() => installLaunchAdmission({...f.options, expectedManifestSha256: launchManifestHash(f.manifest, ethers)}), /existing admission/);
  assert.deepEqual(fs.readFileSync(first.admissionFile), original);
  assert.equal(fs.existsSync(path.join(f.options.stateDirectory, 'launch-review.json')), false);
});

test('automatic mode never fabricates consent; actual existing review is separately checked and preserved byte for byte', t => {
  const f = fixture(t, {automatic: true});
  const first = installLaunchAdmission(f.options);
  assert.equal(first.automaticServicesRequested, true); assert.equal(first.consentFile, null);
  const result = installLaunchAdmission({...f.options, consentFile: f.consentFile});
  assert.equal(result.reviewInstalled, true); assert.equal(result.admissionInstalled, false);
  const actual = fs.readFileSync(f.consentFile); assert.deepEqual(fs.readFileSync(result.consentFile), actual);
  assert.equal(installLaunchAdmission({...f.options, consentFile: f.consentFile}).reviewInstalled, false);
  fs.writeFileSync(f.consentFile, JSON.stringify(f.consent));
  assert.throws(() => installLaunchAdmission({...f.options, consentFile: f.consentFile}), /bytes differ/);
  assert.deepEqual(fs.readFileSync(result.consentFile), actual);
});

test('wrong account, nonce, approval, execution limits, digest and future consent are rejected before admission', t => {
  const f = fixture(t, {automatic: true});
  const changes = [c => {c.account = `0x${'3'.repeat(40)}`;}, c => {c.nonce = '999';}, c => {c.automationAccepted = false;},
    c => {c.economicRiskAccepted = false;}, c => {c.execution.maxTotalGasWei = '1';},
    c => {c.manifestSha256 = `sha256:${'4'.repeat(64)}`;}, c => {c.reviewedAt++;}, c => {c.extra = true;}];
  for (const change of changes) {
    const altered = structuredClone(f.consent); change(altered); fs.writeFileSync(f.consentFile, JSON.stringify(altered));
    assert.throws(() => installLaunchAdmission({...f.options, consentFile: f.consentFile}), /review/);
    assert.equal(fs.existsSync(f.options.stateDirectory), false);
  }
});

test('unexplained runtime state, changed pins and a conflicting existing review remain untouched', t => {
  const f = fixture(t), state = f.options.stateDirectory;
  fs.mkdirSync(state); fs.mkdirSync(path.join(state, 'runtime')); fs.writeFileSync(path.join(state, 'runtime', 'journal.json'), 'preserve');
  assert.throws(() => installLaunchAdmission(f.options), /Previous launch state/);
  assert.equal(fs.readFileSync(path.join(state, 'runtime', 'journal.json'), 'utf8'), 'preserve');
  const g = fixture(t), first = installLaunchAdmission(g.options), original = fs.readFileSync(first.admissionFile);
  fs.writeFileSync(path.join(g.options.stateDirectory, 'admitted-manifest.json'), '{}');
  assert.throws(() => installLaunchAdmission(g.options), /Pinned manifest differs/);
  assert.deepEqual(fs.readFileSync(first.admissionFile), original);
  const h = fixture(t); fs.mkdirSync(h.options.stateDirectory);
  fs.writeFileSync(path.join(h.options.stateDirectory, 'launch-review.json'), '{}');
  assert.throws(() => installLaunchAdmission({...h.options, consentFile: h.consentFile}), /review does not match/);
  assert.equal(fs.existsSync(path.join(h.options.stateDirectory, 'admission.json')), false);
});

test('review-first interrupted delivery can be completed only with its identical explicit review input', t => {
  const f = fixture(t); fs.mkdirSync(f.options.stateDirectory);
  const review = path.join(f.options.stateDirectory, 'launch-review.json'); fs.copyFileSync(f.consentFile, review);
  assert.throws(() => installLaunchAdmission(f.options), /explicit input/);
  const result = installLaunchAdmission({...f.options, consentFile: f.consentFile});
  assert.equal(result.admissionInstalled, true); assert.equal(result.reviewInstalled, false);
});

test('directory links and stale install locks are refused without changing their targets', t => {
  const f = fixture(t), real = path.join(f.dir, 'real'); fs.mkdirSync(real);
  const link = path.join(f.dir, 'linked'); fs.symlinkSync(real, link, 'junction');
  assert.throws(() => installLaunchAdmission({...f.options, stateDirectory: path.join(link, 'state')}), /symlinks/);
  assert.deepEqual(fs.readdirSync(real), []);
  fs.mkdirSync(f.options.stateDirectory); const lock = path.join(f.options.stateDirectory, 'admission-install.lock');
  fs.writeFileSync(lock, 'preserve-lock');
  assert.throws(() => installLaunchAdmission(f.options), /stale install lock/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'preserve-lock');
  assert.equal(fs.existsSync(path.join(f.options.stateDirectory, 'admission.json')), false);
});

test('CLI requires exact inputs and succeeds without RPC, custody access or service-start options', t => {
  const f = fixture(t);
  assert.throws(() => parseAdmissionInstallOptions(['--services']), /Invalid/);
  const args = ['scripts/install-launch-admission.mjs', '--manifest', f.options.manifestFile, '--manifest-sha256', f.expectedHash,
    '--state-directory', f.options.stateDirectory, '--source-revision', f.manifest.sourceRevision];
  const result = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 10000, env: {...process.env,
    ROBIN_RPC_URL: 'invalid-do-not-use', ROBIN_KEYSTORE_FILE: path.join(f.dir, 'missing-key'), ROBIN_KEYSTORE_PASSWORD_FILE: path.join(f.dir, 'missing-password')}});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).servicesStarted, false);
  assert.equal(fs.existsSync(path.join(f.options.stateDirectory, 'runtime')), false);
  const mismatched = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 10000,
    env: {...process.env, ROBIN_SOURCE_REVISION: '9'.repeat(40)}});
  assert.equal(mismatched.status, 2);
  assert.match(mismatched.stderr, /running host revision/);
});

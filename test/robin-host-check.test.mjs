import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {checkLaunchHostReadiness, verifyHostProcesses} from '../scripts/check-launch-host-ready.mjs';
import {validateLaunchHostReady} from '../src/launch-host-ready.mjs';
import {launchManifestHash, effectiveWorkerSourceRevision} from '../src/launch-manifest.mjs';
import {NOW, copy, launchReviewFixture} from './helpers/launch-review-fixture.mjs';

function hostFixture(t, {reviewed = true, workerSourceRevision} = {}) {
  const f = launchReviewFixture({automatic: true}), repositoryRoot = fs.realpathSync(process.cwd());
  if (workerSourceRevision !== undefined) {
    Object.assign(f.manifest, {schemaVersion: 'robinhook.launch-bootstrap.v2', workerSourceRevision});
    f.expectedHash = launchManifestHash(f.manifest, f.ethers);
  }
  const runningRevision = effectiveWorkerSourceRevision(f.manifest);
  const tempRoot = fs.realpathSync(os.tmpdir()), stateDirectory = fs.mkdtempSync(path.join(tempRoot, 'robin-host-check-'));
  t.after(() => {
    const target = path.resolve(stateDirectory);
    assert.equal(path.dirname(target), tempRoot); assert.ok(path.basename(target).startsWith('robin-host-check-'));
    fs.rmSync(target, {recursive: true});
  });
  fs.mkdirSync(path.join(stateDirectory, 'runtime'));
  const write = (name, data) => {
    const file = path.join(stateDirectory, name); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    fs.utimesSync(file, new Date(NOW), new Date(NOW));
  };
  write('admission.json', {schemaVersion: 'robinhook.launch-admission.v1', manifestSha256: f.expectedHash, manifest: f.manifest});
  write('admitted-manifest.json', f.manifest);
  const consent = {schemaVersion: 'robinhook.launch-review.v1', manifestSha256: f.expectedHash, account: f.manifest.transaction.from,
    nonce: f.manifest.transaction.nonce, reviewedAt: NOW / 1000, automationAccepted: true, economicRiskAccepted: true, execution: f.manifest.execution};
  if (reviewed) write('launch-review.json', consent);
  const env = {RENDER_GIT_COMMIT: runningRevision, ROBIN_AUTOMATION_APPROVED_MANIFEST_SHA256: f.expectedHash};
  const processes = [
    {pid: 20, ppid: 1, script: 'launch-standby.mjs', cwd: repositoryRoot, args: ['--loop', ...(reviewed ? ['--services'] : [])],
      env: {...env, ROBIN_LAUNCH_STATE_DIRECTORY: stateDirectory}},
    {pid: 21, ppid: 20, script: 'watch-launch.mjs', cwd: repositoryRoot,
      args: ['--manifest', path.join(stateDirectory, 'admitted-manifest.json'), '--manifest-sha256', f.expectedHash,
        '--consent', path.join(stateDirectory, 'launch-review.json'), '--loop', ...(reviewed ? ['--services'] : [])],
      env: {...env, ROBIN_LAUNCH_STATE_DIRECTORY: path.join(stateDirectory, 'runtime')}},
  ];
  write('standby-status.json', {state: 'reviewed-package-admitted', watcher: 'running', manifestFile: path.join(stateDirectory, 'admitted-manifest.json'),
    manifestSha256: f.expectedHash, automaticServicesRequested: true, signing: false, broadcast: false});
  write('runtime/launch-bootstrap-status.json', {state: 'waiting-for-launch', manifestSha256: f.expectedHash, checkedAt: NOW / 1000, signing: false, broadcast: false});
  write('launch-standby.lock', {pid: 20}); write('runtime/launch-supervisor.lock', {pid: 21});
  const options = {stateDirectory, repositoryRoot, expectedManifestSha256: f.expectedHash, sourceRevision: runningRevision,
    now: NOW, readProcesses: async () => processes};
  return {...f, options, processes, stateDirectory, write};
}

test('actual installed files and matching process evidence produce an ack accepted by local signing gate', async t => {
  const f = hostFixture(t), result = await checkLaunchHostReadiness(f.options);
  assert.equal(result.state, 'host-ready'); assert.equal(result.signing, false); assert.equal(result.broadcast, false);
  const valid = validateLaunchHostReady(result.ack, {...f, now: NOW,
    consentBytes: fs.readFileSync(path.join(f.stateDirectory, 'launch-review.json'))});
  assert.equal(valid.ready, true);
});

test('v2 host acknowledgement binds actual worker process revision separately from approved contract revision', async t => {
  const workerSourceRevision = '2'.repeat(40), f = hostFixture(t, {workerSourceRevision});
  const result = await checkLaunchHostReadiness(f.options);
  assert.equal(result.ack.sourceRevision, workerSourceRevision);
  assert.notEqual(result.ack.sourceRevision, f.manifest.sourceRevision);
  assert.equal(validateLaunchHostReady(result.ack, {...f, now: NOW,
    consentBytes: fs.readFileSync(path.join(f.stateDirectory, 'launch-review.json'))}).ready, true);
  await assert.rejects(checkLaunchHostReadiness({...f.options, sourceRevision: f.manifest.sourceRevision}));
  f.processes[1].env.RENDER_GIT_COMMIT = f.manifest.sourceRevision;
  await assert.rejects(checkLaunchHostReadiness(f.options));
});

test('before user review the host check reports waiting and creates no acknowledgement', async t => {
  const f = hostFixture(t, {reviewed: false}), result = await checkLaunchHostReadiness(f.options);
  assert.equal(result.state, 'waiting-user-review'); assert.equal(result.ack, undefined);
  assert.equal(result.acknowledgementCreated, false); assert.equal(result.processEvidence.servicesEnabled, false);
  assert.equal(fs.existsSync(path.join(f.stateDirectory, 'launch-review.json')), false);
});

test('process checks reject wrong source/digest, duplicate children, absent services, wrong parent and altered watcher arguments', t => {
  const f = hostFixture(t), opts = {...f.options, requireServices: true};
  verifyHostProcesses(f.processes, opts);
  for (const mutate of [
    p => p[0].env.RENDER_GIT_COMMIT = 'f'.repeat(40), p => p[1].env.ROBIN_SOURCE_REVISION = 'f'.repeat(40),
    p => p[1].env.ROBIN_AUTOMATION_APPROVED_MANIFEST_SHA256 = 'wrong',
    p => p[0].args = ['--loop'], p => p[1].args.pop(), p => p[1].ppid = 999,
    p => p[1].args[1] = path.join(f.stateDirectory, 'different-manifest.json'),
    p => p[0].env.ROBIN_LAUNCH_STATE_DIRECTORY = path.join(f.stateDirectory, 'different'),
    p => p[0].env.ROBIN_LAUNCH_CONSENT_FILE = path.join(f.stateDirectory, 'fake.json'),
    p => p.push(copy(p[1])), p => p.push({...copy(p[1]), script: 'production-operator.mjs'}),
    p => p.pop(),
  ]) { const processes = copy(f.processes); mutate(processes); assert.throws(() => verifyHostProcesses(processes, opts)); }
});

test('stale/blocked runtime status, wrong lock owner or stop markers cannot acknowledge readiness', async t => {
  const f = hostFixture(t);
  const file = path.join(f.stateDirectory, 'runtime/launch-bootstrap-status.json'), original = JSON.parse(fs.readFileSync(file));
  for (const value of [{...original, state: 'blocked'}, {...original, checkedAt: NOW / 1000 - 91}, {...original, manifestSha256: 'wrong'}]) {
    f.write('runtime/launch-bootstrap-status.json', value); await assert.rejects(checkLaunchHostReadiness(f.options));
  }
  f.write('runtime/launch-bootstrap-status.json', original);
  f.write('launch-standby.lock', {pid: 999}); await assert.rejects(checkLaunchHostReadiness(f.options));
  f.write('launch-standby.lock', {pid: 20});
  f.write('runtime/operator-stopped.json', {state: 'blocked'}); await assert.rejects(checkLaunchHostReadiness(f.options));
});

test('changed consent, pinned manifest or processes during inspection fails closed', async t => {
  const f = hostFixture(t);
  f.write('launch-review.json', {...JSON.parse(fs.readFileSync(path.join(f.stateDirectory, 'launch-review.json'))), automationAccepted: false});
  await assert.rejects(checkLaunchHostReadiness(f.options));
  const g = hostFixture(t);
  g.write('admitted-manifest.json', {...g.manifest, sourceRevision: 'f'.repeat(40)});
  await assert.rejects(checkLaunchHostReadiness(g.options));
  const h = hostFixture(t); let reads = 0;
  await assert.rejects(checkLaunchHostReadiness({...h.options, readProcesses: async () => ++reads === 1 ? h.processes : []}));
});

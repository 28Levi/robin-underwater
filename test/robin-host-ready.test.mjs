import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {validateLaunchHostReady} from '../src/launch-host-ready.mjs';
import {launchManifestHash, effectiveWorkerSourceRevision} from '../src/launch-manifest.mjs';
import {createLaunchReviewServer} from '../src/launch-review-server.mjs';
import {NOW, copy, launchReviewFixture} from './helpers/launch-review-fixture.mjs';

const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function fixture(workerSourceRevision) {
  const f = launchReviewFixture({automatic: true});
  if (workerSourceRevision !== undefined) {
    Object.assign(f.manifest, {schemaVersion: 'robinhook.launch-bootstrap.v2', workerSourceRevision});
    f.expectedHash = launchManifestHash(f.manifest, f.ethers);
  }
  const consent = {schemaVersion: 'robinhook.launch-review.v1', manifestSha256: f.expectedHash,
    account: f.manifest.transaction.from, nonce: f.manifest.transaction.nonce, reviewedAt: NOW / 1000,
    automationAccepted: true, economicRiskAccepted: true, execution: f.manifest.execution};
  const consentBytes = Buffer.from(JSON.stringify(consent, null, 2) + '\n');
  const ack = {schemaVersion: 'robinhook.launch-host-ready.v1', manifestSha256: f.expectedHash,
    sourceRevision: effectiveWorkerSourceRevision(f.manifest), consentSha256: sha(consentBytes), account: consent.account, nonce: consent.nonce,
    checkedAt: new Date(NOW).toISOString(), automationApprovedManifestSha256: f.expectedHash,
    servicesEnabled: true, admissionInstalled: true, consentInstalled: true, watcherRunning: true,
    noStopMarkers: true, state: 'waiting-for-launch'};
  return {...f, consent, consentBytes, ack};
}

test('host acknowledgement binds actual review bytes, exact installation and five-minute freshness', () => {
  const f = fixture(), args = {...f, now: NOW};
  const result = validateLaunchHostReady(f.ack, args);
  assert.equal(result.ready, true);
  assert.equal(Date.parse(result.expiresAt), NOW + 300000);
  for (const change of [
    a => a.manifestSha256 = `sha256:${'f'.repeat(64)}`, a => a.sourceRevision = 'f'.repeat(40),
    a => a.consentSha256 = `sha256:${'f'.repeat(64)}`, a => a.account = f.manifest.operator, a => a.nonce = '8',
    a => a.automationApprovedManifestSha256 = `sha256:${'f'.repeat(64)}`,
    a => a.servicesEnabled = false, a => a.admissionInstalled = false, a => a.consentInstalled = false,
    a => a.watcherRunning = false, a => a.noStopMarkers = false, a => a.state = 'blocked',
    a => a.checkedAt = new Date(NOW + 1).toISOString(), a => a.extra = true,
  ]) { const ack = copy(f.ack); change(ack); assert.throws(() => validateLaunchHostReady(ack, args)); }
  assert.throws(() => validateLaunchHostReady(f.ack, {...args, now: NOW + 300001}));
  assert.throws(() => validateLaunchHostReady(f.ack, {...args, consentBytes: Buffer.concat([f.consentBytes, Buffer.from('\n')])}));
  const differentReview = {...f.consent, reviewedAt: NOW / 1000 + 1};
  const bytes = Buffer.from(JSON.stringify(differentReview));
  assert.throws(() => validateLaunchHostReady({...f.ack, consentSha256: sha(bytes)}, {...args, now: NOW + 1000, consentBytes: bytes}),
    'host inspection must occur after the actual review');
  assert.throws(() => validateLaunchHostReady(f.ack, {...args, consentBytes: Buffer.from('{}')}));
});

async function freePort() {
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}

test('review and signing are separate: no consent, absent/stale host ack or changed plan blocks signing', async t => {
  const f = fixture(), port = await freePort(); let consentBytes = null, ack = null, now = NOW, writes = 0;
  let current = copy(f.acceptedResource);
  const {server, origin} = createLaunchReviewServer({...f, port, now: () => now, sessionToken: 'test-session',
    readCurrentResource: async () => current,
    readRecordedConsent: async () => consentBytes && JSON.parse(consentBytes),
    writeConsent: async value => { writes++; consentBytes ??= Buffer.from(JSON.stringify(value, null, 2) + '\n'); return JSON.parse(consentBytes); },
    readHostReadiness: async () => validateLaunchHostReady(ack, {...f, consentBytes, now}), assets: new Map()});
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const headers = {Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'X-Robin-Review-Token': 'test-session'};
  const post = (route, body, override = headers) => fetch(origin + route, {method: 'POST', headers: override, body: JSON.stringify(body)});
  const signing = {manifestSha256: f.expectedHash};
  const read = async () => (await fetch(origin + '/readiness.json')).json();
  assert.deepEqual(await read(), {reviewRecorded: false, hostReady: false, manifestSha256: f.expectedHash});
  ack = f.ack;
  assert.equal((await post('/signing-ready', signing)).status, 503, 'ack alone cannot stand in for user consent');
  ack = null;
  const review = {manifestSha256: f.expectedHash, reviewAccepted: true, automationAccepted: true, economicRiskAccepted: true};
  assert.equal((await post('/review', review)).status, 200);
  assert.equal(writes, 1);
  assert.deepEqual(await read(), {reviewRecorded: true, hostReady: false, manifestSha256: f.expectedHash});
  assert.equal((await post('/signing-ready', signing)).status, 503);
  ack = {...f.ack, consentSha256: sha(consentBytes)};
  assert.equal((await read()).hostReady, true);
  assert.equal((await post('/signing-ready', signing, {...headers, 'X-Robin-Review-Token': 'wrong'})).status, 403);
  assert.equal((await post('/signing-ready', {...signing, bypass: true})).status, 503);
  assert.equal((await post('/signing-ready', signing)).status, 200);
  assert.equal(writes, 1, 'signing readiness never rewrites actual consent');
  current.status = 'action_required';
  assert.equal((await post('/signing-ready', signing)).status, 503, 'valid host ack cannot bypass live platform validation');
  current = copy(f.acceptedResource); now = NOW + 300001;
  assert.equal((await read()).hostReady, false);
  assert.equal((await post('/signing-ready', signing)).status, 503);
});

test('server restart recognizes saved real consent but never assumes the host is ready', async t => {
  const f = fixture(), port = await freePort();
  const {server, origin} = createLaunchReviewServer({...f, port, now: () => NOW,
    readCurrentResource: async () => f.acceptedResource, readRecordedConsent: async () => f.consent,
    readHostReadiness: async () => { throw Error('Missing host acknowledgement'); },
    writeConsent: async () => { throw Error('Readiness cannot create consent'); }, assets: new Map()});
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const readiness = await (await fetch(origin + '/readiness.json')).json();
  assert.equal(readiness.reviewRecorded, true); assert.equal(readiness.hostReady, false);
});

test('v2 review server exposes both revisions and rejects previous consent and host ack for the unchanged platform transaction', async t => {
  const old = fixture(), f = fixture('2'.repeat(40)), port = await freePort();
  let consentBytes = old.consentBytes, ack = old.ack, writes = 0;
  const {server, origin} = createLaunchReviewServer({...f, port, now: () => NOW, sessionToken: 'v2-review',
    readCurrentResource: async () => f.acceptedResource, readRecordedConsent: async () => JSON.parse(consentBytes),
    readHostReadiness: async () => validateLaunchHostReady(ack, {...f, consentBytes, now: NOW}),
    writeConsent: async () => { writes++; throw Error('Existing review must be explicitly reconciled, never overwritten'); }, assets: new Map()});
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const session = await (await fetch(origin + '/session.json')).json();
  assert.equal(session.manifest.sourceRevision, old.manifest.sourceRevision);
  assert.equal(session.manifest.workerSourceRevision, '2'.repeat(40));
  assert.deepEqual(session.manifest.transaction, old.manifest.transaction);
  const readiness = async () => (await fetch(origin + '/readiness.json')).json();
  assert.equal((await readiness()).reviewRecorded, false);
  const headers = {Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'X-Robin-Review-Token': 'v2-review'};
  const sign = () => fetch(origin + '/signing-ready', {method: 'POST', headers, body: JSON.stringify({manifestSha256: f.expectedHash})});
  assert.equal((await sign()).status, 503);
  // Synthetic test evidence models a separately completed v2 review. The server never manufactures it.
  consentBytes = f.consentBytes;
  assert.equal((await readiness()).reviewRecorded, true); assert.equal((await readiness()).hostReady, false);
  assert.equal((await sign()).status, 503);
  ack = f.ack;
  assert.equal((await sign()).status, 200); assert.equal(writes, 0);
});

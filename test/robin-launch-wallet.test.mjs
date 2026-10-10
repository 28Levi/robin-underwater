import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {once} from 'node:events';
import {launchManifestHash, validateLaunchConsent} from '../src/launch-manifest.mjs';
import {validateReviewManifest, validateLaunchPackage, boundedLaunchTransaction, launchSubmissionKey} from '../signing-ui/robin-launch-guards.mjs';
import {createLaunchReviewServer, createPlatformPlanReader, verifyLaunchReviewInputs, verifyLaunchProofInputs} from '../src/launch-review-server.mjs';
import {NOW, copy, launchReviewFixture} from './helpers/launch-review-fixture.mjs';

test('exact modern ROBIN plan yields one bounded wallet transaction without signing', () => {
  const f = launchReviewFixture();
  verifyLaunchReviewInputs({...f, now: NOW});
  const result = boundedLaunchTransaction(f.pkg, f.manifest, f.expectedHash, f.state, f.ethers, NOW);
  assert.equal(result.transaction.data, f.pkg.resource.steps[0].transaction.data);
  assert.equal(BigInt(result.transaction.value), 10000000000000000n);
  assert.equal(BigInt(result.transaction.gas), 6000000n);
  assert.equal(result.transaction.nonce, '0x7');
  assert.equal(result.maximumCost, 750000000000000n);
  assert.ok(result.maximumCost <= BigInt(f.manifest.maxLaunchGasWei));
});

test('immutable manifest, exact request bytes and accepted plan are independent boundaries', () => {
  const f = launchReviewFixture();
  assert.throws(() => validateReviewManifest({...f.manifest, sourceRevision: '2'.repeat(40)}, f.expectedHash, f.ethers), /manifest changed/);
  assert.throws(() => verifyLaunchReviewInputs({...f, requestBytes: Buffer.concat([f.requestBytes, Buffer.from('\n')]), now: NOW}), /packed launch request changed/);
  const changed = copy(f.acceptedResource); changed.plan.publication.description = 'changed';
  assert.throws(() => verifyLaunchReviewInputs({...f, acceptedResource: changed, now: NOW}), /not the exact packed plan/);
  for (const change of [m => m.name = 'Moss Circuit', m => m.symbol = 'HOOD', m => m.transaction.valueWei = '100000000000000000',
    m => m.maxLaunchGasWei = '800000000000001', m => m.fees.platformFeeBps = 30,
    m => m.execution.maxTotalGasWei = '5000000000000001']) {
    const m = copy(f.manifest); change(m); assert.throws(() => launchManifestHash(m, f.ethers));
  }
});

test('changed platform identity, metadata, prediction, step, calldata or review cannot open wallet', () => {
  const f = launchReviewFixture();
  const changes = [
    r => r.planId = 'another-plan', r => r.planHash = `sha256:${'2'.repeat(64)}`, r => r.rawRequestSha256 = `sha256:${'2'.repeat(64)}`,
    r => r.status = 'launch_ready', r => r.continuation = {status: 'replan_required'}, r => r.plan.executor = 'controller_multi_step_v1',
    r => r.plan.controller.kind = 'delegated_eoa_v1', r => r.plan.publication.symbol = 'MOSSC',
    r => r.plan.publication.description = 'different project', r => r.plan.budgets.maxTotalValue = '1',
    r => r.plan.components[0].expectedAddress = f.manifest.operator, r => r.plan.components[0].runtimeCodeHash = `0x${'f'.repeat(64)}`,
    r => r.steps.push(copy(r.steps[0])), r => r.steps[0].status = 'broadcast', r => r.steps[0].transactionHash = `0x${'e'.repeat(64)}`,
    r => r.steps[0].transactionDigest = `sha256:${'e'.repeat(64)}`, r => r.steps[0].transaction.nonce = '8',
    r => r.steps[0].transaction.to = f.manifest.operator, r => r.steps[0].transaction.chainId = '1',
    r => r.steps[0].transaction.value = '100000000000000000', r => r.steps[0].transaction.data += '00',
    r => r.steps[0].transaction.gasLimit = '6000001', r => r.steps[0].transaction.deadline = String(NOW / 1000 + 601),
    r => r.manualReview.state = 'pending', r => r.manualReview.state = 'rejected', r => r.manualReview.requiresRepack = true,
    r => r.manualReview.expiresAt = new Date(NOW - 1).toISOString(), r => r.admission.controller = f.manifest.operator,
    r => r.admission.expiresAt = new Date(NOW - 1).toISOString(), r => r.preflight.launchEligibility.hardBlockers = [{code: 'FAIL'}],
    r => delete r.walletAuthorization.atomicPreparation,
  ];
  for (const change of changes) {
    const pkg = copy(f.pkg); change(pkg.resource);
    assert.throws(() => validateLaunchPackage(pkg, f.manifest, f.expectedHash, f.ethers, NOW));
  }
});

test('fresh package and approval clocks are mandatory including before the final wallet action', () => {
  const f = launchReviewFixture();
  for (const offset of [-61000, 31000]) {
    assert.throws(() => validateLaunchPackage({...f.pkg, checkedAt: new Date(NOW + offset).toISOString()}, f.manifest, f.expectedHash, f.ethers, NOW), /Fresh/);
  }
  assert.throws(() => validateLaunchPackage({...f.pkg, checkedAt: new Date(NOW + 511000).toISOString()}, f.manifest, f.expectedHash, f.ethers, NOW + 511000), /expire/);
  assert.throws(() => verifyLaunchReviewInputs({...f, now: NOW + 3600000}), /expire/);
  assert.deepEqual(verifyLaunchProofInputs(f), f.acceptedResource.plan, 'proof-only recovery retains immutable binding without authorizing a new wallet send');
});

test('RPC identity, deployed code, replay, finality, balance and gas changes are rejected', () => {
  const f = launchReviewFixture();
  const changes = [
    {account: f.manifest.operator}, {chainId: '0x1'}, {anchor: {hash: 'wrong'}}, {managerCode: '0x'}, {routerCode: '0x'},
    {factoryCode: '0x'}, {senderCode: '0xef0100'}, {distributorCode: '0x'}, {distributorOperator: f.manifest.transaction.from},
    {distributorBlock: {hash: 'wrong'}}, {watchBlock: {hash: 'wrong'}}, {latestNonce: '0x8'}, {pendingNonce: '0x8'},
    {componentCodes: {...f.state.componentCodes, token: '0x01'}}, {componentCodes: {...f.state.componentCodes, feeVault: '0x01'}},
    {gasPrice: '1000000000'}, {gasEstimate: '5500000'}, {gasEstimate: '0'}, {balance: '11749999999999999'},
    {head: {...f.state.head, timestamp: '0x0'}}, {finalized: {...f.state.finalized, timestamp: `0x${(NOW / 1000 - 1801).toString(16)}`}},
    {finalized: {...f.state.finalized, number: '0x1'}},
  ];
  for (const change of changes) assert.throws(() => boundedLaunchTransaction(f.pkg, f.manifest, f.expectedHash, {...f.state, ...change}, f.ethers, NOW));
  const auto = launchReviewFixture({automatic: true});
  assert.throws(() => boundedLaunchTransaction(auto.pkg, auto.manifest, auto.expectedHash, {...auto.state, operatorBalance: '0'}, auto.ethers, NOW), /Operator balance/);
});

test('uncertain-send key survives replacement plans for the same account and nonce', () => {
  const f = launchReviewFixture();
  const replacement = {...f.manifest, planId: 'replacement-plan'};
  assert.equal(launchSubmissionKey(f.manifest), launchSubmissionKey(replacement));
  assert.notEqual(launchSubmissionKey(f.manifest), launchSubmissionKey({...replacement, transaction: {...replacement.transaction, nonce: '8'}}));
});

test('platform reader uses exact owned HTTPS GET, response1.2, no redirects and bounded errors', async () => {
  const f = launchReviewFixture(); let call;
  const read = createPlatformPlanReader({planId: f.manifest.planId, resumeUrl: f.acceptedResource.resumeUrl, credential: 'mock-opaque-credential',
    fetchImpl: async (url, options) => { call = {url, options}; return Response.json(f.acceptedResource); }});
  assert.deepEqual(await read(), f.acceptedResource);
  assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.headers['Programmable-Launch-Response-Version'], '1.2');
  assert.equal(call.options.headers.Authorization, 'Bearer mock-opaque-credential');
  for (const resumeUrl of ['https://example.com/status', '//example.com/status', `${f.acceptedResource.resumeUrl}?x=y`, '/v4/chains/4663/custom-launch-plans/other']) {
    assert.throws(() => createPlatformPlanReader({planId: f.manifest.planId, resumeUrl, credential: 'mock'}));
  }
  const fail = createPlatformPlanReader({planId: f.manifest.planId, resumeUrl: f.acceptedResource.resumeUrl, credential: 'mock',
    fetchImpl: async () => new Response('private provider body', {status: 403})});
  await assert.rejects(fail(), error => !error.message.includes('private provider body'));
});

async function freePort() {
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}

test('local server exposes only exact assets/fresh package and records explicit bound consent', async t => {
  const f = launchReviewFixture({automatic: true}), port = await freePort(), consents = [], proofs = [];
  let current = copy(f.acceptedResource);
  const {server, origin} = createLaunchReviewServer({...f, port, now: () => NOW, sessionToken: 'mock-session-token',
    readCurrentResource: async () => current, writeConsent: async value => { consents.push(value); },
    submitProof: async hash => { validateLaunchConsent(consents[0], f.manifest, f.ethers); proofs.push(hash); return {status: 'proof-recorded', transactionHash: hash}; },
    assets: new Map([['/', {bytes: '<h1>Review</h1>', type: 'text/html; charset=utf-8'}]])});
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const fetchPath = (pathname, init) => fetch(origin + pathname, init);
  const session = await (await fetchPath('/session.json')).json();
  assert.equal(session.manifestSha256, f.expectedHash); assert.equal(session.reviewToken, 'mock-session-token');
  const packageResponse = await fetchPath('/package.json');
  assert.equal(packageResponse.status, 200); assert.equal(packageResponse.headers.get('cache-control'), 'no-store');
  assert.equal(packageResponse.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetchPath('/')).status, 200);
  assert.equal((await fetchPath('/.secrets/private')).status, 404);
  assert.equal((await fetchPath('/package.json', {method: 'POST'})).status, 403);
  assert.equal((await fetchPath('/session.json', {headers: {Origin: 'https://example.com'}})).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(origin + '/session.json', {headers: {Host: `localhost:${port}`}}, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  const body = {manifestSha256: f.expectedHash, reviewAccepted: true, automationAccepted: true, economicRiskAccepted: true};
  const headers = {Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'X-Robin-Review-Token': session.reviewToken};
  assert.equal((await fetchPath('/review', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).status, 403);
  assert.equal((await fetchPath('/review', {method: 'POST', headers: {...headers, 'X-Robin-Review-Token': 'wrong'}, body: JSON.stringify(body)})).status, 403);
  assert.equal((await fetchPath('/review', {method: 'POST', headers, body: JSON.stringify({...body, economicRiskAccepted: false})})).status, 503);
  assert.equal(consents.length, 0);
  assert.equal((await fetchPath('/review', {method: 'POST', headers, body: JSON.stringify(body)})).status, 200);
  assert.equal(consents.length, 1); validateLaunchConsent(consents[0], f.manifest, f.ethers);
  assert.equal(consents[0].reviewedAt, NOW / 1000); assert.equal(consents[0].automationAccepted, true);
  const proofHash = `0x${'7'.repeat(64)}`;
  const proofBody = {manifestSha256: f.expectedHash, transactionHash: proofHash};
  assert.equal((await fetchPath('/launch-proof', {method: 'POST', headers: {...headers, 'X-Robin-Review-Token': 'wrong'}, body: JSON.stringify(proofBody)})).status, 403);
  assert.equal((await fetchPath('/launch-proof', {method: 'POST', headers, body: JSON.stringify({...proofBody, manifestSha256: 'wrong'})})).status, 503);
  assert.equal(proofs.length, 0);
  assert.equal((await fetchPath('/launch-proof', {method: 'POST', headers, body: JSON.stringify(proofBody)})).status, 200);
  assert.deepEqual(proofs, [proofHash]);
  current.status = 'broadcast';
  assert.equal((await fetchPath('/package.json')).status, 503);
  assert.equal((await fetchPath('/review', {method: 'POST', headers, body: JSON.stringify(body)})).status, 503);
  assert.equal(consents.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {checkWalletFeedConnection} from '../src/wallet-feed-check.mjs';
import {runWalletFeedConnectionCheck} from '../scripts/check-wallet-feed.mjs';

const url = 'https://robinhook.wtf/api/wallet-snapshot', token = 'test-only-publisher-secret-'.repeat(3), nonce = '1234567890abcdef'.repeat(2);
const json = (value, options = {}) => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json; charset=utf-8'}, ...options});
const success = () => json({status: 'verified', nonce});

test('connection check sends exactly one bounded nonfinancial probe to the same allowed origin', async () => {
  let calls = 0;
  const result = await checkWalletFeedConnection({url, token, nonce, fetchImpl: async (target, request) => {
    calls++;
    assert.equal(target, 'https://robinhook.wtf/api/wallet-feed-check');
    assert.equal(request.method, 'POST'); assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit');
    assert.equal(request.cache, 'no-store'); assert.equal(request.referrerPolicy, 'no-referrer');
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(request.body), {nonce}); assert.ok(Buffer.byteLength(request.body) <= 128);
    assert.equal(request.body.includes(token), false); assert.equal(request.signal.aborted, false);
    return success();
  }});
  assert.deepEqual(result, {status: 'verified', nonce}); assert.equal(calls, 1);
});

test('missing or malformed credentials, unsafe URLs and invalid request settings fail before network', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw Error('must not fetch'); };
  const changes = [
    {token: undefined}, {token: ''}, {token: 'short'}, {token: `${token}\n`}, {token: `${token}é`}, {token: 'a'.repeat(4097)},
    {url: 'http://robinhook.wtf/api/wallet-snapshot'}, {url: 'https://attacker.invalid/api/wallet-snapshot'},
    {url: 'https://robinhook.wtf.attacker.invalid/api/wallet-snapshot'}, {url: 'https://user:password@robinhook.wtf/api/wallet-snapshot'},
    {url: `${url}?token=secret`}, {url: `${url}#fragment`}, {url: `${url}/`}, {url: 'https://robinhook.wtf:443/api/wallet-snapshot'},
    {url: 'https://robinhook.wtf/api/wallet-feed-check'}, {nonce: nonce.toUpperCase()}, {nonce: 'a'}, {nonce: {}},
    {timeoutMs: 0}, {timeoutMs: 15001}, {timeoutMs: 1.5},
  ];
  for (const change of changes) await assert.rejects(checkWalletFeedConnection({url, token, nonce, fetchImpl, ...change}), /configuration/);
  assert.equal(called, false);
});

test('CLI helper generates a fresh nonce and supports the exact www deployment without forwarding other environment values', async () => {
  const observed = [];
  const env = {ROBIN_WALLET_FEED_URL: 'https://www.robinhook.wtf/api/wallet-snapshot', ROBIN_WALLET_FEED_PUBLISH_TOKEN: token,
    ROBIN_KEYSTORE_FILE: 'never-open-this', ROBIN_RPC_URL: 'never-contact-this'};
  const fetchImpl = async (target, request) => {
    assert.equal(target, 'https://www.robinhook.wtf/api/wallet-feed-check');
    const body = JSON.parse(request.body); assert.match(body.nonce, /^[0-9a-f]{32}$/); observed.push(body.nonce);
    assert.deepEqual(Object.keys(body), ['nonce']); return json({status: 'verified', nonce: body.nonce});
  };
  await runWalletFeedConnectionCheck({env, args: [], fetchImpl}); await runWalletFeedConnectionCheck({env, args: [], fetchImpl});
  assert.notEqual(observed[0], observed[1]);
  await assert.rejects(runWalletFeedConnectionCheck({env, args: ['--token', token], fetchImpl}), /no command-line/);
});

test('non-200 and redirected responses fail without reading provider errors or retrying', async () => {
  for (const status of [201, 301, 401, 403, 409, 500, 503]) {
    let calls = 0, bodyRead = false;
    await assert.rejects(checkWalletFeedConnection({url, token, nonce, fetchImpl: async () => {
      calls++; return {status, redirected: false, get body() { bodyRead = true; throw Error(token); }};
    }}), error => error.message.includes('connection check failed') && !error.message.includes(token));
    assert.equal(calls, 1); assert.equal(bodyRead, false);
  }
  await assert.rejects(checkWalletFeedConnection({url, token, nonce, fetchImpl: async () => ({status: 200, redirected: true})}), /connection check failed/);
});

test('wrong nonce, malformed acknowledgement and non-JSON response all fail with sanitized errors', async () => {
  const responses = [() => json({status: 'verified', nonce: 'f'.repeat(32)}), () => json({status: 'stored', nonce}),
    () => json({status: 'verified', nonce, leaked: token}), () => json(null), () => json([{status: 'verified', nonce}]),
    () => new Response(token, {headers: {'content-type': 'application/json'}}),
    () => new Response(JSON.stringify({status: 'verified', nonce}), {headers: {'content-type': 'text/html'}})];
  for (const response of responses) await assert.rejects(checkWalletFeedConnection({url, token, nonce, fetchImpl: async () => response()}), error => {
    assert.equal(error.message.includes(token), false); assert.equal(error.cause, undefined); return /connection check failed/.test(error.message);
  });
  await assert.rejects(checkWalletFeedConnection({url, token, nonce, fetchImpl: async () => { throw Error(`Provider leaked ${token}`); }}),
    error => !error.message.includes(token) && error.cause === undefined);
});

test('response limits apply to announced length and actual streamed bytes, cancelling oversized streams', async () => {
  await assert.rejects(checkWalletFeedConnection({url, token, nonce, fetchImpl: async () => new Response('{}', {
    headers: {'content-type': 'application/json', 'content-length': '513'}})}), /connection check failed/);
  let cancelled = false;
  const body = new ReadableStream({start(controller) { controller.enqueue(new Uint8Array(513)); }, cancel() { cancelled = true; }});
  await assert.rejects(checkWalletFeedConnection({url, token, nonce, fetchImpl: async () => new Response(body, {
    headers: {'content-type': 'application/json'}})}), /connection check failed/);
  assert.equal(cancelled, true);
});

test('deadline aborts hung requests and hung body reads without automatic retries', async () => {
  let calls = 0, requestAborted = false;
  await assert.rejects(checkWalletFeedConnection({url, token, nonce, timeoutMs: 10, fetchImpl: async (_, request) => {
    calls++;
    return new Promise((_, reject) => request.signal.addEventListener('abort', () => { requestAborted = true; reject(Error(token)); }, {once: true}));
  }}), /connection check failed/);
  assert.equal(calls, 1); assert.equal(requestAborted, true);
  let bodyCancelled = false;
  const body = new ReadableStream({cancel() { bodyCancelled = true; }});
  await assert.rejects(checkWalletFeedConnection({url, token, nonce, timeoutMs: 10, fetchImpl: async () => new Response(body, {
    headers: {'content-type': 'application/json'}})}), /connection check failed/);
  assert.equal(bodyCancelled, true);
});

test('CLI errors never print configured secrets, URLs, provider data or stack traces', () => {
  const result = spawnSync(process.execPath, ['scripts/check-wallet-feed.mjs'], {encoding: 'utf8', timeout: 5000,
    env: {...process.env, ROBIN_WALLET_FEED_URL: `https://bad.invalid/${token}`, ROBIN_WALLET_FEED_PUBLISH_TOKEN: token}});
  assert.equal(result.status, 2); assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes(token), false); assert.equal(result.stderr.includes('bad.invalid'), false);
  assert.equal(result.stderr.includes(' at '), false); assert.match(result.stderr, /connection check failed/);
});

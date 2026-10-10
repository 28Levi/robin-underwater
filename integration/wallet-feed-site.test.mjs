import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {keccak256} from 'ethers';
import {native20Fixture, E} from '../test/helpers/native20-fixture.mjs';
import {buildSnapshot} from '../src/replay.mjs';
import {LossLedger} from '../src/ledger.mjs';
import {collectFinalizedPayments, buildWalletFeed, publishWalletFeed, unavailableWalletFeed} from '../src/wallet-feed.mjs';
// Resolve the reviewed site checkout before loading any external source or chain.
const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const configuredSiteRoot = process.env.ROBIN_SITE_CHECKOUT;
const requestedSiteRoot = configuredSiteRoot === undefined
  ? path.resolve(backendRoot, '../robinhook-site')
  : path.resolve(configuredSiteRoot);
let siteRoot;
try {
  if (configuredSiteRoot !== undefined && !configuredSiteRoot.trim()) throw Error('Empty checkout path');
  siteRoot = fs.realpathSync(requestedSiteRoot);
  for (const relative of ['worker/index.mjs', 'worker/wallet-feed.mjs', 'dist/wallet-status.mjs', 'dist/data/recovery-snapshot.json']) {
    if (!fs.statSync(path.join(siteRoot, relative)).isFile()) throw Error('Expected a source file');
  }
} catch {
  throw Error(`Wallet-feed integration requires a complete reviewed ROBINHOOK site checkout at ${requestedSiteRoot}. Set ROBIN_SITE_CHECKOUT to its root; missing inputs are a failure, not a skipped test.`);
}
const {createSiteWorker} = await import(pathToFileURL(path.join(siteRoot, 'worker/index.mjs')).href);
const {getWalletView} = await import(pathToFileURL(path.join(siteRoot, 'dist/wallet-status.mjs')).href);

// Ignore an inherited network choice: every transaction uses a disposable local EVM.
process.env.HARDHAT_CONFIG = path.join(backendRoot, 'hardhat.native20.config.cjs');
process.env.HARDHAT_NETWORK = 'hardhat';
const {default: hre} = await import('hardhat');
assert.equal(hre.network.name, 'hardhat', 'Integration must use the local Hardhat network');
assert.equal(hre.network.config.forking?.enabled ?? false, false, 'Integration must not fork a live chain');
const testedSources = [
  ['backend exporter', path.join(backendRoot, 'src/wallet-feed.mjs')],
  ['site Worker', path.join(siteRoot, 'worker/index.mjs')],
  ['site feed validator', path.join(siteRoot, 'worker/wallet-feed.mjs')],
  ['site browser model', path.join(siteRoot, 'dist/wallet-status.mjs')],
].map(([label, filename]) => ({label, path: filename, sha256: createHash('sha256').update(fs.readFileSync(filename)).digest('hex')}));

class MemoryR2 {
  objects = new Map();
  version = 0;
  reads = 0;
  writes = 0;
  async get(key) {
    this.reads++;
    const stored = this.objects.get(key);
    return stored ? {etag: stored.etag, size: Buffer.byteLength(stored.body), json: async () => JSON.parse(stored.body)} : null;
  }
  async put(key, body, options) {
    const current = this.objects.get(key), condition = options.onlyIf;
    if (condition instanceof Headers && condition.get('If-None-Match') === '*' && current) return null;
    if (!(condition instanceof Headers) && current?.etag !== condition.etagMatches) return null;
    const stored = {etag: `local-test-${++this.version}`, body};
    this.objects.set(key, stored); this.writes++;
    return {etag: stored.etag};
  }
}

test('local finalized rewards cross exporter, authenticated Worker, R2 and browser view', async t => {
  for (const source of testedSources) t.diagnostic(JSON.stringify(source));
  const f = await native20Fixture(hre, {operatorIndex: 3, name: 'ROBINHOOK', symbol: 'ROBIN', firstBuyWei: E / 100n});
  try {
    const {provider, alice, bob, keeper, token, reward, feeVault, swap, c} = f;
    const aliceAddress = (await alice.getAddress()).toLowerCase();
    const reject = await f.deploy('RejectEther');
    const rejectAddress = (await reject.getAddress()).toLowerCase();
    await swap(bob, true, E);
    await swap(alice, true, E / 10n);
    await swap(bob, false, await token.balanceOf(await bob.getAddress()));
    await (await token.connect(alice).transfer(rejectAddress, (await token.balanceOf(aliceAddress)) / 2n)).wait();
    await hre.network.provider.send('evm_increaseTime', [3700]);
    await hre.network.provider.send('evm_mine');
    await (await feeVault.connect(keeper).claimCreator()).wait();
    const before = await buildSnapshot(provider, c), beforeLedger = LossLedger.restore(before.ledger);
    before.generatedAt = before.checkpoint.timestamp;
    c.execution = {codeHashes: {distributor: keccak256(await provider.getCode(c.distributor))}};
    const initialPayments = await collectFinalizedPayments(provider, c, before);
    const paid = 1000000000000n;
    const recipients = [aliceAddress, rejectAddress].sort();
    await (await reward.connect(keeper).distributeEligible(
      keccak256('0xfeed0001'), keccak256('0xfeed0002'), c.token, before.checkpoint.timestamp + 300,
      recipients, recipients.map(() => paid), recipients.map(account => beforeLedger.get(account).balance),
    )).wait();
    // A retry creates another deferred event, not another reward allocation.
    await (await reward.connect(keeper).pay(rejectAddress)).wait();
    const snapshot = await buildSnapshot(provider, c), now = snapshot.checkpoint.timestamp;
    // This disposable chain advances time for the real holding rule; align the fixture clock.
    snapshot.generatedAt = now;
    const scannedRanges = [];
    const incrementalProvider = new Proxy(provider, {get(target, key) {
      if (key === 'getLogs') return async filter => { scannedRanges.push(filter); return target.getLogs(filter); };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
    const payments = await collectFinalizedPayments(incrementalProvider, c, snapshot, initialPayments);
    const fullPayments = await collectFinalizedPayments(provider, c, snapshot);
    assert.deepEqual(payments, fullPayments);
    assert.ok(scannedRanges.length > 0);
    assert.ok(scannedRanges.every(range => range.fromBlock > initialPayments.checkpoint.blockNumber));
    const feed = buildWalletFeed(c, snapshot, payments, {now});
    const identity = {chainId: c.chainId, token: c.token, distributor: c.distributor};
    const r2 = new MemoryR2();
    const env = {WALLET_FEED: r2, WALLET_FEED_PUBLISH_TOKEN: 'local-only-fixture-token-32-characters',
      ASSETS: {fetch: async () => new Response('local asset')}};
    const worker = createSiteWorker({identity, now: () => now});
    let uploadStatus;
    await publishWalletFeed(feed, {url: 'https://local.invalid/api/wallet-snapshot', token: env.WALLET_FEED_PUBLISH_TOKEN,
      fetchImpl: async (url, options) => {
        const response = await worker.fetch(new Request(url, options), env);
        uploadStatus = response.status;
        return response;
      },
    });
    assert.equal(uploadStatus, 200);
    assert.equal(r2.writes, 1);
    const response = await worker.fetch(new Request('https://local.invalid/data/recovery-snapshot.json'), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const delivered = await response.json();
    const options = {identity, now};
    const aliceView = getWalletView(delivered, aliceAddress, options);
    const rejectView = getWalletView(delivered, rejectAddress, options);

    await t.test('canonical payment cache resumes after its checkpoint and unchanged checkpoint avoids log replay', async () => {
      const scans = scannedRanges.length;
      const repeated = await collectFinalizedPayments(incrementalProvider, c, snapshot, payments);
      assert.deepEqual(repeated, fullPayments);
      assert.equal(scannedRanges.length, scans);
      assert.equal(initialPayments.accounts[aliceAddress].paidWei, '0');
      assert.equal(initialPayments.accounts[rejectAddress].pendingWei, '0');
    });

    await t.test('confirmed ETH receipts and deferred ETH remain distinct across delivery', () => {
      assert.equal(aliceView.state, 'ready');
      assert.equal(aliceView.paidWei, paid.toString());
      assert.equal(aliceView.pendingWei, '0');
      assert.equal(rejectView.state, 'ready');
      assert.equal(rejectView.paidWei, '0');
      assert.equal(rejectView.pendingWei, paid.toString());
      assert.equal(payments.accounts[rejectAddress].pendingWei, paid.toString());
    });

    await t.test('consumer tiers equal exact dense loss/basis ranks from the finalized ledger', () => {
      const ledger = LossLedger.restore(snapshot.ledger);
      const positions = ledger.shortfalls({...snapshot.oracle, now});
      for (const [account, view] of [[aliceAddress, aliceView], [rejectAddress, rejectView]]) {
        const position = positions.find(p => p.account === account);
        assert.ok(position);
        const deeper = positions.filter(p => p.loss * position.basis > position.loss * p.basis);
        const uniqueDeeper = deeper.filter((p, index) => !deeper.slice(0, index).some(q => p.loss * q.basis === q.loss * p.basis));
        assert.equal(view.tier, uniqueDeeper.length + 1);
        assert.equal(view.lossBps, Number(position.loss * 10000n / position.basis));
        assert.equal(view.badge, 'Eligible');
      }
    });

    await t.test('expired delivery hides account values and browser reports stale', async () => {
      const expiredWorker = createSiteWorker({identity, now: () => feed.expiresAt});
      const expired = await expiredWorker.fetch(new Request('https://local.invalid/data/recovery-snapshot.json'), env);
      const old = await expired.json();
      assert.deepEqual(old.accounts, {});
      const view = getWalletView(old, aliceAddress, {identity, now: feed.expiresAt});
      assert.equal(view.state, 'stale');
      assert.equal(view.paidWei, null);
      assert.equal(view.pendingWei, null);
    });

    await t.test('17-minute finalized chain lag works while generation15m and checkpoint30m expire independently', async () => {
      const delayedNow = now + 1023;
      const delayed = buildWalletFeed(c, {...snapshot, generatedAt: delayedNow}, payments, {now: delayedNow});
      const laggedWorker = createSiteWorker({identity, now: () => delayedNow});
      const laggedEnv = {...env, WALLET_FEED: new MemoryR2()};
      await publishWalletFeed(delayed, {url: 'https://local.invalid/api/wallet-snapshot', token: env.WALLET_FEED_PUBLISH_TOKEN,
        fetchImpl: (url, options) => laggedWorker.fetch(new Request(url, options), laggedEnv),
      });
      const response = await laggedWorker.fetch(new Request('https://local.invalid/data/recovery-snapshot.json'), laggedEnv);
      const deliveredDelayed = await response.json();
      assert.equal(getWalletView(deliveredDelayed, aliceAddress, {identity, now: delayedNow}).state, 'ready');
      assert.equal(getWalletView(delivered, aliceAddress, {identity, now: now + 900}).state, 'stale');
      const almostOld = buildWalletFeed(c, {...snapshot, generatedAt: now + 1799}, payments, {now: now + 1799});
      assert.equal(getWalletView(almostOld, aliceAddress, {identity, now: now + 1799}).state, 'ready');
      assert.equal(getWalletView(almostOld, aliceAddress, {identity, now: now + 1800}).state, 'stale');
      assert.throws(() => buildWalletFeed(c, {...snapshot, generatedAt: now + 1800}, payments, {now: now + 1800}), /stale|future/);
    });

    await t.test('exporter outage replaces visible values without permitting checkpoint rollback', async () => {
      const outageWorker = createSiteWorker({identity, now: () => now + 1});
      const outage = unavailableWalletFeed(c, now + 1);
      await publishWalletFeed(outage, {url: 'https://local.invalid/api/wallet-snapshot', token: env.WALLET_FEED_PUBLISH_TOKEN,
        fetchImpl: (url, options) => outageWorker.fetch(new Request(url, options), env),
      });
      const response = await outageWorker.fetch(new Request('https://local.invalid/data/recovery-snapshot.json'), env);
      const unavailable = await response.json();
      assert.deepEqual(unavailable.accounts, {});
      assert.equal(getWalletView(unavailable, aliceAddress, {identity, now: now + 1}).state, 'unavailable');
      const rollback = structuredClone(feed);
      rollback.generatedAt = now + 2;
      rollback.checkpoint.blockNumber--;
      const refused = await outageWorker.fetch(new Request('https://local.invalid/api/wallet-snapshot', {
        method: 'PUT', headers: {'Authorization': `Bearer ${env.WALLET_FEED_PUBLISH_TOKEN}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(rollback),
      }), env);
      assert.equal(refused.status, 409);
    });

    await t.test('prelaunch identity disables uploads and ignores any stored ready snapshot', async () => {
      const inactiveWorker = createSiteWorker({identity: null, now: () => now});
      const reads = r2.reads, writes = r2.writes;
      const inactiveResponse = await inactiveWorker.fetch(new Request('https://local.invalid/data/recovery-snapshot.json'), env);
      const inactive = await inactiveResponse.json();
      assert.equal(inactive.status, 'inactive');
      assert.deepEqual(inactive.accounts, {});
      assert.equal(getWalletView(inactive, aliceAddress, {now}).state, 'inactive');
      const disabled = await inactiveWorker.fetch(new Request('https://local.invalid/api/wallet-snapshot', {
        method: 'PUT', headers: {'Authorization': `Bearer ${env.WALLET_FEED_PUBLISH_TOKEN}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(feed),
      }), env);
      assert.equal(disabled.status, 503);
      assert.equal((await disabled.json()).reason, 'publishing-disabled');
      assert.equal(r2.reads, reads);
      assert.equal(r2.writes, writes);
    });
  } finally {
    f.provider.destroy();
  }
});

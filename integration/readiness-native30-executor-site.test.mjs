import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {HDNodeWallet, keccak256} from 'ethers';
import {native20Fixture, E} from '../test/helpers/native20-fixture.mjs';
import {executeCycle} from '../src/executor.mjs';
import {runWalletFeedCycle} from '../src/wallet-feed.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const siteRoot = fs.realpathSync(process.env.ROBIN_SITE_CHECKOUT ?? path.resolve(root, '../robinhook-site'));
const {createSiteWorker} = await import(pathToFileURL(path.join(siteRoot, 'worker/index.mjs')).href);
const {getWalletView} = await import(pathToFileURL(path.join(siteRoot, 'dist/wallet-status.mjs')).href);
process.env.HARDHAT_CONFIG = path.join(root, 'hardhat.native20.config.cjs');
process.env.HARDHAT_NETWORK = 'hardhat';
const {default: hre} = await import('hardhat');
assert.equal(hre.network.name, 'hardhat');
assert.equal(hre.network.config.forking?.enabled ?? false, false);

class MemoryR2 {
  objects = new Map();
  version = 0;
  async get(key) {
    const stored = this.objects.get(key);
    return stored ? {etag: stored.etag, size: Buffer.byteLength(stored.body), json: async () => JSON.parse(stored.body)} : null;
  }
  async put(key, body, options) {
    const current = this.objects.get(key), condition = options.onlyIf;
    if (condition instanceof Headers && condition.get('If-None-Match') === '*' && current) return null;
    if (!(condition instanceof Headers) && current?.etag !== condition.etagMatches) return null;
    const stored = {etag: `readiness-fixture-${++this.version}`, body};
    this.objects.set(key, stored);
    return {etag: stored.etag};
  }
}

test('Native30 automatic payout survives uncertain broadcast and reaches the website exactly once on a local EVM', async t => {
  const testRoot = path.join(root, 'output/test');
  fs.mkdirSync(testRoot, {recursive: true});
  const directory = fs.mkdtempSync(path.join(testRoot, 'readiness-native30-'));
  const f = await native20Fixture(hre, {name: 'ROBINHOOK', symbol: 'ROBIN', firstBuyWei: E / 100n, feeProfile: 'robin-native30'});
  const realNow = Date.now;
  try {
    const {provider, alice, bob, token, hook, feeVault, reward, ownerAddress, c, swap} = f;
    const aliceAddress = (await alice.getAddress()).toLowerCase();
    assert.equal(await hook.PLATFORM_FEE_BPS(), 30n);
    assert.equal(await hook.creatorBuyFeeBps(), 170n);
    assert.equal(await hook.creatorSellFeeBps(), 170n);
    await swap(bob, true, E);
    await swap(alice, true, E / 10n);
    await swap(bob, false, await token.balanceOf(await bob.getAddress()));
    await hre.network.provider.send('evm_increaseTime', [3700]);
    await hre.network.provider.send('evm_mine');
    let now = (await provider.getBlock('latest')).timestamp;
    Date.now = () => now * 1000;
    const config = {...c, execution: {mode: 'local-only', operator: ownerAddress,
      feeVault: await feeVault.getAddress(), maxGasPerTransactionWei: (E / 100n).toString(), maxTotalGasWei: E.toString(),
      minimumHarvestWei: '1', minimumBatchWei: '1', retryIntervalSeconds: 3600, codeHashes: {}}};
    for (const name of ['token', 'hook', 'distributor', 'feeVault']) {
      const target = name === 'feeVault' ? config.execution.feeVault : config[name];
      config.execution.codeHashes[name] = keccak256(await provider.getCode(target));
    }
    // Public Hardhat fixture mnemonic; never accesses a production signer or RPC.
    const signer = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
    assert.equal(signer.address, ownerAddress);
    const operatorDirectory = path.join(directory, 'operator');
    const feedDirectory = path.join(directory, 'feed');
    const cycle = async (rpc = provider) => {
      now = (await provider.getBlock('latest')).timestamp;
      return executeCycle(rpc, signer, config, operatorDirectory);
    };

    await t.test('automatic harvest transfers only project accrual and preserves platform fees', async () => {
      const platform = await feeVault.platformAccrued(), project = await feeVault.creatorAccrued();
      assert.ok(project > 0n);
      const harvest = await cycle();
      assert.equal(harvest.state, 'submitted');
      assert.equal(harvest.kind, 'harvest');
      assert.equal((await cycle()).state, 'confirmed');
      assert.equal(await feeVault.creatorAccrued(), 0n);
      assert.equal(await feeVault.platformAccrued(), platform);
      assert.equal(await reward.available(), project);
    });

    let alicePaid, confirmedPayoutHash;
    await t.test('lost payout RPC response is reconciled from its durable hash without a second payment', async () => {
      const before = await provider.getBalance(aliceAddress);
      let broadcasts = 0;
      const uncertain = new Proxy(provider, {get(target, key) {
        if (key === 'broadcastTransaction') return async raw => {
          broadcasts++;
          await target.broadcastTransaction(raw);
          throw Error('Local fixture drops the response after mining');
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }});
      const payout = await cycle(uncertain);
      assert.equal(payout.kind, 'payout');
      assert.equal(payout.state, 'broadcast-uncertain');
      const saved = JSON.parse(fs.readFileSync(path.join(operatorDirectory, 'journal.json'))).state;
      assert.equal(saved.pending.hash, payout.hash);
      const reconciled = await cycle(uncertain);
      assert.equal(reconciled.state, 'confirmed');
      assert.equal(reconciled.hash, payout.hash);
      assert.equal(broadcasts, 1);
      confirmedPayoutHash = payout.hash;
      alicePaid = await provider.getBalance(aliceAddress) - before;
      assert.ok(alicePaid > 0n, 'eligible holder actually receives native ETH');
    });

    await t.test('full export cycle publishes the finalized ETH payment through Worker storage and browser model', async () => {
      now = (await provider.getBlock('latest')).timestamp;
      const identity = {chainId: c.chainId, token: c.token, distributor: c.distributor};
      const env = {WALLET_FEED: new MemoryR2(), WALLET_FEED_PUBLISH_TOKEN: 'readiness-local-fixture-token-32-characters',
        ASSETS: {fetch: async () => new Response('local fixture asset')}};
      const worker = createSiteWorker({identity, now: () => now});
      const publisher = {url: 'https://local.invalid/api/wallet-snapshot', token: env.WALLET_FEED_PUBLISH_TOKEN,
        fetchImpl: (url, options) => worker.fetch(new Request(url, options), env)};
      const status = await runWalletFeedCycle(provider, config, feedDirectory, {now, publisher});
      assert.equal(status.state, 'published');
      const response = await worker.fetch(new Request('https://local.invalid/data/recovery-snapshot.json'), env);
      assert.equal(response.status, 200);
      const feed = await response.json(), view = getWalletView(feed, aliceAddress, {identity, now});
      assert.equal(view.state, 'ready');
      assert.equal(view.paidWei, alicePaid.toString());
      assert.equal(view.pendingWei, '0');
      assert.equal(feed.policy, 'deepest-percentage-first-v1');
      assert.ok(feed.checkpoint.blockNumber >= (await provider.getTransactionReceipt(confirmedPayoutHash)).blockNumber);
      assert.equal((await runWalletFeedCycle(provider, config, feedDirectory, {now, publisher})).state, 'published');
      const replayed = await (await worker.fetch(new Request('https://local.invalid/data/recovery-snapshot.json'), env)).json();
      assert.equal(getWalletView(replayed, aliceAddress, {identity, now}).paidWei, alicePaid.toString());
    });

    await t.test('operator restart retains gas reservations and does not pay the completed round again', async () => {
      const before = await provider.getBalance(aliceAddress);
      const saved = JSON.parse(fs.readFileSync(path.join(operatorDirectory, 'journal.json'))).state;
      assert.equal((await cycle()).state, 'idle');
      const resumed = JSON.parse(fs.readFileSync(path.join(operatorDirectory, 'journal.json'))).state;
      assert.equal(resumed.pending, null);
      assert.deepEqual(resumed.history, saved.history);
      assert.equal(resumed.reservedGasWei, saved.reservedGasWei);
      assert.equal(resumed.history.filter(item => item.kind === 'payout').length, 1);
      assert.equal(await provider.getBalance(aliceAddress), before);
    });
  } finally {
    Date.now = realNow;
    f.provider.destroy();
    if (!path.resolve(directory).startsWith(`${path.resolve(testRoot)}${path.sep}`)) throw Error('Unsafe fixture cleanup path');
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

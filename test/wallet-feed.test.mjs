import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Interface, keccak256} from 'ethers';
import {LossLedger} from '../src/ledger.mjs';
import {rewardInterface} from '../src/replay.mjs';
import {fingerprint, writeSnapshot, readSnapshot} from '../src/store.mjs';
import {buildWalletFeed, collectFinalizedPayments, publishWalletFeed, runWalletFeedCycle, unavailableWalletFeed, walletFeedIntervalSeconds, MAX_WALLET_FEED_BYTES} from '../src/wallet-feed.mjs';

const a = n => '0x' + n.toString(16).padStart(40, '0');
const h = n => '0x' + n.toString(16).padStart(64, '0');
const E = 10n ** 18n, runtime = '0x60006000';
const c = {chainId: 31337, token: a(1), hook: a(2), poolManager: a(3), distributor: a(4), initializer: a(5),
  hookFlavor: 'native20', poolId: h(1), deploymentBlock: 10, minimumAgeSeconds: 60, twapWindowSeconds: 300,
  maxOracleAgeSeconds: 300, excludedAddresses: [a(9)], execution: {codeHashes: {distributor: keccak256(runtime)}}};
const cp = {chainId: c.chainId, blockNumber: 20, blockHash: h(20), timestamp: 2000};
const abi = new Interface(['function pending(address) view returns(uint256)', 'function reserved() view returns(uint256)',
  'function distributeEligible(bytes32,bytes32,address,uint256,address[],uint256[],uint256[])']);
function makeSnapshot(ledger = new LossLedger(c)) {
  ledger.checkpoint = {...cp};
  return {version: 1, ledger: ledger.serialize(), checkpoint: {...cp}, generatedAt: 2000,
    oracle: {priceWeiPerToken: E, observedAt: 2000, windowSeconds: 300}};
}
function snapshotAt(snapshot, blockNumber) {
  const ledger = LossLedger.restore(snapshot.ledger), timestamp = blockNumber * 100;
  ledger.checkpoint = {...cp, blockNumber, blockHash: h(blockNumber), timestamp};
  return {...snapshot, ledger: ledger.serialize(), checkpoint: {...ledger.checkpoint}, generatedAt: timestamp,
    oracle: {...snapshot.oracle, observedAt: timestamp}};
}
function historyEvidence(snapshot) {
  return {schemaVersion: 'robin.wallet-payments.v1', configHash: fingerprint(c), checkpoint: {...cp},
    openingCheckpoint: {blockNumber: 9, blockHash: h(9)}, reservedWei: '0',
    accounts: Object.fromEntries([...LossLedger.restore(snapshot.ledger).accounts.keys()].map(account => [account,
      {allocatedWei: '0', paidWei: '0', pendingWei: '0', lastPaidAt: null}]))};
}
function fixture() {
  const ledger = new LossLedger(c); ledger.receive(a(10), E, 1000, {cost: 2n * E});
  const snapshot = makeSnapshot(ledger), logs = [], receipts = new Map(), txs = new Map(), pending = new Map();
  const counters = {checkpoint: 0, calls: []};
  let reserved = 0n, openingReserved = 0n;
  const provider = {
    async getNetwork() { return {chainId: BigInt(c.chainId)}; },
    async getBlock(number) {
      if (number === 'finalized') return {number: cp.blockNumber, hash: cp.blockHash, timestamp: cp.timestamp};
      if (number === cp.blockNumber) counters.checkpoint++;
      return {number, hash: h(number), timestamp: number * 100};
    },
    async getCode() { return runtime; },
    async getLogs(filter) { return logs.filter(log => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock); },
    async getTransactionReceipt(hash) { return receipts.get(hash); },
    async getTransaction(hash) { return txs.get(hash); },
    async call(request) {
      counters.calls.push(request);
      const parsed = abi.parseTransaction(request), value = parsed.name === 'reserved'
        ? request.blockTag === 9 ? openingReserved : reserved : pending.get(addressKey(parsed.args[0])) ?? 0n;
      return abi.encodeFunctionResult(parsed.name, [value]);
    },
  };
  const addressKey = value => value.toLowerCase();
  function transaction(number, events, {token = c.token, direct = true, amount = 100n, recipient = a(10), data} = {}) {
    const hash = h(1000 + number), blockHash = h(number), blockNumber = number;
    const txLogs = events.map(([name, args], index) => ({address: c.distributor, blockNumber, blockHash, transactionHash: hash,
      transactionIndex: 0, index, removed: false, ...rewardInterface.encodeEventLog(rewardInterface.getEvent(name), args)}));
    logs.push(...txLogs);
    receipts.set(hash, {hash, blockNumber, blockHash, status: 1, index: 0, logs: txLogs});
    txs.set(hash, {hash, blockNumber, blockHash, to: direct ? c.distributor : a(99), value: 0n,
      data: data ?? abi.encodeFunctionData('distributeEligible', [h(number), h(999), token, 9999, [recipient], [amount], [1n]])});
    return {hash, logs: txLogs, receipt: receipts.get(hash), tx: txs.get(hash)};
  }
  const allocation = (number, amount = 100n, recipient = a(10)) => [
    ['BatchRecorded', [h(number), h(999), amount]], ['RewardAllocated', [h(number), recipient, amount]],
  ];
  return {provider, snapshot, logs, receipts, txs, pending, counters, transaction, allocation,
    setReserved(value) { reserved = value; }, setOpeningReserved(value) { openingReserved = value; }};
}

test('feed refresh is bounded and oversized snapshots cannot reach delivery', async () => {
  assert.equal(walletFeedIntervalSeconds(), 300);
  for (const value of ['30', '601', '0', 'NaN', '-1']) assert.throws(() => walletFeedIntervalSeconds(value));
  let called = false;
  await assert.rejects(publishWalletFeed({padding: 'a'.repeat(MAX_WALLET_FEED_BYTES)}, {url: 'https://example.test/api/wallet-snapshot', token: 'a'.repeat(32),
    fetchImpl: async () => {called = true;}}), /capacity/);
  assert.equal(called, false);
  const ledger = new LossLedger(c);
  for (let i = 100; i < 5100; i++) ledger.receive(a(i), E, 1000, {cost: 2n * E});
  const snapshot = makeSnapshot(ledger);
  assert.throws(() => buildWalletFeed(c, snapshot, historyEvidence(snapshot), {now: 2001}), /capacity/);
});

test('local 1000-account reconciliation avoids pending RPC calls for proven zero rewards', async t => {
  const f = fixture(), ledger = new LossLedger(c);
  for (let i = 100; i < 1100; i++) ledger.receive(a(i), E, 1000, {cost: 2n * E});
  const snapshot = makeSnapshot(ledger), started = performance.now();
  const payments = await collectFinalizedPayments(f.provider, c, snapshot);
  const elapsed = performance.now() - started;
  const pendingCalls = f.counters.calls.filter(call => abi.parseTransaction(call).name === 'pending').length;
  assert.equal(pendingCalls, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(payments)), historyEvidence(snapshot));
  const feed = buildWalletFeed(c, snapshot, payments, {now: 2001});
  const bytes = Buffer.byteLength(JSON.stringify(feed)); assert.ok(bytes < MAX_WALLET_FEED_BYTES);
  t.diagnostic(`LOCAL MOCK ONLY: 1000 accounts, ${pendingCalls} pending calls, ${bytes} JSON bytes, ${elapsed.toFixed(1)}ms collector CPU; no network latency/cost measured`);
});

test('wallet tiers use dense exact ratios, sharing ties and excluding system wallets', () => {
  const ledger = new LossLedger(c);
  ledger.receive(a(10), E, 1000, {cost: 2n * E});
  ledger.receive(a(11), 2n * E, 1000, {cost: 4n * E});
  ledger.receive(a(12), E, 1000, {cost: 2n * E + 1n}); // Same displayed bps, distinct exact ratio.
  ledger.receive(a(13), E, 1000, {cost: 2n * E, relief: E / 2n});
  ledger.receive(a(9), E, 1000, {cost: 10n * E}); // Explicitly excluded, must not consume tier 1.
  const snapshot = makeSnapshot(ledger), feed = buildWalletFeed(c, snapshot, historyEvidence(snapshot), {now: 2001});
  assert.equal(feed.accounts[a(12)].tier, 1);
  assert.equal(feed.accounts[a(10)].tier, 2);
  assert.equal(feed.accounts[a(11)].tier, 2);
  assert.equal(feed.accounts[a(13)].tier, 3);
  assert.equal(feed.accounts[a(12)].lossRatioBps, feed.accounts[a(10)].lossRatioBps);
  assert.equal(feed.accounts[a(9)].eligibilityReason, 'excluded');
  assert.equal(feed.accounts[a(9)].tier, null);
  assert.deepEqual(Object.keys(feed.checkpoint).sort(), ['blockHash', 'blockNumber', 'timestamp']);
  assert.equal(feed.reason, null);
});

test('paid ETH belongs to its recipient after all tokens and inventory relief transfer away', () => {
  const ledger = new LossLedger(c);
  ledger.receive(a(10), E, 1000, {cost: 2n * E, relief: E / 2n});
  ledger.apply({id: 'transfer', type: 'transfer', from: a(10), to: a(11), amount: E, time: 1500});
  const snapshot = makeSnapshot(ledger), payments = historyEvidence(snapshot);
  payments.accounts[a(10)] = {allocatedWei: String(E / 2n), paidWei: String(E / 2n), pendingWei: '0', lastPaidAt: 1400};
  const feed = buildWalletFeed(c, snapshot, payments, {now: 2000});
  assert.equal(feed.accounts[a(10)].allocatedReliefWei, '0');
  assert.equal(feed.accounts[a(10)].rewardsReceivedWei, String(E / 2n));
  assert.equal(feed.accounts[a(10)].eligibilityReason, 'no-holdings');
  assert.equal(feed.accounts[a(11)].allocatedReliefWei, String(E / 2n));
  assert.equal(feed.accounts[a(11)].rewardsReceivedWei, '0');
});

test('holding periods, unknown-cost inventory, covered loss and absent wallets remain distinct', () => {
  const ledger = new LossLedger(c);
  ledger.receive(a(10), E, 1990, {cost: 2n * E});
  ledger.receive(a(11), E, 1000);
  ledger.receive(a(12), E, 1000, {cost: E});
  ledger.receive(a(13), E, 1000, {cost: 2n * E});
  ledger.receive(a(13), E, 1990, {cost: 2n * E});
  const snapshot = makeSnapshot(ledger), feed = buildWalletFeed(c, snapshot, historyEvidence(snapshot), {now: 2000});
  assert.equal(feed.accounts[a(10)].eligibilityReason, 'holding-period');
  assert.equal(feed.accounts[a(10)].nextUnlockAt, 2050);
  assert.equal(feed.accounts[a(11)].eligibilityReason, 'no-known-cost');
  assert.equal(feed.accounts[a(12)].eligibilityReason, 'no-uncovered-loss');
  assert.equal(feed.accounts[a(13)].matureBalanceWei, String(E));
  assert.equal(feed.accounts[a(13)].eligibleBasisWei, String(2n * E));
  assert.equal(feed.accounts[a(13)].eligibleLossWei, String(E));
  assert.equal(feed.accounts[a(13)].nextUnlockAt, 2050);
  assert.equal(Object.hasOwn(feed.accounts, a(99)), false);
});

test('payment-only recipients remain present and exact wei are never converted to floats', () => {
  const snapshot = makeSnapshot(), payments = historyEvidence(snapshot), amount = 9007199254740993n;
  payments.accounts[a(10)] = {allocatedWei: String(amount + 7n), paidWei: String(amount), pendingWei: '7', lastPaidAt: 1500};
  payments.reservedWei = '7';
  const feed = buildWalletFeed(c, snapshot, payments, {now: 2000});
  assert.equal(feed.accounts[a(10)].rewardsReceivedWei, String(amount));
  assert.equal(feed.accounts[a(10)].pendingRewardWei, '7');
  assert.equal(feed.accounts[a(10)].eligibilityReason, 'no-holdings');
});

test('feed rejects wrong identity/config, old ledger, mismatched checkpoints, stale and future data', () => {
  const snapshot = fixture().snapshot, payments = historyEvidence(snapshot);
  assert.throws(() => buildWalletFeed(c, snapshot, payments, {now: 2900}), /stale/);
  assert.throws(() => buildWalletFeed(c, snapshot, payments, {now: 1900}), /future/);
  assert.throws(() => buildWalletFeed(c, snapshot, payments, {now: 2000, ttlSeconds: 901}), /stale/);
  assert.throws(() => buildWalletFeed({...c, token: a(99)}, snapshot, payments, {now: 2000}), /mismatch/);
  assert.throws(() => buildWalletFeed(c, {...snapshot, checkpoint: {...cp, blockHash: h(99)}}, payments, {now: 2000}), /mismatch/);
  assert.throws(() => buildWalletFeed(c, snapshot, {...payments, checkpoint: {...cp, blockHash: h(99)}}, {now: 2000}), /mismatch/);
  const serialized = JSON.parse(snapshot.ledger); serialized.version = 3;
  assert.throws(() => buildWalletFeed(c, {...snapshot, ledger: JSON.stringify(serialized)}, payments, {now: 2000}), /Unsupported ledger/);
  const late = buildWalletFeed(c, snapshot, payments, {now: 2899});
  assert.equal(late.expiresAt, 3799);
});

test('healthy 17-minute finality is accepted, while 15-minute generation and 30-minute checkpoint limits are independent', () => {
  const snapshot = {...fixture().snapshot, generatedAt: 3023}, payments = historyEvidence(snapshot);
  const healthy = buildWalletFeed(c, snapshot, payments, {now: 3023});
  assert.equal(healthy.status, 'ready');
  assert.equal(healthy.expiresAt, 3800);
  assert.equal(buildWalletFeed(c, {...snapshot, generatedAt: 3799}, payments, {now: 3799}).expiresAt, 3800);
  assert.throws(() => buildWalletFeed(c, {...snapshot, generatedAt: 3800}, payments, {now: 3800}), /stale/);
  assert.throws(() => buildWalletFeed(c, {...snapshot, generatedAt: 2123}, payments, {now: 3023}), /stale/);
});

test('feed rejects unproven zero payments, amount overflow and inconsistent totals', () => {
  const snapshot = fixture().snapshot, payments = historyEvidence(snapshot);
  assert.throws(() => buildWalletFeed(c, snapshot, {...payments, accounts: {}}, {now: 2000}), /Missing wallet payment/);
  const bad = structuredClone(payments); bad.accounts[a(10)].paidWei = '1';
  assert.throws(() => buildWalletFeed(c, snapshot, bad, {now: 2000}), /payment evidence/);
  bad.accounts[a(10)].paidWei = String(1n << 256n);
  assert.throws(() => buildWalletFeed(c, snapshot, bad, {now: 2000}), /amount/);
  assert.throws(() => buildWalletFeed(c, snapshot, {...payments, reservedWei: '1'}, {now: 2000}), /total/);
});

test('collector reconciles successful payouts and only reads pending at its finalized checkpoint', async () => {
  const f = fixture();
  f.transaction(12, [...f.allocation(12), ['RewardPaid', [a(10), 100n]]]);
  const evidence = await collectFinalizedPayments(f.provider, c, f.snapshot);
  assert.deepEqual(evidence.accounts[a(10)], {allocatedWei: '100', paidWei: '100', pendingWei: '0', lastPaidAt: 1200});
  assert.equal(evidence.reservedWei, '0');
  assert.ok(f.counters.calls.every(request => [9, 20].includes(request.blockTag)));
  const feed = buildWalletFeed(c, f.snapshot, evidence, {now: 2000});
  assert.equal(feed.accounts[a(10)].rewardsReceivedWei, '100');
});

test('deferred retries never double count, later successful retry counts exactly once', async () => {
  const f = fixture();
  f.transaction(12, [...f.allocation(12), ['RewardDeferred', [a(10), 100n]]]);
  f.transaction(13, [['RewardDeferred', [a(10), 100n]]]);
  f.pending.set(a(10), 100n); f.setReserved(100n);
  let evidence = await collectFinalizedPayments(f.provider, c, f.snapshot);
  assert.deepEqual(evidence.accounts[a(10)], {allocatedWei: '100', paidWei: '0', pendingWei: '100', lastPaidAt: null});
  f.transaction(14, [['RewardPaid', [a(10), 100n]]]);
  f.pending.clear(); f.setReserved(0n);
  evidence = await collectFinalizedPayments(f.provider, c, f.snapshot);
  assert.deepEqual(evidence.accounts[a(10)], {allocatedWei: '100', paidWei: '100', pendingWei: '0', lastPaidAt: 1400});
});

test('campaign separation rejects opening pending funds, foreign token calldata and indirect allocation calls', async () => {
  let f = fixture(); f.setOpeningReserved(1n);
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot), /another pending/);
  for (const options of [{token: a(99)}, {direct: false}, {data: '0x12345678'}]) {
    f = fixture(); f.transaction(12, [...f.allocation(12), ['RewardPaid', [a(10), 100n]]], options);
    await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot), /unsupported/);
  }
});

test('collector accepts a historically absent distributor as a zero campaign boundary', async () => {
  const f = fixture();
  f.provider.getCode = async (_address, block) => block === 9 ? '0x' : runtime;
  const evidence = await collectFinalizedPayments(f.provider, c, f.snapshot);
  assert.equal(evidence.accounts[a(10)].paidWei, '0');
  assert.equal(f.counters.calls.some(request => request.blockTag === 9), false);
});

test('collector rejects all-skipped allocation batches for the wrong token too', async () => {
  const f = fixture();
  f.transaction(12, [['BatchRecorded', [h(12), h(999), 0n]]], {token: a(99)});
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot), /unsupported/);
});

test('collector rejects bad finality, wrong chain/runtime and a checkpoint changing during reads', async () => {
  let f = fixture(); f.provider.getNetwork = async () => ({chainId: 1n});
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot), /canonical/);
  f = fixture(); f.provider.getCode = async () => '0x60';
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot), /runtime/);
  f = fixture(); const getBlock = f.provider.getBlock;
  f.provider.getBlock = async number => {
    const block = await getBlock(number);
    return number === 20 && f.counters.checkpoint > 1 ? {...block, hash: h(99)} : block;
  };
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot), /canonical/);
});

test('collector rejects removed/duplicate logs and noncanonical or failed receipts', async () => {
  for (const mutate of [
    f => { f.logs[0].removed = true; },
    f => { f.logs.push(f.logs[0]); },
    f => { [...f.receipts.values()][0].blockHash = h(99); },
    f => { [...f.receipts.values()][0].status = 0; },
    f => { [...f.receipts.values()][0].logs = [...f.receipts.values()][0].logs.slice(1); },
  ]) {
    const f = fixture(); f.transaction(12, [...f.allocation(12), ['RewardPaid', [a(10), 100n]]]); mutate(f);
    await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot), /event|receipt/i);
  }
});

test('collector rejects changed allocation amounts, missing payments and untracked reserved money', async () => {
  let f = fixture(); f.transaction(12, [...f.allocation(12), ['RewardPaid', [a(10), 100n]]], {amount: 101n});
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot), /allocation/);
  f = fixture(); f.transaction(12, f.allocation(12));
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot), /reconcile/);
  f = fixture(); f.setReserved(100n);
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot), /total/);
});

test('incremental payment replay after restart equals full history and scans only new blocks', async () => {
  const f = fixture();
  f.transaction(12, [...f.allocation(12), ['RewardPaid', [a(10), 100n]]]);
  const previous = await collectFinalizedPayments(f.provider, c, snapshotAt(f.snapshot, 15));
  // A durable JSON round trip must preserve every exact historical amount.
  const restored = JSON.parse(JSON.stringify(previous));
  f.transaction(18, [...f.allocation(18, 51n), ['RewardPaid', [a(10), 51n]]], {amount: 51n});
  const getLogs = f.provider.getLogs, ranges = [];
  f.provider.getLogs = async filter => { ranges.push([filter.fromBlock, filter.toBlock]); return getLogs(filter); };
  const incremental = await collectFinalizedPayments(f.provider, c, f.snapshot, restored);
  assert.deepEqual(ranges, [[16, 20]]);
  assert.equal(incremental.accounts[a(10)].paidWei, '151');
  assert.equal(incremental.accounts[a(10)].lastPaidAt, 1800);
  assert.deepEqual(incremental, await collectFinalizedPayments(f.provider, c, f.snapshot));
  ranges.length = 0;
  assert.deepEqual(await collectFinalizedPayments(f.provider, c, f.snapshot, incremental), incremental);
  assert.deepEqual(ranges, []);
});

test('incremental deferred payment retry preserves old allocation and changes only paid/pending', async () => {
  const f = fixture();
  f.transaction(12, [...f.allocation(12), ['RewardDeferred', [a(10), 100n]]]);
  f.pending.set(a(10), 100n); f.setReserved(100n);
  const previous = await collectFinalizedPayments(f.provider, c, snapshotAt(f.snapshot, 15));
  f.transaction(18, [['RewardPaid', [a(10), 100n]]]);
  f.pending.clear(); f.setReserved(0n);
  const current = await collectFinalizedPayments(f.provider, c, f.snapshot, previous);
  assert.deepEqual(current.accounts[a(10)], {allocatedWei: '100', paidWei: '100', pendingWei: '0', lastPaidAt: 1800});
  assert.deepEqual(current, await collectFinalizedPayments(f.provider, c, f.snapshot));
});

test('new holders receive proven zero payments without discarding other recipients history', async () => {
  const f = fixture();
  f.transaction(12, [...f.allocation(12), ['RewardPaid', [a(10), 100n]]]);
  const previous = await collectFinalizedPayments(f.provider, c, snapshotAt(f.snapshot, 15));
  const ledger = LossLedger.restore(f.snapshot.ledger); ledger.receive(a(11), E, 1800, {cost: E});
  const current = await collectFinalizedPayments(f.provider, c, makeSnapshot(ledger), previous);
  assert.deepEqual(current.accounts[a(11)], {allocatedWei: '0', paidWei: '0', pendingWei: '0', lastPaidAt: null});
  assert.equal(current.accounts[a(10)].paidWei, '100');
  assert.deepEqual(current, await collectFinalizedPayments(f.provider, c, makeSnapshot(ledger)));
});

test('optimized replay rechecks touched and unpaid recipients and matches full historical replay', async () => {
  const f = fixture();
  f.transaction(12, [...f.allocation(12), ['RewardPaid', [a(10), 100n]]]);
  f.transaction(13, [...f.allocation(13, 50n, a(11)), ['RewardDeferred', [a(11), 50n]]], {amount: 50n, recipient: a(11)});
  f.pending.set(a(11), 50n); f.setReserved(50n);
  const previous = JSON.parse(JSON.stringify(await collectFinalizedPayments(f.provider, c, snapshotAt(f.snapshot, 15))));
  f.transaction(18, [...f.allocation(18, 75n, a(12)), ['RewardPaid', [a(12), 75n]]], {amount: 75n, recipient: a(12)});
  const ledger = LossLedger.restore(f.snapshot.ledger); ledger.receive(a(13), E, 1800, {cost: E});
  const snapshot = makeSnapshot(ledger); f.counters.calls.length = 0;
  const current = await collectFinalizedPayments(f.provider, c, snapshot, previous);
  const checked = f.counters.calls.map(call => abi.parseTransaction(call)).filter(call => call.name === 'pending').map(call => call.args[0].toLowerCase());
  assert.deepEqual(checked, [a(11), a(12)], 'prior paid wallet and new reward-free holder need no pending reads');
  assert.deepEqual(current.accounts[a(10)], {allocatedWei: '100', paidWei: '100', pendingWei: '0', lastPaidAt: 1200});
  assert.deepEqual(current.accounts[a(11)], {allocatedWei: '50', paidWei: '0', pendingWei: '50', lastPaidAt: null});
  assert.deepEqual(current.accounts[a(12)], {allocatedWei: '75', paidWei: '75', pendingWei: '0', lastPaidAt: 1800});
  assert.deepEqual(current.accounts[a(13)], {allocatedWei: '0', paidWei: '0', pendingWei: '0', lastPaidAt: null});
  assert.deepEqual(current, await collectFinalizedPayments(f.provider, c, snapshot));
  f.counters.calls.length = 0;
  assert.deepEqual(await collectFinalizedPayments(f.provider, c, snapshot, current), current);
  const repeat = f.counters.calls.map(call => abi.parseTransaction(call)).filter(call => call.name === 'pending');
  assert.deepEqual(repeat.map(call => call.args[0].toLowerCase()), [a(11)], 'unchanged deferred reward is still checked every cycle');
  assert.ok(f.counters.calls.every(call => [9, 20].includes(call.blockTag)));
});

test('optimized replay detects omitted payout evidence and unknown allocations through reconciliation', async () => {
  const f = fixture();
  f.transaction(12, [...f.allocation(12), ['RewardDeferred', [a(10), 100n]]]);
  f.pending.set(a(10), 100n); f.setReserved(100n);
  const previous = await collectFinalizedPayments(f.provider, c, snapshotAt(f.snapshot, 15));
  // The RPC reports a changed previously unpaid balance but omits its payout event.
  f.pending.clear(); f.setReserved(0n);
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot, previous), /do not reconcile/);
  // A missing allocation to an unseen wallet changes reserved and cannot become a ready feed.
  f.pending.set(a(10), 100n); f.pending.set(a(11), 1n); f.setReserved(101n);
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot, previous), /total does not reconcile/);
  // Even when aggregate reserved looks right, a newly touched wallet must match its mapping.
  f.pending.clear(); f.pending.set(a(10), 100n); f.pending.set(a(12), 1n); f.setReserved(100n);
  f.transaction(18, [...f.allocation(18, 50n, a(12)), ['RewardPaid', [a(12), 50n]]], {amount: 50n, recipient: a(12)});
  await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot, previous), /do not reconcile/);
});

test('incremental cache rejects schema/config changes, numeric corruption, backward cursor and forked history', async () => {
  const f = fixture();
  f.transaction(12, [...f.allocation(12), ['RewardPaid', [a(10), 100n]]]);
  const previous = await collectFinalizedPayments(f.provider, c, snapshotAt(f.snapshot, 15));
  for (const mutate of [
    p => { p.schemaVersion = 'old'; },
    p => { p.configHash = h(99); },
    p => { p.accounts[a(10)].paidWei = '-1'; },
    p => { p.accounts[a(10)].allocatedWei = '101'; },
    p => { p.accounts[a(10)].lastPaidAt = 1600; },
    p => { p.reservedWei = '1'; },
    p => { p.checkpoint.blockNumber = 21; },
    p => { p.checkpoint.blockNumber = 9; },
    p => { p.checkpoint.chainId = 1; },
    p => { p.checkpoint.blockHash = h(99); },
    p => { p.openingCheckpoint.blockHash = h(99); },
  ]) {
    const bad = structuredClone(previous); mutate(bad);
    await assert.rejects(collectFinalizedPayments(f.provider, c, f.snapshot, bad), /cache|amount|canonical/);
  }
});

test('payment cache envelope binds configuration and rejects disk corruption instead of resetting', async () => {
  const f = fixture(), previous = await collectFinalizedPayments(f.provider, c, f.snapshot);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-wallet-feed-')), file = path.join(dir, 'payments.json');
  try {
    writeSnapshot(file, c, previous);
    assert.deepEqual(JSON.parse(JSON.stringify(readSnapshot(file, c))), JSON.parse(JSON.stringify(previous)));
    assert.throws(() => readSnapshot(file, {...c, deploymentBlock: 11}), /mismatch/);
    const saved = JSON.parse(fs.readFileSync(file)); saved.payload = saved.payload.replace('"paidWei": "0"', '"paidWei": "100"');
    fs.writeFileSync(file, JSON.stringify(saved));
    assert.throws(() => readSnapshot(file, c), /integrity/);
  } finally {
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('robin-wallet-feed-'))
      throw Error('Unexpected test cleanup path');
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('publisher sends public JSON with bearer auth, no redirects and a bounded timeout', async () => {
  const feed = unavailableWalletFeed(c, 2000), token = 'a'.repeat(32);
  let called = false;
  await publishWalletFeed(feed, {url: 'https://example.test/api/wallet-snapshot', token, fetchImpl: async (url, request) => {
    called = true;
    assert.equal(url, 'https://example.test/api/wallet-snapshot');
    assert.equal(request.method, 'PUT'); assert.equal(request.redirect, 'error');
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(request.body), feed); assert.equal(request.body.includes(token), false);
    assert.ok(request.signal instanceof AbortSignal);
    return {status: 200, json: async () => ({status: 'stored', checkpoint: feed.checkpoint, generatedAt: feed.generatedAt})};
  }});
  assert.equal(called, true);
  await assert.rejects(publishWalletFeed(feed, {url: 'https://example.test/api/wallet-snapshot', token, timeoutMs: 20,
    fetchImpl: async (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(Error('secret response'))))}),
  /^Error: Wallet feed publication failed$/);
});

test('publisher rejects URL secrets/redirect endpoints and sanitizes server and credential errors', async () => {
  const feed = unavailableWalletFeed(c, 2000), options = {url: 'https://example.test/api/wallet-snapshot', token: 'a'.repeat(32)};
  for (const url of ['http://example.test/api/wallet-snapshot', 'https://user:secret@example.test/api/wallet-snapshot',
    'https://example.test/api/wallet-snapshot?secret=abc', 'https://example.test/other', 'https://example.test/api/wallet-snapshot#secret']) {
    await assert.rejects(publishWalletFeed(feed, {...options, url}), /^Error: Invalid wallet feed publisher configuration$/);
  }
  for (const fetchImpl of [async () => { throw Error('secret-url-and-token'); },
    async () => ({status: 302, json: async () => ({secret: 'value'})}),
    async () => ({status: 200, json: async () => null}),
    async () => ({status: 200, json: async () => ({})}),
    async () => ({status: 200, json: async () => ({status: 'stored', generatedAt: 1999, checkpoint: null})}),
    async () => ({status: 200, json: async () => ({status: 'stored', generatedAt: 2000, checkpoint: cp})})]) {
    await assert.rejects(publishWalletFeed(feed, {...options, fetchImpl}), /^Error: Wallet feed publication failed$/);
  }
  await publishWalletFeed(feed, {...options, fetchImpl: async () => ({status: 200,
    json: async () => ({status: 'unchanged', generatedAt: 2000})})});
});

test('failed verification atomically clears public values, preserves bound cache, publishes outage and releases lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-wallet-feed-'));
  try {
    const snapshot = fixture().snapshot, cache = path.join(dir, 'wallet-snapshot-cache.json');
    writeSnapshot(cache, c, snapshot);
    const cached = readSnapshot(cache, c);
    fs.writeFileSync(path.join(dir, 'recovery-snapshot.json'), JSON.stringify({status: 'ready', accounts: {private: 'old'}}));
    let delivered;
    const status = await runWalletFeedCycle({}, c, dir, {now: 2000, publisher: {
      url: 'https://example.test/api/wallet-snapshot', token: 'a'.repeat(32),
      fetchImpl: async (_url, request) => { delivered = JSON.parse(request.body); return {status: 200,
        json: async () => ({status: 'stored', checkpoint: delivered.checkpoint, generatedAt: delivered.generatedAt})}; },
    }});
    assert.equal(status.state, 'unavailable');
    assert.deepEqual(delivered, unavailableWalletFeed(c, 2000));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'recovery-snapshot.json'))), delivered);
    assert.deepEqual(readSnapshot(cache, c), cached);
    assert.throws(() => readSnapshot(cache, {...c, token: a(99)}), /mismatch/);
    assert.equal(fs.existsSync(path.join(dir, 'wallet-feed.lock')), false);
  } finally {
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('robin-wallet-feed-'))
      throw Error('Unexpected test cleanup path');
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

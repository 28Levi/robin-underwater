import path from 'node:path';
import {Contract, Interface, keccak256} from 'ethers';
import {LossLedger, LEDGER_VERSION, ZERO, address} from './ledger.mjs';
import {buildSnapshot, rewardInterface} from './replay.mjs';
import {RECOVERY_POLICY} from './recovery-ladder.mjs';
import {acquireLock, atomicWrite, fingerprint, readSnapshot, writeSnapshot} from './store.mjs';
import {executionPolicy, verifyExecution} from './executor.mjs';

export const WALLET_FEED_SCHEMA = 'robinhook.wallet-feed.v1';
export const MAX_FEED_AGE_SECONDS = 900;
export const MAX_FINALIZED_AGE_SECONDS = 1800;
export const MAX_WALLET_FEED_BYTES = 2 * 1024 * 1024;
export function walletFeedIntervalSeconds(value = '300') {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value) || Number(value) < 60 || Number(value) > 600)
    throw Error('Wallet feed refresh must be between 60 and 600 seconds');
  return Number(value);
}
const PAYMENT_SCHEMA = 'robin.wallet-payments.v1';
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const MAX_UINT = (1n << 256n) - 1n;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uint = value => {
  if (typeof value !== 'string' || !UINT.test(value) || BigInt(value) > MAX_UINT) throw Error('Invalid wallet amount');
  return BigInt(value);
};
const decimal = value => uint(String(value)).toString();
const sameCheckpoint = (a, b) => object(a) && object(b) &&
  ['chainId', 'blockNumber', 'blockHash', 'timestamp'].every(key => a[key] === b[key]);
const paymentAbi = new Interface([
  'function pending(address) view returns(uint256)',
  'function reserved() view returns(uint256)',
  'function distributeEligible(bytes32 batchId,bytes32 auditHash,address token,uint256 deadline,address[] recipients,uint256[] amounts,uint256[] minimumBalances)',
]);
const emptyPayment = () => ({allocatedWei: '0', paidWei: '0', pendingWei: '0', lastPaidAt: null});

function restorePaymentCache(c, previous, cp, baseline) {
  const prior = previous?.checkpoint;
  if (!object(previous) || previous.schemaVersion !== PAYMENT_SCHEMA || previous.configHash !== fingerprint(c)
    || !object(prior) || prior.chainId !== c.chainId || !integer(prior.blockNumber) || prior.blockNumber < c.deploymentBlock
    || prior.blockNumber > cp.blockNumber || !HASH.test(prior.blockHash) || !integer(prior.timestamp) || prior.timestamp > cp.timestamp
    || previous.openingCheckpoint?.blockNumber !== baseline.number || previous.openingCheckpoint?.blockHash !== baseline.hash
    || !object(previous.accounts)) throw Error('Wallet payment cache identity or checkpoint mismatch');
  const accounts = Object.create(null);
  let totalPending = 0n;
  for (const [account, record] of Object.entries(previous.accounts)) {
    if (account !== address(account) || !object(record)) throw Error('Invalid wallet payment cache account');
    const allocated = uint(record.allocatedWei), paid = uint(record.paidWei), pending = uint(record.pendingWei);
    if (allocated - paid !== pending || !(record.lastPaidAt === null || integer(record.lastPaidAt) && record.lastPaidAt <= prior.timestamp)
      || (paid === 0n) !== (record.lastPaidAt === null)) throw Error('Wallet payment cache does not reconcile');
    accounts[account] = {allocatedWei: record.allocatedWei, paidWei: record.paidWei, pendingWei: record.pendingWei, lastPaidAt: record.lastPaidAt};
    totalPending += pending;
  }
  if (totalPending !== uint(previous.reservedWei)) throw Error('Wallet payment cache total does not reconcile');
  return accounts;
}

function checkpointOf(c, snapshot) {
  if (!object(snapshot) || snapshot.version !== 1 || typeof snapshot.ledger !== 'string') throw Error('Invalid wallet snapshot');
  const ledger = LossLedger.restore(snapshot.ledger), cp = snapshot.checkpoint;
  if (!sameCheckpoint(cp, ledger.checkpoint) || cp.chainId !== c.chainId || !integer(cp.blockNumber) || !HASH.test(cp.blockHash)
    || !integer(cp.timestamp) || !integer(c.deploymentBlock) || c.deploymentBlock < 1 || cp.blockNumber < c.deploymentBlock
    || ledger.minimumAgeSeconds !== c.minimumAgeSeconds || ledger.maxOracleAgeSeconds !== c.maxOracleAgeSeconds)
    throw Error('Wallet snapshot checkpoint or policy mismatch');
  if (!integer(snapshot.generatedAt) || snapshot.generatedAt < cp.timestamp - 60 || !object(snapshot.oracle)
    || snapshot.oracle.observedAt !== cp.timestamp || snapshot.oracle.windowSeconds !== c.twapWindowSeconds)
    throw Error('Wallet snapshot oracle mismatch');
  // Restore rejects old ledger versions; reject duplicate normalized accounts too.
  if (JSON.parse(snapshot.ledger).accounts.length !== ledger.accounts.size) throw Error('Duplicate wallet accounts');
  return {ledger, cp};
}

async function assertCanonical(provider, c, cp) {
  const [network, block, finalized] = await Promise.all([
    provider.getNetwork(), provider.getBlock(cp.blockNumber), provider.getBlock('finalized'),
  ]);
  if (network.chainId !== BigInt(c.chainId) || !block || block.number !== cp.blockNumber || block.hash !== cp.blockHash || block.timestamp !== cp.timestamp
    || !finalized || !integer(finalized.number) || finalized.number < cp.blockNumber || finalized.timestamp < cp.timestamp)
    throw Error('Wallet checkpoint is not canonical and finalized');
}

function logIndex(log) {
  const index = log.index ?? log.logIndex;
  if (!integer(index)) throw Error('Invalid wallet event position');
  return index;
}
function logKey(log) { return `${log.transactionHash}:${logIndex(log)}`; }
function sameLog(a, b) {
  return address(a.address) === address(b.address) && a.data === b.data && JSON.stringify(a.topics) === JSON.stringify(b.topics)
    && a.blockHash === b.blockHash && a.blockNumber === b.blockNumber && a.transactionHash === b.transactionHash
    && logIndex(a) === logIndex(b) && a.transactionIndex === b.transactionIndex;
}

/** Finalized distributor history from a proven empty campaign boundary.
 * A validated, canonical cache resumes after its checkpoint; the first run scans full history.
 * This intentionally does not use ledger relief as a payment history, or sum deferred retries.
 * The RPC is trusted for completeness; receipt and accounting reconciliation detect inconsistencies.
 */
export async function collectFinalizedPayments(provider, c, snapshot, previous = null) {
  const {ledger, cp} = checkpointOf(c, snapshot), distributor = address(c.distributor);
  await assertCanonical(provider, c, cp);
  const vault = new Contract(distributor, paymentAbi, provider), baselineNumber = c.deploymentBlock - 1;
  const baseline = await provider.getBlock(baselineNumber);
  if (!baseline || baseline.number !== baselineNumber || !HASH.test(baseline.hash)) throw Error('Wallet campaign baseline unavailable');
  const [baselineCode, finalCode] = await Promise.all([
    provider.getCode(distributor, baselineNumber), provider.getCode(distributor, cp.blockNumber),
  ]);
  if (finalCode === '0x' || !HASH.test(c.execution?.codeHashes?.distributor ?? '')
    || keccak256(finalCode) !== c.execution.codeHashes.distributor) throw Error('Wallet distributor runtime mismatch');
  if (baselineCode !== '0x' && (keccak256(baselineCode) !== c.execution.codeHashes.distributor
    || await vault.reserved({blockTag: baselineNumber}) !== 0n)) throw Error('Wallet campaign starts with another pending reward balance');

  const accounts = previous ? restorePaymentCache(c, previous, cp, baseline) : Object.create(null);
  if (previous) await assertCanonical(provider, c, previous.checkpoint);
  // Pinned distributor code changes pending only through the receipt events replayed
  // below. Recheck prior unpaid balances and all newly touched recipients; wallets
  // with proven zero allocations/pending need no repeated storage read.
  const pendingChecks = new Set(Object.entries(accounts).filter(([, record]) => uint(record.pendingWei) > 0n).map(([account]) => account));
  const fromBlock = previous ? previous.checkpoint.blockNumber + 1 : c.deploymentBlock;

  const scanned = new Map(), transactions = new Map();
  for (let from = fromBlock; from <= cp.blockNumber; from += 1000) {
    const to = Math.min(from + 999, cp.blockNumber);
    for (const log of await provider.getLogs({address: distributor, fromBlock: from, toBlock: to})) {
      if (address(log.address) !== distributor || !integer(log.blockNumber) || log.blockNumber < from || log.blockNumber > to
        || !HASH.test(log.blockHash) || !HASH.test(log.transactionHash) || !integer(log.transactionIndex) || log.removed !== false)
        throw Error('Invalid finalized wallet event');
      const key = logKey(log);
      if (scanned.has(key)) throw Error('Duplicate finalized wallet event');
      scanned.set(key, log);
      const prior = transactions.get(log.transactionHash);
      if (prior && (prior.blockNumber !== log.blockNumber || prior.blockHash !== log.blockHash || prior.index !== log.transactionIndex))
        throw Error('Conflicting wallet transaction evidence');
      transactions.set(log.transactionHash, {blockNumber: log.blockNumber, blockHash: log.blockHash, index: log.transactionIndex, count: (prior?.count ?? 0) + 1});
    }
  }
  const get = account => accounts[address(account)] ??= emptyPayment();
  for (const account of ledger.accounts.keys()) get(account);
  const blocks = new Map();
  for (const [hash, info] of [...transactions].sort(([, a], [, b]) => a.blockNumber - b.blockNumber || a.index - b.index)) {
    if (!blocks.has(info.blockNumber)) blocks.set(info.blockNumber, await provider.getBlock(info.blockNumber));
    const block = blocks.get(info.blockNumber), receipt = await provider.getTransactionReceipt(hash);
    if (!block || block.hash !== info.blockHash || !integer(block.timestamp) || block.timestamp > cp.timestamp || !receipt
      || (receipt.hash ?? receipt.transactionHash) !== hash || receipt.blockNumber !== info.blockNumber || receipt.blockHash !== block.hash
      || Number(receipt.status) !== 1 || (receipt.index ?? receipt.transactionIndex) !== info.index)
      throw Error('Inconsistent finalized wallet receipt');
    const logs = receipt.logs.filter(log => address(log.address) === distributor).sort((a, b) => logIndex(a) - logIndex(b));
    const seen = new Set();
    for (const log of logs) {
      const key = logKey(log), original = scanned.get(key);
      if (log.removed === true || seen.has(key) || !original || !sameLog(log, original)) throw Error('Wallet receipt and log scan disagree');
      seen.add(key);
    }
    if (info.count !== seen.size) throw Error('Wallet receipt omitted scanned events');
    const events = logs.map(log => { try { return rewardInterface.parseLog(log); } catch { return null; } }).filter(Boolean);
    const batches = events.filter(event => event.name === 'BatchRecorded');
    const allocations = events.filter(event => event.name === 'RewardAllocated');
    if (batches.length || allocations.length) {
      const transaction = await provider.getTransaction(hash);
      let call;
      try { call = paymentAbi.parseTransaction({data: transaction?.data, value: transaction?.value ?? 0n}); } catch {}
      if (!transaction || transaction.hash !== hash || transaction.blockHash !== block.hash || transaction.blockNumber !== block.number
        || address(transaction.to ?? ZERO) !== distributor || !call || call.name !== 'distributeEligible'
        || address(call.args.token) !== address(c.token) || batches.length !== 1
        || call.args.batchId !== batches[0].args.batchId || call.args.auditHash !== batches[0].args.auditHash)
        throw Error('Mixed or unsupported wallet reward allocation origin');
      const requested = new Map();
      if (call.args.recipients.length !== call.args.amounts.length || call.args.recipients.length !== call.args.minimumBalances.length)
        throw Error('Invalid wallet allocation calldata');
      for (let i = 0; i < call.args.recipients.length; i++) {
        const recipient = address(call.args.recipients[i]);
        if (requested.has(recipient)) throw Error('Duplicate requested wallet allocation');
        requested.set(recipient, call.args.amounts[i]);
      }
      let allocated = 0n;
      const accepted = new Set();
      for (const event of allocations) {
        const recipient = address(event.args.recipient), amount = event.args.amount;
        if (accepted.has(recipient) || amount <= 0n || requested.get(recipient) !== amount || event.args.batchId !== call.args.batchId)
          throw Error('Wallet allocation does not match its transaction');
        accepted.add(recipient); allocated += amount;
      }
      if (allocated !== batches[0].args.total) throw Error('Wallet allocation batch sum mismatch');
    }
    for (const event of events) {
      if (!['RewardAllocated', 'RewardPaid', 'RewardDeferred'].includes(event.name)) continue;
      const recipient = address(event.args.recipient), amount = event.args.amount, record = get(recipient);
      if (recipient === ZERO || amount <= 0n) throw Error('Invalid wallet reward event');
      pendingChecks.add(recipient);
      if (event.name === 'RewardAllocated') record.allocatedWei = decimal(uint(record.allocatedWei) + amount);
      if (event.name === 'RewardPaid') {
        record.paidWei = decimal(uint(record.paidWei) + amount);
        record.lastPaidAt = block.timestamp;
      }
    }
  }
  let totalPending = 0n;
  for (const record of Object.values(accounts)) {
    record.pendingWei = decimal(uint(record.allocatedWei) - uint(record.paidWei));
    totalPending += uint(record.pendingWei);
  }
  const recipients = [...pendingChecks].sort();
  // Bound RPC concurrency; every call is pinned to the same finalized checkpoint.
  for (let i = 0; i < recipients.length; i += 8) {
    const group = recipients.slice(i, i + 8);
    const pending = await Promise.all(group.map(account => vault.pending(account, {blockTag: cp.blockNumber})));
    for (let j = 0; j < group.length; j++) {
      const record = accounts[group[j]];
      if (uint(record.pendingWei) !== pending[j]) throw Error('Wallet payments do not reconcile');
    }
  }
  const reserved = await vault.reserved({blockTag: cp.blockNumber});
  if (totalPending !== reserved) throw Error('Wallet pending total does not reconcile');
  await assertCanonical(provider, c, cp);
  if ((await provider.getBlock(baselineNumber))?.hash !== baseline.hash) throw Error('Wallet campaign baseline changed');
  return {schemaVersion: PAYMENT_SCHEMA, configHash: fingerprint(c), checkpoint: cp,
    openingCheckpoint: {blockNumber: baselineNumber, blockHash: baseline.hash}, reservedWei: decimal(reserved), accounts};
}

/** Pure, exact account view builder. Only publish evidence assembled by the finalized collector. */
export function buildWalletFeed(c, snapshot, payments, {now = Math.floor(Date.now() / 1000), ttlSeconds = MAX_FEED_AGE_SECONDS} = {}) {
  const {ledger, cp} = checkpointOf(c, snapshot);
  if (!integer(now) || !integer(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_FEED_AGE_SECONDS
    || snapshot.generatedAt > now + 60 || cp.timestamp > now + 60 || now - snapshot.generatedAt >= MAX_FEED_AGE_SECONDS
    || now - cp.timestamp >= MAX_FINALIZED_AGE_SECONDS) throw Error('Wallet snapshot is stale or future dated');
  if (!object(payments) || payments.schemaVersion !== PAYMENT_SCHEMA || payments.configHash !== fingerprint(c)
    || !sameCheckpoint(payments.checkpoint, cp) || !object(payments.accounts)
    || payments.openingCheckpoint?.blockNumber !== c.deploymentBlock - 1 || !HASH.test(payments.openingCheckpoint?.blockHash ?? ''))
    throw Error('Wallet payment evidence mismatch');
  const system = new Set([ZERO, c.poolManager, c.hook, c.distributor, ...(c.initializer ? [c.initializer] : []), ...c.excludedAddresses].map(address));
  const positions = ledger.shortfalls({...snapshot.oracle, now: cp.timestamp}).filter(position => !system.has(position.account));
  positions.sort((a, b) => {
    const comparison = a.loss * b.basis - b.loss * a.basis;
    return comparison > 0n ? -1 : comparison < 0n ? 1 : a.account.localeCompare(b.account);
  });
  const eligible = new Map();
  let tier = 0, previous;
  for (const position of positions) {
    if (!previous || position.loss * previous.basis !== previous.loss * position.basis) tier++;
    eligible.set(position.account, {...position, tier}); previous = position;
  }
  const accounts = Object.create(null), recipients = new Set([...ledger.accounts.keys(), ...Object.keys(payments.accounts)]);
  let totalPending = 0n;
  for (const account of [...recipients].sort()) {
    if (account !== address(account)) throw Error('Wallet payment address is not normalized');
    const paid = payments.accounts[account];
    if (!object(paid)) throw Error('Missing wallet payment evidence');
    const allocated = uint(paid.allocatedWei), received = uint(paid.paidWei), pending = uint(paid.pendingWei);
    if (allocated - received !== pending || !(paid.lastPaidAt === null || integer(paid.lastPaidAt) && paid.lastPaidAt <= cp.timestamp)
      || (received === 0n) !== (paid.lastPaidAt === null)) throw Error('Invalid wallet payment evidence');
    totalPending += pending;
    const p = ledger.accounts.get(account) ?? {balance: 0n, cost: 0n, relief: 0n, ageLots: [], quarantined: false, lastAcquired: 0};
    if (typeof p.quarantined !== 'boolean' || !integer(p.lastAcquired) || p.lastAcquired > cp.timestamp) throw Error('Invalid wallet ledger account');
    const mature = p.ageLots.reduce((sum, lot) => sum + (lot.unlockAt <= cp.timestamp ? lot.amount : 0n), 0n);
    const basis = p.balance > 0n ? p.cost * mature / p.balance : 0n;
    const position = !system.has(account) && !p.quarantined ? eligible.get(account) : null;
    const loss = position?.loss ?? 0n;
    if (position && position.basis !== basis) throw Error('Wallet eligibility basis mismatch');
    const reason = system.has(account) || p.quarantined ? 'excluded' : p.balance === 0n ? 'no-holdings'
      : p.cost === 0n ? 'no-known-cost' : mature === 0n ? 'holding-period' : !position ? 'no-uncovered-loss' : 'eligible';
    accounts[account] = {
      balanceWei: decimal(p.balance), costWei: decimal(p.cost), allocatedReliefWei: decimal(p.relief),
      matureBalanceWei: decimal(mature), eligibleBasisWei: decimal(basis), eligibleLossWei: decimal(loss),
      eligible: reason === 'eligible', eligibilityReason: reason, tier: position?.tier ?? null,
      lossRatioBps: basis > 0n ? Number(loss * 10000n / basis) : null,
      rewardsReceivedWei: paid.paidWei, pendingRewardWei: paid.pendingWei, lastPaidAt: paid.lastPaidAt,
      nextUnlockAt: p.ageLots.find(lot => lot.unlockAt > cp.timestamp)?.unlockAt ?? null,
    };
  }
  if (totalPending !== uint(payments.reservedWei)) throw Error('Wallet payment evidence total mismatch');
  const feed = {schemaVersion: WALLET_FEED_SCHEMA, policy: RECOVERY_POLICY, ledgerVersion: LEDGER_VERSION,
    status: 'ready', complete: true, chainId: c.chainId, token: address(c.token), distributor: address(c.distributor),
    reason: null, checkpoint: {blockNumber: cp.blockNumber, blockHash: cp.blockHash, timestamp: cp.timestamp},
    generatedAt: now, expiresAt: Math.min(now + ttlSeconds, cp.timestamp + MAX_FINALIZED_AGE_SECONDS), accounts};
  if (Buffer.byteLength(JSON.stringify(feed), 'utf8') > MAX_WALLET_FEED_BYTES) throw Error('Wallet feed exceeds delivery capacity');
  return feed;
}

export function unavailableWalletFeed(c, now = Math.floor(Date.now() / 1000)) {
  return {schemaVersion: WALLET_FEED_SCHEMA, policy: RECOVERY_POLICY, ledgerVersion: LEDGER_VERSION,
    status: 'unavailable', complete: false, chainId: c.chainId, token: address(c.token), distributor: address(c.distributor),
    checkpoint: null, generatedAt: now, expiresAt: null, accounts: {}};
}

/** Optional delivery of public-only JSON; secrets never enter the feed, URL or errors. */
export async function publishWalletFeed(feed, {url, token, fetchImpl = globalThis.fetch, timeoutMs = 10000} = {}) {
  let target;
  try { target = new URL(url); } catch { throw Error('Invalid wallet feed publisher configuration'); }
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash
    || target.pathname !== '/api/wallet-snapshot' || typeof token !== 'string' || token.length < 32 || /\s/.test(token)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    throw Error('Invalid wallet feed publisher configuration');
  const body = JSON.stringify(feed);
  if (Buffer.byteLength(body, 'utf8') > MAX_WALLET_FEED_BYTES) throw Error('Wallet feed exceeds delivery capacity');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target.href, {method: 'PUT', redirect: 'error', signal: controller.signal,
      headers: {'authorization': `Bearer ${token}`, 'content-type': 'application/json'}, body});
    if (response.status !== 200) throw Error('Publish rejected');
    const acknowledgement = await response.json();
    if (!object(acknowledgement) || !['stored', 'unchanged'].includes(acknowledgement.status)
      || acknowledgement.generatedAt !== feed.generatedAt) throw Error('Invalid acknowledgement');
    if (acknowledgement.status === 'stored' && (feed.checkpoint === null ? acknowledgement.checkpoint !== null
      : !object(acknowledgement.checkpoint) || !['blockNumber', 'blockHash', 'timestamp'].every(key => acknowledgement.checkpoint[key] === feed.checkpoint[key])))
      throw Error('Publication checkpoint mismatch');
  } catch { throw Error('Wallet feed publication failed'); }
  finally { clearTimeout(timer); }
}

/** Separate from payout state and custody: deployment verification uses an address-only stub. */
export async function runWalletFeedCycle(provider, c, dir, {now, publisher = null} = {}) {
  const release = acquireLock(path.join(dir, 'wallet-feed.lock'));
  const currentTime = () => now ?? Math.floor(Date.now() / 1000);
  let feed, state;
  try {
    try {
      const policy = executionPolicy(c);
      await verifyExecution(provider, {getAddress: async () => policy.operator}, c, policy);
      const file = path.join(dir, 'wallet-snapshot-cache.json');
      const snapshot = await buildSnapshot(provider, c, readSnapshot(file, c));
      const paymentFile = path.join(dir, 'wallet-payments-cache.json');
      const payments = await collectFinalizedPayments(provider, c, snapshot, readSnapshot(paymentFile, c));
      feed = buildWalletFeed(c, snapshot, payments, {now: currentTime()});
      writeSnapshot(file, c, snapshot);
      writeSnapshot(paymentFile, c, payments);
      state = 'exported';
    } catch {
      feed = unavailableWalletFeed(c, currentTime()); state = 'unavailable';
    }
    atomicWrite(path.join(dir, 'recovery-snapshot.json'), feed);
    if (publisher) {
      try { await publishWalletFeed(feed, publisher); if (state === 'exported') state = 'published'; }
      catch { state = 'publication-failed'; }
    }
    const status = {state, checkedAt: new Date(feed.generatedAt * 1000).toISOString(), checkpoint: feed.checkpoint,
      reason: state === 'unavailable' ? 'Verified recovery data unavailable; no wallet values published'
        : state === 'publication-failed' ? 'Feed delivery failed; remote data will expire' : null};
    atomicWrite(path.join(dir, 'wallet-feed-status.json'), status);
    return status;
  } finally { release(); }
}

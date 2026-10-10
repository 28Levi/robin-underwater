import {canonicalLaunchJson, validateLaunchManifest, launchManifestHash} from '../src/launch-manifest.mjs';
import {CHAIN_ID, LAUNCH_WALLET, OPERATOR, ANCHOR, MANAGER, MANAGER_HASH} from './guards.mjs';

export {CHAIN_ID, ANCHOR, MANAGER};
export const DISTRIBUTOR = '0x62C12ae94CcbbE470CC1857261Fae9E36074Fb36';
export const DISTRIBUTOR_HASH = '0x66185b6a0594742a3d828569800982b6f1eaab8aca8ef7b8aa14c0dc0ae7a7f8';
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hex = n => `0x${BigInt(n).toString(16)}`;
const digest = (value, ethers) => ethers.keccak256(ethers.toUtf8Bytes(canonicalLaunchJson(value)));
const seconds = value => Number(BigInt(value));
const assert = (condition, message) => { if (!condition) throw Error(message); };

export function validateReviewManifest(manifest, expectedHash, ethers) {
  validateLaunchManifest(manifest);
  assert(launchManifestHash(manifest, ethers) === expectedHash, 'The immutable review manifest changed. Reopen the reviewed handoff.');
  assert(same(manifest.transaction.from, LAUNCH_WALLET) && same(manifest.operator, OPERATOR)
    && same(manifest.components.distributor.address, DISTRIBUTOR)
    && manifest.components.distributor.runtimeCodeHash === DISTRIBUTOR_HASH,
  'Launch wallet, operator or existing ROBIN rewards contract changed.');
  return manifest;
}

/** Validate an authenticated, freshly reread response 1.2. No legacy launch API is accepted. */
export function validateLaunchPackage(pkg, manifest, expectedHash, ethers, now = Date.now()) {
  validateReviewManifest(manifest, expectedHash, ethers);
  const r = pkg?.resource, p = r?.plan, t = r?.steps?.[0]?.transaction, pin = manifest.transaction;
  assert(r?.schemaVersion === 'programmable.custom-launch-plan-resource.v1'
    && r.planId === manifest.planId && r.planHash === manifest.planHash
    && r.rawRequestSha256 === manifest.requestSha256 && r.manifestDigest === manifest.platformManifestDigest
    && r.status === 'wallet_action_ready' && r.continuation === undefined,
  'Current platform resource is not the exact reviewed, wallet-ready ROBIN plan.');
  assert(p?.schemaVersion === 'programmable.custom-launch-plan.v1' && p.chainId === '4663'
    && p.manifestDigest === manifest.platformManifestDigest && p.executor === 'atomic_execute_and_stamp_v2'
    && p.controller?.kind === 'eoa' && same(p.controller.address, pin.from)
    && p.admissionPolicy === 'programmable.custom-launch-policy.provenance.v1'
    && Array.isArray(p.feeObligations) && p.feeObligations.length === 0,
  'Only the exact one-transaction Robinhood Atomic launch is supported.');
  assert(p.publication?.name === 'ROBINHOOK' && p.publication.symbol === 'ROBIN' && p.publication.visibility === 'listed'
    && digest(p.publication, ethers) === manifest.projectMetadataHash && digest(p.budgets, ethers) === manifest.fundingPlanHash
    && p.budgets.maxTotalValue === pin.valueWei && BigInt(p.budgets.maxTotalGas) >= BigInt(pin.gasLimit),
  'Token identity, metadata or funding budget changed.');
  const components = p.components;
  assert(Array.isArray(components), 'Missing exact deployment predictions.');
  for (const name of ['token', 'hook', 'initializer', 'feeVault']) {
    const matches = components.filter(c => same(c.expectedAddress, manifest.components[name].address));
    assert(matches.length === 1 && matches[0].runtimeCodeHash === manifest.components[name].runtimeCodeHash,
      `Predicted ${name} address or code changed.`);
  }
  assert(Array.isArray(r.steps) && r.steps.length === 1 && r.steps[0].stepId === pin.stepId
    && r.steps[0].status === 'wallet_action_ready' && r.steps[0].transactionHash === null
    && r.steps[0].transactionDigest === pin.transactionDigest
    && r.steps[0].controller?.kind === 'eoa' && same(r.steps[0].controller.address, pin.from)
    && t?.chainId === '4663' && same(t.from, pin.from) && same(t.to, pin.to)
    && t.nonce === pin.nonce && t.value === pin.valueWei && t.gasLimit === pin.gasLimit
    && /^0x(?:[0-9a-f]{2})+$/.test(t.data) && t.data.startsWith('0x506aba45')
    && ethers.keccak256(t.data) === pin.calldataHash
    && seconds(t.deadline) * 1000 === Date.parse(pin.expiresAt),
  'The current wallet transaction differs from the reviewed Atomic transaction.');
  const review = r.manualReview, admission = r.admission, preflight = r.preflight;
  assert(review?.state === 'approved' && review.chainId === '4663' && same(review.controller, pin.from)
    && review.requiresRepack !== true && review.supersededBy === undefined,
  'Platform review is not currently approved. No wallet action can open.');
  assert(admission?.planHash === manifest.planHash && admission.rawRequestSha256 === manifest.requestSha256
    && admission.manifestDigest === manifest.platformManifestDigest && admission.chainId === '4663'
    && same(admission.controller, pin.from), 'Current platform admission does not match the reviewed plan.');
  assert(preflight?.planHash === manifest.planHash && preflight.manifestDigest === manifest.platformManifestDigest
    && preflight.launchEligibility?.status === 'ready' && Array.isArray(preflight.launchEligibility.hardBlockers)
    && preflight.launchEligibility.hardBlockers.length === 0
    && r.walletAuthorization?.atomicPreparation && r.walletAuthorization?.executionOrder,
  'Current Atomic preparation or platform preflight is unavailable.');
  const age = now - Date.parse(pkg.checkedAt), expiry = Date.parse(pin.expiresAt);
  const approvedAt = Date.parse(review.approvedAt), reviewExpiry = Date.parse(review.expiresAt);
  assert(Number.isFinite(age) && age >= -30000 && age <= 60000, 'Fresh platform validation is required.');
  assert(Number.isFinite(approvedAt) && approvedAt <= now + 30000 && Number.isFinite(reviewExpiry)
    && reviewExpiry > approvedAt && reviewExpiry - approvedAt <= 86400000
    && Number.isFinite(expiry) && expiry - now >= 90000 && expiry <= reviewExpiry
    && expiry <= Date.parse(admission.expiresAt) && Date.parse(admission.issuedAt) <= now + 30000
    && seconds(p.budgets.validAfter) * 1000 <= now && seconds(p.budgets.deadline) * 1000 >= expiry,
  'The launch authorization is stale, expired or about to expire. Prepare a fresh reviewed handoff.');
  return r;
}

/** All RPC observations are made again immediately before the user's wallet request. */
export function boundedLaunchTransaction(pkg, manifest, expectedHash, state, ethers, now = Date.now()) {
  const r = validateLaunchPackage(pkg, manifest, expectedHash, ethers, now), pin = manifest.transaction;
  assert(same(state.account, pin.from) && state.chainId === CHAIN_ID, 'Connect the displayed launch wallet on Robinhood Chain.');
  assert(state.anchor?.hash === ANCHOR.hash && ethers.keccak256(state.managerCode) === MANAGER_HASH
    && ethers.keccak256(state.routerCode) === pin.routerRuntimeCodeHash
    && ethers.keccak256(state.factoryCode) === manifest.infrastructure.graphDeployer.runtimeCodeHash && state.senderCode === '0x',
  'Chain identity, launch executor or wallet authority changed.');
  assert(ethers.keccak256(state.distributorCode) === manifest.components.distributor.runtimeCodeHash
    && state.distributorBlock?.hash === manifest.distributorDeployment.blockHash
    && same(state.distributorOperator, manifest.operator), 'Existing rewards contract, operator or canonical deployment changed.');
  assert(state.watchBlock?.hash === manifest.watchFrom.blockHash, 'The reviewed launch discovery checkpoint is no longer canonical.');
  for (const name of ['token', 'hook', 'initializer', 'feeVault']) {
    assert(state.componentCodes?.[name] === '0x', `${name} is already deployed. Reconcile the existing launch before retrying.`);
  }
  assert(BigInt(state.latestNonce) === BigInt(pin.nonce) && BigInt(state.pendingNonce) === BigInt(pin.nonce),
    'Wallet nonce changed or a transaction is pending. Reconcile before retrying.');
  const headTime = seconds(state.head?.timestamp) * 1000, finalTime = seconds(state.finalized?.timestamp) * 1000;
  assert(headTime <= now + 30000 && now - headTime <= 300000 && finalTime <= headTime
    && now - finalTime <= manifest.accounting.maxFinalityLagSeconds * 1000
    && BigInt(state.finalized.number) <= BigInt(state.head.number)
    && BigInt(state.finalized.number) >= BigInt(manifest.distributorDeployment.blockNumber)
    && BigInt(state.finalized.number) >= BigInt(manifest.watchFrom.blockNumber), 'Wallet RPC, finalized block or local clock is stale.');
  const estimate = BigInt(state.gasEstimate), gas = BigInt(pin.gasLimit);
  const price = (BigInt(state.gasPrice) * 125n + 99n) / 100n, maximumCost = gas * price;
  assert(estimate > 0n && gas >= (estimate * 120n + 99n) / 100n && price > 0n
    && maximumCost <= BigInt(manifest.maxLaunchGasWei), 'Fresh gas estimate does not fit the exact transaction and approved gas budget.');
  assert(BigInt(state.balance) >= BigInt(manifest.preserveLaunchBalanceWei) + BigInt(pin.valueWei) + maximumCost,
    'Insufficient launch balance while preserving the reviewed reserve.');
  if (manifest.activation.mode === 'after-reviewed-launch') {
    assert(BigInt(state.operatorBalance) >= BigInt(manifest.execution.maxTotalGasWei), 'Operator balance is below the reviewed automatic payout budget.');
  }
  return {transaction: {from: pin.from, to: pin.to, chainId: CHAIN_ID, data: r.steps[0].transaction.data,
    value: hex(pin.valueWei), nonce: hex(pin.nonce), gas: hex(gas), gasPrice: hex(price)}, maximumCost};
}

// A new plan or refreshed permit must not bypass an uncertain send for the same wallet nonce.
export function launchSubmissionKey(manifest) {
  return `robin-launch:4663:${manifest.transaction.from.toLowerCase()}:${manifest.transaction.nonce}`;
}

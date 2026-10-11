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
const framedSha = (domain, value, ethers) => `sha256:${ethers.sha256(ethers.concat([
  ethers.toUtf8Bytes(domain + '\0'), ethers.toUtf8Bytes(canonicalLaunchJson(value)),
])).slice(2)}`;
const ATOMIC_ABI = ['function executeAndStampV2((uint256 chainId,address executor,bytes32 executorRuntimeCodeHash,address controller,bytes32 controllerRuntimeCodeHash,bytes32 launchId,bytes32 planHash,bytes32 manifestDigest,bytes32 callsHash,uint256 totalValue,bytes32 componentsHash,bytes32 marketsHash,bytes32 effectsHash,bytes32 feeObligationsHash,bytes32 nonce,uint64 validAfter,uint64 deadline) order,(address target,bytes32 targetRuntimeCodeHash,uint256 value,uint256 gasLimit,bytes data)[] calls,(bytes32 componentId,address account,bytes32 runtimeCodeHash)[] components,(bytes32 marketId,address poolManager,address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)[] markets,bytes platformSignature) payable returns(bytes32 stampHash)'];

/** The published V1.2 resource explicitly permits preflight:null. In that case,
 * require the issued evidence for this exact signed Atomic transaction instead. */
export function validateAdmittedAtomicEvidence(r, manifest, ethers) {
  const e = r.admissionEvidence, a = r.admission, p = r.plan, pin = manifest.transaction;
  const wa = r.walletAuthorization, prep = wa?.atomicPreparation, order = wa?.executionOrder;
  assert(e?.schemaVersion === 'programmable.custom-launch-plan-evidence.v1'
    && a?.schemaVersion === 'programmable.custom-launch-plan-admission.v1'
    && e.planHash === manifest.planHash && e.manifestDigest === manifest.platformManifestDigest
    && a.evidenceDigest === framedSha(e.schemaVersion, e, ethers)
    && canonicalLaunchJson(e.walletAuthorization) === canonicalLaunchJson(wa)
    && canonicalLaunchJson(e.assuranceClaims) === canonicalLaunchJson(a.assuranceClaims),
  'Issued Atomic evidence is missing or differs from the admission receipt.');
  assert(Array.isArray(e.transactionDigests) && e.transactionDigests.length === 1 && e.transactionDigests[0] === pin.transactionDigest
    && e.simulation?.chainId === '4663' && e.simulation.planHash === manifest.planHash
    && Array.isArray(e.simulation.violations) && e.simulation.violations.length === 0
    && e.simulation.steps?.length === 1 && e.simulation.steps[0].stepId === pin.stepId
    && e.simulation.steps[0].transactionDigest === pin.transactionDigest && e.simulation.steps[0].outcome === 'success'
    && e.inspection?.chainId === '4663' && e.simulation.blockHash === e.inspection.blockHash
    && e.simulation.blockNumber === e.inspection.blockNumber && same(e.inspection.controller?.address, pin.from)
    && e.inspection.controller?.nonce === pin.nonce,
  'Issued Atomic evidence does not establish this exact successful wallet transaction.');
  assert(prep && order && canonicalLaunchJson(prep.order) === canonicalLaunchJson(order)
    && prep.sourceEvidenceDigest === e.compilationDigest && /^sha256:[0-9a-f]{64}$/.test(e.compilationDigest)
    && prep.binding?.policyBindingHash === e.policyBindingHash && /^sha256:[0-9a-f]{64}$/.test(e.policyBindingHash)
    && prep.binding.chainId === '4663' && prep.binding.manifestDigest === manifest.platformManifestDigest
    && same(prep.binding.address, pin.to) && prep.binding.runtimeCodeHash === pin.routerRuntimeCodeHash
    && same(prep.binding.poolManager, MANAGER) && prep.binding.poolManagerRuntimeCodeHash === MANAGER_HASH
    && same(prep.binding.permitAuthority, '0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06')
    && prep.binding.permitAuthorityRuntimeCodeHash === '0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c'
    && order.chainId === '4663' && same(order.controller, pin.from) && order.controllerRuntimeCodeHash === ethers.ZeroHash
    && same(order.executor, pin.to) && order.executorRuntimeCodeHash === pin.routerRuntimeCodeHash
    && order.planHash === '0x' + manifest.planHash.slice(7) && order.manifestDigest === '0x' + manifest.platformManifestDigest.slice(7)
    && order.totalValue === pin.valueWei && order.validAfter === p.budgets.validAfter && order.deadline === p.budgets.deadline
    && seconds(order.deadline) * 1000 === Date.parse(pin.expiresAt),
  'Issued Atomic preparation is not bound to the reviewed source, controller, runtime, value and window.');
  const policy = a.assuranceClaims.filter(c => c.claimType === 'launch_admission_policy');
  assert(policy.length === 1 && policy[0].status === 'verified' && policy[0].subject === manifest.planHash
    && policy[0].observedValue === p.admissionPolicy, 'Verified launch admission policy claim is missing.');
  for (const component of p.components) {
    const claims = a.assuranceClaims.filter(c => c.claimType === 'source_matches_creation_and_runtime' && c.subject === component.componentId);
    assert(claims.length === 1 && claims[0].status === 'verified' && claims[0].observedValue === component.runtimeCodeHash
      && claims[0].witness?.details?.compilationDigest === e.compilationDigest,
    'Issued Atomic source/runtime evidence differs from the reviewed components.');
  }
  if (r.replan) assert(canonicalLaunchJson(e.replan) === canonicalLaunchJson(r.replan), 'Issued Atomic evidence belongs to a different replan.');
  const atomic = new ethers.Interface(ATOMIC_ABI), data = r.steps[0].transaction.data;
  let decoded;
  try { decoded = atomic.decodeFunctionData('executeAndStampV2', data); }
  catch { throw Error('Issued Atomic calldata cannot be decoded.'); }
  assert(decoded.platformSignature !== '0x' && ethers.getBytes(decoded.platformSignature).length <= 16384
    && atomic.encodeFunctionData('executeAndStampV2', [order, prep.calls, prep.components, prep.markets, decoded.platformSignature]) === data,
  'Issued Atomic order and snapshots do not match the exact signed calldata.');
  return true;
}

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
    && review.requiresRepack !== true && (review.supersededBy === undefined || review.supersededBy === null),
  'Platform review is not currently approved. No wallet action can open.');
  assert(admission?.planHash === manifest.planHash && admission.rawRequestSha256 === manifest.requestSha256
    && admission.manifestDigest === manifest.platformManifestDigest && admission.chainId === '4663'
    && same(admission.controller, pin.from), 'Current platform admission does not match the reviewed plan.');
  assert(r.walletAuthorization?.atomicPreparation && r.walletAuthorization?.executionOrder,
    'Current Atomic preparation is unavailable.');
  const admissionExpiry = Date.parse(admission.expiresAt);
  if (preflight === null) validateAdmittedAtomicEvidence(r, manifest, ethers);
  else {
    assert(preflight?.planHash === manifest.planHash && preflight.manifestDigest === manifest.platformManifestDigest
      && preflight.launchEligibility?.status === 'ready' && Array.isArray(preflight.launchEligibility.hardBlockers)
      && preflight.launchEligibility.hardBlockers.length === 0, 'Current platform preflight is unavailable or not ready.');
    if (Date.parse(pin.expiresAt) > admissionExpiry) validateAdmittedAtomicEvidence(r, manifest, ethers);
  }
  const age = now - Date.parse(pkg.checkedAt), expiry = Date.parse(pin.expiresAt);
  const approvedAt = Date.parse(review.approvedAt), reviewExpiry = Date.parse(review.expiresAt);
  assert(Number.isFinite(age) && age >= -30000 && age <= 60000, 'Fresh platform validation is required.');
  assert(Number.isFinite(approvedAt) && approvedAt <= now + 30000 && Number.isFinite(reviewExpiry)
    && reviewExpiry > approvedAt && reviewExpiry - approvedAt <= 86400000
    && Number.isFinite(expiry) && expiry - now >= 90000 && expiry <= reviewExpiry
    && Number.isFinite(admissionExpiry) && admissionExpiry > now && Date.parse(admission.issuedAt) <= now + 30000
    && Date.parse(admission.issuedAt) < admissionExpiry
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

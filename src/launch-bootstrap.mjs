import fs from 'node:fs';
import path from 'node:path';
import * as ethers from 'ethers';
import {address, ZERO} from './ledger.mjs';
import {atomicWrite, acquireLock} from './store.mjs';
import {executionBinding} from './execution-journal.mjs';
import {executionPolicy} from './executor.mjs';
import {verifyProductionNetwork, verifyProductionToken, POOL_MANAGER} from './production-network.mjs';
import {canonicalLaunchJson, validateLaunchManifest, launchManifestHash, validateLaunchConsent, effectiveWorkerSourceRevision} from './launch-manifest.mjs';

const HASH = /^0x[0-9a-f]{64}$/;
const supportedEnvelope = transaction => [0, 2].includes(transaction.type)
  && (transaction.type !== 0 || transaction.maxFeePerGas == null && transaction.maxPriorityFeePerGas == null)
  && ['accessList', 'authorizationList', 'blobVersionedHashes'].every(key => transaction[key] == null
    || Array.isArray(transaction[key]) && transaction[key].length === 0)
  && ['blobs', 'sidecars'].every(key => transaction[key] === undefined);
const digest = value => `sha256:${ethers.sha256(ethers.toUtf8Bytes(canonicalLaunchJson(value))).slice(2)}`;
const transfers = new ethers.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const initializerAbi = ['function initialBuyer() view returns(address)', 'function initialBuyWei() view returns(uint256)',
  'function initialTokensOut() view returns(uint256)', 'function minimumInitialTokensOut() view returns(uint256)',
  'function initialized() view returns(bool)', 'function token() view returns(address)', 'function hook() view returns(address)',
  'function lockedLiquidity() view returns(uint128)', 'function seededTokenAmount() view returns(uint256)', 'function graphFactory() view returns(address)'];
const vaultAbi = ['function creatorRecipient() view returns(address)', 'function PLATFORM_RECIPIENT() view returns(address)'];
const distributorAbi = ['function operator() view returns(address)', 'function reserved() view returns(uint256)'];
const launchGuardAbi = ['function EARLY_BUY_WINDOW() view returns(uint256)', 'function publicBuysAt() view returns(uint256)',
  'function CANONICAL_EARLY_BUY_ROUTER() view returns(address)', 'function CANONICAL_EARLY_BUY_ROUTER_CODE_HASH() view returns(bytes32)',
  ...[0, 1, 2, 3, 4].map(index => `function earlyBuyer${index}() view returns(address)`)];
const expectedLaunchGuardProof = (manifest, timestamp) => ({policyVerified: true,
  windowSeconds: manifest.launchGuard.windowSeconds, publicBuysAt: timestamp + manifest.launchGuard.windowSeconds,
  initialBuyRecipient: address(manifest.launchGuard.initialBuyRecipient), allowedBuyers: manifest.launchGuard.allowedBuyers.map(address),
  router: address(manifest.launchGuard.router), routerCodeHash: manifest.launchGuard.routerCodeHash});

function readState(file, manifest, manifestSha256) {
  if (!fs.existsSync(file)) return {manifestSha256, cursor: {number: manifest.watchFrom.blockNumber, hash: manifest.watchFrom.blockHash}, transactionHash: null};
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  const state = envelope.state;
  if (envelope.schemaVersion !== 'robinhook.launch-watch-state.v1' || envelope.checksum !== digest(state)
    || state?.manifestSha256 !== manifestSha256 || !Number.isSafeInteger(state.cursor?.number)
    || state.cursor.number < manifest.watchFrom.blockNumber || !HASH.test(state.cursor.hash)
    || !(state.transactionHash === null || HASH.test(state.transactionHash))) throw Error('Launch watcher state requires reconciliation');
  return state;
}
function writeState(file, state) { atomicWrite(file, {schemaVersion: 'robinhook.launch-watch-state.v1', checksum: digest(state), state}); }
function writeImmutable(file, value) {
  if (fs.existsSync(file)) {
    if (canonicalLaunchJson(JSON.parse(fs.readFileSync(file, 'utf8'))) !== canonicalLaunchJson(value))
      throw Error('Existing launch configuration or gate differs; preserve and reconcile it');
  } else atomicWrite(file, value);
}

/** Addresses come only from the reviewed predictions, never user-entered post-launch values. */
export function productionConfigFromLaunch(manifest, proof, {broadcastEnabled = false} = {}) {
  const m = validateLaunchManifest(manifest), manifestSha256 = launchManifestHash(m, ethers);
  if (proof?.schemaVersion !== 'robinhook.launch-proof.v1' || proof.manifestSha256 !== manifestSha256 || proof.verified !== true
    || proof.finalized !== true || !HASH.test(proof.transactionHash) || !Number.isSafeInteger(proof.checkpoint?.blockNumber)
    || !HASH.test(proof.checkpoint?.blockHash) || !Number.isSafeInteger(proof.checkpoint?.timestamp) || proof.checkpoint.timestamp < 0
    || m.execution.payoutIntervalSeconds !== undefined && proof.checkpoint.timestamp === 0
    || proof.checkpoint.blockNumber <= m.watchFrom.blockNumber || typeof broadcastEnabled !== 'boolean')
    throw Error('A verified exact launch proof is required');
  if (m.launchGuard && canonicalLaunchJson(proof.launchGuard ?? null) !== canonicalLaunchJson(expectedLaunchGuardProof(m, proof.checkpoint.timestamp)))
    throw Error('Verified launch guard policy and initialization clock are required');
  const component = name => address(m.components[name].address);
  const config = {name: m.name, symbol: m.symbol, chainId: m.chainId, rpcUrlEnvironment: 'ROBIN_RPC_URL',
    // This selects the compatible receipt ABI; exact runtime and 170/30 fees are checked separately.
    token: component('token'), hook: component('hook'), initializer: component('initializer'), hookFlavor: 'native20',
    distributor: component('distributor'), poolManager: address(POOL_MANAGER),
    poolId: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint24', 'int24', 'address'],
      [ZERO, component('token'), 0, 60, component('hook')])), deploymentBlock: proof.checkpoint.blockNumber,
    ...(m.execution.payoutIntervalSeconds === undefined ? {} : {payoutStartTimestamp: proof.checkpoint.timestamp}),
    ...m.accounting, excludedAddresses: [...new Set([...m.accounting.excludedAddresses.map(address), component('initializer'), component('feeVault')])].sort(),
    execution: {mode: 'production', broadcastEnabled, operator: address(m.operator), feeVault: component('feeVault'),
      codeHashes: Object.fromEntries(Object.entries(m.components).map(([name, item]) => [name, item.runtimeCodeHash])), ...m.execution}};
  executionPolicy(config);
  return config;
}

/** Exact transaction and finalized runtime/state verification. No signer is accepted. */
export async function verifyLaunchReceipt(provider, manifest, transactionHash, {now = Math.floor(Date.now() / 1000)} = {}) {
  const m = validateLaunchManifest(manifest), manifestSha256 = launchManifestHash(m, ethers);
  if (!HASH.test(transactionHash)) throw Error('Invalid launch transaction hash');
  const {finalized} = await verifyProductionNetwork(provider, {chainId: m.chainId, poolManager: POOL_MANAGER,
    maxFinalityLagSeconds: m.accounting.maxFinalityLagSeconds}, {now});
  const [transaction, receipt, origin] = await Promise.all([provider.getTransaction(transactionHash), provider.getTransactionReceipt(transactionHash),
    provider.getBlock(m.watchFrom.blockNumber)]);
  if (!origin || origin.hash !== m.watchFrom.blockHash) throw Error('Launch discovery anchor changed');
  if (!transaction || !receipt) return {state: 'waiting-for-receipt'};
  if (receipt.blockNumber > finalized.number) return {state: 'waiting-for-finality'};
  const block = await provider.getBlock(receipt.blockNumber), t = m.transaction;
  if (!block || !Number.isSafeInteger(block.number) || !Number.isSafeInteger(block.timestamp) || block.timestamp < 0
    || block.hash !== receipt.blockHash || receipt.blockNumber <= m.watchFrom.blockNumber || receipt.status !== 1
    || (receipt.hash ?? receipt.transactionHash) !== transactionHash || transaction.hash !== transactionHash
    || transaction.blockHash !== block.hash || transaction.blockNumber !== block.number || transaction.chainId !== 4663n
    || address(transaction.from) !== address(t.from) || address(transaction.to ?? ZERO) !== address(t.to)
    || address(receipt.from) !== address(t.from) || address(receipt.to ?? ZERO) !== address(t.to)
    || BigInt(transaction.nonce) !== BigInt(t.nonce) || transaction.value !== BigInt(t.valueWei)
    || ethers.keccak256(transaction.data) !== t.calldataHash || !supportedEnvelope(transaction) || transaction.gasLimit < 21000n
    || block.timestamp > Math.floor(Date.parse(t.expiresAt) / 1000)) throw Error('Finalized transaction differs from the reviewed launch');
  const token = address(m.components.token.address), initializer = address(m.components.initializer.address);
  if (await provider.getCode(token, m.watchFrom.blockNumber) !== '0x') throw Error('Predicted token existed before this reviewed launch');
  for (const [name, item] of Object.entries(m.components)) {
    const [atLaunch, current] = await Promise.all([provider.getCode(item.address, block.number), provider.getCode(item.address, finalized.number)]);
    if (atLaunch === '0x' || current === '0x' || ethers.keccak256(atLaunch) !== item.runtimeCodeHash
      || ethers.keccak256(current) !== item.runtimeCodeHash) throw Error(`Launch ${name} runtime differs from the reviewed prediction`);
  }
  if (ethers.keccak256(await provider.getCode(t.to, block.number)) !== t.routerRuntimeCodeHash)
    throw Error('Launch executor runtime differs from the reviewed platform deployment');
  if (ethers.keccak256(await provider.getCode(m.infrastructure.graphDeployer.address, block.number)) !== m.infrastructure.graphDeployer.runtimeCodeHash)
    throw Error('Launch graph deployer runtime differs from the reviewed platform deployment');
  const deployment = m.distributorDeployment;
  const [distributorReceipt, distributorBlock] = await Promise.all([
    provider.getTransactionReceipt(deployment.transactionHash), provider.getBlock(deployment.blockNumber),
  ]);
  if (!distributorReceipt || (distributorReceipt.hash ?? distributorReceipt.transactionHash) !== deployment.transactionHash
    || distributorReceipt.status !== 1 || distributorReceipt.blockNumber !== deployment.blockNumber
    || distributorReceipt.blockHash !== deployment.blockHash || distributorBlock?.hash !== deployment.blockHash
    || address(distributorReceipt.contractAddress ?? ZERO) !== address(m.components.distributor.address))
    throw Error('Existing distributor deployment proof changed');
  const pinned = {call: request => provider.call({...request, blockTag: block.number})};
  const proof = {schemaVersion: 'robinhook.launch-proof.v1', manifestSha256, verified: true, finalized: true,
    transactionHash, checkpoint: {blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp},
    ...(m.launchGuard ? {launchGuard: expectedLaunchGuardProof(m, block.timestamp)} : {})};
  const config = productionConfigFromLaunch(m, proof);
  await verifyProductionToken(pinned, config);
  const init = new ethers.Contract(initializer, initializerAbi, pinned), feeVault = new ethers.Contract(m.components.feeVault.address, vaultAbi, pinned);
  const distributor = new ethers.Contract(m.components.distributor.address, distributorAbi, pinned);
  const hook = new ethers.Contract(m.components.hook.address, ['function feeVault() view returns(address)'], pinned);
  const [buyer, initialBuy, received, minimum, initialized, initToken, initHook, liquidity, seeded, factory, recipient, platform, operator, hookVault] = await Promise.all([
    init.initialBuyer(), init.initialBuyWei(), init.initialTokensOut(), init.minimumInitialTokensOut(), init.initialized(), init.token(), init.hook(),
    init.lockedLiquidity(), init.seededTokenAmount(), init.graphFactory(), feeVault.creatorRecipient(), feeVault.PLATFORM_RECIPIENT(), distributor.operator(), hook.feeVault(),
  ]);
  const initialBuyRecipient = m.launchGuard ? m.launchGuard.initialBuyRecipient : t.from;
  if (!initialized || address(buyer) !== address(initialBuyRecipient) || initialBuy !== BigInt(t.valueWei) || minimum !== BigInt(m.minimumTokensOut)
    || received < minimum || address(initToken) !== token || address(initHook) !== address(config.hook) || liquidity <= 0n || seeded <= 0n
    || address(factory) !== address(m.infrastructure.graphDeployer.address)
    || address(recipient) !== address(config.distributor) || address(platform) !== address(m.platformRecipient) || address(operator) !== address(m.operator)
    || address(hookVault) !== address(config.execution.feeVault)) throw Error('Launch initialization or fee destinations differ from reviewed policy');
  if (m.launchGuard) {
    const guard = new ethers.Contract(m.components.hook.address, launchGuardAbi, pinned), policy = m.launchGuard;
    const [window, opensAt, router, routerHash, buyers, routerAtLaunch, routerCurrent] = await Promise.all([
      guard.EARLY_BUY_WINDOW(), guard.publicBuysAt(), guard.CANONICAL_EARLY_BUY_ROUTER(), guard.CANONICAL_EARLY_BUY_ROUTER_CODE_HASH(),
      Promise.all([0, 1, 2, 3, 4].map(index => guard[`earlyBuyer${index}`]())),
      provider.getCode(policy.router, block.number), provider.getCode(policy.router, finalized.number),
    ]);
    if (window !== BigInt(policy.windowSeconds) || opensAt !== BigInt(block.timestamp) + window
      || address(router) !== address(policy.router) || routerHash !== policy.routerCodeHash
      || buyers.some((value, index) => address(value) !== address(policy.allowedBuyers[index]))
      || ethers.keccak256(routerAtLaunch) !== policy.routerCodeHash || ethers.keccak256(routerCurrent) !== policy.routerCodeHash)
      throw Error('Launch guard policy, router or initialization clock differs from the reviewed launch');
  }
  let minted = 0n, initialTransfers = 0n;
  for (const log of receipt.logs) {
    if (address(log.address) !== token) continue;
    let event; try { event = transfers.parseLog(log); } catch {}
    if (event?.name !== 'Transfer') continue;
    if (address(event.args.from) === ZERO) {
      if (address(event.args.to) !== initializer) throw Error('Launch minted inventory to the wrong owner');
      minted += event.args.value;
    }
    if (address(event.args.to) === address(initialBuyRecipient)) initialTransfers += event.args.value;
  }
  if (minted !== 10n ** 27n || initialTransfers !== received) throw Error('Launch receipt inventory or initial purchase differs');
  const priorVault = new ethers.Contract(config.distributor, distributorAbi, provider);
  if (await priorVault.reserved({blockTag: block.number - 1}) !== 0n) throw Error('Launch distributor has previous campaign pending rewards');
  const rawReceipt = await provider.send('eth_getTransactionReceipt', [transactionHash]);
  if (!rawReceipt || rawReceipt.blockHash !== block.hash || rawReceipt.transactionHash !== transactionHash || BigInt(rawReceipt.status) !== 1n)
    throw Error('Raw launch receipt is inconsistent');
  const additionalFee = BigInt(rawReceipt.l1Fee ?? '0x0'), gasPrice = receipt.gasPrice;
  const maxFee = transaction.type === 2 ? transaction.maxFeePerGas : transaction.gasPrice;
  const priorityFee = transaction.maxPriorityFeePerGas;
  if (gasPrice === null || gasPrice === undefined || maxFee === null || maxFee === undefined || maxFee <= 0n || gasPrice <= 0n
    || transaction.type === 2 && (priorityFee === null || priorityFee === undefined || priorityFee < 0n || priorityFee > maxFee)
    || gasPrice > maxFee || receipt.gasUsed <= 0n || receipt.gasUsed > transaction.gasLimit || additionalFee < 0n
    || BigInt(rawReceipt.blobGasUsed ?? 0) !== 0n || BigInt(rawReceipt.blobGasPrice ?? 0) !== 0n)
    throw Error('Launch gas evidence unavailable');
  // Wallets may adjust the outer gas estimate. Successful execution and
  // gasUsed <= gasLimit prove adequacy; the signed maximum liability, not just
  // the cheaper mined cost, must fit the original reviewed ETH ceiling. The
  // calldata hash above still pins the signed order and inner Graph call gas.
  // Legacy gasPrice remains supported for the existing local review UI; type2
  // uses maxFeePerGas rather than its cheaper mined effective gas price.
  const gasCost = receipt.gasUsed * gasPrice + additionalFee, gasLiability = transaction.gasLimit * maxFee + additionalFee;
  if (gasCost > BigInt(m.maxLaunchGasWei) || gasLiability > BigInt(m.maxLaunchGasWei)
    || await provider.getBalance(t.from, block.number) < BigInt(m.preserveLaunchBalanceWei)) throw Error('Launch exceeded the reviewed spending boundary');
  if ((await provider.getBlock(block.number))?.hash !== block.hash || (await provider.getBlock('finalized')).number < block.number)
    throw Error('Launch finality changed during verification');
  return {state: 'verified', proof: {...proof, initialTokensReceivedWei: received.toString(), gasCostWei: gasCost.toString(),
    gasLiabilityWei: gasLiability.toString(), signedGasLimit: transaction.gasLimit.toString(), quotedGasLimit: t.gasLimit,
    gasLimitAdjusted: transaction.gasLimit !== BigInt(t.gasLimit), poolId: config.poolId, signing: false, broadcast: false}};
}

/** The separate recorded UI review, exact finalized proof and host-approved digest are all required. */
export function operatorStartupAllowed(manifest, consent, proof, approvedManifestSha256) {
  if (manifest.activation.mode !== 'after-reviewed-launch' || !consent) return false;
  validateLaunchConsent(consent, manifest, ethers);
  const hash = launchManifestHash(manifest, ethers);
  if (approvedManifestSha256 !== hash || proof?.manifestSha256 !== hash || proof.verified !== true || proof.finalized !== true
    || consent.reviewedAt > proof.checkpoint?.timestamp + 60) return false;
  productionConfigFromLaunch(manifest, proof);
  return true;
}

/** Discover the user's exact finalized launch automatically, without a pasted hash or address. */
export async function runLaunchBootstrapCycle(provider, manifest, dir, {expectedManifestSha256, sourceRevision, consent = null,
  approvedManifestSha256 = null, now = Math.floor(Date.now() / 1000)} = {}) {
  const m = validateLaunchManifest(manifest), manifestSha256 = launchManifestHash(m, ethers);
  if (manifestSha256 !== expectedManifestSha256 || sourceRevision !== effectiveWorkerSourceRevision(m)) throw Error('Launch manifest or executing source revision changed');
  if (consent) validateLaunchConsent(consent, m, ethers);
  const release = acquireLock(path.join(dir, 'launch-bootstrap.lock'));
  try {
    const file = path.join(dir, 'launch-bootstrap-state.json'), state = readState(file, m, manifestSha256);
    const {finalized} = await verifyProductionNetwork(provider, {chainId: m.chainId, poolManager: POOL_MANAGER,
      maxFinalityLagSeconds: m.accounting.maxFinalityLagSeconds}, {now});
    const [origin, cursor] = await Promise.all([provider.getBlock(m.watchFrom.blockNumber), provider.getBlock(state.cursor.number)]);
    if (origin?.hash !== m.watchFrom.blockHash || cursor?.hash !== state.cursor.hash || state.cursor.number > finalized.number)
      throw Error('Launch watcher finalized history changed');
    if (!state.transactionHash) {
      if (await provider.getCode(m.components.token.address, m.watchFrom.blockNumber) !== '0x') throw Error('Predicted token already existed at the review checkpoint');
      const candidates = new Set();
      for (let from = state.cursor.number + 1; from <= finalized.number; from += 1000) {
        const to = Math.min(from + 999, finalized.number);
        const logs = await provider.getLogs({address: m.components.token.address, fromBlock: from, toBlock: to,
          topics: [transfers.getEvent('Transfer').topicHash, ethers.zeroPadValue(ZERO, 32)]});
        for (const log of logs) {
          if (address(log.address) !== address(m.components.token.address) || log.removed !== false || !HASH.test(log.transactionHash)
            || !Number.isSafeInteger(log.blockNumber) || log.blockNumber < from || log.blockNumber > to) throw Error('Invalid finalized launch discovery log');
          const event = transfers.parseLog(log);
          if (address(event.args.from) !== ZERO || address(event.args.to) !== address(m.components.initializer.address)
            || event.args.value !== 10n ** 27n) throw Error('Predicted token mint differs from reviewed launch');
          candidates.add(log.transactionHash);
        }
      }
      if (candidates.size > 1) throw Error('Multiple launch candidates require reconciliation');
      if (candidates.size === 1) state.transactionHash = [...candidates][0];
      else {
        if (await provider.getCode(m.components.token.address, finalized.number) !== '0x') throw Error('Deployed predicted token has no matching finalized mint evidence');
        if (await provider.getTransactionCount(m.transaction.from, finalized.number) > Number(m.transaction.nonce)) throw Error('Reviewed wallet nonce was consumed without the expected launch');
        state.cursor = {number: finalized.number, hash: finalized.hash};
        writeState(file, state);
        const status = {state: finalized.timestamp > Math.floor(Date.parse(m.transaction.expiresAt) / 1000) ? 'expired' : 'waiting-for-launch',
          manifestSha256, checkedAt: now, signing: false, broadcast: false};
        atomicWrite(path.join(dir, 'launch-bootstrap-status.json'), status);
        return status;
      }
    }
    const result = await verifyLaunchReceipt(provider, m, state.transactionHash, {now});
    if (result.state !== 'verified') return {...result, manifestSha256, signing: false, broadcast: false};
    const proof = result.proof, readOnly = productionConfigFromLaunch(m, proof);
    const readOnlyFile = path.join(dir, 'production.readonly.json'), operatorFile = path.join(dir, 'production.operator.json');
    writeImmutable(path.join(dir, 'launch-proof.json'), proof);
    writeImmutable(readOnlyFile, readOnly);
    const allowed = operatorStartupAllowed(m, consent, proof, approvedManifestSha256);
    if (allowed) {
      const active = productionConfigFromLaunch(m, proof, {broadcastEnabled: true});
      writeImmutable(operatorFile, active);
      writeImmutable(path.join(dir, 'operator-activation.json'), {schemaVersion: 'robinhook.operator-activation.v1', manifestSha256,
        consentSha256: digest(consent), transactionHash: proof.transactionHash, checkpoint: proof.checkpoint,
        executionBinding: executionBinding(active, m.operator), operator: address(m.operator)});
    }
    state.cursor = {number: finalized.number, hash: finalized.hash}; writeState(file, state);
    const status = {state: allowed ? 'ready-for-approved-services' : m.activation.mode === 'manual' ? 'verified-manual' : 'verified-awaiting-review-gate',
      manifestSha256, transactionHash: proof.transactionHash, checkedAt: now, readOnlyConfig: readOnlyFile,
      operatorConfig: allowed ? operatorFile : null, automaticRewardsApproved: allowed, signing: false, broadcast: false};
    atomicWrite(path.join(dir, 'launch-bootstrap-status.json'), status);
    return status;
  } finally { release(); }
}

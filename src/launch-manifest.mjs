// Browser-safe shared launch boundary. This module never accesses a wallet, filesystem or network.
export const LAUNCH_MANIFEST_SCHEMA = 'robinhook.launch-bootstrap.v1';
const HASH = /^0x[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = `0x${'0'.repeat(40)}`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < (1n << 256n);
const positive = value => amount(value) && BigInt(value) > 0n;
const account = value => typeof value === 'string' && ADDRESS.test(value) && value.toLowerCase() !== ZERO;
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));

export function canonicalLaunchJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalLaunchJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalLaunchJson(value[key])}`).join(',')}}`;
  throw Error('Launch manifest contains unsupported JSON values');
}

/** An exact release/transaction/automation policy, prepared before the final user wallet action. */
export function validateLaunchManifest(m) {
  if (!keys(m, ['schemaVersion', 'chainId', 'name', 'symbol', 'sourceRevision', 'planId', 'planHash', 'platformManifestDigest', 'requestSha256',
    'projectMetadataHash', 'fundingPlanHash', 'transaction', 'components', 'infrastructure', 'operator', 'platformRecipient', 'watchFrom',
    'distributorDeployment', 'preserveLaunchBalanceWei', 'fees', 'minimumTokensOut', 'maxLaunchGasWei', 'accounting', 'execution', 'activation'])
    || m.schemaVersion !== LAUNCH_MANIFEST_SCHEMA || m.chainId !== 4663 || m.name !== 'ROBINHOOK' || m.symbol !== 'ROBIN'
    || !/^[0-9a-f]{40}$/.test(m.sourceRevision) || typeof m.planId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/.test(m.planId)
    || !SHA256.test(m.planHash) || !SHA256.test(m.platformManifestDigest)
    || !SHA256.test(m.requestSha256) || !HASH.test(m.projectMetadataHash) || !HASH.test(m.fundingPlanHash)
    || !account(m.operator) || !account(m.platformRecipient) || !positive(m.minimumTokensOut)
    || !amount(m.preserveLaunchBalanceWei) || !positive(m.maxLaunchGasWei) || BigInt(m.maxLaunchGasWei) > 800000000000000n)
    throw Error('Invalid reviewed ROBIN launch manifest');
  const t = m.transaction;
  if (!keys(t, ['from', 'to', 'nonce', 'valueWei', 'calldataHash', 'routerRuntimeCodeHash', 'expiresAt', 'transactionDigest', 'apiVersion', 'stepId', 'gasLimit'])
    || !account(t.from) || !account(t.to) || !amount(t.nonce) || BigInt(t.nonce) > BigInt(Number.MAX_SAFE_INTEGER)
    || t.valueWei !== '10000000000000000' || !HASH.test(t.calldataHash) || !HASH.test(t.routerRuntimeCodeHash)
    || !SHA256.test(t.transactionDigest) || t.apiVersion !== 'custom-launch-plan-v1.2'
    || typeof t.stepId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/.test(t.stepId) || !positive(t.gasLimit)
    || typeof t.expiresAt !== 'string' || !Number.isFinite(Date.parse(t.expiresAt))) throw Error('Invalid exact launch transaction');
  if (!keys(m.components, ['token', 'hook', 'initializer', 'feeVault', 'distributor'])) throw Error('Invalid launch component set');
  const addresses = new Set();
  for (const component of Object.values(m.components)) {
    if (!keys(component, ['address', 'runtimeCodeHash']) || !account(component.address) || !HASH.test(component.runtimeCodeHash)
      || addresses.has(component.address.toLowerCase())) throw Error('Invalid or duplicate launch component');
    addresses.add(component.address.toLowerCase());
  }
  if (!keys(m.infrastructure, ['graphDeployer']) || !keys(m.infrastructure.graphDeployer, ['address', 'runtimeCodeHash'])
    || !account(m.infrastructure.graphDeployer.address) || !HASH.test(m.infrastructure.graphDeployer.runtimeCodeHash))
    throw Error('Missing reviewed graph deployer identity');
  if (!keys(m.watchFrom, ['blockNumber', 'blockHash']) || !integer(m.watchFrom.blockNumber) || m.watchFrom.blockNumber < 50469365
    || !HASH.test(m.watchFrom.blockHash)) throw Error('Invalid launch discovery checkpoint');
  const d = m.distributorDeployment;
  if (!keys(d, ['blockNumber', 'blockHash', 'transactionHash']) || !integer(d.blockNumber) || d.blockNumber > m.watchFrom.blockNumber
    || !HASH.test(d.blockHash) || !HASH.test(d.transactionHash)) throw Error('Invalid distributor deployment proof');
  if (!keys(m.fees, ['projectBuyFeeBps', 'projectSellFeeBps', 'platformFeeBps', 'lpFeePips']) || m.fees.projectBuyFeeBps !== 170
    || m.fees.projectSellFeeBps !== 170 || m.fees.platformFeeBps !== 30 || m.fees.lpFeePips !== 0) throw Error('Launch fees changed');
  const a = m.accounting;
  if (!keys(a, ['minimumAgeSeconds', 'twapWindowSeconds', 'maxOracleAgeSeconds', 'maxSnapshotAgeSeconds', 'maxFinalityLagSeconds', 'batchSize', 'excludedAddresses'])
    || a.minimumAgeSeconds !== 3600 || a.twapWindowSeconds !== 1800 || a.maxOracleAgeSeconds !== 300
    || a.maxSnapshotAgeSeconds !== 300 || a.maxFinalityLagSeconds !== 1800 || a.batchSize !== 100
    || !Array.isArray(a.excludedAddresses) || a.excludedAddresses.some(value => !account(value))
    || new Set(a.excludedAddresses.map(value => value.toLowerCase())).size !== a.excludedAddresses.length)
    throw Error('Launch manifest changes reviewed accounting policy');
  const e = m.execution;
  if (!keys(e, ['maxGasPerTransactionWei', 'maxTotalGasWei', 'minimumHarvestWei', 'minimumBatchWei', 'retryIntervalSeconds'])
    || !positive(e.maxGasPerTransactionWei) || BigInt(e.maxGasPerTransactionWei) > 200000000000000n
    || !positive(e.maxTotalGasWei) || BigInt(e.maxTotalGasWei) > 5000000000000000n
    || BigInt(e.maxGasPerTransactionWei) > BigInt(e.maxTotalGasWei) || !positive(e.minimumHarvestWei) || !positive(e.minimumBatchWei)
    || e.retryIntervalSeconds !== 3600) throw Error('Launch manifest exceeds approved operator policy');
  if (!keys(m.activation, ['mode', 'approvalReference']) || !['manual', 'after-reviewed-launch'].includes(m.activation.mode)
    || typeof m.activation.approvalReference !== 'string' || m.activation.approvalReference.length < 1
    || m.activation.approvalReference.length > 240 || /[\r\n\x00-\x1f]/.test(m.activation.approvalReference))
    throw Error('Missing explicit launch activation gate');
  return m;
}

export function launchManifestHash(manifest, ethers) {
  validateLaunchManifest(manifest);
  return `sha256:${ethers.sha256(ethers.toUtf8Bytes(canonicalLaunchJson(manifest))).slice(2)}`;
}

/** Server-recorded review is a separate gate, never inferred from token code or a manifest flag. */
export function validateLaunchConsent(consent, manifest, ethers) {
  validateLaunchManifest(manifest);
  if (!keys(consent, ['schemaVersion', 'manifestSha256', 'account', 'nonce', 'reviewedAt', 'automationAccepted', 'economicRiskAccepted', 'execution'])
    || consent.schemaVersion !== 'robinhook.launch-review.v1' || consent.manifestSha256 !== launchManifestHash(manifest, ethers)
    || !account(consent.account) || consent.account.toLowerCase() !== manifest.transaction.from.toLowerCase()
    || consent.nonce !== manifest.transaction.nonce || !integer(consent.reviewedAt)
    || consent.reviewedAt * 1000 > Date.parse(manifest.transaction.expiresAt) || typeof consent.economicRiskAccepted !== 'boolean'
    || manifest.activation.mode === 'after-reviewed-launch' && consent.economicRiskAccepted !== true
    || consent.automationAccepted !== (manifest.activation.mode === 'after-reviewed-launch')
    || canonicalLaunchJson(consent.execution) !== canonicalLaunchJson(manifest.execution)) throw Error('Launch review consent does not match the immutable manifest');
  return consent;
}

import * as ethers from 'ethers';
import {canonicalLaunchJson, launchManifestHash} from '../../src/launch-manifest.mjs';
import {LAUNCH_WALLET, OPERATOR, ANCHOR, MANAGER_HASH} from '../../signing-ui/guards.mjs';
import {DISTRIBUTOR, DISTRIBUTOR_HASH} from '../../signing-ui/robin-launch-guards.mjs';

export const NOW = Date.parse('2026-10-10T12:00:00Z');
export const copy = value => structuredClone(value);
const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const hash = text => ethers.keccak256(ethers.toUtf8Bytes(text));
const sha = text => `sha256:${ethers.sha256(ethers.toUtf8Bytes(text)).slice(2)}`;
const digest = value => hash(canonicalLaunchJson(value));

export function launchReviewFixture({automatic = false} = {}) {
  const components = Object.fromEntries(['token', 'hook', 'initializer', 'feeVault'].map((name, i) => [name,
    {address: address(i + 1), runtimeCodeHash: hash(name)}]));
  components.distributor = {address: DISTRIBUTOR, runtimeCodeHash: DISTRIBUTOR_HASH};
  const transaction = {chainId: '4663', from: LAUNCH_WALLET, to: address(20), nonce: '7', value: '10000000000000000',
    gasLimit: '6000000', deadline: String(NOW / 1000 + 600), data: '0x506aba4500010203'};
  const platformManifestDigest = sha('published-manifest');
  const plan = {
    schemaVersion: 'programmable.custom-launch-plan.v1', manifestDigest: platformManifestDigest, chainId: '4663',
    controller: {kind: 'eoa', address: LAUNCH_WALLET}, executor: 'atomic_execute_and_stamp_v2',
    admissionPolicy: 'programmable.custom-launch-policy.provenance.v1', feeObligations: [],
    publication: {visibility: 'listed', name: 'ROBINHOOK', symbol: 'ROBIN', description: 'Mock review fixture; never a launch package.',
      imageUrl: 'https://robinhook.wtf/assets/robinhook-token-logo.png', links: ['https://robinhook.wtf/', 'https://x.com/HOOKHOOD']},
    budgets: {maxTotalValue: transaction.value, maxTotalGas: '7000000', validAfter: String(NOW / 1000 - 60), deadline: transaction.deadline},
    components: Object.entries(components).filter(([name]) => name !== 'distributor').map(([name, c]) => ({componentId: name,
      artifactId: name, expectedAddress: c.address, runtimeCodeHash: c.runtimeCodeHash})),
  };
  const requestBytes = Buffer.from(canonicalLaunchJson(plan));
  const manifest = {
    schemaVersion: 'robinhook.launch-bootstrap.v1', chainId: 4663, name: 'ROBINHOOK', symbol: 'ROBIN', sourceRevision: '1'.repeat(40),
    planId: 'mock-plan-DO-NOT-LAUNCH', planHash: sha('plan'), platformManifestDigest, requestSha256: sha(requestBytes.toString()),
    projectMetadataHash: digest(plan.publication), fundingPlanHash: digest(plan.budgets),
    transaction: {from: transaction.from, to: transaction.to, nonce: transaction.nonce, valueWei: transaction.value,
      calldataHash: ethers.keccak256(transaction.data), routerRuntimeCodeHash: ethers.keccak256('0x60016002'),
      expiresAt: new Date(Number(transaction.deadline) * 1000).toISOString(), transactionDigest: sha('transaction'),
      apiVersion: 'custom-launch-plan-v1.2', stepId: 'atomic-execute-and-stamp', gasLimit: transaction.gasLimit},
    components, infrastructure: {graphDeployer: {address: address(21), runtimeCodeHash: ethers.keccak256('0x6003')}}, operator: OPERATOR, platformRecipient: address(30),
    watchFrom: {blockNumber: 63000000, blockHash: hash('watch')},
    distributorDeployment: {blockNumber: 62007962, blockHash: hash('distributor-block'), transactionHash: hash('distributor-tx')},
    preserveLaunchBalanceWei: '1000000000000000', minimumTokensOut: '4701823804994213697915087', maxLaunchGasWei: '800000000000000',
    fees: {projectBuyFeeBps: 180, projectSellFeeBps: 180, platformFeeBps: 20, lpFeePips: 0},
    accounting: {minimumAgeSeconds: 3600, twapWindowSeconds: 1800, maxOracleAgeSeconds: 300, maxSnapshotAgeSeconds: 300,
      maxFinalityLagSeconds: 1800, batchSize: 100, excludedAddresses: []},
    execution: {maxGasPerTransactionWei: '200000000000000', maxTotalGasWei: '5000000000000000', minimumHarvestWei: '1000000000000',
      minimumBatchWei: '1000000000000', retryIntervalSeconds: 3600},
    activation: {mode: automatic ? 'after-reviewed-launch' : 'manual', approvalReference: 'Mock explicit review only'},
  };
  const resource = {schemaVersion: 'programmable.custom-launch-plan-resource.v1', planId: manifest.planId, planHash: manifest.planHash,
    rawRequestSha256: manifest.requestSha256, manifestDigest: platformManifestDigest, plan, status: 'wallet_action_ready',
    preflight: {planHash: manifest.planHash, manifestDigest: platformManifestDigest, launchEligibility: {status: 'ready', hardBlockers: []}},
    admission: {planHash: manifest.planHash, rawRequestSha256: manifest.requestSha256, manifestDigest: platformManifestDigest,
      chainId: '4663', controller: LAUNCH_WALLET, issuedAt: new Date(NOW - 10000).toISOString(), expiresAt: manifest.transaction.expiresAt},
    manualReview: {state: 'approved', chainId: '4663', controller: LAUNCH_WALLET, approvedAt: new Date(NOW - 600000).toISOString(),
      expiresAt: new Date(NOW + 3600000).toISOString()},
    steps: [{stepId: manifest.transaction.stepId, transactionDigest: manifest.transaction.transactionDigest,
      controller: plan.controller, transaction, status: 'wallet_action_ready', transactionHash: null}],
    walletAuthorization: {atomicPreparation: {}, executionOrder: {}},
    resumeUrl: `/v4/chains/4663/custom-launch-plans/${manifest.planId}`,
  };
  const pkg = {checkedAt: new Date(NOW).toISOString(), resource};
  const state = {account: LAUNCH_WALLET, chainId: '0x1237', anchor: ANCHOR,
    head: {number: '0x3c26700', timestamp: `0x${(NOW / 1000).toString(16)}`},
    finalized: {number: '0x3c15ac0', timestamp: `0x${(NOW / 1000 - 1000).toString(16)}`},
    managerCode: 'manager-mock', routerCode: '0x60016002', factoryCode: '0x6003', senderCode: '0x', distributorCode: 'distributor-mock',
    distributorBlock: {hash: manifest.distributorDeployment.blockHash}, watchBlock: {hash: manifest.watchFrom.blockHash},
    distributorOperator: OPERATOR, componentCodes: {token: '0x', hook: '0x', initializer: '0x', feeVault: '0x'},
    latestNonce: '0x7', pendingNonce: '0x7', balance: '50000000000000000', operatorBalance: '5000000000000000',
    gasPrice: '100000000', gasEstimate: '4000000'};
  const crypto = {...ethers, keccak256: value => value === 'manager-mock' ? MANAGER_HASH
    : value === 'distributor-mock' ? DISTRIBUTOR_HASH : ethers.keccak256(value)};
  return {manifest, expectedHash: launchManifestHash(manifest, ethers), requestBytes, acceptedResource: resource, pkg, state, ethers: crypto};
}

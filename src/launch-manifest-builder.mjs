import {createHash} from 'node:crypto';
import * as ethers from 'ethers';
import graphArtifact from '../vendor/programmable-launch-plan-v1/graph-factory.json' with {type: 'json'};
import {inspectPackedRequest, verifyPlanResource} from './launch-plan-api.mjs';
import {assertRobinLaunchIntent} from './launch-intent.mjs';
import {canonicalLaunchJson, validateLaunchManifest, launchManifestHash, LAUNCH_MANIFEST_SCHEMA, LAUNCH_MANIFEST_SCHEMA_V2, LAUNCH_MANIFEST_SCHEMA_V3, LAUNCH_MANIFEST_SCHEMA_V4} from './launch-manifest.mjs';
import {validateLaunchPackage, boundedLaunchTransaction, ANCHOR, MANAGER, DISTRIBUTOR, DISTRIBUTOR_HASH} from '../signing-ui/robin-launch-guards.mjs';
import {ATOMIC, ATOMIC_HASH, GRAPH, GRAPH_HASH, MANAGER_HASH, PERMIT_AUTHORITY, PERMIT_AUTHORITY_HASH} from './launch-plan.mjs';
import {assertSupportedPlanCapabilities} from './launch-platform-contract.mjs';

// Exact executeAndStampV2 ABI from the verified 4663 Atomic runtime. ABI encoding is
// decoded below; actual issuer authorization is tested by an unchanged read-only eth_call.
export const ATOMIC_LAUNCH_ABI = ['function executeAndStampV2((uint256 chainId,address executor,bytes32 executorRuntimeCodeHash,address controller,bytes32 controllerRuntimeCodeHash,bytes32 launchId,bytes32 planHash,bytes32 manifestDigest,bytes32 callsHash,uint256 totalValue,bytes32 componentsHash,bytes32 marketsHash,bytes32 effectsHash,bytes32 feeObligationsHash,bytes32 nonce,uint64 validAfter,uint64 deadline) order,(address target,bytes32 targetRuntimeCodeHash,uint256 value,uint256 gasLimit,bytes data)[] calls,(bytes32 componentId,address account,bytes32 runtimeCodeHash)[] components,(bytes32 marketId,address poolManager,address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)[] markets,bytes platformSignature) payable returns(bytes32 stampHash)'];
const atomic = new ethers.Interface(ATOMIC_LAUNCH_ABI), graph = new ethers.Interface(graphArtifact.abi);
const initializer = new ethers.Interface(['function initialize(address token,address hook,address buyer,uint256 minimumTokensOut)']);
const operatorAbi = new ethers.Interface(['function operator() view returns(address)']);
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const hashJson = value => ethers.keccak256(ethers.toUtf8Bytes(canonicalLaunchJson(value)));
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const require = (condition, message) => { if (!condition) throw Error(message); };
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const componentIds = ['initializer', 'token', 'hook', 'feeVault'];

export function acceptedLaunchResource(value) {
  if (value?.resource) return value.resource;
  if (value?.data) {
    require(value.ok === true && [200, 201, 202].includes(value.httpStatus), 'Accepted API artifact is not a successful owned-resource response.');
    return value.data;
  }
  return value;
}

function exactComponents(plan, preparation) {
  require(Array.isArray(plan.components) && plan.components.length === 4, 'Exactly the four reviewed ROBIN components are required.');
  const result = {};
  for (const id of componentIds) {
    const matches = plan.components.filter(c => c.componentId === id), materials = plan.verificationBundle?.components?.filter(c => c.targetId === id);
    require(matches.length === 1 && materials?.length === 1, `Missing or ambiguous ${id} source/runtime binding.`);
    const c = matches[0], material = materials[0].runtimeMaterialization;
    require(same(c.expectedAddress, preparation.addresses?.[id]) && c.artifactId === id
      && material?.deployedRuntimeCodeHash === c.runtimeCodeHash
      && ethers.keccak256(Buffer.from(material.deployedRuntimeCodeBase64, 'base64')) === c.runtimeCodeHash,
    `${id} prediction differs from final source preparation.`);
    if (id === 'hook') require(materials[0].contractName === 'RobinhookNativeFeeHookV1'
      && materials[0].compilationUnitId === 'robin-native30'
      && materials[0].sourcePath === 'src/robinhook-fee-v1/RobinhookNativeFeeHookV1.sol',
    'The current ROBIN 30 bps custom hook source binding is required.');
    result[id] = {address: ethers.getAddress(c.expectedAddress), runtimeCodeHash: c.runtimeCodeHash};
  }
  return result;
}

/** Inspects the actual signed envelope without manufacturing a platform signature or admission. */
export function inspectAtomicLaunchEnvelope(resource, plan, preparation, intent) {
  const step = resource?.steps?.[0], t = step?.transaction;
  require(Array.isArray(resource?.steps) && resource.steps.length === 1 && t && same(t.to, ATOMIC)
    && t.chainId === '4663' && same(t.from, intent.launchWallet) && t.value === intent.initialBuyWei,
  'One exact ROBIN Atomic wallet step is required.');
  const decoded = atomic.decodeFunctionData('executeAndStampV2', t.data);
  require(atomic.encodeFunctionData('executeAndStampV2', decoded) === t.data, 'Atomic calldata is not canonical ABI encoding.');
  const {order, calls, components, markets, platformSignature} = decoded;
  require(order.chainId === 4663n && same(order.executor, ATOMIC) && order.executorRuntimeCodeHash === ATOMIC_HASH
    && same(order.controller, intent.launchWallet) && order.controllerRuntimeCodeHash === ethers.ZeroHash
    && order.planHash === '0x' + resource.planHash.slice(7) && order.manifestDigest === '0x' + resource.manifestDigest.slice(7)
    && order.totalValue === BigInt(intent.initialBuyWei) && order.validAfter === BigInt(plan.budgets.validAfter)
    && order.deadline === BigInt(plan.budgets.deadline) && order.deadline === BigInt(t.deadline)
    && order.deadline > order.validAfter && order.deadline - order.validAfter <= 86400n
    && platformSignature !== '0x' && ethers.getBytes(platformSignature).length <= 16384,
  'Atomic signed order differs from the exact plan/controller/value/window.');
  const actions = plan.actions;
  require(Array.isArray(actions) && actions.length === 3 && actions.every((a, index) => a.kind === 'deployCreate2'
    && a.componentId === componentIds[index] && same(a.factory?.address, GRAPH)
    && a.authority?.kind === 'controller' && canonicalLaunchJson(a.execution) === canonicalLaunchJson(actions[0].execution)),
  'The reviewed three adjacent graph deployment actions changed.');
  const execution = actions[0].execution;
  require(calls.length === 1 && same(calls[0].target, GRAPH) && calls[0].targetRuntimeCodeHash === GRAPH_HASH
    && calls[0].value === BigInt(intent.initialBuyWei) && calls[0].gasLimit === BigInt(execution.gasLimit)
    && same(execution.target?.address, GRAPH) && execution.value === intent.initialBuyWei
    && execution.gasLimit === preparation.graphGasLimit && plan.budgets.maxTotalGas === preparation.totalGasLimit
    && BigInt(preparation.totalGasLimit) > BigInt(preparation.graphGasLimit)
    && BigInt(t.gasLimit) > BigInt(preparation.graphGasLimit) && BigInt(t.gasLimit) <= BigInt(preparation.totalGasLimit)
    && calls[0].data === execution.data && ethers.keccak256(calls[0].data) === preparation.projectCallDataHash,
  'Atomic execution does not contain exactly the prepared project call.');
  const graphCall = graph.decodeFunctionData('deployGraph', calls[0].data), auth = graphCall.authorization;
  require(graph.encodeFunctionData('deployGraph', graphCall) === calls[0].data && same(auth.authorizedLauncher, ATOMIC)
    && auth.totalValue === BigInt(intent.initialBuyWei) && auth.graphCommitment === preparation.graphCommitment
    && graphCall.targets.length === 3, 'Exact prepared GraphFactory authorization is required.');
  for (const [index, id] of componentIds.slice(0, 3).entries()) {
    const target = graphCall.targets[index];
    require(target.targetIdHash === ethers.keccak256(ethers.toUtf8Bytes(id)) && target.initCode === actions[index].initCode
      && target.deploymentValue === 0n && target.initializerValue === (index === 0 ? BigInt(intent.initialBuyWei) : 0n),
    `Graph ${id} creation or funding differs.`);
    if (index !== 0) require(target.initializerCalldata === '0x', 'Unexpected project post-deployment call.');
  }
  const init = initializer.decodeFunctionData('initialize', graphCall.targets[0].initializerCalldata);
  require(same(init.token, preparation.addresses.token) && same(init.hook, preparation.addresses.hook)
    && same(init.buyer, intent.launchWallet) && init.minimumTokensOut === BigInt(intent.minimumTokensOut),
  'Initial purchase buyer or minimum token output changed.');
  const predicted = exactComponents(plan, preparation);
  require(components.length === 4, 'Atomic component snapshot count changed.');
  for (const c of Object.values(predicted)) {
    const matches = components.filter(s => same(s.account, c.address));
    require(matches.length === 1 && matches[0].runtimeCodeHash === c.runtimeCodeHash, 'Atomic runtime predictions differ from exact source.');
  }
  require(markets.length === 1 && same(markets[0].poolManager, MANAGER) && markets[0].currency0 === ethers.ZeroAddress
    && same(markets[0].currency1, predicted.token.address) && markets[0].fee === 0n && markets[0].tickSpacing === 60n
    && same(markets[0].hooks, predicted.hook.address), 'Atomic market differs from the prepared ROBIN pool.');
  return {predicted, calldataHash: ethers.keccak256(t.data)};
}

/** Deterministic candidate only. Fresh wallet checks and the user's consent remain separate gates. */
export function buildLaunchHandoff({requestBytes, packReport, preparation, accepted, intent, distributor, policy,
  sourceRevision, workerSourceRevision, capabilities, facts, activationMode = 'manual', approvalReference = 'final-user-wallet-review-pending', now = Date.now(), crypto = ethers}) {
  assertRobinLaunchIntent(intent);
  require(keys(policy, ['preserveLaunchBalanceWei', 'accounting', 'execution']), 'Explicit reviewed launch reserve/accounting/operator policy required.');
  require(/^[0-9a-f]{40}$/.test(sourceRevision ?? ''), 'Exact final published source revision required.');
  require(workerSourceRevision === undefined || /^[0-9a-f]{40}$/.test(workerSourceRevision), 'Exact worker source revision required when specified.');
  const scheduledPayouts = Object.hasOwn(policy.execution ?? {}, 'payoutIntervalSeconds');
  const pipelinedFinality = Object.hasOwn(policy.execution ?? {}, 'confirmationMode') || Object.hasOwn(policy.execution ?? {}, 'maxInflightTransactions');
  require(!scheduledPayouts || workerSourceRevision !== undefined, 'Scheduled payout policy requires an explicit worker source revision.');
  require(!pipelinedFinality || scheduledPayouts && workerSourceRevision !== undefined, 'Pipelined payout policy requires a schedule and explicit worker source revision.');
  const packed = inspectPackedRequest(Buffer.from(requestBytes), packReport), resource = acceptedLaunchResource(accepted);
  verifyPlanResource(resource, packed);
  const plan = packed.plan;
  const platformContract = assertSupportedPlanCapabilities(capabilities);
  require(canonicalLaunchJson(resource.plan) === canonicalLaunchJson(plan), 'Owned platform resource differs from exact packed request bytes.');
  require(preparation?.schemaVersion === 'robin.launch-plan-preparation.v1' && preparation.sourceRevision === sourceRevision
    && preparation.manifestDigest === platformContract.manifestDigest && preparation.manifestDigest === packed.plan.manifestDigest
    && canonicalLaunchJson(preparation.packer) === canonicalLaunchJson(packReport)
    && preparation.sourceCommitment === sha(Buffer.from(canonicalLaunchJson(plan.verificationBundle?.compilationUnits)))
    && plan.publication.links.includes(`${intent.publicSource.url}/tree/${sourceRevision}`)
    && preparation.initialBuyWei === intent.initialBuyWei && preparation.minimumTokensOut === intent.minimumTokensOut
    && preparation.maximumLaunchGasCostWei === intent.maxGasCostWei && intent.maxGasCostWei === '800000000000000'
    && same(preparation.authorizedLauncher, ATOMIC) && same(preparation.factory, GRAPH)
    && canonicalLaunchJson(preparation.hookFees) === canonicalLaunchJson({projectBuyBps: 170, projectSellBps: 170, platformBps: 30, lpFeePips: 0}),
  'Final preparation, source revision, fees or purchase budget changed.');
  require(intent.projectBuyFeeBps === 170 && intent.projectSellFeeBps === 170 && intent.platformFeeBps === 30 && intent.lpFeePips === 0
    && policy.execution.maxTotalGasWei === intent.operatorGasBudgetWei && policy.execution.maxGasPerTransactionWei === intent.operatorMaxGasPerTransactionWei,
  'The current explicit operator or fee budget changed.');
  const cap = capabilities?.availability?.bindings?.execution?.atomic;
  require(capabilities?.schemaVersion === 'programmable.custom-launch-capabilities.v1' && capabilities.chainId === '4663'
    && capabilities.manifestDigest === plan.manifestDigest && cap?.executorKind === 'atomic_execute_and_stamp_v2'
    && same(cap.address, ATOMIC) && cap.runtimeCodeHash === ATOMIC_HASH && cap.selector === '0x506aba45'
    && same(cap.poolManager, MANAGER) && cap.poolManagerRuntimeCodeHash === MANAGER_HASH
    && same(cap.permitAuthority, PERMIT_AUTHORITY) && cap.permitAuthorityRuntimeCodeHash === PERMIT_AUTHORITY_HASH,
  'Current released Atomic capability does not match this package.');
  require(distributor?.verified === true && distributor.finalized === true && distributor.chainId === 4663
    && same(distributor.address, DISTRIBUTOR) && same(distributor.address, intent.creatorFeeRecipient)
    && same(distributor.operator, intent.operator) && distributor.runtimeCodeHash === DISTRIBUTOR_HASH,
  'Existing verified ROBIN distributor evidence required.');
  const dependencies = plan.dependencies;
  require(Array.isArray(dependencies), 'Missing exact plan dependencies.');
  for (const [id, address, runtimeCodeHash] of [['graph-factory', GRAPH, GRAPH_HASH], ['reward-distributor', DISTRIBUTOR, DISTRIBUTOR_HASH]]) {
    const matches = dependencies.filter(d => d.dependencyId === id);
    require(matches.length === 1 && matches[0].chainId === '4663' && same(matches[0].address, address)
      && matches[0].runtimeCodeHash === runtimeCodeHash && (id !== 'reward-distributor' || same(matches[0].authoritySnapshot?.operator, intent.operator)),
    'Prepared dependency identity or operator changed.');
  }
  const {predicted, calldataHash} = inspectAtomicLaunchEnvelope(resource, plan, preparation, intent), t = resource.steps[0].transaction;
  const age = now - Date.parse(facts?.checkedAt);
  require(facts?.schemaVersion === 'robinhook.launch-chain-facts.v1' && Number.isFinite(age) && age >= -30000 && age <= 60000
    && facts.resourceSha256 === sha(Buffer.from(canonicalLaunchJson(resource)))
    && crypto.keccak256(facts.permitAuthorityCode) === PERMIT_AUTHORITY_HASH
    && /^0x(?!0{64}$)[0-9a-f]{64}$/.test(facts.simulation?.result ?? '')
    && facts.simulation.calldataHash === calldataHash && facts.simulation.blockHash === facts.state?.head?.hash
    && facts.simulation.blockNumber === Number(BigInt(facts.state.head.number)) && facts.simulation.stateOverrides === false,
  'Fresh exact Atomic call simulation and read-only chain evidence required.');
  const receipt = facts.distributorReceipt;
  require(receipt?.status === '0x1' && same(receipt.contractAddress, DISTRIBUTOR)
    && same(receipt.transactionHash, distributor.transactionHash) && Number(BigInt(receipt.blockNumber)) === distributor.blockNumber
    && receipt.blockHash === distributor.blockHash && facts.state.distributorBlock?.hash === distributor.blockHash,
  'Existing distributor receipt is not canonical and successful.');
  const workerBinding = workerSourceRevision === undefined ? {} : {workerSourceRevision};
  const manifest = {schemaVersion: pipelinedFinality ? LAUNCH_MANIFEST_SCHEMA_V4 : scheduledPayouts ? LAUNCH_MANIFEST_SCHEMA_V3
    : workerSourceRevision === undefined ? LAUNCH_MANIFEST_SCHEMA : LAUNCH_MANIFEST_SCHEMA_V2,
    chainId: 4663, name: 'ROBINHOOK', symbol: 'ROBIN', sourceRevision, ...workerBinding,
    planId: resource.planId, planHash: resource.planHash, platformManifestDigest: resource.manifestDigest, requestSha256: packed.hash,
    projectMetadataHash: hashJson(plan.publication), fundingPlanHash: hashJson(plan.budgets),
    transaction: {from: ethers.getAddress(t.from), to: ethers.getAddress(t.to), nonce: t.nonce, valueWei: t.value,
      calldataHash, routerRuntimeCodeHash: ATOMIC_HASH, expiresAt: new Date(Number(BigInt(t.deadline)) * 1000).toISOString(),
      transactionDigest: resource.steps[0].transactionDigest, apiVersion: 'custom-launch-plan-v1.2', stepId: resource.steps[0].stepId, gasLimit: t.gasLimit},
    components: {...predicted, distributor: {address: DISTRIBUTOR, runtimeCodeHash: DISTRIBUTOR_HASH}},
    infrastructure: {graphDeployer: {address: GRAPH, runtimeCodeHash: GRAPH_HASH}}, operator: ethers.getAddress(intent.operator),
    platformRecipient: '0xD88539d3c4C460136a733A3Fd60cf6BF269079da',
    watchFrom: {blockNumber: Number(BigInt(facts.state.finalized.number)), blockHash: facts.state.finalized.hash},
    distributorDeployment: {blockNumber: distributor.blockNumber, blockHash: distributor.blockHash, transactionHash: distributor.transactionHash},
    preserveLaunchBalanceWei: policy.preserveLaunchBalanceWei,
    fees: {projectBuyFeeBps: 170, projectSellFeeBps: 170, platformFeeBps: 30, lpFeePips: 0},
    minimumTokensOut: intent.minimumTokensOut, maxLaunchGasWei: intent.maxGasCostWei,
    accounting: structuredClone(policy.accounting), execution: structuredClone(policy.execution), activation: {mode: activationMode, approvalReference}};
  validateLaunchManifest(manifest);
  const manifestSha256 = launchManifestHash(manifest, ethers), pkg = {checkedAt: facts.checkedAt, resource};
  validateLaunchPackage(pkg, manifest, manifestSha256, ethers, now);
  const bounded = boundedLaunchTransaction(pkg, manifest, manifestSha256, facts.state, crypto, now);
  return {manifest, manifestSha256, report: {schemaVersion: 'robinhook.launch-handoff-candidate.v1', checkedAt: new Date(now).toISOString(),
    status: 'candidate-for-final-user-review', manifestSha256, planId: manifest.planId, requestSha256: packed.hash, sourceRevision, ...workerBinding,
    simulationBlock: {number: facts.simulation.blockNumber, hash: facts.simulation.blockHash}, maximumLaunchGasWei: bounded.maximumCost.toString(),
    routedTradingFee: {...platformContract.tradeFeePolicy, waiverVerified: false, totalTradingFeeConfirmed: false},
    activationMode, automationAuthorized: false, walletSigning: false, transactionBroadcast: false, platformIssuanceCreated: false}};
}

/** RPC calls are all reads: no signer, authorization list, state override or send method exists here. */
export async function readLaunchChainFacts({rpc, accepted, distributor, now = () => Date.now()}) {
  const resource = acceptedLaunchResource(accepted), t = resource?.steps?.[0]?.transaction;
  require(resource?.status === 'wallet_action_ready' && resource.steps?.length === 1 && t && same(t.to, ATOMIC),
    'A real wallet-ready Atomic package is required before chain inspection.');
  const components = Object.fromEntries(resource.plan.components.map(c => [c.componentId, c.expectedAddress]));
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  require(head && /^0x[0-9a-f]+$/.test(head.number), 'Missing current chain head.');
  const finalized = await rpc('eth_getBlockByNumber', ['finalized', false]);
  const tag = head.number;
  const unsigned = {from: t.from, to: t.to, data: t.data, value: ethers.toQuantity(t.value), nonce: ethers.toQuantity(t.nonce), gas: ethers.toQuantity(t.gasLimit)};
  const [chainId, anchor, managerCode, routerCode, factoryCode, permitAuthorityCode, senderCode, distributorCode, distributorBlock,
    distributorReceipt, operatorResult, latestNonce, pendingNonce, balance, operatorBalance, gasPrice, gasEstimate, simulationResult, codes] = await Promise.all([
    rpc('eth_chainId', []), rpc('eth_getBlockByNumber', [ANCHOR.number, false]), rpc('eth_getCode', [MANAGER, tag]),
    rpc('eth_getCode', [ATOMIC, tag]), rpc('eth_getCode', [GRAPH, tag]), rpc('eth_getCode', [PERMIT_AUTHORITY, tag]), rpc('eth_getCode', [t.from, tag]),
    rpc('eth_getCode', [DISTRIBUTOR, tag]), rpc('eth_getBlockByNumber', [ethers.toQuantity(distributor.blockNumber), false]),
    rpc('eth_getTransactionReceipt', [distributor.transactionHash]),
    rpc('eth_call', [{to: DISTRIBUTOR, data: operatorAbi.encodeFunctionData('operator')}, tag]),
    rpc('eth_getTransactionCount', [t.from, 'latest']), rpc('eth_getTransactionCount', [t.from, 'pending']),
    rpc('eth_getBalance', [t.from, 'pending']), rpc('eth_getBalance', [distributor.operator, 'pending']), rpc('eth_gasPrice', []),
    rpc('eth_estimateGas', [unsigned, tag]), rpc('eth_call', [unsigned, tag]),
    Promise.all(componentIds.map(id => rpc('eth_getCode', [components[id], tag]))),
  ]);
  // Re-read the chosen head to reject a reorg between the simulation and state reads.
  const canonicalHead = await rpc('eth_getBlockByNumber', [tag, false]);
  require(canonicalHead?.hash === head.hash, 'Chain head changed during exact Atomic simulation.');
  return {schemaVersion: 'robinhook.launch-chain-facts.v1', checkedAt: new Date(now()).toISOString(),
    resourceSha256: sha(Buffer.from(canonicalLaunchJson(resource))), permitAuthorityCode, distributorReceipt,
    simulation: {result: simulationResult, calldataHash: ethers.keccak256(t.data), blockNumber: Number(BigInt(head.number)), blockHash: head.hash, stateOverrides: false},
    state: {account: t.from, chainId, anchor, head, finalized, managerCode, routerCode, factoryCode, senderCode, distributorCode, distributorBlock,
      watchBlock: finalized, distributorOperator: operatorAbi.decodeFunctionResult('operator', operatorResult)[0],
      latestNonce, pendingNonce, balance, operatorBalance, gasPrice, gasEstimate,
      componentCodes: Object.fromEntries(componentIds.map((id, i) => [id, codes[i]]))}};
}

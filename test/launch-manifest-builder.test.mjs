import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import * as ethers from 'ethers';
import {buildLaunchHandoff, inspectAtomicLaunchEnvelope, ATOMIC_LAUNCH_ABI, readLaunchChainFacts} from '../src/launch-manifest-builder.mjs';
import {compileRobinLaunchContracts, buildRobinLaunchPlan, ATOMIC, ATOMIC_HASH, GRAPH, GRAPH_HASH, MANAGER, MANAGER_HASH, PERMIT_AUTHORITY, PERMIT_AUTHORITY_HASH} from '../src/launch-plan.mjs';
import {DISTRIBUTOR, DISTRIBUTOR_HASH, ANCHOR} from '../signing-ui/robin-launch-guards.mjs';
import {canonicalLaunchJson} from '../src/launch-manifest.mjs';
import {launchReviewFixture, NOW} from './helpers/launch-review-fixture.mjs';

const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const hash = text => ethers.keccak256(ethers.toUtf8Bytes(text));
const sha = bytes => 'sha256:' + ethers.sha256(bytes).slice(2);
const intent = read('launch-intent.json'), capabilities = read('vendor/programmable-launch-plan-v1/capabilities-observed.json');
// Public chain receipt fixture; tests must not depend on an operator's deploy files.
const distributor = {verified: true, finalized: true, chainId: 4663, address: DISTRIBUTOR,
  operator: intent.operator, runtimeCodeHash: DISTRIBUTOR_HASH, blockNumber: 62007962,
  blockHash: '0x67e727bd78ca55b71c2622ec25fa5e5f05a749d93147bdc852b7c95d022d0d31',
  transactionHash: '0xe9e909d732221c44d4bcd96b71dc72cf87df1d11cfc4143f5ac7862b0d0c379a',
  checkedAt: new Date(NOW).toISOString()};
const sourceRevision = '1'.repeat(40);
const built = buildRobinLaunchPlan({intent, capabilities, distributor, sourceRevision, now: NOW / 1000, totalGasLimit: '9500000',
  nonce: '0x' + '31'.repeat(32), factory: read('vendor/programmable-launch-plan-v1/graph-factory.json'), compiled: compileRobinLaunchContracts(process.cwd(), solc)});
const atomic = new ethers.Interface(ATOMIC_LAUNCH_ABI);
const crypto = {...ethers, keccak256: value => ({'manager-mock': MANAGER_HASH, 'atomic-mock': ATOMIC_HASH,
  'graph-mock': GRAPH_HASH, 'permit-mock': PERMIT_AUTHORITY_HASH, 'distributor-mock': DISTRIBUTOR_HASH}[value] ?? ethers.keccak256(value))};

function fixture() {
  const previous = launchReviewFixture(), plan = structuredClone(built.plan), requestBytes = Buffer.from(canonicalLaunchJson(plan));
  const rawRequestSha256 = sha(requestBytes), planHash = sha(ethers.toUtf8Bytes('mock-not-issued-platform-plan'));
  const packReport = {status: 'packed', rawRequestSha256, byteLength: requestBytes.length, idempotencyKey: 'clp-v1-' + rawRequestSha256.slice(7), manifestDigest: plan.manifestDigest, planHash};
  const order = {chainId: 4663, executor: ATOMIC, executorRuntimeCodeHash: ATOMIC_HASH, controller: intent.launchWallet,
    controllerRuntimeCodeHash: ethers.ZeroHash, launchId: hash('mock-launch'), planHash: '0x' + planHash.slice(7),
    manifestDigest: '0x' + plan.manifestDigest.slice(7), callsHash: hash('mock-calls'), totalValue: intent.initialBuyWei,
    componentsHash: hash('mock-components'), marketsHash: hash('mock-markets'), effectsHash: hash('mock-effects'),
    feeObligationsHash: hash('mock-fees'), nonce: hash('mock-order-nonce'), validAfter: plan.budgets.validAfter, deadline: plan.budgets.deadline};
  const calls = [{target: GRAPH, targetRuntimeCodeHash: GRAPH_HASH, value: intent.initialBuyWei,
    gasLimit: built.report.graphGasLimit, data: built.factoryCall}];
  const snapshots = plan.components.map(c => ({componentId: hash(c.componentId), account: c.expectedAddress, runtimeCodeHash: c.runtimeCodeHash}));
  const markets = [{marketId: hash('mock-market'), poolManager: MANAGER, currency0: ethers.ZeroAddress,
    currency1: built.report.addresses.token, fee: 0, tickSpacing: 60, hooks: built.report.addresses.hook}];
  const data = atomic.encodeFunctionData('executeAndStampV2', [order, calls, snapshots, markets, '0x1234']);
  const expiresAt = new Date(Number(plan.budgets.deadline) * 1000).toISOString();
  const accepted = {...previous.acceptedResource, plan, planHash, rawRequestSha256, manifestDigest: plan.manifestDigest};
  accepted.preflight = {planHash, manifestDigest: plan.manifestDigest, launchEligibility: {status: 'ready', hardBlockers: []}};
  accepted.admission = {...accepted.admission, planHash, rawRequestSha256, manifestDigest: plan.manifestDigest, expiresAt};
  accepted.manualReview = {...accepted.manualReview, approvedAt: new Date(NOW - 60000).toISOString(), expiresAt};
  accepted.steps[0].transaction = {...accepted.steps[0].transaction, to: ATOMIC, data, deadline: plan.budgets.deadline, gasLimit: built.report.totalGasLimit};
  const state = {...previous.state, routerCode: 'atomic-mock', factoryCode: 'graph-mock',
    head: {...previous.state.head, hash: hash('head')}, finalized: {...previous.state.finalized, hash: hash('finalized')},
    distributorBlock: {hash: distributor.blockHash}, watchBlock: {hash: hash('finalized')}, gasPrice: '60000000', gasEstimate: '7800000'};
  const facts = {schemaVersion: 'robinhook.launch-chain-facts.v1', checkedAt: new Date(NOW).toISOString(),
    resourceSha256: sha(Buffer.from(canonicalLaunchJson(accepted))), permitAuthorityCode: 'permit-mock', state,
    distributorReceipt: {status: '0x1', contractAddress: DISTRIBUTOR, transactionHash: distributor.transactionHash,
      blockNumber: ethers.toQuantity(distributor.blockNumber), blockHash: distributor.blockHash},
    simulation: {result: hash('mock-call-result-NOT-platform-issuance'), calldataHash: ethers.keccak256(data),
      blockNumber: Number(BigInt(state.head.number)), blockHash: state.head.hash, stateOverrides: false}};
  const policy = Object.fromEntries(['preserveLaunchBalanceWei', 'accounting', 'execution'].map(k => [k, previous.manifest[k]]));
  return {requestBytes, packReport, preparation: {...built.report, packer: packReport}, accepted, intent: structuredClone(intent),
    distributor, policy, sourceRevision, capabilities: structuredClone(capabilities), facts, now: NOW, crypto};
}

test('fixture-only accepted plan becomes a deterministic manual review candidate, never consent or issuance', () => {
  const a = buildLaunchHandoff(fixture()), b = buildLaunchHandoff(fixture());
  assert.deepEqual(a, b); assert.equal(a.manifest.activation.mode, 'manual');
  assert.equal(a.manifest.symbol, 'ROBIN'); assert.equal(a.manifest.transaction.nonce, '7');
  assert.equal(a.manifest.components.token.address, built.report.addresses.token);
  assert.equal(a.manifest.minimumTokensOut, intent.minimumTokensOut);
  assert.deepEqual(a.manifest.fees, {projectBuyFeeBps: 170, projectSellFeeBps: 170, platformFeeBps: 30, lpFeePips: 0});
  for (const key of ['automationAuthorized', 'walletSigning', 'transactionBroadcast', 'platformIssuanceCreated']) assert.equal(a.report[key], false);
  const automatic = buildLaunchHandoff({...fixture(), activationMode: 'after-reviewed-launch'});
  assert.equal(automatic.manifest.activation.mode, 'after-reviewed-launch');
  assert.notEqual(automatic.manifestSha256, a.manifestSha256, 'automatic policy requires its own immutable final review');
  assert.equal(automatic.report.automationAuthorized, false, 'preparation never produces runtime consent');
  assert.equal(automatic.report.transactionBroadcast, false);
  assert.throws(() => buildLaunchHandoff({...fixture(), activationMode: 'automatic'}), /activation gate/);
});

test('candidate rejects binding changes, non-ready admission, stale evidence, reverted calls and budget drift', () => {
  const mutations = [x => x.preparation.sourceRevision = '2'.repeat(40), x => x.requestBytes = Buffer.concat([x.requestBytes, Buffer.from('\n')]),
    x => x.accepted.status = 'pending', x => x.accepted.manualReview.state = 'pending', x => x.accepted.plan.publication.name = 'OTHER',
    x => x.facts.checkedAt = new Date(NOW - 61000).toISOString(), x => x.facts.simulation.result = '0x',
    x => x.facts.simulation.stateOverrides = true, x => x.facts.distributorReceipt.status = '0x0',
    x => x.facts.state.pendingNonce = '0x8', x => x.facts.state.gasPrice = '1000000000',
    x => x.policy.execution.maxTotalGasWei = '6000000000000000', x => x.capabilities.manifestDigest = 'sha256:' + '0'.repeat(64)];
  for (const mutate of mutations) { const x = fixture(); mutate(x); assert.throws(() => buildLaunchHandoff(x)); }
});

test('explicit worker revision changes only local review identity while exact approved contract package remains unchanged', () => {
  const input = fixture(), requestBefore = Buffer.from(input.requestBytes), resourceBefore = canonicalLaunchJson(input.accepted);
  const original = buildLaunchHandoff(input), workerSourceRevision = '2'.repeat(40);
  const revised = buildLaunchHandoff({...input, workerSourceRevision});
  assert.equal(revised.manifest.schemaVersion, 'robinhook.launch-bootstrap.v2');
  assert.equal(revised.manifest.workerSourceRevision, workerSourceRevision);
  assert.equal(revised.manifest.sourceRevision, input.preparation.sourceRevision);
  assert.equal(revised.report.workerSourceRevision, workerSourceRevision);
  const {workerSourceRevision: _worker, schemaVersion: _schema, ...remaining} = revised.manifest;
  assert.deepEqual({...remaining, schemaVersion: 'robinhook.launch-bootstrap.v1'}, original.manifest);
  assert.notEqual(revised.manifestSha256, original.manifestSha256);
  assert.deepEqual(input.requestBytes, requestBefore); assert.equal(canonicalLaunchJson(input.accepted), resourceBefore);
  for (const worker of ['', 'main', 'G'.repeat(40), null]) assert.throws(() => buildLaunchHandoff({...input, workerSourceRevision: worker}), /worker source/);
  assert.throws(() => buildLaunchHandoff({...input, sourceRevision: workerSourceRevision, workerSourceRevision: sourceRevision}), /source revision/);
});

test('a stale 1.8% / 0.2% preparation or fee intent cannot produce a current handoff', () => {
  for (const field of ['preparation', 'intent']) {
    const x = fixture();
    if (field === 'preparation') x.preparation.hookFees = {projectBuyBps: 180, projectSellBps: 180, platformBps: 20, lpFeePips: 0};
    else Object.assign(x.intent, {projectBuyFeeBps: 180, projectSellFeeBps: 180, platformFeeBps: 20});
    assert.throws(() => buildLaunchHandoff(x), /fees|fee budget|intent required/);
  }
});

test('exact Atomic envelope rejects changed project destination and absent issuer signature', () => {
  for (const mutate of [args => args[1][0][0] = MANAGER, args => args[4] = '0x']) {
    const x = fixture(), args = atomic.decodeFunctionData('executeAndStampV2', x.accepted.steps[0].transaction.data).toArray(true);
    mutate(args); x.accepted.steps[0].transaction.data = atomic.encodeFunctionData('executeAndStampV2', args);
    assert.throws(() => inspectAtomicLaunchEnvelope(x.accepted, x.accepted.plan, x.preparation, x.intent));
  }
  const x = fixture(); x.accepted.steps[0].transaction.gasLimit = x.preparation.graphGasLimit;
  assert.throws(() => inspectAtomicLaunchEnvelope(x.accepted, x.accepted.plan, x.preparation, x.intent), /project call/);
});

test('the canonical 20 bps source label cannot be used as the new custom fee hook', () => {
  const x = fixture(), hook = x.accepted.plan.verificationBundle.components.find(c => c.targetId === 'hook');
  hook.contractName = 'RobinhoodNativeFeeHookV1';
  hook.compilationUnitId = 'kernel';
  hook.sourcePath = 'src/robinhood-fee-v1/RobinhoodNativeFeeHookV1.sol';
  assert.throws(() => inspectAtomicLaunchEnvelope(x.accepted, x.accepted.plan, x.preparation, x.intent), /custom hook source binding/);
});

test('chain collector uses only reads and the complete admitted call without state overrides', async () => {
  const x = fixture(), calls = [], state = x.facts.state, operator = new ethers.Interface(['function operator() view returns(address)']);
  const rpc = async (method, params) => {
    calls.push([method, params]);
    if (method === 'eth_chainId') return state.chainId;
    if (method === 'eth_getBlockByNumber') return params[0] === 'latest' || params[0] === state.head.number ? state.head
      : params[0] === 'finalized' ? state.finalized : params[0] === ANCHOR.number ? ANCHOR : state.distributorBlock;
    if (method === 'eth_getTransactionReceipt') return x.facts.distributorReceipt;
    if (method === 'eth_call') return params[0].to === DISTRIBUTOR ? operator.encodeFunctionResult('operator', [intent.operator]) : x.facts.simulation.result;
    if (method === 'eth_estimateGas') return state.gasEstimate;
    if (method === 'eth_getTransactionCount') return '0x7';
    if (method === 'eth_getBalance') return state.balance;
    if (method === 'eth_gasPrice') return state.gasPrice;
    if (method === 'eth_getCode') return ({[MANAGER]: state.managerCode, [ATOMIC]: state.routerCode, [GRAPH]: state.factoryCode,
      [PERMIT_AUTHORITY]: 'permit-mock', [DISTRIBUTOR]: state.distributorCode})[params[0]] ?? '0x';
    throw Error('Unexpected RPC ' + method);
  };
  const facts = await readLaunchChainFacts({rpc, accepted: x.accepted, distributor, now: () => NOW});
  assert.equal(facts.simulation.calldataHash, x.facts.simulation.calldataHash);
  const simulation = calls.find(([m, p]) => m === 'eth_call' && p[0].to === ATOMIC);
  assert.equal(simulation[1].length, 2); assert.equal(simulation[1][0].data, x.accepted.steps[0].transaction.data);
  assert.ok(calls.every(([m]) => /^eth_(chainId|get|call|estimateGas|gasPrice)/.test(m)));
  await assert.rejects(readLaunchChainFacts({accepted: x.accepted, distributor, now: () => NOW,
    rpc: (m, p) => m === 'eth_getBlockByNumber' && p[0] === state.head.number ? {...state.head, hash: hash('reorg')} : rpc(m, p)}), /head changed/);
});

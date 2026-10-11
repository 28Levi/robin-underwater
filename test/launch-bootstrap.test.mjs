import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as ethers from 'ethers';
import {ROBINHOOD_ANCHOR, POOL_MANAGER} from '../src/production-network.mjs';
import {canonicalLaunchJson, validateLaunchManifest, launchManifestHash, validateLaunchConsent} from '../src/launch-manifest.mjs';
import {productionConfigFromLaunch, verifyLaunchReceipt, operatorStartupAllowed, runLaunchBootstrapCycle} from '../src/launch-bootstrap.mjs';
import {standbySettings, inspectLaunchAdmission} from '../src/launch-standby.mjs';
import {loadConfig} from '../src/config.mjs';

const now = 1800000000, first = ROBINHOOD_ANCHOR.blockNumber + 10, launched = first + 2;
const addr = n => `0x${n.toString(16).padStart(40, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const sha = n => `sha256:${hash(n).slice(2)}`;
const managerCode = fs.readFileSync('research/current/poolManager-runtime.txt', 'utf8');
const transfer = new ethers.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const getters = new ethers.Interface([
  'function creatorBuyFeeBps() view returns(uint16)', 'function creatorSellFeeBps() view returns(uint16)', 'function PLATFORM_FEE_BPS() view returns(uint16)',
  'function lpFee() view returns(uint24)', 'function module() view returns(address)', 'function initialized() view returns(bool)',
  'function token() view returns(address)', 'function initializer() view returns(address)', 'function poolManager() view returns(address)',
  'function tickSpacing() view returns(int24)', 'function name() view returns(string)', 'function symbol() view returns(string)',
  'function totalSupply() view returns(uint256)', 'function initialBuyer() view returns(address)', 'function initialBuyWei() view returns(uint256)',
  'function initialTokensOut() view returns(uint256)', 'function minimumInitialTokensOut() view returns(uint256)', 'function hook() view returns(address)',
  'function lockedLiquidity() view returns(uint128)', 'function seededTokenAmount() view returns(uint256)', 'function graphFactory() view returns(address)',
  'function creatorRecipient() view returns(address)', 'function PLATFORM_RECIPIENT() view returns(address)', 'function operator() view returns(address)',
  'function feeVault() view returns(address)', 'function reserved() view returns(uint256)',
]);
function fixture(mode = 'manual') {
  const code = '0x6001600155', components = Object.fromEntries(['token', 'hook', 'initializer', 'feeVault', 'distributor'].map((key, i) =>
    [key, {address: addr(i + 10), runtimeCodeHash: ethers.keccak256(code)}]));
  const m = {schemaVersion: 'robinhook.launch-bootstrap.v1', chainId: 4663, name: 'ROBINHOOK', symbol: 'ROBIN', sourceRevision: 'a'.repeat(40),
    planId: 'robin/one:1', planHash: sha(1), platformManifestDigest: sha(2), requestSha256: sha(3), projectMetadataHash: hash(4), fundingPlanHash: hash(5),
    transaction: {from: addr(1), to: addr(2), nonce: '3', valueWei: '10000000000000000', calldataHash: ethers.keccak256('0x1234'),
      routerRuntimeCodeHash: ethers.keccak256(code), expiresAt: new Date((now + 600) * 1000).toISOString(), transactionDigest: sha(6),
      apiVersion: 'custom-launch-plan-v1.2', stepId: 'atomic_launch', gasLimit: '5000000'}, components,
    infrastructure: {graphDeployer: {address: addr(3), runtimeCodeHash: ethers.keccak256(code)}}, operator: addr(4), platformRecipient: addr(5),
    watchFrom: {blockNumber: first, blockHash: hash(first)}, distributorDeployment: {blockNumber: first - 1, blockHash: hash(first - 1), transactionHash: hash(998)},
    preserveLaunchBalanceWei: '1000000000000000', fees: {projectBuyFeeBps: 170, projectSellFeeBps: 170, platformFeeBps: 30, lpFeePips: 0},
    minimumTokensOut: '100', maxLaunchGasWei: '800000000000000', accounting: {minimumAgeSeconds: 3600, twapWindowSeconds: 1800,
      maxOracleAgeSeconds: 300, maxSnapshotAgeSeconds: 300, maxFinalityLagSeconds: 1800, batchSize: 100, excludedAddresses: []},
    execution: {maxGasPerTransactionWei: '200000000000000', maxTotalGasWei: '5000000000000000', minimumHarvestWei: '10000000000000',
      minimumBatchWei: '10000000000000', retryIntervalSeconds: 3600}, activation: {mode, approvalReference: 'Local mock review'}};
  const block = number => ({number, hash: number === ROBINHOOD_ANCHOR.blockNumber ? ROBINHOOD_ANCHOR.blockHash : hash(number), timestamp: now - 60 + number - launched});
  const log = (from, to, value, index) => ({...transfer.encodeEventLog(transfer.getEvent('Transfer'), [from, to, value]),
    address: components.token.address, blockNumber: launched, blockHash: hash(launched), transactionHash: hash(999), index, removed: false});
  const mint = log(ethers.ZeroAddress, components.initializer.address, 10n ** 27n, 0);
  const tx = {hash: hash(999), from: m.transaction.from, to: m.transaction.to, nonce: 3, value: BigInt(m.transaction.valueWei), data: '0x1234',
    gasLimit: 5000000n, maxFeePerGas: 100000000n, chainId: 4663n, blockNumber: launched, blockHash: hash(launched)};
  const receipt = {hash: tx.hash, from: tx.from, to: tx.to, status: 1, blockNumber: launched, blockHash: hash(launched), gasUsed: 2000000n,
    gasPrice: 50000000n, logs: [mint, log(components.initializer.address, tx.from, 200n, 1)]};
  const values = {creatorBuyFeeBps: 170n, creatorSellFeeBps: 170n, PLATFORM_FEE_BPS: 30n, lpFee: 0n, module: ethers.ZeroAddress,
    initialized: true, token: components.token.address, initializer: components.initializer.address, poolManager: POOL_MANAGER, tickSpacing: 60,
    name: 'ROBINHOOK', symbol: 'ROBIN', totalSupply: 10n ** 27n, initialBuyer: tx.from, initialBuyWei: tx.value, initialTokensOut: 200n,
    minimumInitialTokensOut: 100n, hook: components.hook.address, lockedLiquidity: 100n, seededTokenAmount: 10n ** 27n,
    graphFactory: m.infrastructure.graphDeployer.address, creatorRecipient: components.distributor.address, PLATFORM_RECIPIENT: m.platformRecipient,
    operator: m.operator, feeVault: components.feeVault.address, reserved: 0n};
  const state = {finalized: launched + 1, deployed: true, nonce: 3, calls: [], logRanges: [], values};
  const provider = {
    getNetwork: async () => ({chainId: 4663n}), getBlock: async n => block(n === 'latest' ? launched + 20 : n === 'finalized' ? state.finalized : n),
    getCode: async (account, n) => account.toLowerCase() === POOL_MANAGER.toLowerCase() ? managerCode
      : account.toLowerCase() === components.token.address && (!state.deployed || n <= first) ? '0x' : code,
    getTransaction: async () => tx,
    getTransactionReceipt: async id => id === m.distributorDeployment.transactionHash
      ? {hash: id, status: 1, blockNumber: first - 1, blockHash: hash(first - 1), contractAddress: components.distributor.address} : receipt,
    getLogs: async filter => {state.logRanges.push([filter.fromBlock, filter.toBlock]); return state.deployed && filter.fromBlock <= launched && filter.toBlock >= launched ? [mint] : [];},
    getTransactionCount: async () => state.nonce,
    call: async request => {state.calls.push(request); const fn = getters.getFunction(request.data.slice(0, 10));
      return getters.encodeFunctionResult(fn, [state.values[fn.name]]);},
    getBalance: async () => 2000000000000000n,
    send: async method => {assert.equal(method, 'eth_getTransactionReceipt'); return {transactionHash: tx.hash, blockHash: receipt.blockHash, status: '0x1', l1Fee: '0x0'};},
    broadcastTransaction: async () => {throw Error('Forbidden broadcast');}, getSigner: () => {throw Error('Forbidden signer');},
  };
  return {m, provider, state, tx, receipt, mint, code};
}
function dir(t) {const root = path.resolve('output/test'); fs.mkdirSync(root, {recursive: true}); const value = fs.mkdtempSync(path.join(root, 'bootstrap-'));
  t.after(() => {if (!path.resolve(value).startsWith(`${root}${path.sep}`)) throw Error('Unsafe test cleanup'); fs.rmSync(value, {recursive: true, force: true});}); return value;}
const options = m => ({expectedManifestSha256: launchManifestHash(m, ethers), sourceRevision: m.sourceRevision, now});
const consent = m => ({schemaVersion: 'robinhook.launch-review.v1', manifestSha256: launchManifestHash(m, ethers), account: m.transaction.from,
  nonce: m.transaction.nonce, reviewedAt: now - 100, automationAccepted: m.activation.mode === 'after-reviewed-launch',
  economicRiskAccepted: m.activation.mode === 'after-reviewed-launch', execution: structuredClone(m.execution)});

test('immutable manifest canonical hashing and fixed policy boundaries', () => {
  const {m} = fixture(); assert.equal(validateLaunchManifest(m), m);
  assert.equal(launchManifestHash(m, ethers), launchManifestHash(Object.fromEntries(Object.entries(m).reverse()), ethers));
  assert.throws(() => canonicalLaunchJson({unsafe: 1.2}), /unsupported/);
  for (const change of [x => {x.transaction.apiVersion = 'v4';}, x => {x.planHash = hash(1);}, x => {delete x.infrastructure;},
    x => {x.fees.projectBuyFeeBps = 179;}, x => {x.execution.maxTotalGasWei = '5000000000000001';},
    x => {x.maxLaunchGasWei = '800000000000001';}, x => {x.components.hook.address = x.components.token.address;}]) {
    const altered = structuredClone(m); change(altered); assert.throws(() => validateLaunchManifest(altered));
  }
  assert.equal(validateLaunchConsent(consent(m), m, ethers).economicRiskAccepted, false);
});

test('exact finalized receipt becomes a read-only production config without signing', async () => {
  const {m, provider, state} = fixture(); const result = await verifyLaunchReceipt(provider, m, hash(999), {now});
  assert.equal(result.state, 'verified'); assert.equal(result.proof.gasCostWei, '100000000000000');
  assert.equal(result.proof.initialTokensReceivedWei, '200'); assert.equal(result.proof.signing, false);
  const c = productionConfigFromLaunch(m, result.proof); assert.equal(c.symbol, 'ROBIN'); assert.equal(c.execution.broadcastEnabled, false);
  assert.equal(c.deploymentBlock, launched); assert.ok(c.excludedAddresses.includes(m.components.initializer.address));
  assert.equal(Object.hasOwn(c, 'payoutStartTimestamp'), false);
  assert.equal(Object.hasOwn(c.execution, 'payoutIntervalSeconds'), false);
  assert.ok(state.calls.every(call => [launched, launched - 1].includes(call.blockTag)));
});

test('the old 1.8% / 0.2% split is rejected in admission and finalized contract readback', async () => {
  const oldManifest = structuredClone(fixture().m);
  Object.assign(oldManifest.fees, {projectBuyFeeBps: 180, projectSellFeeBps: 180, platformFeeBps: 20});
  assert.throws(() => validateLaunchManifest(oldManifest), /Launch fees changed/);
  for (const oldReadback of [
    {creatorBuyFeeBps: 180n}, {creatorSellFeeBps: 180n}, {PLATFORM_FEE_BPS: 20n},
    {creatorBuyFeeBps: 180n, creatorSellFeeBps: 180n, PLATFORM_FEE_BPS: 20n},
  ]) {
    const f = fixture(); Object.assign(f.state.values, oldReadback);
    await assert.rejects(verifyLaunchReceipt(f.provider, f.m, hash(999), {now}), /fixed fee settings/);
    assert.equal(f.state.calls.length > 0, true);
  }
});

test('automation needs separate exact consent, approved host digest and finalized proof', async () => {
  const {m, provider} = fixture('after-reviewed-launch'), c = consent(m), expected = launchManifestHash(m, ethers);
  const {proof} = await verifyLaunchReceipt(provider, m, hash(999), {now});
  assert.equal(operatorStartupAllowed(m, null, proof, expected), false);
  assert.equal(operatorStartupAllowed(m, c, proof, null), false);
  assert.equal(operatorStartupAllowed(m, c, {...proof, finalized: false}, expected), false);
  assert.equal(operatorStartupAllowed(m, c, proof, expected), true);
  assert.throws(() => operatorStartupAllowed(m, {...c, economicRiskAccepted: false}, proof, expected), /consent/);
  assert.throws(() => operatorStartupAllowed(m, {...c, nonce: '4'}, proof, expected), /consent/);
  assert.equal(operatorStartupAllowed(m, {...c, reviewedAt: now + 100}, proof, expected), false);
});

test('wrong transaction, fee, factory, inventory, old rewards and gas evidence fail closed', async () => {
  const changes = [f => {f.tx.nonce++;}, f => {f.tx.value++;}, f => {f.tx.data = '0xabcd';}, f => {f.tx.gasLimit--;},
    f => {f.tx.from = addr(99);}, f => {f.tx.to = addr(99);}, f => {f.receipt.status = 0;}, f => {f.receipt.blockHash = hash(44);},
    f => {f.state.values.creatorBuyFeeBps = 179n;}, f => {f.state.values.graphFactory = addr(88);}, f => {f.state.values.creatorRecipient = addr(88);},
    f => {f.state.values.initialTokensOut = 201n;}, f => {f.state.values.reserved = 1n;}, f => {f.tx.maxFeePerGas = 900000000n;},
    f => {f.receipt.gasPrice = 200000000n;}, f => {f.receipt.gasUsed = 6000000n;},
    f => {f.provider.getBalance = async () => 0n;}, f => {f.provider.getCode = async () => '0x';}];
  for (const change of changes) {const f = fixture(); change(f); await assert.rejects(verifyLaunchReceipt(f.provider, f.m, hash(999), {now}));}
});

test('missing receipt and unfinalized receipt never produce a launch proof', async () => {
  const f = fixture(); f.state.finalized = launched - 1;
  assert.deepEqual(await verifyLaunchReceipt(f.provider, f.m, hash(999), {now}), {state: 'waiting-for-finality'});
  f.provider.getTransactionReceipt = async () => null;
  assert.deepEqual(await verifyLaunchReceipt(f.provider, f.m, hash(999), {now}), {state: 'waiting-for-receipt'});
});

test('mint discovery persists exact readonly output and restart preserves journals', async t => {
  const {m, provider, state} = fixture(), target = dir(t);
  const firstStatus = await runLaunchBootstrapCycle(provider, m, target, options(m));
  assert.equal(firstStatus.state, 'verified-manual'); assert.equal(firstStatus.automaticRewardsApproved, false);
  assert.equal(fs.existsSync(path.join(target, 'production.operator.json')), false);
  fs.mkdirSync(path.join(target, 'operator')); fs.writeFileSync(path.join(target, 'operator', 'journal.json'), 'do not change');
  const proof = fs.readFileSync(path.join(target, 'launch-proof.json'), 'utf8'); state.logRanges.length = 0;
  const second = await runLaunchBootstrapCycle(provider, m, target, options(m));
  assert.equal(second.state, 'verified-manual'); assert.deepEqual(state.logRanges, []);
  assert.equal(fs.readFileSync(path.join(target, 'launch-proof.json'), 'utf8'), proof);
  assert.equal(fs.readFileSync(path.join(target, 'operator', 'journal.json'), 'utf8'), 'do not change');
});

test('reviewed automatic gate produces bounded operator config only after final proof', async t => {
  const {m, provider} = fixture('after-reviewed-launch'), target = dir(t);
  const waiting = await runLaunchBootstrapCycle(provider, m, target, options(m));
  assert.equal(waiting.state, 'verified-awaiting-review-gate'); assert.equal(fs.existsSync(path.join(target, 'production.operator.json')), false);
  const active = await runLaunchBootstrapCycle(provider, m, target, {...options(m), consent: consent(m), approvedManifestSha256: launchManifestHash(m, ethers)});
  assert.equal(active.state, 'ready-for-approved-services'); assert.equal(active.signing, false);
  const c = JSON.parse(fs.readFileSync(active.operatorConfig, 'utf8')); assert.equal(c.execution.broadcastEnabled, true);
  assert.equal(c.execution.maxTotalGasWei, m.execution.maxTotalGasWei);
});

test('waiting scan is incremental and discovers a later launch after restart', async t => {
  const f = fixture(), target = dir(t); f.state.deployed = false; f.state.finalized = launched - 1;
  assert.equal((await runLaunchBootstrapCycle(f.provider, f.m, target, options(f.m))).state, 'waiting-for-launch');
  f.state.deployed = true; f.state.finalized = launched + 1; f.state.logRanges.length = 0;
  assert.equal((await runLaunchBootstrapCycle(f.provider, f.m, target, options(f.m))).state, 'verified-manual');
  assert.deepEqual(f.state.logRanges, [[launched, launched + 1]]);
});

test('changed source, corrupt state, forked checkpoint and overwritten output are rejected', async t => {
  const f = fixture(), target = dir(t);
  await assert.rejects(runLaunchBootstrapCycle(f.provider, f.m, target, {...options(f.m), sourceRevision: 'b'.repeat(40)}), /revision/);
  await runLaunchBootstrapCycle(f.provider, f.m, target, options(f.m));
  const file = path.join(target, 'launch-bootstrap-state.json'), original = fs.readFileSync(file, 'utf8');
  const tampered = JSON.parse(original); tampered.state.transactionHash = hash(88); fs.writeFileSync(file, JSON.stringify(tampered));
  await assert.rejects(runLaunchBootstrapCycle(f.provider, f.m, target, options(f.m)), /reconciliation/);
  fs.writeFileSync(file, original); const getBlock = f.provider.getBlock;
  f.provider.getBlock = async n => n === f.state.finalized ? {...await getBlock(n), hash: hash(81)} : getBlock(n);
  await assert.rejects(runLaunchBootstrapCycle(f.provider, f.m, target, options(f.m)), /history changed/);
  f.provider.getBlock = getBlock; fs.writeFileSync(path.join(target, 'production.readonly.json'), '{}');
  await assert.rejects(runLaunchBootstrapCycle(f.provider, f.m, target, options(f.m)), /differs/);
});

test('v2 bootstrap requires reviewed worker revision and fresh consent while contract provenance remains pinned', async t => {
  const f = fixture('after-reviewed-launch'), oldConsent = consent(f.m), originalRevision = f.m.sourceRevision;
  Object.assign(f.m, {schemaVersion: 'robinhook.launch-bootstrap.v2', workerSourceRevision: 'b'.repeat(40)});
  const target = dir(t), workerOptions = {...options(f.m), sourceRevision: f.m.workerSourceRevision};
  await assert.rejects(runLaunchBootstrapCycle(f.provider, f.m, target, options(f.m)), /revision/);
  await assert.rejects(runLaunchBootstrapCycle(f.provider, f.m, target, {...workerOptions, consent: oldConsent}), /consent/);
  const result = await runLaunchBootstrapCycle(f.provider, f.m, target, {...workerOptions,
    consent: consent(f.m), approvedManifestSha256: launchManifestHash(f.m, ethers)});
  assert.equal(result.state, 'ready-for-approved-services'); assert.equal(result.signing, false);
  assert.equal(f.m.sourceRevision, originalRevision);
});

test('v3 bootstrap anchors the reviewed schedule to finalized launch time only after fresh consent', async t => {
  const f = fixture('after-reviewed-launch');
  Object.assign(f.m, {schemaVersion: 'robinhook.launch-bootstrap.v2', workerSourceRevision: 'b'.repeat(40)});
  const oldConsent = consent(f.m), originalTransaction = structuredClone(f.m.transaction);
  f.m.schemaVersion = 'robinhook.launch-bootstrap.v3';
  f.m.accounting.minimumAgeSeconds = 300; f.m.execution.payoutIntervalSeconds = 900;
  const target = dir(t), workerOptions = {...options(f.m), sourceRevision: f.m.workerSourceRevision};
  await assert.rejects(runLaunchBootstrapCycle(f.provider, f.m, target, options(f.m)), /revision/);
  await assert.rejects(runLaunchBootstrapCycle(f.provider, f.m, target, {...workerOptions, consent: oldConsent}), /consent/);
  const waiting = await runLaunchBootstrapCycle(f.provider, f.m, target, workerOptions);
  assert.equal(waiting.state, 'verified-awaiting-review-gate');
  assert.equal(fs.existsSync(path.join(target, 'production.operator.json')), false);
  const readonly = loadConfig(path.join(target, 'production.readonly.json'));
  assert.equal(readonly.execution.broadcastEnabled, false);
  assert.equal(readonly.minimumAgeSeconds, 300); assert.equal(readonly.execution.payoutIntervalSeconds, 900);
  const proof = JSON.parse(fs.readFileSync(path.join(target, 'launch-proof.json'), 'utf8'));
  assert.equal(readonly.payoutStartTimestamp, proof.checkpoint.timestamp);
  assert.equal(readonly.payoutStartTimestamp, now - 60, 'schedule is anchored to launch, not watcher start or current time');
  const active = await runLaunchBootstrapCycle(f.provider, f.m, target, {...workerOptions,
    consent: consent(f.m), approvedManifestSha256: launchManifestHash(f.m, ethers)});
  const config = loadConfig(active.operatorConfig);
  assert.equal(active.signing, false); assert.equal(active.state, 'ready-for-approved-services');
  assert.equal(config.execution.broadcastEnabled, true);
  assert.equal(config.payoutStartTimestamp, readonly.payoutStartTimestamp);
  assert.equal(config.execution.payoutIntervalSeconds, 900);
  assert.deepEqual(f.m.transaction, originalTransaction);
  for (const timestamp of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined])
    assert.throws(() => productionConfigFromLaunch(f.m, {...proof, checkpoint: {...proof.checkpoint, timestamp}}), /verified exact launch proof/);
  const configFile = path.join(target, 'invalid-config.json');
  for (const mutate of [c => delete c.payoutStartTimestamp, c => c.payoutStartTimestamp = 0,
    c => c.payoutStartTimestamp = 1.5, c => c.payoutStartTimestamp = Number.MAX_SAFE_INTEGER + 1,
    c => c.execution.payoutIntervalSeconds = 0, c => delete c.execution.payoutIntervalSeconds]) {
    const changed = structuredClone(config); mutate(changed); fs.writeFileSync(configFile, JSON.stringify(changed));
    assert.throws(() => loadConfig(configFile), /payout/);
  }
});

test('missing mint proof and consumed launch nonce cannot be mistaken for a launch', async t => {
  const f = fixture(); f.provider.getLogs = async () => [];
  await assert.rejects(runLaunchBootstrapCycle(f.provider, f.m, dir(t), options(f.m)), /mint evidence/);
  f.state.deployed = false; f.state.nonce = 4;
  await assert.rejects(runLaunchBootstrapCycle(f.provider, f.m, dir(t), options(f.m)), /nonce was consumed/);
});

test('standby waits offline before admission and pins one exact package across restarts', t => {
  const {m} = fixture(), target = dir(t), env = {ROBIN_LAUNCH_STATE_DIRECTORY: target, ROBIN_RPC_URL: 'https://archive.invalid/', ROBIN_SOURCE_REVISION: m.sourceRevision};
  const settings = standbySettings(env);
  assert.equal(inspectLaunchAdmission(settings).state, 'waiting-for-reviewed-package');
  const envelope = {schemaVersion: 'robinhook.launch-admission.v1', manifestSha256: launchManifestHash(m, ethers), manifest: m};
  fs.writeFileSync(settings.admissionFile, JSON.stringify(envelope));
  assert.equal(inspectLaunchAdmission(settings).state, 'reviewed-package-admitted');
  assert.equal(inspectLaunchAdmission(settings).manifestSha256, envelope.manifestSha256);
  const changed = structuredClone(envelope); changed.manifest.execution.minimumBatchWei = '1';
  changed.manifestSha256 = launchManifestHash(changed.manifest, ethers); fs.writeFileSync(settings.admissionFile, JSON.stringify(changed));
  assert.throws(() => inspectLaunchAdmission(settings), /changed/);
  fs.unlinkSync(settings.admissionFile); assert.throws(() => inspectLaunchAdmission(settings), /missing/);
});

test('standby rejects outside paths, combined consent, bad digest and wrong release', t => {
  const {m} = fixture(), target = dir(t), env = {ROBIN_LAUNCH_STATE_DIRECTORY: target, ROBIN_RPC_URL: 'https://archive.invalid/', ROBIN_SOURCE_REVISION: m.sourceRevision};
  assert.throws(() => standbySettings({...env, ROBIN_LAUNCH_ADMISSION_FILE: path.resolve(target, '..', 'outside.json')}), /inside/);
  assert.throws(() => standbySettings({...env, ROBIN_LAUNCH_CONSENT_FILE: path.join(target, 'admission.json')}), /separate/);
  assert.throws(() => standbySettings({...env, ROBIN_RPC_URL: 'http://archive.invalid/'}), /HTTPS/);
  const settings = standbySettings(env), envelope = {schemaVersion: 'robinhook.launch-admission.v1', manifestSha256: sha(1), manifest: m};
  fs.writeFileSync(settings.admissionFile, JSON.stringify(envelope)); assert.throws(() => inspectLaunchAdmission(settings), /digest/);
  envelope.manifestSha256 = launchManifestHash(m, ethers); fs.writeFileSync(settings.admissionFile, JSON.stringify(envelope));
  assert.throws(() => inspectLaunchAdmission({...settings, sourceRevision: 'b'.repeat(40)}), /revision/);
});

test('prelaunch standby CLI exits successfully with no RPC or custody access', t => {
  const target = dir(t), result = spawnSync(process.execPath, ['scripts/launch-standby.mjs', '--once'], {encoding: 'utf8', timeout: 10000,
    env: {...process.env, ROBIN_LAUNCH_STATE_DIRECTORY: target, ROBIN_LAUNCH_ADMISSION_FILE: path.join(target, 'admission.json'),
      ROBIN_LAUNCH_CONSENT_FILE: path.join(target, 'review.json'), ROBIN_RPC_URL: 'https://never-contact-this-host.invalid/', ROBIN_SOURCE_REVISION: 'a'.repeat(40),
      ROBIN_KEYSTORE_FILE: path.join(target, 'nonexistent-custody-file'), ROBIN_KEYSTORE_PASSWORD_FILE: path.join(target, 'nonexistent-password-file')}});
  assert.equal(result.status, 0, result.stderr); const status = JSON.parse(result.stdout.trim());
  assert.equal(status.state, 'waiting-for-reviewed-package'); assert.equal(status.watcher, 'not-started'); assert.equal(status.signing, false);
  assert.equal(fs.existsSync(path.join(target, 'runtime')), false); assert.equal(fs.existsSync(path.join(target, 'launch-standby.lock')), false);
});

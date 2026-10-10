import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Interface, keccak256, toQuantity} from 'ethers';
import {refreshDistributorEvidence} from '../src/distributor-evidence.mjs';
import {ROBINHOOD_ANCHOR, POOL_MANAGER, POOL_MANAGER_HASH} from '../src/production-network.mjs';
import {DISTRIBUTOR_HASH} from '../signing-ui/robin-launch-guards.mjs';

const evidence = JSON.parse(fs.readFileSync('docs/robin-distributor.public.json', 'utf8'));
const now = Date.parse('2026-10-10T12:00:00Z'), iface = new Interface(['function operator() view returns(address)']);
function fixture() {
  const head = {number: toQuantity(evidence.blockNumber + 10000), hash: '0x' + 'a'.repeat(64), timestamp: toQuantity(now / 1000)};
  const finalized = {number: toQuantity(evidence.blockNumber + 5000), hash: '0x' + 'b'.repeat(64), timestamp: toQuantity(now / 1000 - 1000)};
  const receipt = {transactionHash: evidence.transactionHash, blockHash: evidence.blockHash, blockNumber: toQuantity(evidence.blockNumber),
    status: '0x1', contractAddress: evidence.address, from: evidence.from};
  const transaction = {hash: evidence.transactionHash, blockHash: evidence.blockHash, blockNumber: receipt.blockNumber,
    chainId: '0x1237', from: evidence.from, to: null, nonce: '0x1', value: '0x0', input: '0x01'};
  const state = {chainId: '0x1237', anchor: {hash: ROBINHOOD_ANCHOR.blockHash}, head, finalized, receipt, transaction,
    block: {hash: evidence.blockHash}, managerCode: '0x02', code: '0x03', originalCode: '0x03',
    operator: evidence.operator, canonicalFinalized: {...finalized}};
  const calls = [], rpc = async (method, params) => {
    calls.push([method, params]);
    switch (method) {
      case 'eth_chainId': return state.chainId;
      case 'eth_getTransactionByHash': assert.equal(params[0], evidence.transactionHash); return state.transaction;
      case 'eth_getTransactionReceipt': return state.receipt;
      case 'eth_getBlockByNumber': return params[0] === 'latest' ? state.head : params[0] === 'finalized' ? state.finalized
        : params[0] === toQuantity(ROBINHOOD_ANCHOR.blockNumber) ? state.anchor
        : params[0] === receipt.blockNumber ? state.block : state.canonicalFinalized;
      case 'eth_getCode': return params[0] === POOL_MANAGER ? state.managerCode : params[1] === receipt.blockNumber ? state.originalCode : state.code;
      case 'eth_call': assert.equal(params.length, 2); assert.equal(params[0].to, evidence.address);
        assert.equal(params[0].data, iface.encodeFunctionData('operator')); return iface.encodeFunctionResult('operator', [state.operator]);
      default: throw Error('Unexpected RPC ' + method);
    }
  };
  const hashCode = code => ({'0x01': evidence.creationBytecodeHash, '0x02': POOL_MANAGER_HASH, '0x03': DISTRIBUTOR_HASH}[code] ?? keccak256(code));
  return {state, calls, rpc, hashCode};
}

test('public distributor evidence refresh verifies existing canonical creation/runtime/operator with read-only RPC', async () => {
  const f = fixture(), report = await refreshDistributorEvidence({evidence, now, rpc: f.rpc, hashCode: f.hashCode});
  assert.equal(report.checkedAt, new Date(now).toISOString()); assert.equal(report.transactionHash, evidence.transactionHash);
  assert.equal(report.verified, true); assert.equal(report.finalized, true); assert.equal(report.signing, false); assert.equal(report.broadcast, false);
  assert.notEqual(evidence.checkedAt, report.checkedAt, 'the shipped historical evidence is not rewritten');
  assert.ok(f.calls.every(([method]) => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getCode', 'eth_call'].includes(method)));
  assert.ok(f.calls.some(([method, args]) => method === 'eth_getCode' && args[0] === evidence.address && args[1] === toQuantity(evidence.blockNumber)));
});

test('refresh rejects wrong network, receipt, creation, runtime, operator, stale finality and changed canonical block', async () => {
  const changes = [s => s.chainId = '0x1', s => s.anchor.hash = 'wrong', s => s.receipt.status = '0x0',
    s => s.transaction.nonce = '0x2', s => s.transaction.input = '0x00', s => s.transaction.to = evidence.address,
    s => s.transaction.blockHash = 'wrong', s => s.block.hash = 'wrong', s => s.managerCode = '0x00',
    s => s.code = '0x00', s => s.originalCode = '0x00', s => s.operator = evidence.from,
    s => s.head.timestamp = toQuantity(now / 1000 - 301), s => s.finalized.timestamp = toQuantity(now / 1000 - 1801),
    s => s.finalized.number = toQuantity(evidence.blockNumber - 1), s => s.canonicalFinalized.hash = 'wrong'];
  for (const change of changes) {
    const f = fixture(); change(f.state);
    await assert.rejects(refreshDistributorEvidence({evidence, now, rpc: f.rpc, hashCode: f.hashCode}));
  }
});

test('altered public authority evidence is rejected before network access', async () => {
  let calls = 0;
  for (const change of [{operator: evidence.from}, {address: evidence.operator}, {creationBytecodeHash: '0x' + '0'.repeat(64)}]) {
    await assert.rejects(refreshDistributorEvidence({evidence: {...evidence, ...change}, now, rpc: async () => { calls++; }}), /reviewed distributor/);
  }
  assert.equal(calls, 0);
});

import {Interface, getCreateAddress, keccak256, toQuantity} from 'ethers';
import {ROBINHOOD_ANCHOR, POOL_MANAGER, POOL_MANAGER_HASH} from './production-network.mjs';
import {DISTRIBUTOR, DISTRIBUTOR_HASH} from '../signing-ui/robin-launch-guards.mjs';
import {LAUNCH_WALLET, OPERATOR} from '../signing-ui/guards.mjs';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const assert = (condition, message) => { if (!condition) throw Error(message); };
const hash = value => /^0x[0-9a-f]{64}$/.test(value ?? '');
const creationHash = '0xd4f942c982a3a81e0549c8a5d0c38c0358e5b20ff2b49bc43836a50953ebfcb0';
const iface = new Interface(['function operator() view returns(address)']);

/** Rechecks an existing public deployment. No wallet, key, signer or send method is used. */
export async function refreshDistributorEvidence({evidence, rpc, now = Date.now(), hashCode = keccak256}) {
  assert(evidence?.schemaVersion === 'robin.distributor-deployment.verified.v1' && evidence.chainId === 4663
    && same(evidence.address, DISTRIBUTOR) && same(evidence.from, LAUNCH_WALLET) && same(evidence.operator, OPERATOR)
    && evidence.runtimeCodeHash === DISTRIBUTOR_HASH && evidence.creationBytecodeHash === creationHash
    && hash(evidence.transactionHash) && hash(evidence.blockHash) && Number.isSafeInteger(evidence.blockNumber)
    && evidence.blockNumber >= ROBINHOOD_ANCHOR.blockNumber, 'Existing reviewed distributor evidence required.');
  const [chainId, anchor, head, finalized, transaction, receipt, block] = await Promise.all([
    rpc('eth_chainId', []), rpc('eth_getBlockByNumber', [toQuantity(ROBINHOOD_ANCHOR.blockNumber), false]),
    rpc('eth_getBlockByNumber', ['latest', false]), rpc('eth_getBlockByNumber', ['finalized', false]),
    rpc('eth_getTransactionByHash', [evidence.transactionHash]), rpc('eth_getTransactionReceipt', [evidence.transactionHash]),
    rpc('eth_getBlockByNumber', [toQuantity(evidence.blockNumber), false]),
  ]);
  assert(BigInt(chainId) === 4663n && anchor?.hash === ROBINHOOD_ANCHOR.blockHash, 'Production chain identity changed.');
  const seconds = Math.floor(now / 1000), headTime = Number(BigInt(head?.timestamp ?? 0)), finalTime = Number(BigInt(finalized?.timestamp ?? 0));
  assert(head && finalized && headTime <= seconds + 30 && seconds - headTime <= 300 && finalTime <= headTime
    && seconds - finalTime <= 1800 && BigInt(finalized.number) <= BigInt(head.number)
    && BigInt(finalized.number) >= BigInt(evidence.blockNumber), 'Fresh finalized production state required.');
  assert(transaction && receipt && same(transaction.hash, evidence.transactionHash) && same(receipt.transactionHash, evidence.transactionHash)
    && BigInt(transaction.chainId) === 4663n && transaction.to === null && same(transaction.from, LAUNCH_WALLET)
    && same(receipt.from, LAUNCH_WALLET) && BigInt(transaction.nonce) === 1n && BigInt(transaction.value) === 0n
    && same(getCreateAddress({from: transaction.from, nonce: 1}), DISTRIBUTOR) && same(receipt.contractAddress, DISTRIBUTOR)
    && hashCode(transaction.input) === creationHash && BigInt(receipt.status) === 1n
    && Number(BigInt(receipt.blockNumber)) === evidence.blockNumber && transaction.blockNumber === receipt.blockNumber
    && transaction.blockHash === evidence.blockHash && receipt.blockHash === evidence.blockHash && block?.hash === evidence.blockHash,
  'Existing distributor receipt or creation transaction changed.');
  const finalTag = finalized.number;
  const [managerCode, code, originalCode, operatorResult, canonicalFinalized] = await Promise.all([
    rpc('eth_getCode', [POOL_MANAGER, finalTag]), rpc('eth_getCode', [DISTRIBUTOR, finalTag]),
    rpc('eth_getCode', [DISTRIBUTOR, toQuantity(evidence.blockNumber)]),
    rpc('eth_call', [{to: DISTRIBUTOR, data: iface.encodeFunctionData('operator')}, finalTag]),
    rpc('eth_getBlockByNumber', [finalTag, false]),
  ]);
  assert(hashCode(managerCode) === POOL_MANAGER_HASH && hashCode(code) === DISTRIBUTOR_HASH && hashCode(originalCode) === DISTRIBUTOR_HASH
    && same(iface.decodeFunctionResult('operator', operatorResult)[0], OPERATOR) && canonicalFinalized?.hash === finalized.hash,
  'Finalized distributor runtime, operator or canonical checkpoint changed.');
  return {...evidence, checkedAt: new Date(now).toISOString(), finalizedBlock: Number(BigInt(finalized.number)),
    finalized: true, verified: true, status: 'verified-and-finalized', signing: false, broadcast: false};
}

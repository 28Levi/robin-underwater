import {createHash} from 'node:crypto';
import {canonicalLaunchJson, validateLaunchConsent} from './launch-manifest.mjs';
import {validateReviewManifest, ANCHOR} from '../signing-ui/robin-launch-guards.mjs';
import {MANAGER_HASH} from '../signing-ui/guards.mjs';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const HASH = /^0x[0-9a-f]{64}$/;
const sha = text => createHash('sha256').update(text).digest('hex');

export function validateBroadcastForProof(transactionHash, observed, chain, manifest, expectedHash, ethers) {
  validateReviewManifest(manifest, expectedHash, ethers);
  const t = manifest.transaction;
  if (!HASH.test(transactionHash) || !observed || !same(observed.hash, transactionHash)
    || BigInt(observed.chainId) !== 4663n || BigInt(chain.chainId) !== 4663n || chain.anchor?.hash !== ANCHOR.hash
    || ethers.keccak256(chain.managerCode) !== MANAGER_HASH
    || ethers.keccak256(chain.routerCode) !== t.routerRuntimeCodeHash
    || ethers.keccak256(chain.factoryCode) !== manifest.infrastructure.graphDeployer.runtimeCodeHash
    || !same(observed.from, t.from) || !same(observed.to, t.to) || BigInt(observed.nonce) !== BigInt(t.nonce)
    || BigInt(observed.value) !== BigInt(t.valueWei) || ethers.keccak256(observed.input ?? observed.data) !== t.calldataHash
    || BigInt(observed.gas ?? observed.gasLimit) !== BigInt(t.gasLimit)) throw Error('Observed transaction does not match the reviewed launch.');
  const price = BigInt(observed.maxFeePerGas ?? observed.gasPrice);
  if (price <= 0n || price * BigInt(t.gasLimit) > BigInt(manifest.maxLaunchGasWei)) throw Error('Broadcast transaction exceeds the reviewed gas ceiling.');
  return true;
}

/** Only relays a hash of the already user-signed, independently observed exact transaction. */
export function createBoundLaunchProof({manifest, expectedHash, request, credential, ethers, readTransaction, readChain,
  readConsent, loadAttempt, saveAttempt, fetchImpl = fetch}) {
  validateReviewManifest(manifest, expectedHash, ethers);
  if (typeof credential !== 'string' || !credential.trim() || /\s/.test(credential)) throw Error('Missing in-memory platform credential.');
  const route = `https://api.programmable.market/v4/chains/4663/custom-launch-plans/${encodeURIComponent(manifest.planId)}/steps/${encodeURIComponent(manifest.transaction.stepId)}/proofs`;
  return async transactionHash => {
    if (typeof transactionHash !== 'string' || !HASH.test(transactionHash)) throw Error('Invalid submitted transaction hash.');
    validateLaunchConsent(await readConsent(), manifest, ethers);
    const bytes = canonicalLaunchJson({schemaVersion: 'programmable.custom-launch-plan-step-proof.v1', transactionHash});
    const idempotencyKey = `robin-proof-${sha(`${expectedHash}\n${manifest.planId}\n${manifest.transaction.stepId}\n${bytes}`)}`;
    const binding = {schemaVersion: 'robinhook.launch-proof-attempt.v1', manifestSha256: expectedHash, planId: manifest.planId,
      stepId: manifest.transaction.stepId, transactionDigest: manifest.transaction.transactionDigest, transactionHash, idempotencyKey, bytes};
    const prior = await loadAttempt();
    if (prior && Object.entries(binding).some(([key, value]) => prior[key] !== value)) throw Error('A different proof attempt already exists. Reconcile the original hash.');
    const [observed, chain] = await Promise.all([readTransaction(transactionHash), readChain()]);
    validateBroadcastForProof(transactionHash, observed, chain, manifest, expectedHash, ethers);
    if (prior?.state === 'platform-proof-recorded') return {status: 'proof-recorded', transactionHash};
    // Persist before the network mutation; retries preserve precisely this route/body/key.
    await saveAttempt({...binding, state: 'platform-proof-outcome-pending'});
    let response;
    try {
      response = await fetchImpl(route, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: {Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', Accept: 'application/json',
          'Programmable-Launch-Response-Version': '1.2', 'Idempotency-Key': idempotencyKey}, body: bytes});
    } catch { throw Error('Platform proof outcome is uncertain. Preserve the original transaction; retry only its proof.'); }
    if (![200, 202].includes(response.status) || response.redirected
      || !response.headers.get('content-type')?.toLowerCase().includes('application/json')
      || Number(response.headers.get('content-length')) > 68157440) throw Error('Platform proof is pending or unavailable. Retry only this same transaction hash.');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 68157440) throw Error('Platform proof response exceeds its published limit.');
      chunks.push(Buffer.from(chunk));
    }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString('utf8').replaceAll(credential, '[redacted]')); }
    catch { throw Error('Platform proof response could not be verified. Preserve the original transaction.'); }
    const step = result.steps?.find(s => s.stepId === manifest.transaction.stepId);
    if (result.schemaVersion !== 'programmable.custom-launch-plan-resource.v1' || result.planId !== manifest.planId
      || !['wallet_action_ready', 'broadcast', 'mined', 'final', 'source_verified', 'indexed', 'publicly_visible'].includes(result.status)
      || result.planHash !== manifest.planHash || result.rawRequestSha256 !== manifest.requestSha256
      || result.manifestDigest !== manifest.platformManifestDigest || canonicalLaunchJson(result.plan) !== canonicalLaunchJson(request)
      || step?.transactionDigest !== manifest.transaction.transactionDigest || !same(step.transactionHash, transactionHash)) {
      throw Error('Platform proof acknowledgement is not bound to the submitted transaction. Preserve its hash.');
    }
    await saveAttempt({...binding, state: 'platform-proof-recorded', platformStatus: result.status});
    return {status: 'proof-recorded', transactionHash};
  };
}

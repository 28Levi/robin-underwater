import {createHash} from 'node:crypto';
import {inspectPackedRequest, verifyPlanResource} from './launch-plan-api.mjs';
import {canonicalLaunchJson} from './launch-manifest.mjs';

const check = (condition, message) => { if (!condition) throw Error(message); };
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
export const replanHash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const canonicalBytes = value => Buffer.from(canonicalLaunchJson(value));
export const domainHash = (domain, value) => replanHash(Buffer.concat([Buffer.from(domain + '\0'), canonicalBytes(value)]));
const PLAN_VERSION = 'programmable.custom-launch-plan.v1';
const REPLAN_VERSION = 'programmable.custom-launch-plan-replan.v1';

function responseResource(value, successfulResponseRequired = false) {
  if (value?.data) {
    check([200, 202].includes(value.httpStatus) && value.ok !== false, 'A successful immutable API response is required.');
    return value.data;
  }
  check(!successfulResponseRequired, 'Original POST and predecessor response wrappers are required.');
  return value?.resource ?? value;
}
function verifyCanonicalHashes(resource) {
  check(resource?.schemaVersion === 'programmable.custom-launch-plan-resource.v1'
    && resource.plan?.schemaVersion === PLAN_VERSION, 'Versioned owned plan resource required.');
  check(resource.rawRequestSha256 === replanHash(canonicalBytes(resource.plan))
    && resource.planHash === domainHash(PLAN_VERSION, resource.plan)
    && resource.manifestDigest === resource.plan.manifestDigest, 'Resource canonical hashes do not match its stored plan.');
  verifyPlanResource(resource, {hash: resource.rawRequestSha256, planHash: resource.planHash, plan: resource.plan});
}
function execution(plan) {
  const copy = structuredClone(plan);
  check(copy.budgets && Object.hasOwn(copy.budgets, 'validAfter') && Object.hasOwn(copy.budgets, 'deadline'), 'Plan budget window is missing.');
  delete copy.budgets.validAfter;
  delete copy.budgets.deadline;
  return canonicalLaunchJson(copy);
}
function verifyReview(review, original, intent, now) {
  check(review?.state === 'approved' && !review.requiresRepack && !review.supersededBy
    && review.subjectHash === intent.approvalSubjectHash && digest(review.subjectHash)
    && review.chainId === '4663' && sameAddress(review.controller, intent.controller)
    && Date.parse(review.expiresAt) === Date.parse(intent.approvalExpiresAt)
    && Date.parse(review.expiresAt) === Date.parse(original.expiresAt)
    && Date.parse(review.approvedAt) === Date.parse(original.approvedAt)
    && Date.parse(review.expiresAt) > now, 'Existing approval subject, owner or approval window changed or expired.');
}
function bindingOf(resource, predecessor, intent) {
  const binding = resource.replan;
  check(binding?.schemaVersion === REPLAN_VERSION && digest(binding.bindingHash), 'Server replan binding is missing.');
  const {bindingHash, ...unsigned} = binding;
  check(bindingHash === domainHash(REPLAN_VERSION, unsigned), 'Server replan binding hash is invalid.');
  for (const [field, expected] of Object.entries({previousPlanId: predecessor.planId,
    previousPlanHash: predecessor.planHash, previousRawRequestSha256: predecessor.rawRequestSha256,
    previousManifestDigest: predecessor.manifestDigest, chainId: '4663'})) {
    check(binding[field] === expected && intent.predecessor?.[field] === expected, `Replan predecessor ${field} binding differs.`);
  }
  check(sameAddress(binding.controller, intent.controller) && sameAddress(intent.predecessor?.controller, intent.controller)
    && Array.isArray(binding.finalizedPrefix) && binding.finalizedPrefix.length === 0
    && Array.isArray(intent.predecessor?.finalizedPrefix) && intent.predecessor.finalizedPrefix.length === 0,
  'Unexpected replan controller or finalized prefix.');
  return binding;
}

/** Read-only reconciliation. Never repairs, repacks execution, refreshes timestamps locally, or calls an API. */
export function reconcileReplanInputs({requestBytes, packReport, preparation, accepted, evidence, now = Date.now()}) {
  const original = inspectPackedRequest(Buffer.from(requestBytes), packReport);
  check(Buffer.from(requestBytes).equals(canonicalBytes(original.plan))
    && original.planHash === domainHash(PLAN_VERSION, original.plan), 'Original report is not bound to the canonical approved request.');
  check(preparation?.schemaVersion === 'robin.launch-plan-preparation.v1'
    && /^[0-9a-f]{40}$/.test(preparation.sourceRevision ?? '')
    && canonicalLaunchJson(preparation.packer) === canonicalLaunchJson(packReport)
    && preparation.manifestDigest === original.plan.manifestDigest
    && preparation.sourceCommitment === replanHash(canonicalBytes(original.plan.verificationBundle?.compilationUnits)),
  'Original preparation, pack report or approved source commitment differs.');
  const intent = evidence?.intent;
  check(intent?.schemaVersion === 'robin.single-replan-intent.v1' && intent.method === 'POST'
    && intent.responseVersion === '1.2' && intent.permittedPostAttempts === 1
    && intent.rawRequestSha256 === original.hash && intent.byteLength === requestBytes.length
    && sameAddress(intent.controller, original.plan.controller.address)
    && typeof intent.credentialId === 'string' && intent.credentialId.length > 0
    && /^robin-replan-[0-9a-f-]{36}$/.test(intent.idempotencyKey ?? '')
    && intent.walletSigning === false && intent.transactionBroadcast === false,
  'Immutable single-operation replan intent does not bind the original package.');
  const predecessor = responseResource(evidence.predecessorResponse, true);
  const posted = responseResource(evidence.postResponse, true);
  const current = responseResource(accepted);
  for (const resource of [predecessor, posted, current]) {
    verifyCanonicalHashes(resource);
    check(resource.plan.chainId === '4663' && sameAddress(resource.plan.controller?.address, intent.controller)
      && execution(resource.plan) === execution(original.plan), 'Only the server budget timestamps may differ; source, execution, fees and gas must be identical.');
  }
  check(intent.endpoint === `/v4/chains/4663/custom-launch-plans/${predecessor.planId}:replan`
    && predecessor.planId !== posted.planId && current.planId === posted.planId,
  'Original replan endpoint or successor identity differs.');
  check(Array.isArray(predecessor.steps) && predecessor.steps.every(step => step.status === 'wallet_action_ready' && !step.transactionHash)
    && !['broadcast', 'mined', 'final', 'source_verified', 'indexed', 'publicly_visible'].includes(predecessor.status),
  'Predecessor has unresolved or completed transaction execution.');
  verifyPlanResource(posted, original);
  check(canonicalLaunchJson(posted.plan) === canonicalLaunchJson(original.plan), 'Original POST did not accept the exact original request.');
  const binding = bindingOf(posted, predecessor, intent);
  check(canonicalLaunchJson(current.replan) === canonicalLaunchJson(binding), 'Current successor replan binding changed.');
  for (const resource of [predecessor, posted, current]) verifyReview(resource.manualReview, predecessor.manualReview, intent, now);
  check(current.status === 'wallet_action_ready' && current.steps?.length === 1
    && current.steps[0].status === 'wallet_action_ready' && current.steps[0].transactionHash === null,
  'One unsubmitted wallet-ready successor step is required.');
  const {validAfter, deadline} = current.plan.budgets;
  check(typeof validAfter === 'string' && /^(0|[1-9][0-9]*)$/.test(validAfter)
    && typeof deadline === 'string' && /^(0|[1-9][0-9]*)$/.test(deadline), 'Canonical server window timestamps required.');
  const currentSecond = BigInt(Math.floor(now / 1000));
  check(BigInt(validAfter) <= currentSecond && currentSecond < BigInt(deadline)
    && BigInt(deadline) - BigInt(validAfter) <= 86400n
    && BigInt(deadline) <= BigInt(Math.floor(Date.parse(intent.approvalExpiresAt) / 1000)),
  'Server window must be live and remain inside the original approval.');
  const refreshedBytes = canonicalBytes(current.plan);
  const changes = ['validAfter', 'deadline'].filter(key => original.plan.budgets[key] !== current.plan.budgets[key])
    .map(key => ({path: `/budgets/${key}`, original: original.plan.budgets[key], current: current.plan.budgets[key]}));
  return {refreshedBytes, resource: current, provenance: {
    schemaVersion: 'robin.reviewed-replan-reconciliation.v1', checkedAt: new Date(now).toISOString(),
    purpose: 'read-only-wallet-handoff-inputs; not a new platform submission', sourceRevision: preparation.sourceRevision,
    originalRawRequestSha256: original.hash, originalPlanHash: original.planHash,
    originalPreparationSha256: replanHash(canonicalBytes(preparation)),
    refreshedRawRequestSha256: current.rawRequestSha256, refreshedPlanHash: current.planHash,
    previousPlanId: predecessor.planId, successorPlanId: current.planId, replanBindingHash: binding.bindingHash,
    originalReplanIdempotencyKey: intent.idempotencyKey, approvalSubjectHash: intent.approvalSubjectHash,
    approvalExpiresAt: intent.approvalExpiresAt, changedFields: changes,
    sourceExecutionFeesAndGasUnchanged: true,
    evidenceSha256: {intent: replanHash(canonicalBytes(intent)), postResponse: replanHash(canonicalBytes(evidence.postResponse)),
      predecessorResponse: replanHash(canonicalBytes(evidence.predecessorResponse)), accepted: replanHash(canonicalBytes(accepted))},
    apiRequests: 0, walletSigning: false, transactionBroadcast: false,
  }};
}

/** A report from the pinned official packer is mandatory; never synthesize admission or a pack report. */
export function bindRefreshedPreparation({reconciled, requestBytes, packReport, preparation}) {
  check(replanHash(canonicalBytes(preparation)) === reconciled.provenance.originalPreparationSha256, 'Original preparation changed after reconciliation.');
  check(Buffer.from(requestBytes).equals(reconciled.refreshedBytes), 'Official packer changed the verified server plan.');
  const packed = inspectPackedRequest(Buffer.from(requestBytes), packReport);
  verifyPlanResource(reconciled.resource, packed);
  check(packed.planHash === domainHash(PLAN_VERSION, packed.plan), 'Official report plan hash differs.');
  return {...structuredClone(preparation), packer: structuredClone(packReport)};
}

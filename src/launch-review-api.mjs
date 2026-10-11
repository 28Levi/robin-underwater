import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PLAN_API_ORIGIN, inspectPackedRequest, verifyCredential, verifyPlanResource } from './launch-plan-api.mjs';
import { acquireLock, atomicWrite } from './store.mjs';

const base = '/v4/chains/4663/';
const feedbackPath = '/v1/custom-launch-reviews/feedback';
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/.test(value);
const digest = value => /^sha256:[a-f0-9]{64}$/.test(value ?? '');

export function inspectReviewRequest(value) {
  const expected = value?.operation === 'ownerRead' ? ['operation', 'chainId', 'launchId']
    : value?.operation === 'replace' ? ['operation', 'chainId', 'launchId', 'revision', 'subjectHash', 'replacementReviewId'] : [];
  if (!expected.length || !value || Object.keys(value).length !== expected.length ||
      !expected.every(key => Object.hasOwn(value, key)) || value.chainId !== '4663' || !identifier(value.launchId) ||
      value.operation === 'replace' && (!Number.isSafeInteger(value.revision) || value.revision < 1 ||
        !digest(value.subjectHash) || !identifier(value.replacementReviewId))) throw Error('Only exact Robinhood ownerRead and replace review requests are permitted');
  return value;
}

// This deliberately does not expand the plan client's URL or mutation allowlist.
export function createReviewApi(key, { fetchImpl = fetch } = {}) {
  if (typeof key !== 'string' || !key.trim() || /\s/.test(key)) throw Error('Missing or malformed API credential');
  return async request => {
    inspectReviewRequest(request);
    let response;
    try {
      response = await fetchImpl(PLAN_API_ORIGIN + feedbackPath, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Programmable-Launch-Response-Version': '1.2' },
        body: JSON.stringify(request),
      });
    } catch { throw Error('Review request outcome unknown; reconcile the owned plan before any further replacement'); }
    if (response.redirected) throw Error('Review redirect rejected');
    if (Number(response.headers.get('content-length')) > 68157440) throw Error('Review response exceeds published owner limit');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 68157440) throw Error('Review response exceeds published owner limit');
      chunks.push(Buffer.from(chunk));
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8').replaceAll(key, '[redacted]')); }
    catch { throw Error(`Review returned non-JSON (HTTP ${response.status})`); }
    const header = response.headers.get('retry-after');
    const retryAfter = typeof header === 'string' && header.length <= 128 && !/[\r\n]/.test(header) &&
      (/^\d+$/.test(header) && Number.isSafeInteger(Number(header)) ||
       /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header) && Number.isFinite(Date.parse(header))) ? header : null;
    return { ok: response.ok, httpStatus: response.status, data, headers: { retryAfter } };
  };
}

function verifySubmission(bundle, credential) {
  const packed = inspectPackedRequest(bundle.bytes, bundle.report);
  const credentialId = verifyCredential(credential, packed, { currentManifest: false });
  const journal = JSON.parse(fs.readFileSync(path.join(bundle.stateDirectory, 'submission.json'), 'utf8'));
  const identity = { rawRequestSha256: packed.hash, planHash: packed.planHash, idempotencyKey: packed.idempotencyKey,
    credentialId, controller: packed.plan.controller.address, chainId: '4663' };
  if (journal.state !== 'owned-plan' || !identifier(journal.planId) ||
      Object.entries(identity).some(([key, value]) => journal[key] !== value) ||
      journal.resumeUrl !== base + 'custom-launch-plans/' + encodeURIComponent(journal.planId)) throw Error('Review requires the original owned submission and credential binding');
  return { packed, journal };
}

async function readBoundPlan(api, binding) {
  const result = await api(binding.journal.resumeUrl);
  if (!result.ok) throw Error(`Owned plan read failed (HTTP ${result.httpStatus})`);
  const resource = verifyPlanResource(result.data, binding.packed), review = resource.manualReview;
  if (resource.planId !== binding.journal.planId || !isDeepStrictEqual(resource.plan, binding.packed.plan) ||
      review?.schemaVersion !== 'programmable.custom-launch-manual-review.v1' || review.chainId !== '4663' ||
      review.controller?.toLowerCase() !== binding.packed.plan.controller.address.toLowerCase() ||
      !identifier(review.reviewId) || !Number.isSafeInteger(review.revision) || review.revision < 1 ||
      !digest(review.subjectHash) || !Number.isFinite(Date.parse(review.submittedAt))) throw Error('Owned review identity differs from the exact submitted plan');
  return resource;
}

const isReplacement = (review, replacement) => review.supersededBy?.launchId === replacement.planId &&
  (review.supersededBy.reviewId == null || review.supersededBy.reviewId === replacement.manualReview.reviewId);

export async function runReviewOperation({ action, original, replacement, api, reviewApi, stateDirectory, now = Date.now() }) {
  if (!['ownerRead', 'replace'].includes(action) || !Number.isSafeInteger(now)) throw Error('Unsupported review operation');
  if (action === 'replace' && !replacement) throw Error('Replacement owned submission required');
  const directory = path.resolve(stateDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const release = acquireLock(path.join(directory, 'review.lock'));
  try {
    const credential = await api(base + 'custom-launch-credentials/me');
    if (!credential.ok) throw Error(`Credential check failed (HTTP ${credential.httpStatus})`);
    const oldBinding = verifySubmission(original, credential.data);
    const oldPlan = await readBoundPlan(api, oldBinding);
    atomicWrite(path.join(directory, 'original-plan.json'), oldPlan);
    const readRequest = { operation: 'ownerRead', chainId: '4663', launchId: oldPlan.planId };
    const ownerRead = await reviewApi(readRequest);
    atomicWrite(path.join(directory, 'owner-review.json'), { checkedAt: new Date(now).toISOString(), launchId: oldPlan.planId, ...ownerRead });
    if (action === 'ownerRead') return { ...ownerRead, planId: oldPlan.planId, reviewId: oldPlan.manualReview.reviewId, signing: false, broadcast: false };
    if (!ownerRead.ok) throw Error(`Owner review read failed (HTTP ${ownerRead.httpStatus}); replacement not sent`);
    const newBinding = verifySubmission(replacement, credential.data);
    const newPlan = await readBoundPlan(api, newBinding);
    atomicWrite(path.join(directory, 'replacement-plan.json'), newPlan);
    if (oldPlan.planId === newPlan.planId || oldPlan.manualReview.reviewId === newPlan.manualReview.reviewId ||
        oldBinding.packed.plan.controller.address.toLowerCase() !== newBinding.packed.plan.controller.address.toLowerCase() ||
        Date.parse(newPlan.manualReview.submittedAt) <= Date.parse(oldPlan.manualReview.submittedAt)) throw Error('Replacement must be a newer distinct owned review for the same controller and chain');
    const journalFile = path.join(directory, 'replacement.json');
    const existing = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : null;
    const identity = { credentialId: credential.data.credentialId, chainId: '4663', controller: oldBinding.packed.plan.controller.address.toLowerCase(),
      originalPlanId: oldPlan.planId, originalRawRequestSha256: oldBinding.packed.hash, originalReviewId: oldPlan.manualReview.reviewId,
      replacementPlanId: newPlan.planId, replacementRawRequestSha256: newBinding.packed.hash, replacementReviewId: newPlan.manualReview.reviewId };
    if (existing && Object.entries(identity).some(([key, value]) => existing[key] !== value)) throw Error('Replacement journal belongs to different exact submissions; reconcile it first');
    if (isReplacement(oldPlan.manualReview, newPlan)) {
      atomicWrite(journalFile, { ...existing, ...identity, state: 'replacement-confirmed', checkedAt: new Date(now).toISOString() });
      return { ok: true, status: 'replacement-confirmed', planId: oldPlan.planId, replacementPlanId: newPlan.planId, signing: false, broadcast: false };
    }
    if (existing) return { ok: false, status: 'replacement-unresolved', planId: oldPlan.planId, replacementPlanId: newPlan.planId,
      message: 'A previous replacement attempt is not confirmed. Owner state was re-read; no replacement was resent.', signing: false, broadcast: false };
    if (oldPlan.manualReview.supersededBy || newPlan.manualReview.supersededBy ||
        !Array.isArray(oldPlan.steps) || oldPlan.steps.length !== 0 || !Array.isArray(newPlan.steps) || newPlan.steps.length !== 0 ||
        !['pending', 'rejected', 'expired'].includes(oldPlan.manualReview.state) || newPlan.manualReview.state !== 'pending') throw Error('Replacement requires an unsigned old review and a pending unsuperseded newer review');
    const capabilities = await api(base + 'custom-launch-capabilities');
    if (!capabilities.ok || capabilities.data.chainId !== '4663' || capabilities.data.manifestDigest !== newBinding.packed.plan.manifestDigest ||
        capabilities.data.availability?.operations?.read?.state !== 'active') throw Error('Current platform read operation and replacement manifest must be active');
    const request = inspectReviewRequest({ operation: 'replace', chainId: '4663', launchId: oldPlan.planId,
      revision: oldPlan.manualReview.revision, subjectHash: oldPlan.manualReview.subjectHash, replacementReviewId: newPlan.manualReview.reviewId });
    // No documented idempotency semantics exist here. Persist before POST and never automatically resend.
    atomicWrite(journalFile, { ...identity, request, state: 'replacement-outcome-pending', attemptedAt: new Date(now).toISOString() });
    const result = await reviewApi(request);
    atomicWrite(path.join(directory, 'replacement-response.json'), result);
    if (!result.ok) return { ...result, status: 'replacement-unresolved', planId: oldPlan.planId, replacementPlanId: newPlan.planId, signing: false, broadcast: false };
    const confirmed = await readBoundPlan(api, oldBinding);
    atomicWrite(path.join(directory, 'original-plan.json'), confirmed);
    const status = isReplacement(confirmed.manualReview, newPlan) ? 'replacement-confirmed' : 'replacement-unresolved';
    atomicWrite(journalFile, { ...identity, request, state: status, attemptedAt: new Date(now).toISOString() });
    return { ...result, ok: status === 'replacement-confirmed', status, planId: oldPlan.planId, replacementPlanId: newPlan.planId, signing: false, broadcast: false };
  } finally { release(); }
}

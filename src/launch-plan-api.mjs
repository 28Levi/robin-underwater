import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { acquireLock, atomicWrite } from './store.mjs';

export const PLAN_API_ORIGIN = 'https://api.programmable.market';
const base = '/v4/chains/4663/';
export const requestHash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

export function inspectPackedRequest(bytes, report) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16777216) throw Error('Invalid packed request size');
  const hash = requestHash(bytes), plan = JSON.parse(bytes.toString('utf8'));
  if (report?.status !== 'packed' || report.rawRequestSha256 !== hash || report.byteLength !== bytes.length ||
      report.idempotencyKey !== 'clp-v1-' + hash.slice(7) || report.manifestDigest !== plan.manifestDigest ||
      !/^sha256:[a-f0-9]{64}$/.test(report.planHash ?? '') || plan.schemaVersion !== 'programmable.custom-launch-plan.v1' ||
      plan.chainId !== '4663' || plan.executor !== 'atomic_execute_and_stamp_v2' ||
      plan.admissionPolicy !== 'programmable.custom-launch-policy.provenance.v1' ||
      !Array.isArray(plan.feeObligations) || plan.feeObligations.length || plan.publication?.visibility !== 'listed' ||
      !/^0x[a-fA-F0-9]{40}$/.test(plan.controller?.address ?? '')) throw Error('Exact ROBIN pack report and supported plan required');
  return { plan, hash, planHash: report.planHash, idempotencyKey: report.idempotencyKey };
}

export function safePlanPath(value) {
  const url = new URL(value, PLAN_API_ORIGIN);
  if (url.origin !== PLAN_API_ORIGIN || url.username || url.password || url.search || url.hash) throw Error('Unapproved launch API path');
  if (['custom-launch-credentials/me', 'custom-launch-capabilities', 'custom-launch-plans', 'custom-launch-plans:preflight'].some(route => url.pathname === base + route)) return url.pathname;
  const prefix = base + 'custom-launch-plans/';
  if (!url.pathname.startsWith(prefix)) throw Error('Unapproved launch API path');
  const encoded = url.pathname.slice(prefix.length);
  let id; try { id = decodeURIComponent(encoded); } catch { throw Error('Invalid encoded plan identifier'); }
  if (encoded.includes('/') || !/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/.test(id)) throw Error('Unapproved launch API path');
  return prefix + encodeURIComponent(id);
}

export function createPlanApi(key, { fetchImpl = fetch } = {}) {
  if (typeof key !== 'string' || !key.trim() || /\s/.test(key)) throw Error('Missing or malformed API credential');
  return async function request(apiPath, { bytes, idempotencyKey } = {}) {
    const route = safePlanPath(apiPath), method = bytes ? 'POST' : 'GET';
    if (method === 'POST' && ![base + 'custom-launch-plans', base + 'custom-launch-plans:preflight'].includes(route)) throw Error('Only preflight and plan creation are permitted');
    const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Programmable-Launch-Response-Version': '1.2' };
    if (bytes) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let response;
    try {
      response = await fetchImpl(PLAN_API_ORIGIN + route, { method, headers, body: bytes, redirect: 'error', signal: AbortSignal.timeout(60000) });
    } catch { throw Error('Platform request outcome unknown; preserve exact bytes and idempotency key before retrying'); }
    if (response.redirected) throw Error('Platform redirect rejected');
    if (Number(response.headers.get('content-length')) > 68157440) throw Error('Platform response exceeds published limit');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 68157440) throw Error('Platform response exceeds published limit');
      chunks.push(Buffer.from(chunk));
    }
    // Response artifacts must never persist the request credential, even if reflected by an error.
    const raw = Buffer.concat(chunks).toString('utf8').replaceAll(key, '[redacted]');
    let data;
    try { data = JSON.parse(raw); } catch { throw Error(`Platform returned non-JSON (HTTP ${response.status})`); }
    const readHeader = name => {
      const value = response.headers.get(name);
      return typeof value === 'string' && value.length <= 2048 && !/[\r\n]/.test(value) ? value.replaceAll(key, '[redacted]') : null;
    };
    const retryAfter = readHeader('retry-after');
    const validRetryAfter = retryAfter !== null && (/^\d+$/.test(retryAfter)
      ? Number.isSafeInteger(Number(retryAfter))
      : /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryAfter) && Number.isFinite(Date.parse(retryAfter)));
    let location = null;
    try { const value = readHeader('location'); if (value !== null) location = safePlanPath(value); } catch { /* Untrusted destinations are not followed or persisted. */ }
    return { httpStatus: response.status, ok: response.ok, data, headers: { retryAfter: validRetryAfter ? retryAfter : null, location } };
  };
}

export function verifyCredential(credential, packed, { currentManifest = true } = {}) {
  if (credential?.schemaVersion !== 'programmable.custom-launch-credential.v1' || credential.chainId !== '4663' ||
      credential.controller?.toLowerCase() !== packed.plan.controller.address.toLowerCase() ||
      (currentManifest && credential.manifestDigest !== packed.plan.manifestDigest) ||
      !['custom-launch:create', 'custom-launch:read'].every(scope => credential.scopes?.includes(scope)) ||
      typeof credential.credentialId !== 'string' || !credential.credentialId.trim()) throw Error('Credential does not authorize this controller, chain and manifest');
  return credential.credentialId;
}

export function verifyPlanResource(resource, packed) {
  if (!resource || resource.rawRequestSha256 !== packed.hash || resource.planHash !== packed.planHash ||
      resource.manifestDigest !== packed.plan.manifestDigest || resource.plan?.chainId !== '4663' ||
      resource.plan?.controller?.address?.toLowerCase() !== packed.plan.controller.address.toLowerCase() ||
      resource.plan?.executor !== 'atomic_execute_and_stamp_v2' || !resource.planId) throw Error('Platform resource differs from the exact submitted plan');
  const route = safePlanPath(resource.resumeUrl);
  if (route !== base + 'custom-launch-plans/' + encodeURIComponent(resource.planId)) throw Error('Unexpected owned plan status path');
  return resource;
}

function hasOnlyPendingAtomicPermit(data) {
  if (data?.launchEligibility?.status !== 'analysis_pending' || !Array.isArray(data.findings) || data.findings.length !== 1) return false;
  const finding = data.findings[0];
  return finding?.code === 'PLAN_ADMISSION_PENDING' && finding.actual === 'atomic_permit_pending' &&
    finding.blockingAxis === 'lifecycle' && finding.stage === 'execution' && finding.jsonPointer === '/executor' &&
    finding.constraint?.required === 'source_bound_pre_execution_order_then_signed_call_simulation';
}

function requestWindowIsOpen(plan, now) {
  const { validAfter, deadline } = plan.budgets ?? {};
  if (!Number.isSafeInteger(now) || !/^\d+$/.test(validAfter ?? '') || !/^\d+$/.test(deadline ?? '')) return false;
  const current = BigInt(Math.floor(now / 1000));
  return BigInt(validAfter) <= current && current < BigInt(deadline);
}

export async function runPlanOperation({ action, bytes, report, api, stateDirectory, now = Date.now(), allowPendingAtomicReview = false }) {
  if (typeof allowPendingAtomicReview !== 'boolean') throw Error('Pending Atomic review opt-in must be boolean');
  const packed = inspectPackedRequest(bytes, report), directory = path.resolve(stateDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const release = acquireLock(path.join(directory, 'platform.lock'));
  const journalFile = path.join(directory, 'submission.json'), preflightFile = path.join(directory, 'preflight.json');
  try {
    const existing = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : null;
    const credentials = await api(base + 'custom-launch-credentials/me');
    if (!credentials.ok) throw Error(`Credential check failed (HTTP ${credentials.httpStatus})`);
    const credentialId = verifyCredential(credentials.data, packed, { currentManifest: !existing });
    const identity = { rawRequestSha256: packed.hash, planHash: packed.planHash, idempotencyKey: packed.idempotencyKey, credentialId, controller: packed.plan.controller.address, chainId: '4663' };
    if (existing && Object.entries(identity).some(([key, value]) => existing[key] !== value)) throw Error('Existing submission binds different bytes or credential; reconcile it before proceeding');
    if (action === 'credential') return { credential: credentials.data, signing: false, broadcast: false };
    if (action === 'status' || existing?.resumeUrl) {
      if (!existing?.resumeUrl) throw Error('No owned plan recorded; recover creation with exact original bytes and key');
      const result = await api(existing.resumeUrl);
      if (result.ok) verifyPlanResource(result.data, packed);
      atomicWrite(path.join(directory, 'resource.json'), result);
      return result;
    }
    if (!['preflight', 'create'].includes(action)) throw Error('Unsupported plan operation');
    // Exact replay can recover an earlier ambiguous create even after new writes close.
    // A server lookup miss still has to pass the platform's current admission checks.
    const recovering = action === 'create' && existing?.state === 'submission-outcome-pending';
    if (!recovering) {
      const capabilities = await api(base + 'custom-launch-capabilities');
      if (!capabilities.ok || capabilities.data.manifestDigest !== packed.plan.manifestDigest ||
          capabilities.data.availability?.operations?.[action]?.state !== 'active') throw Error('Current platform manifest/operation is not active');
    }
    if (action === 'preflight') {
      const result = await api(base + 'custom-launch-plans:preflight', { bytes });
      if (result.ok && (result.data.planHash !== packed.planHash || result.data.manifestDigest !== packed.plan.manifestDigest)) throw Error('Preflight binding mismatch');
      atomicWrite(preflightFile, { ...identity, checkedAt: new Date(now).toISOString(), ...result });
      return result;
    }
    const checked = fs.existsSync(preflightFile) ? JSON.parse(fs.readFileSync(preflightFile, 'utf8')) : null;
    if (!recovering) {
      const age = now - Date.parse(checked?.checkedAt);
      const exactEvidence = checked?.ok === true && Object.entries(identity).every(([key, value]) => checked[key] === value) &&
        checked.data?.planHash === packed.planHash && checked.data.manifestDigest === packed.plan.manifestDigest &&
        Array.isArray(checked.data.launchEligibility?.hardBlockers) && checked.data.launchEligibility.hardBlockers.length === 0 &&
        Number.isFinite(age) && age >= 0;
      const ready = checked?.data?.launchEligibility?.status === 'ready' && age <= 600000;
      // Platform review precedes permit issuance. This explicit exception admits only that
      // lifecycle finding; it does not relax wallet readiness or transaction simulation.
      const pendingReview = allowPendingAtomicReview && hasOnlyPendingAtomicPermit(checked?.data) && requestWindowIsOpen(packed.plan, now);
      if (!exactEvidence || !(ready || pendingReview)) throw Error('Fresh successful preflight for these exact bytes required, or explicit pending Atomic review with exact lifecycle-only evidence and an open request window');
    }
    // Persist binding BEFORE the first network mutation. An ambiguous response retains the same identity.
    atomicWrite(journalFile, { ...existing, ...identity, createdAt: existing?.createdAt ?? new Date(now).toISOString(), state: 'submission-outcome-pending' });
    const result = await api(base + 'custom-launch-plans', { bytes, idempotencyKey: packed.idempotencyKey });
    if (result.ok) {
      const resource = verifyPlanResource(result.data, packed);
      atomicWrite(journalFile, { ...identity, createdAt: existing?.createdAt ?? new Date(now).toISOString(), state: 'owned-plan', planId: resource.planId, resumeUrl: resource.resumeUrl });
    }
    atomicWrite(path.join(directory, 'resource.json'), result);
    return result;
  } finally { release(); }
}

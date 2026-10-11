import http from 'node:http';
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {canonicalLaunchJson, validateLaunchConsent} from './launch-manifest.mjs';
import {validateLaunchPackage, validateReviewManifest} from '../signing-ui/robin-launch-guards.mjs';

const JSON_TYPE = 'application/json; charset=utf-8';
const HEADERS = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fixedEqual = (a, b) => typeof a === 'string' && timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export function verifyLaunchProofInputs({manifest, expectedHash, requestBytes, acceptedResource, ethers}) {
  validateReviewManifest(manifest, expectedHash, ethers);
  if (sha256(requestBytes) !== manifest.requestSha256) throw Error('Exact packed launch request changed.');
  const request = JSON.parse(Buffer.from(requestBytes).toString('utf8'));
  if (canonicalLaunchJson(request) !== canonicalLaunchJson(acceptedResource.plan)) throw Error('Accepted resource is not the exact packed plan.');
  return request;
}

export function verifyLaunchReviewInputs({manifest, expectedHash, requestBytes, acceptedResource, ethers, now = Date.now()}) {
  const request = verifyLaunchProofInputs({manifest, expectedHash, requestBytes, acceptedResource, ethers});
  validateLaunchPackage({checkedAt: new Date(now).toISOString(), resource: acceptedResource}, manifest, expectedHash, ethers, now);
  return request;
}

/** Stored evidence pins identity; only a fresh authenticated read establishes
 * current admission on server restart. Proof-only recovery never calls this. */
export async function refreshLaunchReviewInputs({readCurrentResource, ...inputs}) {
  verifyLaunchProofInputs(inputs);
  const current = await readCurrentResource();
  verifyLaunchReviewInputs({...inputs, acceptedResource: current});
  return current;
}

/** Read only the exact owned plan. The credential never reaches the browser or a redirect. */
export function createPlatformPlanReader({planId, resumeUrl, credential, fetchImpl = fetch}) {
  const base = 'https://api.programmable.market';
  const url = new URL(resumeUrl, base);
  const prefix = '/v4/chains/4663/custom-launch-plans/';
  if (url.origin !== base || url.username || url.password || url.search || url.hash
    || !url.pathname.startsWith(prefix) || decodeURIComponent(url.pathname.slice(prefix.length)) !== planId) {
    throw Error('The status URL is not the exact owned Programmable plan.');
  }
  if (typeof credential !== 'string' || !credential.trim() || /[\r\n]/.test(credential)) throw Error('Missing valid in-memory platform credential.');
  return async () => {
    const response = await fetchImpl(url.href, {method: 'GET', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(20000), headers: {Authorization: `Bearer ${credential}`, Accept: 'application/json',
        'Programmable-Launch-Response-Version': '1.2'}});
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw Error('Fresh platform plan validation is unavailable.');
    }
    // Published owner response limit. Never echo platform response/error bodies to the browser or log.
    if (Number(response.headers.get('content-length')) > 68157440) throw Error('Platform response exceeds its published limit.');
    const bytes = await readLimited(response.body, 68157440);
    return JSON.parse(Buffer.from(bytes).toString('utf8').replaceAll(credential, '[redacted]'));
  };
}

async function readLimited(stream, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw Error('Request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The only mutation is a local, manifest-bound consent file after the user's explicit review click. */
export function createLaunchReviewServer({manifest, expectedHash, requestBytes, acceptedResource, readCurrentResource,
  writeConsent, readRecordedConsent, readHostReadiness, submitProof, assets, ethers, now = () => Date.now(), port = 8792, sessionToken = randomBytes(32).toString('hex')}) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local review port.');
  const request = verifyLaunchReviewInputs({manifest, expectedHash, requestBytes, acceptedResource, ethers, now: now()});
  // Clone inputs so external callers cannot mutate an approved manifest during a request.
  manifest = JSON.parse(canonicalLaunchJson(manifest));
  const origin = `http://127.0.0.1:${port}`;
  let loading = false, recordedConsent = null;
  async function reviewReadiness() {
    let validatedReview = false;
    try {
      const consent = readRecordedConsent ? await readRecordedConsent() : recordedConsent;
      if (!consent) return {reviewRecorded: false, hostReady: false};
      validateLaunchConsent(consent, manifest, ethers);
      validatedReview = true;
      if (manifest.activation.mode === 'manual') return {reviewRecorded: true, hostReady: true, expiresAt: manifest.transaction.expiresAt};
      const host = readHostReadiness ? await readHostReadiness() : null;
      if (host?.ready !== true || host.manifestSha256 !== expectedHash || !Number.isFinite(Date.parse(host.expiresAt)) || Date.parse(host.expiresAt) <= now()) {
        return {reviewRecorded: true, hostReady: false};
      }
      return {reviewRecorded: true, hostReady: true, expiresAt: host.expiresAt};
    } catch { return {reviewRecorded: validatedReview, hostReady: false}; }
  }
  async function freshPackage() {
    const resource = await readCurrentResource();
    if (canonicalLaunchJson(resource.plan) !== canonicalLaunchJson(request)) throw Error('Current platform plan changed.');
    const pkg = {checkedAt: new Date(now()).toISOString(), resource};
    validateLaunchPackage(pkg, manifest, expectedHash, ethers, now());
    return pkg;
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value, type = JSON_TYPE) => {
      res.writeHead(status, {...HEADERS, 'Content-Type': type});
      res.end(type === JSON_TYPE ? JSON.stringify(value) : value);
    };
    if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)
      || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
      send(403, {error: 'Forbidden'}); return;
    }
    if (req.method === 'POST' && ['/review', '/signing-ready', '/launch-proof'].includes(req.url)) {
      if (req.headers.origin !== origin || req.headers['sec-fetch-site'] !== 'same-origin'
        || !fixedEqual(req.headers['x-robin-review-token'], sessionToken)
        || req.headers['content-type'] !== 'application/json' || req.headers['content-encoding']) {
        send(403, {error: 'Forbidden'}); return;
      }
      if (loading) { send(429, {error: 'Validation is already in progress.'}); return; }
      loading = true;
      try {
        const body = JSON.parse((await readLimited(req, 2048)).toString('utf8'));
        if (req.url === '/signing-ready') {
          if (canonicalLaunchJson(Object.keys(body)) !== canonicalLaunchJson(['manifestSha256']) || body.manifestSha256 !== expectedHash) {
            throw Error('Exact signing readiness binding required.');
          }
          await freshPackage();
          const readiness = await reviewReadiness();
          if (!readiness.reviewRecorded || !readiness.hostReady) throw Error('Rewards host is not ready.');
          send(200, {status: 'signing-ready', manifestSha256: expectedHash, expiresAt: readiness.expiresAt}); return;
        }
        if (req.url === '/launch-proof') {
          if (!submitProof || canonicalLaunchJson(Object.keys(body).sort()) !== canonicalLaunchJson(['manifestSha256', 'transactionHash'])
            || body.manifestSha256 !== expectedHash || typeof body.transactionHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(body.transactionHash)) {
            throw Error('Exact proof binding required.');
          }
          send(200, await submitProof(body.transactionHash)); return;
        }
        if (canonicalLaunchJson(Object.keys(body).sort()) !== canonicalLaunchJson(['automationAccepted', 'economicRiskAccepted', 'manifestSha256', 'reviewAccepted'].sort())
          || body.manifestSha256 !== expectedHash || body.reviewAccepted !== true
          || body.automationAccepted !== (manifest.activation.mode === 'after-reviewed-launch')
          || typeof body.economicRiskAccepted !== 'boolean'
          || (body.automationAccepted && body.economicRiskAccepted !== true)) throw Error('Explicit review is missing.');
        await freshPackage();
        const consent = {schemaVersion: 'robinhook.launch-review.v1', manifestSha256: expectedHash,
          account: manifest.transaction.from, nonce: manifest.transaction.nonce, reviewedAt: Math.floor(now() / 1000),
          automationAccepted: body.automationAccepted, economicRiskAccepted: body.economicRiskAccepted, execution: manifest.execution};
        validateLaunchConsent(consent, manifest, ethers);
        const preserved = await writeConsent(consent);
        recordedConsent = validateLaunchConsent(preserved ?? consent, manifest, ethers);
        send(200, {status: 'review-recorded', manifestSha256: expectedHash});
      } catch { send(503, {error: req.url === '/launch-proof'
        ? 'Platform proof is pending or unavailable. Preserve the original transaction hash and retry only its proof; never launch again.'
        : req.url === '/signing-ready' ? 'Rewards host is not ready for this exact review. No wallet action opened.'
        : 'Review was not recorded. Refresh the exact platform handoff before opening your wallet.'}); }
      finally { loading = false; }
      return;
    }
    if (req.method !== 'GET') { send(403, {error: 'Forbidden'}); return; }
    if (req.url === '/session.json') {
      send(200, {manifest, manifestSha256: expectedHash, reviewToken: sessionToken, publication: acceptedResource.plan.publication}); return;
    }
    if (req.url === '/readiness.json') {
      send(200, {...await reviewReadiness(), manifestSha256: expectedHash}); return;
    }
    if (req.url === '/package.json') {
      if (loading) { send(429, {error: 'Validation is already in progress.'}); return; }
      loading = true;
      try { send(200, await freshPackage()); }
      catch { send(503, {error: 'Fresh exact platform validation is unavailable. No wallet action opened.'}); }
      finally { loading = false; }
      return;
    }
    const asset = assets.get(req.url);
    if (!asset) { send(404, {error: 'Not found'}); return; }
    send(200, asset.bytes, asset.type);
  });
  server.requestTimeout = 25000;
  server.headersTimeout = 10000;
  return {server, origin, freshPackage};
}

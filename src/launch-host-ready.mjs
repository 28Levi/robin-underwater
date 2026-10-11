import {createHash} from 'node:crypto';
import {validateLaunchConsent, launchManifestHash, effectiveWorkerSourceRevision} from './launch-manifest.mjs';

const keys = ['schemaVersion', 'manifestSha256', 'sourceRevision', 'consentSha256', 'account', 'nonce', 'checkedAt',
  'automationApprovedManifestSha256', 'servicesEnabled', 'admissionInstalled', 'consentInstalled',
  'watcherRunning', 'noStopMarkers', 'state'];

/** A trusted host administrator records this after inspecting the actual installation.
 * This is a local handoff gate, not a cryptographic remote-host attestation.
 * The review server never creates this acknowledgement or invents user consent. */
export function validateLaunchHostReady(ack, {manifest, expectedHash, consentBytes, ethers, now = Date.now()}) {
  const fail = () => { throw Error('Exact, fresh rewards-host acknowledgement is required before signing.'); };
  if (launchManifestHash(manifest, ethers) !== expectedHash || !Buffer.isBuffer(consentBytes)) fail();
  const consent = validateLaunchConsent(JSON.parse(consentBytes.toString('utf8')), manifest, ethers);
  const checkedAt = Date.parse(ack?.checkedAt), age = now - checkedAt;
  if (!ack || Object.keys(ack).length !== keys.length || keys.some(key => !Object.hasOwn(ack, key))
    || ack.schemaVersion !== 'robinhook.launch-host-ready.v1' || ack.manifestSha256 !== expectedHash
    || ack.sourceRevision !== effectiveWorkerSourceRevision(manifest)
    || ack.consentSha256 !== `sha256:${createHash('sha256').update(consentBytes).digest('hex')}`
    || ack.account?.toLowerCase() !== manifest.transaction.from.toLowerCase() || ack.nonce !== manifest.transaction.nonce
    || ack.automationApprovedManifestSha256 !== expectedHash || manifest.activation.mode !== 'after-reviewed-launch'
    || ack.servicesEnabled !== true || ack.admissionInstalled !== true || ack.consentInstalled !== true
    || ack.watcherRunning !== true || ack.noStopMarkers !== true || ack.state !== 'waiting-for-launch'
    || !Number.isFinite(age) || age < 0 || age > 300000 || checkedAt < consent.reviewedAt * 1000
    || now >= Date.parse(manifest.transaction.expiresAt) - 90000) fail();
  return {ready: true, manifestSha256: expectedHash,
    expiresAt: new Date(Math.min(checkedAt + 300000, Date.parse(manifest.transaction.expiresAt) - 90000)).toISOString()};
}

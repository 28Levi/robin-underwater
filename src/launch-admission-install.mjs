import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as ethers from 'ethers';
import {canonicalLaunchJson, launchManifestHash, validateLaunchConsent, validateLaunchManifest, effectiveWorkerSourceRevision} from './launch-manifest.mjs';

const MAX_BYTES = 256 * 1024;
export class AdmissionInstallError extends Error {}
const fail = message => { throw new AdmissionInstallError(message); };

function statOrNull(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function noSymlinks(file) {
  for (let current = file; ; current = path.dirname(current)) {
    if (statOrNull(current)?.isSymbolicLink()) fail('Admission paths cannot use symlinks.');
    if (path.dirname(current) === current) break;
  }
}

function readPublicFile(file) {
  noSymlinks(file);
  const before = statOrNull(file);
  if (!before?.isFile() || before.size > MAX_BYTES) fail('Expected an existing public JSON file of at most 256 KiB.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_BYTES)
      fail('Public input changed while being opened.');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > MAX_BYTES) fail('Public input exceeds 256 KiB.');
    return bytes;
  } finally { fs.closeSync(fd); }
}

function parseJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { fail('Public input is not valid JSON.'); }
}

function existingMatches(file, bytes) {
  noSymlinks(file);
  if (!statOrNull(file)) return false;
  if (!readPublicFile(file).equals(bytes)) fail('An existing admission or review differs. Preserve and reconcile durable state.');
  return true;
}

function syncDirectory(dir) {
  // Windows cannot open a directory for fsync. Linux durable hosts can and must.
  if (process.platform === 'win32') return;
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function publishExclusive(file, bytes) {
  if (existingMatches(file, bytes)) return false;
  const temp = path.join(path.dirname(file), `.admission-install-${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try {
    // A hard link exposes only the complete inode and never replaces a destination.
    // Do not replace this with rename: rename can overwrite an existing admission.
    try { fs.linkSync(temp, file); }
    catch (error) {
      if (error.code !== 'EEXIST' || !existingMatches(file, bytes)) throw error;
      return false;
    }
    syncDirectory(path.dirname(file));
    return true;
  } finally { fs.unlinkSync(temp); }
}

/** Offline installation only. Never constructs review consent, contacts RPC, or starts services. */
export function installLaunchAdmission({manifestFile, expectedManifestSha256, stateDirectory, sourceRevision, consentFile = null,
  now = Date.now()}) {
  if (typeof manifestFile !== 'string' || !manifestFile || !/^sha256:[0-9a-f]{64}$/.test(expectedManifestSha256 ?? '')
    || !/^[0-9a-f]{40}$/.test(sourceRevision ?? '') || typeof stateDirectory !== 'string' || !path.isAbsolute(stateDirectory)
    || !Number.isSafeInteger(now) || now < 0 || consentFile !== null && (typeof consentFile !== 'string' || !consentFile))
    fail('Use an explicit manifest, SHA-256 digest, running source revision and absolute durable state directory.');

  // Complete input validation before creating or changing any destination.
  const manifest = parseJson(readPublicFile(path.resolve(manifestFile)));
  try { validateLaunchManifest(manifest); } catch { fail('Invalid reviewed ROBIN launch manifest.'); }
  if (launchManifestHash(manifest, ethers) !== expectedManifestSha256 || effectiveWorkerSourceRevision(manifest) !== sourceRevision)
    fail('Manifest digest or running source revision mismatch.');
  const checkConsent = bytes => {
    const consent = parseJson(bytes);
    try { validateLaunchConsent(consent, manifest, ethers); } catch { fail('Existing review does not match the exact manifest and consent policy.'); }
    if (consent.reviewedAt * 1000 > now) fail('Existing review is dated in the future.');
    return consent;
  };
  const reviewBytes = consentFile === null ? null : readPublicFile(path.resolve(consentFile));
  if (reviewBytes) checkConsent(reviewBytes);
  const envelope = {schemaVersion: 'robinhook.launch-admission.v1', manifestSha256: expectedManifestSha256, manifest};
  const admissionBytes = Buffer.from(`${canonicalLaunchJson(envelope)}\n`);
  if (admissionBytes.length > MAX_BYTES) fail('Admission envelope exceeds 256 KiB.');

  const dir = path.resolve(stateDirectory), admission = path.join(dir, 'admission.json'), review = path.join(dir, 'launch-review.json');
  const pinned = path.join(dir, 'admitted-manifest.json'), runtime = path.join(dir, 'runtime'), lock = path.join(dir, 'admission-install.lock');
  for (const file of [dir, admission, review, pinned, runtime, lock]) noSymlinks(file);
  if (statOrNull(dir) && !statOrNull(dir).isDirectory()) fail('Durable launch state must be a directory.');
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  noSymlinks(dir);
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('Another installer or stale install lock exists; reconcile without deleting launch state.'); throw error; }
  try {
    const alreadyAdmitted = existingMatches(admission, admissionBytes);
    if (!alreadyAdmitted && (statOrNull(pinned) || statOrNull(runtime)))
      fail('Previous launch state has no matching admission. Preserve and reconcile it.');
    if (statOrNull(pinned) && canonicalLaunchJson(parseJson(readPublicFile(pinned))) !== canonicalLaunchJson(manifest))
      fail('Pinned manifest differs. Preserve and reconcile durable state.');
    // Check all existing destinations before publishing either file. A partially
    // completed review-first install can be retried only with the exact same review.
    const existingReview = statOrNull(review) ? readPublicFile(review) : null;
    if (existingReview) {
      checkConsent(existingReview);
      if (!reviewBytes && !alreadyAdmitted) fail('An existing review requires its explicit input when completing admission.');
      if (reviewBytes && !existingReview.equals(reviewBytes)) fail('Existing review bytes differ. Preserve the original review.');
    }
    const reviewInstalled = reviewBytes ? publishExclusive(review, reviewBytes) : false;
    const admissionInstalled = publishExclusive(admission, admissionBytes);
    return {state: 'admission-installed', manifestSha256: expectedManifestSha256, sourceRevision,
      admissionFile: admission, consentFile: existingReview || reviewBytes ? review : null,
      admissionInstalled, reviewInstalled, automaticServicesRequested: manifest.activation.mode === 'after-reviewed-launch',
      signing: false, broadcast: false, servicesStarted: false};
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}

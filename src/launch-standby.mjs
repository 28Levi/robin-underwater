import fs from 'node:fs';
import path from 'node:path';
import * as ethers from 'ethers';
import {atomicWrite} from './store.mjs';
import {canonicalLaunchJson, launchManifestHash, validateLaunchManifest} from './launch-manifest.mjs';

function contained(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
function noSymlink(file) {
  for (let current = file; ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Launch admission paths cannot use symlinks');
    const parent = path.dirname(current); if (parent === current) break;
  }
}

/** Validate only configuration and local public admission paths; never read a custody file. */
export function standbySettings(env) {
  const input = env.ROBIN_LAUNCH_STATE_DIRECTORY;
  if (!input || !path.isAbsolute(input)) throw Error('An absolute durable launch directory is required');
  const dir = path.resolve(input);
  const admissionFile = env.ROBIN_LAUNCH_ADMISSION_FILE ?? path.join(dir, 'admission.json');
  const consentFile = env.ROBIN_LAUNCH_CONSENT_FILE ?? path.join(dir, 'launch-review.json');
  for (const file of [admissionFile, consentFile]) {
    if (!path.isAbsolute(file) || !contained(dir, path.resolve(file))) throw Error('Admission and consent must remain inside the dedicated launch directory');
    noSymlink(file);
  }
  if (path.resolve(admissionFile) === path.resolve(consentFile)) throw Error('Admission and consent require separate files');
  const rpc = new URL(env.ROBIN_RPC_URL ?? '');
  if (rpc.protocol !== 'https:' || rpc.username || rpc.password || rpc.hash) throw Error('An HTTPS archive RPC is required');
  const sourceRevision = env.ROBIN_SOURCE_REVISION ?? env.RENDER_GIT_COMMIT;
  if (!/^[0-9a-f]{40}$/.test(sourceRevision ?? '')) throw Error('The running source revision must be explicit');
  noSymlink(dir); fs.mkdirSync(dir, {recursive: true});
  return {dir, admissionFile: path.resolve(admissionFile), consentFile: path.resolve(consentFile), sourceRevision};
}

/** One atomically delivered envelope prevents a manifest/digest partial-write race. */
export function inspectLaunchAdmission(settings) {
  const {dir, admissionFile, sourceRevision} = settings;
  const pinnedFile = path.join(dir, 'admitted-manifest.json');
  noSymlink(admissionFile); noSymlink(pinnedFile);
  if (!fs.existsSync(admissionFile)) {
    if (fs.existsSync(pinnedFile)) throw Error('Previously admitted launch package is missing; reconcile without resetting state');
    return {state: 'waiting-for-reviewed-package', signing: false, broadcast: false};
  }
  const stat = fs.statSync(admissionFile);
  if (!stat.isFile() || stat.size > 256 * 1024) throw Error('Invalid launch admission envelope');
  const envelope = JSON.parse(fs.readFileSync(admissionFile, 'utf8'));
  if (Object.keys(envelope ?? {}).sort().join(',') !== 'manifest,manifestSha256,schemaVersion'
    || envelope.schemaVersion !== 'robinhook.launch-admission.v1') throw Error('Invalid launch admission envelope');
  const manifest = validateLaunchManifest(envelope.manifest), hash = launchManifestHash(manifest, ethers);
  if (hash !== envelope.manifestSha256 || manifest.sourceRevision !== sourceRevision) throw Error('Admission digest or source revision mismatch');
  if (fs.existsSync(pinnedFile)) {
    if (canonicalLaunchJson(JSON.parse(fs.readFileSync(pinnedFile, 'utf8'))) !== canonicalLaunchJson(manifest))
      throw Error('Admitted launch package changed; preserve and reconcile state');
  } else atomicWrite(pinnedFile, manifest);
  return {state: 'reviewed-package-admitted', manifestFile: pinnedFile, manifestSha256: hash,
    automaticServicesRequested: manifest.activation.mode === 'after-reviewed-launch', signing: false, broadcast: false};
}

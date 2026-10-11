// Standalone, read-only host inspection. Run from the deployed repository root.
// This file can be copied to /tmp without changing or redeploying worker source.
// It never reads custody contents, signs, broadcasts, creates consent or starts services.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const requireTrue = value => { if (!value) throw Error('Host readiness evidence is incomplete or does not match the reviewed launch.'); };
const samePath = (a, b) => typeof a === 'string' && path.resolve(a) === path.resolve(b);
const ownKeys = (value, names) => value && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

function noSymlinks(file) {
  for (let current = file; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current); requireTrue(!stat.isSymbolicLink());
    if (path.dirname(current) === current) break;
  }
}
function publicFile(file) {
  noSymlinks(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd); requireTrue(stat.isFile() && stat.size <= 262144);
    const bytes = fs.readFileSync(fd); requireTrue(bytes.length <= 262144);
    return {bytes, value: JSON.parse(bytes.toString('utf8')), mtimeMs: stat.mtimeMs};
  } finally { fs.closeSync(fd); }
}

/** Read environment only for exact worker scripts in this repository. Never return
 * or print unrelated environment values, command arguments or provider URLs. */
export function readHostProcesses(repositoryRoot) {
  const targets = new Map(['launch-standby.mjs', 'watch-launch.mjs', 'production-operator.mjs']
    .map(name => [path.join(repositoryRoot, 'scripts', name), name]));
  const processes = [];
  for (const pid of fs.readdirSync('/proc').filter(value => /^[1-9][0-9]*$/.test(value))) {
    try {
      const dir = `/proc/${pid}`, argv = fs.readFileSync(`${dir}/cmdline`, 'utf8').split('\0').filter(Boolean);
      if (!['node', 'nodejs'].includes(path.basename(argv[0] ?? '')) || !argv[1]) continue;
      const cwd = fs.realpathSync(`${dir}/cwd`), script = path.resolve(cwd, argv[1]);
      if (!targets.has(script) || cwd !== repositoryRoot) continue;
      const allEnv = Object.fromEntries(fs.readFileSync(`${dir}/environ`, 'utf8').split('\0').filter(Boolean).map(entry => {
        const at = entry.indexOf('='); return [entry.slice(0, at), entry.slice(at + 1)];
      }));
      const allowed = ['RENDER_GIT_COMMIT', 'ROBIN_SOURCE_REVISION', 'ROBIN_LAUNCH_STATE_DIRECTORY',
        'ROBIN_LAUNCH_ADMISSION_FILE', 'ROBIN_LAUNCH_CONSENT_FILE', 'ROBIN_AUTOMATION_APPROVED_MANIFEST_SHA256'];
      const env = Object.fromEntries(allowed.filter(name => Object.hasOwn(allEnv, name)).map(name => [name, allEnv[name]]));
      const ppid = Number(fs.readFileSync(`${dir}/status`, 'utf8').match(/^PPid:\s+(\d+)$/m)?.[1]);
      requireTrue(Number.isSafeInteger(ppid));
      processes.push({pid: Number(pid), ppid, cwd, script: targets.get(script), args: argv.slice(2), env});
    } catch (error) {
      // A disappearing unrelated process is normal. A target process that cannot
      // be completely inspected is omitted, so the exact-count checks fail closed.
      if (error?.code !== 'ENOENT' && error?.code !== 'ESRCH' && error?.code !== 'EACCES') throw error;
    }
  }
  return processes;
}

export function verifyHostProcesses(processes, {repositoryRoot, stateDirectory, sourceRevision, expectedManifestSha256, requireServices}) {
  const standby = processes.filter(p => p.script === 'launch-standby.mjs');
  const watcher = processes.filter(p => p.script === 'watch-launch.mjs');
  requireTrue(standby.length === 1 && watcher.length === 1 && !processes.some(p => p.script === 'production-operator.mjs'));
  const [s] = standby, [w] = watcher;
  for (const p of [s, w]) {
    requireTrue(p.cwd === repositoryRoot && Number.isSafeInteger(p.pid) && p.pid > 0
      && p.env.RENDER_GIT_COMMIT === sourceRevision
      && (p.env.ROBIN_SOURCE_REVISION === undefined || p.env.ROBIN_SOURCE_REVISION === sourceRevision));
    if (requireServices) requireTrue(p.env.ROBIN_AUTOMATION_APPROVED_MANIFEST_SHA256 === expectedManifestSha256);
    requireTrue(p.env.ROBIN_LAUNCH_ADMISSION_FILE === undefined || samePath(p.env.ROBIN_LAUNCH_ADMISSION_FILE, path.join(stateDirectory, 'admission.json')));
    requireTrue(p.env.ROBIN_LAUNCH_CONSENT_FILE === undefined || samePath(p.env.ROBIN_LAUNCH_CONSENT_FILE, path.join(stateDirectory, 'launch-review.json')));
  }
  requireTrue(w.ppid === s.pid && samePath(s.env.ROBIN_LAUNCH_STATE_DIRECTORY, stateDirectory)
    && samePath(w.env.ROBIN_LAUNCH_STATE_DIRECTORY, path.join(stateDirectory, 'runtime')));
  requireTrue(s.args.includes('--loop') && new Set(s.args).size === s.args.length
    && s.args.every(arg => ['--loop', '--services'].includes(arg)));
  const services = s.args.includes('--services');
  requireTrue(!requireServices || services);
  const options = {};
  for (let i = 0; i < w.args.length; i++) {
    const name = w.args[i]; requireTrue(['--manifest', '--manifest-sha256', '--consent', '--loop', '--services'].includes(name) && !Object.hasOwn(options, name));
    options[name] = ['--loop', '--services'].includes(name) ? true : w.args[++i];
  }
  requireTrue(options['--loop'] === true && Boolean(options['--services']) === services
    && samePath(options['--manifest'], path.join(stateDirectory, 'admitted-manifest.json'))
    && options['--manifest-sha256'] === expectedManifestSha256
    && samePath(options['--consent'], path.join(stateDirectory, 'launch-review.json')));
  return {standbyPid: s.pid, watcherPid: w.pid, servicesEnabled: services};
}

export async function checkLaunchHostReadiness({stateDirectory, expectedManifestSha256, sourceRevision,
  repositoryRoot = fs.realpathSync(process.cwd()), now = Date.now(), readProcesses = readHostProcesses}) {
  requireTrue(path.isAbsolute(stateDirectory) && /^sha256:[0-9a-f]{64}$/.test(expectedManifestSha256 ?? '')
    && /^[0-9a-f]{40}$/.test(sourceRevision ?? '') && Number.isSafeInteger(now));
  repositoryRoot = fs.realpathSync(repositoryRoot); stateDirectory = path.resolve(stateDirectory);
  const {validateLaunchManifest, launchManifestHash, validateLaunchConsent, canonicalLaunchJson, effectiveWorkerSourceRevision} =
    await import(pathToFileURL(path.join(repositoryRoot, 'src', 'launch-manifest.mjs')).href);
  const ethers = createRequire(path.join(repositoryRoot, 'package.json'))('ethers');
  const admissionPath = path.join(stateDirectory, 'admission.json'), pinnedPath = path.join(stateDirectory, 'admitted-manifest.json');
  const consentPath = path.join(stateDirectory, 'launch-review.json'), runtime = path.join(stateDirectory, 'runtime');
  for (const marker of [path.join(stateDirectory, 'watcher-stopped.json'), path.join(runtime, 'operator-stopped.json')]) requireTrue(!fs.existsSync(marker));
  const admission = publicFile(admissionPath), pinned = publicFile(pinnedPath), envelope = admission.value;
  requireTrue(ownKeys(envelope, ['schemaVersion', 'manifestSha256', 'manifest']) && envelope.schemaVersion === 'robinhook.launch-admission.v1'
    && envelope.manifestSha256 === expectedManifestSha256);
  const manifest = validateLaunchManifest(envelope.manifest);
  requireTrue(launchManifestHash(manifest, ethers) === expectedManifestSha256 && effectiveWorkerSourceRevision(manifest) === sourceRevision
    && canonicalLaunchJson(manifest) === canonicalLaunchJson(pinned.value) && manifest.activation.mode === 'after-reviewed-launch'
    && now < Date.parse(manifest.transaction.expiresAt) - 90000);
  const consent = fs.existsSync(consentPath) ? publicFile(consentPath) : null;
  if (consent) {
    validateLaunchConsent(consent.value, manifest, ethers);
    requireTrue(consent.value.reviewedAt * 1000 <= now);
  }
  const processEvidence = verifyHostProcesses(await readProcesses(repositoryRoot), {
    repositoryRoot, stateDirectory, sourceRevision, expectedManifestSha256, requireServices: Boolean(consent)});
  const standby = publicFile(path.join(stateDirectory, 'standby-status.json'));
  const bootstrap = publicFile(path.join(runtime, 'launch-bootstrap-status.json'));
  requireTrue(standby.value.state === 'reviewed-package-admitted' && standby.value.watcher === 'running'
    && standby.value.manifestSha256 === expectedManifestSha256 && standby.value.automaticServicesRequested === true
    && samePath(standby.value.manifestFile, pinnedPath) && standby.value.signing === false && standby.value.broadcast === false
    && standby.mtimeMs <= now + 1000 && now - standby.mtimeMs <= 90000);
  requireTrue(bootstrap.value.state === 'waiting-for-launch' && bootstrap.value.manifestSha256 === expectedManifestSha256
    && bootstrap.value.signing === false && bootstrap.value.broadcast === false
    && Number.isSafeInteger(bootstrap.value.checkedAt) && bootstrap.value.checkedAt * 1000 <= now + 1000
    && now - bootstrap.value.checkedAt * 1000 <= 90000);
  requireTrue(publicFile(path.join(stateDirectory, 'launch-standby.lock')).value.pid === processEvidence.standbyPid
    && publicFile(path.join(runtime, 'launch-supervisor.lock')).value.pid === processEvidence.watcherPid);
  // Check immutable input bytes and process identity again before acknowledging.
  requireTrue(publicFile(admissionPath).bytes.equals(admission.bytes) && publicFile(pinnedPath).bytes.equals(pinned.bytes)
    && (consent ? publicFile(consentPath).bytes.equals(consent.bytes) : !fs.existsSync(consentPath)));
  const again = verifyHostProcesses(await readProcesses(repositoryRoot), {
    repositoryRoot, stateDirectory, sourceRevision, expectedManifestSha256, requireServices: Boolean(consent)});
  requireTrue(JSON.stringify(again) === JSON.stringify(processEvidence));
  for (const marker of [path.join(stateDirectory, 'watcher-stopped.json'), path.join(runtime, 'operator-stopped.json')]) requireTrue(!fs.existsSync(marker));
  if (!consent) return {state: 'waiting-user-review', manifestSha256: expectedManifestSha256, sourceRevision,
    processEvidence, signing: false, broadcast: false, acknowledgementCreated: false};
  const ack = {schemaVersion: 'robinhook.launch-host-ready.v1', manifestSha256: expectedManifestSha256, sourceRevision,
    consentSha256: hash(consent.bytes), account: manifest.transaction.from, nonce: manifest.transaction.nonce,
    checkedAt: new Date(now).toISOString(), automationApprovedManifestSha256: expectedManifestSha256,
    servicesEnabled: true, admissionInstalled: true, consentInstalled: true, watcherRunning: true, noStopMarkers: true, state: 'waiting-for-launch'};
  return {state: 'host-ready', ack, processEvidence, signing: false, broadcast: false, acknowledgementCreated: true};
}

function writeAck(file, ack) {
  requireTrue(path.isAbsolute(file)); noSymlinks(path.dirname(file)); requireTrue(!fs.existsSync(file));
  const temp = path.join(path.dirname(file), `.robin-host-ready-${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(ack, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, file); } finally { fs.unlinkSync(temp); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i]?.replace(/^--/, ''), value = process.argv[i + 1];
      requireTrue(process.argv[i]?.startsWith('--') && ['state-directory', 'manifest-sha256', 'source-revision', 'out'].includes(key)
        && value && !value.startsWith('--') && !Object.hasOwn(options, key)); options[key] = value;
    }
    requireTrue(options['state-directory'] && options['manifest-sha256'] && options['source-revision']);
    const result = await checkLaunchHostReadiness({stateDirectory: options['state-directory'],
      expectedManifestSha256: options['manifest-sha256'], sourceRevision: options['source-revision']});
    if (result.ack && options.out) { writeAck(options.out, result.ack); result.ackFile = options.out; }
    console.log(JSON.stringify(result, null, 2));
  } catch { console.error('Host readiness failed. Verify the exact installed files, live worker processes, approved source/digest and fresh waiting state. No secret values were printed; no acknowledgement was created.'); process.exitCode = 2; }
}

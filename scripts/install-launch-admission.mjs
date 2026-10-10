import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AdmissionInstallError, installLaunchAdmission} from '../src/launch-admission-install.mjs';

export function parseAdmissionInstallOptions(args) {
  const required = ['manifest', 'manifest-sha256', 'state-directory', 'source-revision'];
  const allowed = new Set([...required, 'consent']), options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith('--') || !allowed.has(name) || options.has(name) || !value || value.startsWith('--'))
      throw new AdmissionInstallError('Invalid, repeated or missing installer option.');
    options.set(name, value);
  }
  for (const name of required) if (!options.has(name)) throw new AdmissionInstallError(`Required: --${name}`);
  return {manifestFile: options.get('manifest'), expectedManifestSha256: options.get('manifest-sha256'),
    stateDirectory: options.get('state-directory'), sourceRevision: options.get('source-revision'), consentFile: options.get('consent') ?? null};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseAdmissionInstallOptions(process.argv.slice(2));
    const runningRevision = process.env.ROBIN_SOURCE_REVISION ?? process.env.RENDER_GIT_COMMIT;
    if (runningRevision !== undefined && runningRevision !== options.sourceRevision)
      throw new AdmissionInstallError('Explicit source revision differs from the running host revision.');
    console.log(JSON.stringify(installLaunchAdmission(options), null, 2));
  }
  catch (error) {
    console.error(error instanceof AdmissionInstallError ? error.message : 'Admission installation failed. Preserve public inputs and durable state; no services were started.');
    process.exitCode = 2;
  }
}

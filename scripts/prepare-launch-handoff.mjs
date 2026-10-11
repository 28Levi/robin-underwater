import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLaunchRpcProvider, runLaunchCommand} from '../src/launch-rpc.mjs';
import {buildLaunchHandoff, readLaunchChainFacts} from '../src/launch-manifest-builder.mjs';

export function parseHandoffOptions(args) {
  const options = new Map(), required = ['request', 'pack-report', 'preparation', 'accepted-package', 'distributor', 'policy', 'source-revision', 'out'];
  const allowed = new Set([...required, 'activation', 'worker-source-revision']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, ''), value = args[i + 1];
    if (!allowed.has(key) || !args[i].startsWith('--') || !value || value.startsWith('--') || options.has(key)) throw Error('Invalid or repeated handoff option');
    options.set(key, value);
  }
  for (const key of required) if (!options.has(key)) throw Error(`Required: --${key}`);
  if (options.has('worker-source-revision') && !/^[0-9a-f]{40}$/.test(options.get('worker-source-revision'))) {
    throw Error('Worker source revision must be an exact 40-character lowercase commit hash.');
  }
  if (options.has('activation') && !['manual', 'after-reviewed-launch'].includes(options.get('activation'))) {
    throw Error('Activation must be manual or after-reviewed-launch; this choice still requires final user review.');
  }
  return options;
}
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function readHandoffInputs(options) {
  const out = path.resolve(options.get('out'));
  if (fs.existsSync(out)) throw Error('Use a new output directory; previous handoff evidence must be preserved.');
  return {out, requestBytes: fs.readFileSync(options.get('request')), packReport: json(options.get('pack-report')),
    preparation: json(options.get('preparation')), accepted: json(options.get('accepted-package')),
    distributor: json(options.get('distributor')), policy: json(options.get('policy')), sourceRevision: options.get('source-revision'),
    ...(options.has('worker-source-revision') ? {workerSourceRevision: options.get('worker-source-revision')} : {}),
    activationMode: options.get('activation') ?? 'manual'};
}

export async function prepareLaunchHandoff(args) {
  // Validate and read every explicit local input before any public network request.
  const {out, ...inputs} = readHandoffInputs(parseHandoffOptions(args));
  const intent = json('launch-intent.json');
  const response = await fetch('https://api.programmable.market/v4/chains/4663/custom-launch-capabilities',
    {redirect: 'error', signal: AbortSignal.timeout(20000), headers: {Accept: 'application/json'}});
  if (!response.ok) throw Error(`Current capabilities unavailable (${response.status})`);
  const capabilities = await response.json();
  const provider = createLaunchRpcProvider();
  try {
    const facts = await readLaunchChainFacts({rpc: (method, params) => provider.send(method, params), accepted: inputs.accepted, distributor: inputs.distributor});
    const result = buildLaunchHandoff({...inputs, intent, capabilities, facts});
    fs.mkdirSync(out, {recursive: false});
    for (const [name, value] of Object.entries({'manifest.json': result.manifest, 'report.json': result.report, 'chain-facts.json': facts})) {
      fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
    }
    console.log(JSON.stringify({directory: out, ...result.report}, null, 2));
  } finally { provider.destroy(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!await runLaunchCommand(() => prepareLaunchHandoff(process.argv.slice(2)))) process.exitCode = 2;
}

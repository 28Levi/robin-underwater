import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {reconcileReplanInputs, bindRefreshedPreparation, replanHash} from '../src/launch-replan-reconciliation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function parseReplanOptions(args) {
  const required = ['request', 'pack-report', 'preparation', 'accepted-package', 'replan-evidence-dir', 'out'];
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith('--') || !required.includes(key) || !value || value.startsWith('--') || options.has(key)) throw Error('Invalid or repeated replan reconciliation option.');
    options.set(key, value);
  }
  for (const key of required) if (!options.has(key)) throw Error(`Required: --${key}`);
  return options;
}
export async function prepareReplanHandoffInputs(args) {
  const options = parseReplanOptions(args), out = path.resolve(options.get('out'));
  if (fs.existsSync(out)) throw Error('Use a new reconciliation output directory; preserve previous evidence.');
  const evidenceDir = path.resolve(options.get('replan-evidence-dir'));
  const inputs = {requestBytes: fs.readFileSync(options.get('request')), packReport: json(options.get('pack-report')),
    preparation: json(options.get('preparation')), accepted: json(options.get('accepted-package')),
    evidence: {intent: json(path.join(evidenceDir, 'intent.json')), postResponse: json(path.join(evidenceDir, 'post-response.json')),
      predecessorResponse: json(path.join(evidenceDir, 'predecessor-response.json'))}};
  const reconciled = reconcileReplanInputs(inputs);
  const vendor = path.join(root, 'vendor/programmable-launch-plan-v1'), packerPath = path.join(vendor, 'request-packer.mjs');
  const index = json(path.join(vendor, 'artifact-index.json')), entry = index.artifacts?.find(a => a.fileName === 'request-packer.mjs');
  const packerBytes = fs.readFileSync(packerPath);
  if (!entry || replanHash(packerBytes) !== entry.contentSha256 || packerBytes.length !== entry.byteLength
    || index.manifestDigest !== inputs.packReport.manifestDigest) throw Error('Official packer artifact or manifest digest differs.');
  const {runCustomLaunchPlanPackerCliV1} = await import(pathToFileURL(packerPath).href);
  fs.mkdirSync(out, {recursive: false});
  const write = (name, bytes) => fs.writeFileSync(path.join(out, name), bytes, {flag: 'wx', mode: 0o600});
  const writeJson = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
  write('original-request.canonical.json', inputs.requestBytes);
  writeJson('original-pack-report.json', inputs.packReport);
  writeJson('original-preparation.json', inputs.preparation);
  writeJson('original-replan-evidence.json', inputs.evidence);
  writeJson('accepted-package.json', inputs.accepted);
  write('plan.json', reconciled.refreshedBytes);
  const code = await runCustomLaunchPlanPackerCliV1(['--input', path.join(out, 'plan.json'), '--out', path.join(out, 'request.canonical.json'), '--report', path.join(out, 'pack-report.json')]);
  if (code !== 0) throw Error('Official packer rejected server-refreshed plan. Evidence retained; no repair or submission occurred.');
  const requestBytes = fs.readFileSync(path.join(out, 'request.canonical.json')), packReport = json(path.join(out, 'pack-report.json'));
  const preparation = bindRefreshedPreparation({reconciled, requestBytes, packReport, preparation: inputs.preparation});
  writeJson('preparation.json', preparation);
  writeJson('reconciliation.json', {...reconciled.provenance, officialPackerSha256: entry.contentSha256, officialPackerVersion: packReport.packerVersion,
    preparationChange: 'Only preparation.packer replaced with the official report for the server-refreshed plan; all approved preparation fields retained.'});
  return {directory: out, ...reconciled.provenance};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareReplanHandoffInputs(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

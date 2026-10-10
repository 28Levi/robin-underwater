import fs from 'node:fs';
import path from 'node:path';
import {refreshDistributorEvidence} from '../src/distributor-evidence.mjs';
import {createLaunchRpcProvider, runLaunchCommand} from '../src/launch-rpc.mjs';

async function main() {
if (process.argv.length !== 4 || process.argv[2] !== '--out' || process.argv[3].startsWith('--')) {
  throw Error('Use --out NEW_PUBLIC_EVIDENCE_FILE. This command only verifies the existing distributor.');
}
const out = path.resolve(process.argv[3]);
if (fs.existsSync(out)) throw Error('Preserve previous evidence; choose a new output file.');
const evidence = JSON.parse(fs.readFileSync(new URL('../docs/robin-distributor.public.json', import.meta.url), 'utf8'));
const provider = createLaunchRpcProvider();
try {
  const report = await refreshDistributorEvidence({evidence, rpc: (method, params) => provider.send(method, params)});
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: report.status, file: out, checkedAt: report.checkedAt,
    address: report.address, signing: false, broadcast: false}, null, 2));
} finally { provider.destroy(); }
}
if (!await runLaunchCommand(main)) process.exitCode = 2;

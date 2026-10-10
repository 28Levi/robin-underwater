import fs from 'node:fs';
import path from 'node:path';
import {JsonRpcProvider} from 'ethers';
import {buildLaunchHandoff, readLaunchChainFacts} from '../src/launch-manifest-builder.mjs';

const options = new Map(), allowed = new Set(['request', 'pack-report', 'preparation', 'accepted-package', 'policy', 'source-revision', 'out']);
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, ''), value = process.argv[i + 1];
  if (!allowed.has(key) || !process.argv[i].startsWith('--') || !value || value.startsWith('--') || options.has(key)) throw Error('Invalid or repeated handoff option');
  options.set(key, value);
}
for (const key of allowed) if (!options.has(key)) throw Error(`Required: --${key}`);
const out = path.resolve(options.get('out'));
if (fs.existsSync(out)) throw Error('Use a new output directory; previous handoff evidence must be preserved.');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const accepted = json(options.get('accepted-package')), distributor = json('deploy/distributor.mainnet.json');
const response = await fetch('https://api.programmable.market/v4/chains/4663/custom-launch-capabilities',
  {redirect: 'error', signal: AbortSignal.timeout(20000), headers: {Accept: 'application/json'}});
if (!response.ok) throw Error(`Current capabilities unavailable (${response.status})`);
const capabilities = await response.json();
const provider = new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com');
try {
  const facts = await readLaunchChainFacts({rpc: (method, params) => provider.send(method, params), accepted, distributor});
  const result = buildLaunchHandoff({requestBytes: fs.readFileSync(options.get('request')), packReport: json(options.get('pack-report')),
    preparation: json(options.get('preparation')), accepted, intent: json('launch-intent.json'), distributor,
    policy: json(options.get('policy')), sourceRevision: options.get('source-revision'), capabilities, facts});
  fs.mkdirSync(out, {recursive: false});
  for (const [name, value] of Object.entries({'manifest.json': result.manifest, 'report.json': result.report, 'chain-facts.json': facts})) {
    fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  }
  console.log(JSON.stringify({directory: out, ...result.report}, null, 2));
} finally { provider.destroy(); }

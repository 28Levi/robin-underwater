import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as ethers from 'ethers';
import {createLaunchReviewServer, createPlatformPlanReader, refreshLaunchReviewInputs, verifyLaunchProofInputs} from '../src/launch-review-server.mjs';
import {validateLaunchConsent} from '../src/launch-manifest.mjs';
import {createBoundLaunchProof} from '../src/launch-plan-proof.mjs';
import {atomicWrite} from '../src/store.mjs';
import {ANCHOR, MANAGER} from '../signing-ui/robin-launch-guards.mjs';
import {createLaunchRpcProvider, runLaunchCommand} from '../src/launch-rpc.mjs';
import {validateLaunchHostReady} from '../src/launch-host-ready.mjs';

let activeProvider;
async function main() {
const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Set(['manifest', 'manifest-sha256', 'request', 'accepted-package', 'consent-file', 'host-ready-file', 'port', 'proof-hash']);
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i]?.replace(/^--/, ''), value = process.argv[i + 1];
  if (!process.argv[i]?.startsWith('--') || !allowed.has(name) || !value || Object.hasOwn(options, name)) {
    throw Error('Use --manifest FILE --manifest-sha256 sha256:HASH --request FILE --accepted-package FILE --consent-file FILE [--port 8792].');
  }
  options[name] = value;
}
for (const name of ['manifest', 'manifest-sha256', 'request', 'accepted-package', 'consent-file']) {
  if (!options[name]) throw Error(`Missing --${name}. No signing handoff started.`);
}
const read = name => fs.readFile(path.resolve(options[name]));
const [manifestBytes, requestBytes, acceptedBytes] = await Promise.all([read('manifest'), read('request'), read('accepted-package')]);
const manifest = JSON.parse(manifestBytes), accepted = JSON.parse(acceptedBytes);
let acceptedResource = accepted.resource ?? accepted.data ?? accepted;
const expectedHash = options['manifest-sha256'];
if (!options['proof-hash'] && manifest.activation.mode === 'after-reviewed-launch' && !options['host-ready-file']) {
  throw Error('Automatic launch review requires --host-ready-file for the independently verified host acknowledgement.');
}
if (options['proof-hash']) {
  if (!/^0x[0-9a-f]{64}$/.test(options['proof-hash'])) throw Error('Use the exact original lowercase transaction hash.');
}
// A saved short-lived admission may be stale while the reviewed order is still
// valid. Check immutable evidence now; fetch and validate live admission below.
verifyLaunchProofInputs({manifest, expectedHash, requestBytes, acceptedResource, ethers});

async function credentialFromStdin() {
  console.log('Waiting for the Programmable credential on non-echoing stdin. Read-only platform validation; no server signer.');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8'); process.stdin.resume();
  try {
    return await new Promise((resolve, reject) => {
      let buffer = '';
      const stop = () => { process.stdin.off('data', data); process.stdin.off('end', end); };
      const end = () => { stop(); reject(Error('Credential input closed.')); };
      const data = chunk => {
        if (chunk.includes('\u0003')) { stop(); reject(Error('Credential entry cancelled.')); return; }
        buffer += chunk;
        if (buffer.length > 16384) { stop(); reject(Error('Credential input too long.')); return; }
        if (/[\r\n]/.test(buffer)) { stop(); resolve(buffer.split(/[\r\n]/)[0].trim()); }
      };
      process.stdin.on('data', data); process.stdin.on('end', end);
    });
  } finally {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}
const credential = await credentialFromStdin();
const readCurrentResource = createPlatformPlanReader({planId: manifest.planId, resumeUrl: acceptedResource.resumeUrl, credential});
if (!options['proof-hash']) {
  acceptedResource = await refreshLaunchReviewInputs({manifest, expectedHash, requestBytes, acceptedResource, ethers, readCurrentResource});
}
const consentPath = path.resolve(options['consent-file']);
const hostReadyPath = options['host-ready-file'] ? path.resolve(options['host-ready-file']) : null;
if (hostReadyPath === consentPath) throw Error('Consent and host acknowledgement require separate files.');
const readRecordedConsent = async () => {
  try { return JSON.parse(await fs.readFile(consentPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const readHostReadiness = async () => validateLaunchHostReady(JSON.parse(await fs.readFile(hostReadyPath, 'utf8')), {
  manifest, expectedHash, consentBytes: await fs.readFile(consentPath), ethers,
});
const writeConsent = async consent => {
  await fs.mkdir(path.dirname(consentPath), {recursive: true});
  try { await fs.writeFile(consentPath, JSON.stringify(consent, null, 2) + '\n', {flag: 'wx', mode: 0o600}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Never overwrite a prior review or an unresolved wallet attempt with a different manifest.
    validateLaunchConsent(JSON.parse(await fs.readFile(consentPath, 'utf8')), manifest, ethers);
  }
  return await readRecordedConsent();
};
const provider = activeProvider = createLaunchRpcProvider();
const rpc = (method, params = []) => provider.send(method, params);
const proofPath = consentPath + '.proof.json';
const submitProof = createBoundLaunchProof({manifest, expectedHash, request: JSON.parse(requestBytes), credential, ethers,
  readConsent: async () => JSON.parse(await fs.readFile(consentPath, 'utf8')),
  loadAttempt: async () => { try { return JSON.parse(await fs.readFile(proofPath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
  saveAttempt: async record => atomicWrite(proofPath, record),
  readTransaction: async hash => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const transaction = await rpc('eth_getTransactionByHash', [hash]);
      if (transaction) return transaction;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw Error('Submitted transaction is not yet visible on the independent RPC.');
  },
  readChain: async () => {
    const [chainId, anchor, managerCode, routerCode, factoryCode] = await Promise.all([
      rpc('eth_chainId'), rpc('eth_getBlockByNumber', [ANCHOR.number, false]), rpc('eth_getCode', [MANAGER, 'latest']),
      rpc('eth_getCode', [manifest.transaction.to, 'latest']), rpc('eth_getCode', [manifest.infrastructure.graphDeployer.address, 'latest']),
    ]);
    return {chainId, anchor, managerCode, routerCode, factoryCode};
  },
});
if (options['proof-hash']) {
  // Recovery never opens a browser server or asks a wallet to send. Expired permits may still have valid broadcasts.
  try { console.log(JSON.stringify(await submitProof(options['proof-hash']))); }
  finally { provider.destroy(); }
  process.exit(0);
}
const descriptions = [
  ['/', 'signing-ui/robin-launch.html', 'text/html; charset=utf-8'],
  ['/app.js', 'signing-ui/robin-launch-app.js', 'text/javascript; charset=utf-8'],
  ['/signing-ui/robin-launch-guards.mjs', 'signing-ui/robin-launch-guards.mjs', 'text/javascript; charset=utf-8'],
  ['/signing-ui/guards.mjs', 'signing-ui/guards.mjs', 'text/javascript; charset=utf-8'],
  ['/signing-ui/wallet-connection.mjs', 'signing-ui/wallet-connection.mjs', 'text/javascript; charset=utf-8'],
  ['/src/launch-manifest.mjs', 'src/launch-manifest.mjs', 'text/javascript; charset=utf-8'],
  ['/ethers.js', 'node_modules/ethers/dist/ethers.umd.min.js', 'text/javascript; charset=utf-8'],
];
const assets = new Map(await Promise.all(descriptions.map(async ([url, file, type]) => [url, {bytes: await fs.readFile(path.join(root, file)), type}])));
const {server, origin, freshPackage} = createLaunchReviewServer({manifest, expectedHash, requestBytes, acceptedResource,
  readCurrentResource, writeConsent, readRecordedConsent, readHostReadiness, submitProof, assets, ethers, port: Number(options.port ?? 8792)});
await freshPackage();
server.listen(Number(options.port ?? 8792), '127.0.0.1', () => {
  console.log(`ROBINHOOK / ROBIN wallet review: ${origin}`);
  console.log(`Manifest: ${expectedHash}. User wallet confirmation required. No transaction has been signed or broadcast.`);
});
server.on('error', () => { console.error('Local review server could not bind its configured loopback port.'); provider.destroy(); process.exitCode = 1; });
server.on('close', () => provider.destroy());
}
if (!await runLaunchCommand(main)) { activeProvider?.destroy(); process.exitCode = 2; }

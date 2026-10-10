import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {FetchRequest, JsonRpcProvider} from 'ethers';
import {setTimeout as delay} from 'node:timers/promises';
import {runLaunchBootstrapCycle} from '../src/launch-bootstrap.mjs';
import {runWalletFeedCycle, walletFeedIntervalSeconds} from '../src/wallet-feed.mjs';
import {atomicWrite, acquireLock} from '../src/store.mjs';

// Default modes only verify deployment and export public data. --services is an explicit
// supervisor opt-in and still cannot start the existing signer without every review gate.
let provider, release, operatorChild = null, expectedOperatorStop = false;
const stop = new AbortController();
const stopOperator = () => { if (operatorChild) { expectedOperatorStop = true; operatorChild.kill('SIGTERM'); } };
process.once('SIGINT', () => { stop.abort(); stopOperator(); });
process.once('SIGTERM', () => { stop.abort(); stopOperator(); });
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--manifest', '--manifest-sha256', '--consent', '--once', '--loop', '--services'].includes(key) || Object.hasOwn(options, key))
      throw Error('Invalid watcher arguments');
    if (['--once', '--loop', '--services'].includes(key)) options[key] = true;
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw Error('Missing watcher option'); options[key] = value; }
  }
  if (!options['--manifest'] || !options['--manifest-sha256'] || Boolean(options['--once']) === Boolean(options['--loop'])
    || options['--services'] && !options['--loop']) throw Error('Use an exact pinned manifest and --once or --loop; --services requires --loop');
  const manifest = JSON.parse(fs.readFileSync(options['--manifest'], 'utf8'));
  const sourceRevision = process.env.ROBIN_SOURCE_REVISION ?? process.env.RENDER_GIT_COMMIT;
  const rpc = process.env.ROBIN_RPC_URL;
  if (!rpc || new URL(rpc).protocol !== 'https:') throw Error('An archive HTTPS production RPC is required');
  const request = new FetchRequest(rpc); request.timeout = 20000;
  provider = new JsonRpcProvider(request);
  const dir = path.resolve(process.env.ROBIN_LAUNCH_STATE_DIRECTORY ?? 'output/launch-bootstrap');
  const operatorDir = path.join(dir, 'operator'), feedDir = path.join(dir, 'wallet-feed');
  release = acquireLock(path.join(dir, 'launch-supervisor.lock'));
  const consentFile = options['--consent'] ?? process.env.ROBIN_LAUNCH_CONSENT_FILE;
  const url = process.env.ROBIN_WALLET_FEED_URL, token = process.env.ROBIN_WALLET_FEED_PUBLISH_TOKEN;
  if (Boolean(url) !== Boolean(token)) throw Error('Configure both feed publication settings or neither');
  const publisher = url ? {url, token} : null;
  const refreshSeconds = walletFeedIntervalSeconds(process.env.ROBIN_WALLET_FEED_INTERVAL_SECONDS);
  const stoppedFile = path.join(dir, 'operator-stopped.json');
  const operatorScript = fileURLToPath(new URL('./production-operator.mjs', import.meta.url));
  do {
    let status;
    try {
      const consent = consentFile && fs.existsSync(consentFile) ? JSON.parse(fs.readFileSync(consentFile, 'utf8')) : null;
      status = await runLaunchBootstrapCycle(provider, manifest, dir, {expectedManifestSha256: options['--manifest-sha256'], sourceRevision, consent,
        approvedManifestSha256: process.env.ROBIN_AUTOMATION_APPROVED_MANIFEST_SHA256 ?? null});
      if (status.readOnlyConfig) {
        const config = JSON.parse(fs.readFileSync(status.readOnlyConfig, 'utf8'));
        const feed = await runWalletFeedCycle(provider, config, feedDir, {publisher});
        status = {...status, walletFeed: feed.state};
      }
      if (options['--services'] && status.automaticRewardsApproved && !stop.signal.aborted && !operatorChild && !fs.existsSync(stoppedFile)) {
        expectedOperatorStop = false;
        operatorChild = spawn(process.execPath, [operatorScript, status.operatorConfig, '--send'], {
          env: {...process.env, ROBIN_STATE_DIRECTORY: operatorDir}, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
        });
        const child = operatorChild;
        child.once('error', () => {
          atomicWrite(stoppedFile, {state: 'blocked', reason: 'Operator could not start; reconcile hosting before retry', checkedAt: new Date().toISOString()});
        });
        child.once('exit', code => {
          if (!expectedOperatorStop) atomicWrite(stoppedFile, {state: 'blocked', reason: 'Operator stopped; preserve and reconcile its journal before restart',
            exitCode: code, checkedAt: new Date().toISOString()});
          if (operatorChild === child) operatorChild = null;
        });
      } else if (!status.automaticRewardsApproved) stopOperator();
      if (fs.existsSync(stoppedFile)) status = {...status, operator: 'blocked-reconciliation-required'};
      else status = {...status, operator: operatorChild ? 'running-under-reviewed-gate' : 'not-started'};
    } catch {
      stopOperator();
      status = {state: 'blocked', reason: 'Launch verification or service setup failed; preserve state and reconcile before activation',
        checkedAt: new Date().toISOString(), signing: false, broadcast: false};
      atomicWrite(path.join(dir, 'launch-bootstrap-status.json'), status);
    }
    console.log(JSON.stringify(status));
    if (options['--once']) { if (status.state === 'blocked' || status.state === 'expired') process.exitCode = 2; break; }
    // Finalized launch evidence and the complete feed refresh together. Do not repeat
    // the archive/account scan every prelaunch discovery tick after verification.
    try { await delay(status.readOnlyConfig ? refreshSeconds * 1000 : 30000, undefined, {signal: stop.signal}); } catch { break; }
  } while (!stop.signal.aborted);
} catch {
  console.error('Launch watcher startup failed. Check immutable manifest, release revision, archive RPC, consent delivery and dedicated durable state. No secret values printed.');
  process.exitCode = 2;
} finally { stopOperator(); provider?.destroy(); release?.(); }

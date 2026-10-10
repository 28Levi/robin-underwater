import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {standbySettings, inspectLaunchAdmission} from '../src/launch-standby.mjs';
import {acquireLock, atomicWrite} from '../src/store.mjs';

// Safe before a launch package exists: no RPC requests, signer construction or custody reads.
let release, child = null, expectedStop = false;
const stop = new AbortController();
const stopChild = () => {if (child) {expectedStop = true; child.kill('SIGTERM');}};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {stop.abort(); stopChild();});
try {
  const args = process.argv.slice(2);
  if (new Set(args).size !== args.length || args.some(arg => !['--once', '--loop', '--services'].includes(arg))
    || args.includes('--once') === args.includes('--loop') || args.includes('--services') && !args.includes('--loop'))
    throw Error('Choose --once or --loop; reviewed service activation additionally requires --services');
  const settings = standbySettings(process.env), blocked = path.join(settings.dir, 'watcher-stopped.json');
  release = acquireLock(path.join(settings.dir, 'launch-standby.lock'));
  const script = fileURLToPath(new URL('./watch-launch.mjs', import.meta.url));
  do {
    let status;
    try {
      status = inspectLaunchAdmission(settings);
      if (fs.existsSync(blocked)) status = {...status, state: 'blocked-reconciliation-required'};
      if (status.state === 'reviewed-package-admitted' && args.includes('--loop') && !stop.signal.aborted && !child) {
        expectedStop = false;
        const parameters = [script, '--manifest', status.manifestFile, '--manifest-sha256', status.manifestSha256,
          '--consent', settings.consentFile, '--loop', ...(args.includes('--services') ? ['--services'] : [])];
        child = spawn(process.execPath, parameters, {windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'],
          env: {...process.env, ROBIN_LAUNCH_STATE_DIRECTORY: path.join(settings.dir, 'runtime')}});
        const current = child;
        current.once('error', () => atomicWrite(blocked, {state: 'blocked', reason: 'Launch watcher failed to start; reconcile host setup'}));
        current.once('exit', code => {
          if (!expectedStop) atomicWrite(blocked, {state: 'blocked', reason: 'Launch watcher exited; reconcile durable state before restart', exitCode: code});
          if (child === current) child = null;
        });
      } else if (status.state !== 'reviewed-package-admitted') stopChild();
      status = {...status, watcher: child ? 'running' : 'not-started'};
    } catch {
      stopChild(); status = {state: 'blocked', reason: 'Invalid or changed launch admission; preserve and reconcile durable state', signing: false, broadcast: false};
    }
    atomicWrite(path.join(settings.dir, 'standby-status.json'), status); console.log(JSON.stringify(status));
    if (args.includes('--once')) {if (status.state.startsWith('blocked')) process.exitCode = 2; break;}
    try {await delay(30000, undefined, {signal: stop.signal});} catch {break;}
  } while (!stop.signal.aborted);
} catch {
  console.error('Launch standby configuration failed. Check absolute durable paths, source revision and HTTPS RPC configuration. No secret values printed.');
  process.exitCode = 2;
} finally {stopChild(); release?.();}

import path from 'node:path';
import {FetchRequest, JsonRpcProvider} from 'ethers';
import {setTimeout as delay} from 'node:timers/promises';
import {loadConfig} from '../src/config.mjs';
import {runWalletFeedCycle, walletFeedIntervalSeconds} from '../src/wallet-feed.mjs';

// This process has no Wallet import, signer, transaction submission or secret-file access.
let provider;
const stop = new AbortController();
process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort());
try {
  const args = process.argv.slice(2), file = args[0];
  if (!file || file.startsWith('--') || args.length !== 2 || !['--once', '--loop'].includes(args[1]))
    throw Error('Use a production config and exactly one of --once or --loop');
  const c = loadConfig(file);
  if (c.execution?.mode !== 'production') throw Error('A verified production configuration is required');
  const rpc = process.env[c.rpcUrlEnvironment];
  if (!rpc || new URL(rpc).protocol !== 'https:') throw Error('Configure an HTTPS production RPC');
  const request = new FetchRequest(rpc); request.timeout = 20000;
  provider = new JsonRpcProvider(request);
  const dir = path.resolve(process.env.ROBIN_WALLET_FEED_STATE_DIRECTORY ?? 'output/wallet-feed');
  // Never share the signing operator's state files or lock.
  if (process.env.ROBIN_STATE_DIRECTORY && dir === path.resolve(process.env.ROBIN_STATE_DIRECTORY))
    throw Error('Wallet feed requires its own state directory');
  const url = process.env.ROBIN_WALLET_FEED_URL, token = process.env.ROBIN_WALLET_FEED_PUBLISH_TOKEN;
  if (Boolean(url) !== Boolean(token)) throw Error('Configure both feed publication settings or neither');
  const publisher = url ? {url, token} : null;
  const refreshSeconds = walletFeedIntervalSeconds(process.env.ROBIN_WALLET_FEED_INTERVAL_SECONDS);
  do {
    const status = await runWalletFeedCycle(provider, c, dir, {publisher});
    console.log(JSON.stringify(status));
    if (args[1] === '--once') { if (!['exported', 'published'].includes(status.state)) process.exitCode = 2; break; }
    try { await delay(refreshSeconds * 1000, undefined, {signal: stop.signal}); } catch { break; }
  } while (!stop.signal.aborted);
} catch {
  console.error('Wallet feed startup or cycle failed. Check production identity, archive RPC, separate state directory and publication settings. No secret values printed.');
  process.exitCode = 2;
} finally { provider?.destroy(); }

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkWalletFeedConnection} from '../src/wallet-feed-check.mjs';

export async function runWalletFeedConnectionCheck({env = process.env, args = process.argv.slice(2), fetchImpl = globalThis.fetch} = {}) {
  if (args.length !== 0) throw Error('Wallet feed connection check accepts no command-line arguments.');
  return checkWalletFeedConnection({url: env.ROBIN_WALLET_FEED_URL, token: env.ROBIN_WALLET_FEED_PUBLISH_TOKEN, fetchImpl});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runWalletFeedConnectionCheck())); }
  catch {
    console.error('Wallet feed connection check failed. Verify publisher configuration and probe availability; no financial feed was submitted.');
    process.exitCode = 2;
  }
}

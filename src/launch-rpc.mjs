import {FetchRequest, JsonRpcProvider} from 'ethers';

export const PUBLIC_LAUNCH_RPC = 'https://rpc.mainnet.chain.robinhood.com';

export function launchRpcUrl(configured = process.env.ROBIN_RPC_URL) {
  let url;
  try { url = new URL(configured || PUBLIC_LAUNCH_RPC); }
  catch { throw Error('Invalid archive RPC configuration.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('Archive RPC must use HTTPS without embedded login or fragment.');
  return url.href;
}

export function createLaunchRpcProvider(configured = process.env.ROBIN_RPC_URL) {
  const request = new FetchRequest(launchRpcUrl(configured)); request.timeout = 20000;
  return new JsonRpcProvider(request);
}

// Provider exceptions can contain key-bearing endpoint URLs. CLI boundaries never print them.
export async function runLaunchCommand(task, report = console.error) {
  try { await task(); return true; }
  catch {
    report('Launch command failed. Check the explicit input files, archive RPC, current chain state and package validity. No secret values printed.');
    return false;
  }
}

import {randomBytes} from 'node:crypto';

const SNAPSHOT_URLS = new Set(['https://robinhook.wtf/api/wallet-snapshot', 'https://www.robinhook.wtf/api/wallet-snapshot']);
const MAX_RESPONSE_BYTES = 512;
const FAILURE = 'Wallet feed connection check failed. Check the configured publisher and website probe; no financial feed was submitted.';

async function readBoundedBody(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw Error('Invalid response length');
  if (!response.headers.get('content-type')?.toLowerCase().split(';')[0].trim().match(/^application\/json$/)
    || !response.body || typeof response.body.getReader !== 'function') throw Error('Invalid response type');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once: true});
  try {
    while (true) {
      signal.throwIfAborted();
      const {done, value} = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw Error('Response exceeds limit');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Authenticated diagnostic storage probe only; never sends token, holder or payout records. */
export async function checkWalletFeedConnection({url, token, fetchImpl = globalThis.fetch,
  nonce = randomBytes(16).toString('hex'), timeoutMs = 15000} = {}) {
  // Compare the original URL exactly. Do not normalize credentialed, alternate-host,
  // query-bearing or redirected URLs before deciding where the secret may be sent.
  if (!SNAPSHOT_URLS.has(url) || typeof token !== 'string' || !/^[\x21-\x7e]{32,4096}$/.test(token)
    || typeof nonce !== 'string' || !/^[0-9a-f]{32}$/.test(nonce) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000
    || typeof fetchImpl !== 'function') throw Error('Invalid wallet feed connection-check configuration.');
  const endpoint = new URL('/api/wallet-feed-check', url).href, body = JSON.stringify({nonce});
  if (Buffer.byteLength(body, 'utf8') > 128) throw Error('Invalid wallet feed connection-check request.');
  const controller = new AbortController();
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Error('Timed out')); }, timeoutMs);
  });
  try {
    const attempt = async () => {
      const response = await fetchImpl(endpoint, {method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit',
        referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: {'authorization': `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json'}, body});
      // No retries, including a 409 from another active diagnostic request.
      if (response.status !== 200 || response.redirected === true) throw Error('Probe rejected');
      const acknowledgement = await readBoundedBody(response, controller.signal);
      if (acknowledgement === null || typeof acknowledgement !== 'object' || Array.isArray(acknowledgement)
        || Object.keys(acknowledgement).sort().join(',') !== 'nonce,status'
        || acknowledgement.status !== 'verified' || acknowledgement.nonce !== nonce) throw Error('Invalid probe acknowledgement');
      return {status: 'verified', nonce};
    };
    return await Promise.race([attempt(), timedOut]);
  } catch { throw Error(FAILURE); }
  finally { clearTimeout(timer); controller.abort(); }
}

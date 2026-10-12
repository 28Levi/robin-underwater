// Retry provenance is private: an arbitrary signer/error code cannot opt in.
const retryableReads = new WeakSet();
const readMethods = new Set(['getNetwork', 'getBlock', 'getCode', 'getBalance', 'getTransactionCount',
  'getTransaction', 'getTransactionReceipt', 'getLogs', 'call', 'estimateGas', 'getFeeData']);
const transportCodes = new Set(['TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
const retryableHttp = new Set([429, 502, 503, 504]);

function knownTransportFailure(error, depth = 0) {
  if (!error || typeof error !== 'object' || depth > 3) return false;
  if (transportCodes.has(error.code)) return true;
  // NETWORK_ERROR also means "chain changed" in ethers. Never retry that, or
  // arbitrary semantic/RPC failures just because their message mentions a timeout.
  if (error.code === 'NETWORK_ERROR') {
    if (error.event !== 'initial-network-discovery') return false;
    return knownTransportFailure(error.info?.error, depth + 1);
  }
  if (error.code === 'SERVER_ERROR') return retryableHttp.has(error.response?.statusCode);
  // Node's fetch wrapper may retain a typed socket cause. No other generic
  // nesting is inspected, so a CALL_EXCEPTION cannot become a transport retry.
  return error instanceof TypeError && error.message === 'fetch failed'
    && knownTransportFailure(error.cause, depth + 1);
}

export function assertOperatorRunning(signal) {
  if (signal?.aborted) throw new Error('Operator shutdown requested');
}

/** Tag only failures of explicit read calls. No retries occur inside a call;
 * the outer cycle reloads the unchanged journal and repeats all safety checks.
 * Raw send/broadcast/signing failures never receive the retry provenance.
 */
export function withReadOnlyRpcRetries(provider, {signal} = {}) {
  return new Proxy(provider, {get(target, method) {
    const value = Reflect.get(target, method, target);
    if (typeof value !== 'function') return value;
    if (method === 'destroy') return value.bind(target);
    if (!readMethods.has(method)) return (...args) => {
      assertOperatorRunning(signal);
      return value.apply(target, args);
    };
    return async (...args) => {
      assertOperatorRunning(signal);
      try { return await value.apply(target, args); }
      catch (error) {
        assertOperatorRunning(signal);
        if (!knownTransportFailure(error)) throw error;
        const safe = new Error('Temporary failure of a read-only RPC request');
        retryableReads.add(safe);
        throw safe;
      }
    };
  }});
}

export const isRetryableRpcReadError = error => retryableReads.has(error);

export function rpcReadRetryDelayMs(consecutiveFailures) {
  if (!Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 1) throw Error('Invalid RPC retry count');
  return Math.min(300_000, 30_000 * 2 ** Math.min(consecutiveFailures - 1, 4));
}

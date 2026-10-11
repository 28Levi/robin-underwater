const methods = new Set(['eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']);

/** Bound connection/network prompts only. Cancellation stops this page waiting;
 * it cannot close the extension's prompt. Late provider responses are ignored. */
export function requestConnectionStep(provider, method, params, {signal, timeoutMs = 30000} = {}) {
  if (!methods.has(method) || !provider?.request || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw Error('Unsupported wallet connection step.');
  }
  return new Promise((resolve, reject) => {
    let settled = false, timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(value);
    };
    const failure = code => Object.assign(Error(code), {code});
    const cancel = () => finish(failure('WALLET_CONNECTION_CANCELLED'));
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, {once: true});
    timer = setTimeout(() => finish(failure('WALLET_CONNECTION_TIMEOUT')), timeoutMs);
    Promise.resolve().then(() => {
      if (settled) return;
      return provider.request({method, ...(params === undefined ? {} : {params})});
    }).then(value => finish(null, value), error => finish(error));
  });
}

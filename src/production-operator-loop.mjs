import {setTimeout as delay} from 'node:timers/promises';
import {operatorFailureStatus} from './operator-status.mjs';
import {isRetryableRpcReadError, rpcReadRetryDelayMs} from './read-only-rpc-retry.mjs';

/** A failed read never clears durable state or causes an in-call retry. */
export async function runProductionOperatorLoop({cycle, report, signal, once = false, wait = delay}) {
  let readFailures = 0;
  while (!signal?.aborted) {
    let status, retryableRead = false;
    try { status = await cycle(); }
    catch (error) {
      if (signal?.aborted) break;
      retryableRead = isRetryableRpcReadError(error);
      status = operatorFailureStatus(error);
    }
    if (signal?.aborted) break;
    readFailures = retryableRead ? Math.min(readFailures + 1, 5) : 0;
    const waitMs = retryableRead ? rpcReadRetryDelayMs(readFailures) : 30_000;
    if (retryableRead) status = {...status, retryAfterSeconds: waitMs / 1000};
    // Persistence/console failures are intentionally outside the retry catch.
    await report(status);
    if (status.state === 'blocked') return {blocked: true};
    if (once) return {blocked: false};
    try { await wait(waitMs, undefined, {signal}); }
    catch (error) { if (!signal?.aborted) throw error; }
  }
  return {blocked: false, stopped: true};
}

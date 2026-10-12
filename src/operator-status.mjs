import {isRetryableRpcReadError} from './read-only-rpc-retry.mjs';
import {initialPriceWindowStatus} from './price-window-warmup.mjs';
import {atomicFileFailureStatus} from './atomic-file.mjs';
/** Fixed public status text only. Provider/custody errors may contain secrets. */
export function operatorFailureStatus(error){
 const persistence=atomicFileFailureStatus(error);if(persistence)return persistence;
 const warmup=initialPriceWindowStatus(error);if(warmup)return {...warmup};
 if(isRetryableRpcReadError(error))return {state:'waiting',code:'TRANSIENT_RPC_READ',
  reason:'Temporary RPC read failure; preserving the journal and retrying with backoff'};
 if(error?.code==='PER_TRANSACTION_GAS_CAP')return {state:'blocked',code:'PER_TRANSACTION_GAS_CAP',
  reason:'Transaction cannot fit the approved per-transaction gas cap; preserve the unpaid round and review before restart'};
 if(error?.code==='CUMULATIVE_GAS_CAP')return {state:'blocked',code:'CUMULATIVE_GAS_CAP',
  reason:'Remaining approved cumulative gas allowance cannot fund this transaction; preserve gas accounting and review before restart'};
 if(error?.code==='PAYOUT_GAS_MINIMUM_CONFLICT')return {state:'blocked',code:'PAYOUT_GAS_MINIMUM_CONFLICT',
  reason:'No payout slice fits both the approved per-transaction gas cap and minimum batch value; preserve the unpaid round and review before restart'};
 const waiting=['Head changed during preparation; rebuild next cycle','Head changed during estimation; rebuild next cycle',
  'Deployment is not finalized','Wait for previous reward allocations to finalize before another plan'];
 return waiting.includes(error?.message)?{state:'waiting',reason:'Waiting for stable finalized history'}
  :{state:'blocked',reason:'Operator stopped; reconcile deployment, RPC, funding and durable journal before restart'};
}

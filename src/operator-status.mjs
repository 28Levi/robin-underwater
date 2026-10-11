/** Fixed public status text only. Provider/custody errors may contain secrets. */
export function operatorFailureStatus(error){
 if(error?.code==='PER_TRANSACTION_GAS_CAP')return {state:'blocked',code:'PER_TRANSACTION_GAS_CAP',
  reason:'Transaction cannot fit the approved per-transaction gas cap; preserve the unpaid round and review before restart'};
 if(error?.code==='CUMULATIVE_GAS_CAP')return {state:'blocked',code:'CUMULATIVE_GAS_CAP',
  reason:'Remaining approved cumulative gas allowance cannot fund this transaction; preserve gas accounting and review before restart'};
 if(error?.code==='PAYOUT_GAS_MINIMUM_CONFLICT')return {state:'blocked',code:'PAYOUT_GAS_MINIMUM_CONFLICT',
  reason:'No payout slice fits both the approved per-transaction gas cap and minimum batch value; preserve the unpaid round and review before restart'};
 const waiting=['Head changed during preparation; rebuild next cycle','Head changed during estimation; rebuild next cycle',
  'Missing window history','Deployment is not finalized','Wait for previous reward allocations to finalize before another plan'];
 return waiting.includes(error?.message)?{state:'waiting',reason:'Waiting for stable finalized history'}
  :{state:'blocked',reason:'Operator stopped; reconcile deployment, RPC, funding and durable journal before restart'};
}

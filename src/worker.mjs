import fs from 'node:fs';import path from 'node:path';
import {buildSnapshot} from './replay.mjs';
import {preparePlan} from './payout-plan.mjs';
import {atomicWrite,readSnapshot,writeSnapshot,fingerprint} from './store.mjs';

/** Read-only operator loop: immutable per-checkpoint plans plus durable status. No wallet keys. */
export async function runCycle(provider,c,dir='output/operator'){
 const snapshotFile=path.join(dir,'snapshot.json');
 try{
  const snapshot=await buildSnapshot(provider,c,readSnapshot(snapshotFile,c));
  writeSnapshot(snapshotFile,c,snapshot);
  const filename=`v2-${snapshot.checkpoint.blockNumber}-${snapshot.checkpoint.blockHash.slice(2)}.json`;
  const planFile=path.join(dir,'plans',filename);
  // Never silently overwrite previously prepared bytes. A stale plan is not authorization to send.
  if(fs.existsSync(planFile)){
   const status={state:'unchanged',checkpoint:snapshot.checkpoint,planFile,configHash:fingerprint(c),checkedAt:Date.now()};
   atomicWrite(path.join(dir,'status.json'),status);return status;
  }
  const plan=await preparePlan(provider,c,snapshot);
  atomicWrite(planFile,plan);
  const status={state:plan.transactions.length?'prepared':'no-eligible-funded-rewards',checkpoint:snapshot.checkpoint,
   batches:plan.transactions.length,planFile,configHash:fingerprint(c),checkedAt:Date.now()};
  atomicWrite(path.join(dir,'status.json'),status);return status;
 }catch(error){
  // Error messages avoid RPC URLs or provider exception bodies, which can contain credentials.
  const safe=/^(Snapshot|Checkpoint|Finalized|Finality|Wrong|Wait|Balance|Missing|Deployment|RPC must|Inconsistent)/.test(error.message)
   ?error.message.split('\n')[0]:'Operator cycle failed; no new payout plan produced';
  const status={state:'blocked',reason:safe,checkedAt:Date.now()};atomicWrite(path.join(dir,'status.json'),status);return status;
 }
}

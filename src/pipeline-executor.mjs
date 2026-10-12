import path from 'node:path';
import {Interface,Transaction} from 'ethers';
import {LossLedger,address} from './ledger.mjs';
import {buildSnapshot} from './replay.mjs';
import {preparePlan} from './payout-plan.mjs';
import {readSnapshot,writeSnapshot,atomicWrite} from './store.mjs';
import {writeJournal} from './execution-journal.mjs';
import {createRound,nextRoundBatch} from './reward-round.mjs';
import {payoutSchedulePolicy,openPayoutCycle,completeScheduledHarvest,bindScheduledRound,finishPayoutCycle} from './payout-schedule.mjs';
import {validatePipelineReceipt} from './pipeline-reservations.mjs';

const fees=new Interface(['function claimCreator()']);
const rewards=new Interface(['function pay(address)']);
const nonceError=()=>Error('Pipeline operator nonce changed; reconciliation required');

async function checkNonce(provider,operator,state){
 const latest=await provider.getTransactionCount(operator,'latest'),pending=await provider.getTransactionCount(operator,'pending');
 const expected=state.pipeline.nextNonce-(state.pending?1:0);
 if(latest!==expected||pending<latest||pending>state.pipeline.nextNonce)throw nonceError();
 if(!state.pending&&pending!==latest)throw nonceError();
}

async function canonicalReceipt(provider,record,c){
 const receipt=await provider.getTransactionReceipt(record.hash);
 if(!receipt)return null;
 validatePipelineReceipt(record,receipt,c);
 const block=await provider.getBlock(receipt.blockNumber);
 if(!block||block.hash!==receipt.blockHash)throw Error('Pipeline receipt is no longer canonical; reconciliation required');
 if(record.mined&&(record.mined.blockNumber!==receipt.blockNumber||record.mined.blockHash!==receipt.blockHash))
  throw Error('Pipeline mined receipt changed; reconciliation required');
 return receipt;
}

function recordFinality(state,record,receipt){
 if(record.finalized)return false;
 const existing=state.history.find(entry=>entry.hash===record.hash||entry.nonce===record.nonce);
 if(existing)throw Error('Duplicate pipeline finality history');
 state.history.push({hash:record.hash,kind:record.kind,nonce:record.nonce,blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,status:1});
 record.finalized=true;
 return true;
}

/** Mined records stay durable while finality advances. Their full signed amounts
 * remain reserved until finalized replay has incorporated their receipts. */
async function reconcileInflight(provider,c,state,file){
 const finalized=await provider.getBlock('finalized');
 if(!finalized)throw Error('RPC must support finalized reads');
 let changed=false;
 for(const record of state.inflight){
  const receipt=await canonicalReceipt(provider,record,c);
  if(!receipt)throw Error('Pipeline mined receipt disappeared; reconciliation required');
  if(record.finalized&&receipt.blockNumber>finalized.number)throw Error('Pipeline finalized history moved backwards');
  if(receipt.blockNumber<=finalized.number)changed=recordFinality(state,record,receipt)||changed;
 }
 const retained=state.inflight.filter(record=>record.kind==='payout'||!record.finalized);
 if(retained.length!==state.inflight.length){state.inflight=retained;changed=true;}
 if(changed)writeJournal(file,state);
 return finalized;
}

async function recoverPending(provider,c,state,file,now,finalized){
 const record=state.pending;if(!record)return null;
 const receipt=await canonicalReceipt(provider,record,c);
 if(receipt){
  record.mined={blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,status:1};record.finalized=false;
  if(receipt.blockNumber<=finalized.number)recordFinality(state,record,receipt);
  state.inflight.push(record);state.pending=null;
  if(record.kind==='retry')state.retryAt[address(record.recipient)]=now;
  if(record.kind==='payout'){
   if(!state.round||state.round.id!==record.roundId||record.roundEnd<=state.round.nextIndex||record.roundEnd>state.round.allocations.length)
    throw Error('Pipeline reward round does not match mined payment');
   state.round.nextIndex=record.roundEnd;
   if(state.round.nextIndex===state.round.allocations.length){state.round=null;finishPayoutCycle(state,now);}
  }
  writeJournal(file,state);
  return {state:'mined',kind:record.kind,hash:record.hash,finalized:record.finalized};
 }
 const from=Transaction.from(record.raw).from,latest=await provider.getTransactionCount(from,'latest');
 if(latest!==record.nonce)throw nonceError();
 const pending=await provider.getTransactionCount(from,'pending');
 if(pending<latest||pending>record.nonce+1)throw nonceError();
 if(await provider.getTransaction(record.hash))return {state:'pending',kind:record.kind,hash:record.hash};
 if(record.deadline!==null&&now>record.deadline)throw Error('Unresolved signed payout expired; reconcile its nonce before resuming');
 try{await provider.broadcastTransaction(record.raw);}catch{return {state:'broadcast-uncertain',kind:record.kind,hash:record.hash};}
 return {state:'rebroadcast',kind:record.kind,hash:record.hash};
}

/** Explicitly opted-in pipeline, called under the same exclusive executor lock.
 * Finalized accounting is immutable. Only delivery confirmations overlap. */
export async function executePipelinedCycle({provider,signer,c,e,dir,file,state,now,operator,vault,feeVault,submit,payoutCandidate,smallerPayoutBatch}){
 if(!state.pipeline){
  if(state.pending||state.round||state.history.length||state.schedule||state.inflight)throw Error('Cannot attach pipeline to existing execution journal');
  const latest=await provider.getTransactionCount(operator,'latest'),pending=await provider.getTransactionCount(operator,'pending');
  if(latest!==pending)throw nonceError();
  state.pipeline={version:1,initialNonce:latest,nextNonce:latest,lastHarvestAttemptAt:null};state.inflight=[];
  writeJournal(file,state);
 }
 const finalized=await reconcileInflight(provider,c,state,file);
 const recovered=await recoverPending(provider,c,state,file,now,finalized);if(recovered)return recovered;
 await checkNonce(provider,operator,state);
 const snapshotFile=path.join(dir,'snapshot.json');let snapshot=null;
 if(state.inflight.some(record=>record.finalized&&record.kind==='payout')){
  snapshot=await buildSnapshot(provider,c,readSnapshot(snapshotFile,c));writeSnapshot(snapshotFile,c,snapshot);
  state.inflight=state.inflight.filter(record=>!(record.finalized&&record.mined.blockNumber<=snapshot.checkpoint.blockNumber));
  writeJournal(file,state);
 }
 const policy=payoutSchedulePolicy(c),before=JSON.stringify(state.schedule);
 openPayoutCycle(state,policy,now);
 // Harvesting runs independently ahead of allocations; only finalized treasury
 // is spendable. A fresh claim therefore cannot finance this interval early.
 if(state.schedule.active?.phase==='harvest')completeScheduledHarvest(state);
 if(JSON.stringify(state.schedule)!==before)writeJournal(file,state);
 const full=()=>state.inflight.length>=e.maxInflightTransactions;
 if(full())return {state:'waiting-for-finality',reason:'Inflight transaction limit reached',inflight:state.inflight.length};
 if(state.pipeline.lastHarvestAttemptAt===null||now-state.pipeline.lastHarvestAttemptAt>=policy.intervalSeconds){
  const head=await provider.getBlock('latest');
  if(await feeVault.creatorAccrued({blockTag:head.number})>=BigInt(e.minimumHarvestWei))
   return submit(provider,signer,c,e,state,file,{kind:'harvest',to:e.feeVault,data:fees.encodeFunctionData('claimCreator'),deadline:null,headHash:head.hash,headNumber:head.number});
  state.pipeline.lastHarvestAttemptAt=now;writeJournal(file,state);
 }
 if(!snapshot){snapshot=await buildSnapshot(provider,c,readSnapshot(snapshotFile,c));writeSnapshot(snapshotFile,c,snapshot);}
 // writeSnapshot precedes journal pruning. A crash between these writes is safe:
 // the next plan ignores records already included by this finalized checkpoint.
 const retained=state.inflight.filter(record=>!(record.finalized&&record.mined.blockNumber<=snapshot.checkpoint.blockNumber));
 if(retained.length!==state.inflight.length){state.inflight=retained;writeJournal(file,state);}
 const allocationDue=state.schedule.active?.phase==='allocation';
 const prepared=allocationDue?await preparePlan(provider,c,snapshot,{reservations:state.inflight}):null;
 const ledger=LossLedger.restore(prepared?.reservationLedger??snapshot.ledger);
 if(allocationDue&&!state.round&&BigInt(prepared.plan.allocated)>=BigInt(e.minimumBatchWei)){
  state.round=createRound(prepared);bindScheduledRound(state);
  atomicWrite(path.join(dir,'recovery-reports',`${state.round.id.slice(2)}.json`),prepared.plan);writeJournal(file,state);
 }
 while(state.round){
  let batch=await nextRoundBatch(provider,c,state.round,prepared,ledger,snapshot),deferred=false;
  while(batch.total>=BigInt(e.minimumBatchWei)){
   const candidate=payoutCandidate(c,prepared,batch);
   atomicWrite(path.join(dir,'plans',`${batch.batchId.slice(2)}.json`),{...batch.audit,auditHash:batch.auditHash,guardedTransaction:candidate});
   try{return await submit(provider,signer,c,e,state,file,candidate);}
   catch(error){
    if(error.code==='PER_TRANSACTION_GAS_CAP'&&batch.end-state.round.nextIndex>1){
     batch=await smallerPayoutBatch(provider,c,e,operator,state.round,prepared,ledger,snapshot,batch,error.maxFeePerGas);continue;
    }
    if(!/^Head changed during (preparation|estimation); rebuild next cycle$/.test(error.message))throw error;
    deferred=true;break;
   }
  }
  if(deferred)break;
  state.round.nextIndex=batch.end;
  if(batch.end>=state.round.allocations.length){state.round=null;finishPayoutCycle(state,(await provider.getBlock('latest')).timestamp);}
  writeJournal(file,state);
 }
 if(state.schedule.active?.phase==='allocation'&&!state.round){finishPayoutCycle(state,(await provider.getBlock('latest')).timestamp);writeJournal(file,state);}
 const head=await provider.getBlock('latest');
 for(const account of snapshot.pendingRecipients){
  if((state.retryAttempts[account]??0)>=3||now-(state.retryAt[account]??0)<e.retryIntervalSeconds)continue;
  if(state.inflight.some(record=>record.kind==='retry'&&address(record.recipient)===address(account)))continue;
  if(await vault.pending(account,{blockTag:head.number})>0n)
   return submit(provider,signer,c,e,state,file,{kind:'retry',recipient:account,to:c.distributor,data:rewards.encodeFunctionData('pay',[account]),deadline:null,headHash:head.hash,headNumber:head.number});
 }
 return {state:'idle',reason:'Waiting for the next payout interval, finalized funding, or due payment retry',
  nextPayoutAt:state.schedule.nextDueAt,payoutCycle:state.schedule.active?.phase??null,inflight:state.inflight.length};
}

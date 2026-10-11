import path from 'node:path';
import {Contract,Interface,keccak256,Transaction} from 'ethers';
import {LossLedger,address} from './ledger.mjs';
import {buildSnapshot} from './replay.mjs';
import {preparePlan} from './payout-plan.mjs';
import {acquireLock,atomicWrite,readSnapshot,writeSnapshot} from './store.mjs';
import {executionBinding,readJournal,writeJournal} from './execution-journal.mjs';
import {createRound,nextRoundBatch} from './reward-round.mjs';
import {verifyProductionNetwork,verifyProductionToken} from './production-network.mjs';
import {verifyCandidateState} from './candidate-state.mjs';
import {payoutSchedulePolicy,openPayoutCycle,completeScheduledHarvest,bindScheduledRound,finishPayoutCycle} from './payout-schedule.mjs';

const rewardAbi=['function operator() view returns(address)','function available() view returns(uint256)',
 'function pending(address) view returns(uint256)','function pay(address)',
 'function distributeEligible(bytes32,bytes32,address,uint256,address[],uint256[],uint256[])'];
const feeAbi=['function creatorRecipient() view returns(address)','function creatorAccrued() view returns(uint256)','function claimCreator()'];
const rewards=new Interface(rewardAbi),fees=new Interface(feeAbi);
const amount=(x,name)=>{if(typeof x!=='string'||! /^[1-9][0-9]*$/.test(x))throw Error(`Missing positive execution ${name}`);return BigInt(x);};
class GasBudgetError extends Error {
 constructor(scope,maxFeePerGas){
  const details={transaction:['PER_TRANSACTION_GAS_CAP','per-transaction cap'],cumulative:['CUMULATIVE_GAS_CAP','cumulative cap'],
   batch:['PAYOUT_GAS_MINIMUM_CONFLICT','no payout slice fits both the per-transaction cap and minimum batch value']}[scope];
  super(`Execution gas budget exceeded: ${details[1]}`);
  this.code=details[0];this.maxFeePerGas=maxFeePerGas;
 }
}
const bufferedGas=units=>(units*120n+99n)/100n;
function payoutCandidate(c,prepared,batch){
 return {kind:'payout',to:c.distributor,deadline:prepared.expiresAt,headHash:prepared.checkedHead.hash,headNumber:prepared.checkedHead.number,roundEnd:batch.end,
  data:rewards.encodeFunctionData('distributeEligible',[batch.batchId,batch.auditHash,c.token,prepared.expiresAt,
   batch.entries.map(a=>a.account),batch.entries.map(a=>a.amount),batch.entries.map(a=>a.balance)])};
}

/** Reduce only the contiguous slice, never the round's original entitlements.
 * Quotes do not sign or reserve gas. submit() repeats state, fee, total-budget and
 * balance checks for the selected slice immediately before signing.
 */
async function smallerPayoutBatch(provider,c,e,operator,round,prepared,ledger,snapshot,batch,maxFeePerGas){
 let low=1,high=batch.end-round.nextIndex-1,best=null;
 while(low<=high){
  const size=Math.floor((low+high)/2);
  const candidateBatch=await nextRoundBatch(provider,{...c,batchSize:size},round,prepared,ledger,snapshot);
  if(candidateBatch.total<BigInt(e.minimumBatchWei)){low=size+1;continue;}
  const candidate=payoutCandidate(c,prepared,candidateBatch);
  const units=await provider.estimateGas({from:operator,to:candidate.to,data:candidate.data,value:0n});
  if(units<=0n)throw Error('Execution gas estimate unavailable');
  if(bufferedGas(units)*maxFeePerGas<=BigInt(e.maxGasPerTransactionWei)){best=candidateBatch;low=size+1;}
  else high=size-1;
 }
 if(!best)throw new GasBudgetError('batch',maxFeePerGas);
 return best;
}

export function executionPolicy(c){
 const e=c.execution;if(!e||!['local-only','production'].includes(e.mode))throw Error('Choose local EVM or production execution mode');
 if(e.mode==='production'){
  if(c.chainId!==4663)throw Error('Wrong production chain');
  if(address(e.operator??'')==='0x'+'0'.repeat(40))throw Error('Missing production operator');
 }
 if(c.hookFlavor!=='native20')throw Error('Executor requires canonical Native20 integration');
 if(!Number.isSafeInteger(c.batchSize)||c.batchSize<1||c.batchSize>100)throw Error('Invalid execution batch size');
 for(const n of ['maxGasPerTransactionWei','maxTotalGasWei','minimumHarvestWei','minimumBatchWei'])amount(e[n],n);
 if(!Number.isSafeInteger(e.retryIntervalSeconds)||e.retryIntervalSeconds<1)throw Error('Invalid retry interval');
 payoutSchedulePolicy(c);
 for(const n of ['token','hook','distributor','feeVault'])if(!/^0x[0-9a-f]{64}$/.test(e.codeHashes?.[n]??''))throw Error('Missing pinned runtime hash');
 address(e.feeVault);return e;
}

export async function verifyExecution(provider,signer,c,e){
 // Chain ID alone is insufficient: the local canonical integration test also uses 4663.
 if(e.mode==='local-only'){
  const metadata=await provider.send('hardhat_metadata',[]);
  if(!/^(HardhatNetwork\/|edr\/)/.test(metadata?.clientVersion??'')
   ||!/^0x[0-9a-f]{64}$/.test(metadata?.instanceId??'')||metadata.chainId!==c.chainId)throw Error('A local Hardhat EVM is required');
 }else await verifyProductionNetwork(provider,c);
 if((await provider.getNetwork()).chainId!==BigInt(c.chainId))throw Error('Wrong execution chain');
 const operator=await signer.getAddress();
 if(e.mode==='production'&&address(operator)!==address(e.operator))throw Error('Wrong configured production operator');
 for(const name of ['token','hook','distributor','feeVault']){
  const code=await provider.getCode(name==='feeVault'?e.feeVault:c[name]);
  if(code==='0x'||keccak256(code)!==e.codeHashes[name])throw Error('Pinned deployment runtime changed');
 }
 const vault=new Contract(c.distributor,rewardAbi,provider),feeVault=new Contract(e.feeVault,feeAbi,provider);
 const hook=new Contract(c.hook,['function feeVault() view returns(address)'],provider);
 if(address(await vault.operator())!==address(operator))throw Error('Wrong reward operator signer');
 if(address(await hook.feeVault())!==address(e.feeVault)||address(await feeVault.creatorRecipient())!==address(c.distributor))
  throw Error('Fee collection destination mismatch');
 if(e.mode==='production')await verifyProductionToken(provider,c);
 return {operator,vault,feeVault};
}

async function recover(provider,state,file,now){
 const p=state.pending;if(!p)return null;
 const receipt=await provider.getTransactionReceipt(p.hash);
 if(receipt){
  const [canonical,finalized]=await Promise.all([provider.getBlock(receipt.blockNumber),provider.getBlock('finalized')]);
  if(!canonical||canonical.hash!==receipt.blockHash)throw Error('Receipt is no longer canonical; reconciliation required');
  if(!finalized||receipt.blockNumber>finalized.number)return {state:'waiting-for-finality',hash:p.hash};
  state.history.push({hash:p.hash,kind:p.kind,nonce:p.nonce,blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,status:Number(receipt.status)});
  if(p.recipient)state.retryAt[address(p.recipient)]=now;
  if(Number(receipt.status)!==1)state.fault='Finalized transaction reverted; reconcile before resuming';
  else if(p.roundEnd!==null){
   if(!state.round)throw Error('Reward round journal is missing');
   state.round.nextIndex=p.roundEnd;
   if(state.round.nextIndex>=state.round.allocations.length)state.round=null;
  }
  state.pending=null;
  if(!state.fault&&state.schedule){
   if(p.kind==='harvest')completeScheduledHarvest(state);
   else if(p.kind==='payout'&&!state.round)finishPayoutCycle(state,(await provider.getBlock('latest')).timestamp);
  }
  writeJournal(file,state);
  return {state:state.fault?'blocked':'confirmed',kind:p.kind,hash:p.hash,reason:state.fault};
 }
 const nonce=await provider.getTransactionCount(Transaction.from(p.raw).from,'latest');
 if(nonce>p.nonce)throw Error('Operator nonce was consumed by an unknown transaction');
 if(await provider.getTransaction(p.hash))return {state:'pending',hash:p.hash};
 if(p.deadline!==null&&now>p.deadline)throw Error('Unresolved signed payout expired; reconcile its nonce before resuming');
 // A broadcast timeout is ambiguous. Reuse identical signed bytes, never create a replacement payment.
 try{await provider.broadcastTransaction(p.raw);}catch{return {state:'broadcast-uncertain',hash:p.hash};}
 return {state:'rebroadcast',hash:p.hash};
}

async function submit(provider,signer,c,e,state,file,candidate){
 const from=await signer.getAddress(),head=await provider.getBlock('latest');
 await verifyCandidateState(provider,c,candidate,head,'preparation');
 const latest=await provider.getTransactionCount(from,'latest'),pending=await provider.getTransactionCount(from,'pending');
 if(latest!==pending)throw Error('Operator has an untracked pending transaction');
 const request={from,to:candidate.to,data:candidate.data,value:0n};
 const [units,feeData]=await Promise.all([provider.estimateGas(request),provider.getFeeData()]);
 if(units<=0n)throw Error('Execution gas estimate unavailable');
 if(!feeData.maxFeePerGas||feeData.maxPriorityFeePerGas===null)throw Error('EIP-1559 fee data unavailable');
 const gasLimit=bufferedGas(units),reservation=gasLimit*feeData.maxFeePerGas;
 if(reservation>BigInt(e.maxGasPerTransactionWei))throw new GasBudgetError('transaction',feeData.maxFeePerGas);
 if(BigInt(state.reservedGasWei)+reservation>BigInt(e.maxTotalGasWei))throw new GasBudgetError('cumulative',feeData.maxFeePerGas);
 if(candidate.kind==='retry'&&BigInt(state.retryGasWei)+reservation>BigInt(e.maxTotalGasWei)/10n)
  return {state:'idle',reason:'Automatic retry gas allowance exhausted; recipient can call pay directly'};
 if(await provider.getBalance(from)<reservation)throw Error('Operator lacks gas funding');
 const afterEstimate=await provider.getBlock('latest');
 await verifyCandidateState(provider,c,candidate,afterEstimate,'estimation');
 if(candidate.deadline!==null&&afterEstimate.timestamp>candidate.deadline)throw Error('Payout expired before signing');
 const raw=await signer.signTransaction({to:candidate.to,data:candidate.data,value:0n,chainId:c.chainId,nonce:latest,type:2,
  gasLimit,maxFeePerGas:feeData.maxFeePerGas,maxPriorityFeePerGas:feeData.maxPriorityFeePerGas});
 const signed=Transaction.from(raw);
 if(address(signed.from)!==address(from)||signed.to?.toLowerCase()!==candidate.to.toLowerCase()||signed.data!==candidate.data
  ||signed.value!==0n||signed.chainId!==BigInt(c.chainId)||signed.nonce!==latest||signed.gasLimit!==gasLimit
  ||signed.maxFeePerGas!==feeData.maxFeePerGas||signed.maxPriorityFeePerGas!==feeData.maxPriorityFeePerGas)
  throw Error('Signer changed prepared transaction');
 state.reservedGasWei=(BigInt(state.reservedGasWei)+reservation).toString();
 if(candidate.kind==='retry'){
  state.retryGasWei=(BigInt(state.retryGasWei)+reservation).toString();
  const recipient=address(candidate.recipient);state.retryAttempts[recipient]=(state.retryAttempts[recipient]??0)+1;
 }
 state.pending={hash:signed.hash,raw,nonce:latest,kind:candidate.kind,deadline:candidate.deadline,recipient:candidate.recipient??null,roundEnd:candidate.roundEnd??null};
 // Signed bytes are durable BEFORE broadcasting. Gas reservations are never automatically replenished.
 writeJournal(file,state);
 try{await provider.broadcastTransaction(raw);}catch{return {state:'broadcast-uncertain',kind:candidate.kind,hash:signed.hash};}
 return {state:'submitted',kind:candidate.kind,hash:signed.hash};
}

/** One serialized cycle. Production requires explicit activation, pinned deployment and gas caps. */
export async function executeCycle(provider,signer,c,dir='output/executor'){
 const release=acquireLock(path.join(dir,'executor.lock'));
 try{
  const e=executionPolicy(c);
  if(e.mode==='production'&&e.broadcastEnabled!==true)throw Error('Production broadcasting is not activated');
  const {operator,vault,feeVault}=await verifyExecution(provider,signer,c,e);
  const file=path.join(dir,'journal.json'),state=readJournal(file,executionBinding(c,operator));
  if(state.fault)throw Error(state.fault);
  const last=state.history.at(-1);
  if(last){const [block,finalized]=await Promise.all([provider.getBlock(last.blockNumber),provider.getBlock('finalized')]);
   if(!block||block.hash!==last.blockHash||!finalized||finalized.number<last.blockNumber)
    throw Error('Finalized execution history changed; reconciliation required');}
  const now=(await provider.getBlock('latest')).timestamp;
  const recovered=await recover(provider,state,file,now);if(recovered)return recovered;
  const schedulePolicy=payoutSchedulePolicy(c);
  if(schedulePolicy){
   const before=JSON.stringify(state.schedule);
   openPayoutCycle(state,schedulePolicy,now);
   if(JSON.stringify(state.schedule)!==before)writeJournal(file,state);
   if(state.schedule.active?.phase==='harvest'){
    const head=await provider.getBlock('latest');
    if(await feeVault.creatorAccrued({blockTag:head.number})>=BigInt(e.minimumHarvestWei))
     return await submit(provider,signer,c,e,state,file,{kind:'harvest',to:e.feeVault,data:fees.encodeFunctionData('claimCreator'),deadline:null,headHash:head.hash,headNumber:head.number});
    completeScheduledHarvest(state);writeJournal(file,state);
   }
  }
  const snapshotFile=path.join(dir,'snapshot.json');
  const snapshot=await buildSnapshot(provider,c,readSnapshot(snapshotFile,c));writeSnapshot(snapshotFile,c,snapshot);
  const allocationDue=!schedulePolicy||state.schedule.active?.phase==='allocation';
  const prepared=allocationDue?await preparePlan(provider,c,snapshot):null,ledger=LossLedger.restore(snapshot.ledger);
  if(allocationDue&&!state.round&&BigInt(prepared.plan.allocated)>=BigInt(e.minimumBatchWei)){
   state.round=createRound(prepared);
   bindScheduledRound(state);
   atomicWrite(path.join(dir,'recovery-reports',`${state.round.id.slice(2)}.json`),prepared.plan);
   writeJournal(file,state);
  }
  while(state.round){
   let batch=await nextRoundBatch(provider,c,state.round,prepared,ledger,snapshot),deferred=false;
   while(batch.total>=BigInt(e.minimumBatchWei)){
    const candidate=payoutCandidate(c,prepared,batch);
    atomicWrite(path.join(dir,'plans',`${batch.batchId.slice(2)}.json`),{...batch.audit,auditHash:batch.auditHash,guardedTransaction:candidate});
    try{return await submit(provider,signer,c,e,state,file,candidate);}
    catch(error){
     if(error.code==='PER_TRANSACTION_GAS_CAP'&&batch.end-state.round.nextIndex>1){
      batch=await smallerPayoutBatch(provider,c,e,operator,state.round,prepared,ledger,snapshot,batch,error.maxFeePerGas);
      continue;
     }
     if(!/^Head changed during (preparation|estimation); rebuild next cycle$/.test(error.message))throw error;
     deferred=true;break;
    }
   }
   if(deferred)break; // Leave the round intact, but permit independent harvest/retry work.
   state.round.nextIndex=batch.end;
   if(batch.end>=state.round.allocations.length){
    state.round=null;
    if(schedulePolicy)finishPayoutCycle(state,(await provider.getBlock('latest')).timestamp);
   }
   writeJournal(file,state);
  }
  if(schedulePolicy&&state.schedule.active?.phase==='allocation'&&!state.round){
   finishPayoutCycle(state,(await provider.getBlock('latest')).timestamp);writeJournal(file,state);
  }
  const head=await provider.getBlock('latest');
  if(!schedulePolicy&&await feeVault.creatorAccrued({blockTag:head.number})>=BigInt(e.minimumHarvestWei))
   return await submit(provider,signer,c,e,state,file,{kind:'harvest',to:e.feeVault,data:fees.encodeFunctionData('claimCreator'),deadline:null,headHash:head.hash,headNumber:head.number});
  for(const account of snapshot.pendingRecipients){
   if((state.retryAttempts[account]??0)>=3)continue;
   if(now-(state.retryAt[account]??0)<e.retryIntervalSeconds)continue;
   if(await vault.pending(account,{blockTag:head.number})>0n)
    return await submit(provider,signer,c,e,state,file,{kind:'retry',recipient:account,to:c.distributor,data:rewards.encodeFunctionData('pay',[account]),deadline:null,headHash:head.hash,headNumber:head.number});
  }
  return {state:'idle',reason:schedulePolicy&&!state.schedule.active?'Waiting for next scheduled payout interval or due payment retry':'No eligible funded batch, harvest or due payment retry',
   ...(schedulePolicy?{nextPayoutAt:state.schedule.nextDueAt,payoutCycle:state.schedule.active?.phase??null}:{})};
 }finally{release();}
}

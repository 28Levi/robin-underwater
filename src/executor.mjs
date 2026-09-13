import path from 'node:path';
import {Contract,Interface,keccak256,Transaction} from 'ethers';
import {LossLedger,address} from './ledger.mjs';
import {buildSnapshot} from './replay.mjs';
import {preparePlan} from './payout-plan.mjs';
import {acquireLock,atomicWrite,readSnapshot,writeSnapshot} from './store.mjs';
import {executionBinding,readJournal,writeJournal} from './execution-journal.mjs';
import {createRound,nextRoundBatch} from './reward-round.mjs';
import {verifyProductionNetwork,verifyProductionToken} from './production-network.mjs';

const rewardAbi=['function operator() view returns(address)','function available() view returns(uint256)',
 'function pending(address) view returns(uint256)','function pay(address)',
 'function distributeEligible(bytes32,bytes32,address,uint256,address[],uint256[],uint256[])'];
const feeAbi=['function creatorRecipient() view returns(address)','function creatorAccrued() view returns(uint256)','function claimCreator()'];
const rewards=new Interface(rewardAbi),fees=new Interface(feeAbi);
const amount=(x,name)=>{if(typeof x!=='string'||! /^[1-9][0-9]*$/.test(x))throw Error(`Missing positive execution ${name}`);return BigInt(x);};

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
  state.pending=null;writeJournal(file,state);
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
 if(head.hash!==candidate.headHash)throw Error('Head changed during preparation; rebuild next cycle');
 const latest=await provider.getTransactionCount(from,'latest'),pending=await provider.getTransactionCount(from,'pending');
 if(latest!==pending)throw Error('Operator has an untracked pending transaction');
 const request={from,to:candidate.to,data:candidate.data,value:0n};
 const [units,feeData]=await Promise.all([provider.estimateGas(request),provider.getFeeData()]);
 if(units<=0n)throw Error('Execution gas estimate unavailable');
 if(!feeData.maxFeePerGas||feeData.maxPriorityFeePerGas===null)throw Error('EIP-1559 fee data unavailable');
 const gasLimit=(units*120n+99n)/100n,reservation=gasLimit*feeData.maxFeePerGas;
 if(reservation>BigInt(e.maxGasPerTransactionWei)||BigInt(state.reservedGasWei)+reservation>BigInt(e.maxTotalGasWei))
  throw Error('Execution gas budget exceeded');
 if(await provider.getBalance(from)<reservation)throw Error('Operator lacks gas funding');
 if((await provider.getBlock('latest')).hash!==candidate.headHash)throw Error('Head changed during estimation; rebuild next cycle');
 if(candidate.deadline!==null&&(await provider.getBlock('latest')).timestamp>candidate.deadline)throw Error('Payout expired before signing');
 const raw=await signer.signTransaction({to:candidate.to,data:candidate.data,value:0n,chainId:c.chainId,nonce:latest,type:2,
  gasLimit,maxFeePerGas:feeData.maxFeePerGas,maxPriorityFeePerGas:feeData.maxPriorityFeePerGas});
 const signed=Transaction.from(raw);
 if(address(signed.from)!==address(from)||signed.to?.toLowerCase()!==candidate.to.toLowerCase()||signed.data!==candidate.data
  ||signed.value!==0n||signed.chainId!==BigInt(c.chainId)||signed.nonce!==latest||signed.gasLimit!==gasLimit
  ||signed.maxFeePerGas!==feeData.maxFeePerGas||signed.maxPriorityFeePerGas!==feeData.maxPriorityFeePerGas)
  throw Error('Signer changed prepared transaction');
 state.reservedGasWei=(BigInt(state.reservedGasWei)+reservation).toString();
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
  const snapshotFile=path.join(dir,'snapshot.json');
  const snapshot=await buildSnapshot(provider,c,readSnapshot(snapshotFile,c));writeSnapshot(snapshotFile,c,snapshot);
  const prepared=await preparePlan(provider,c,snapshot),ledger=LossLedger.restore(snapshot.ledger);
  if(!state.round&&BigInt(prepared.plan.allocated)>=BigInt(e.minimumBatchWei)){
   state.round=createRound(prepared);writeJournal(file,state);
  }
  while(state.round){
   const batch=await nextRoundBatch(provider,c,state.round,prepared,ledger,snapshot);
   if(batch.total>=BigInt(e.minimumBatchWei)){
    const candidate={kind:'payout',to:c.distributor,deadline:prepared.expiresAt,headHash:prepared.checkedHead.hash,roundEnd:batch.end,
     data:rewards.encodeFunctionData('distributeEligible',[batch.batchId,batch.auditHash,c.token,prepared.expiresAt,
      batch.entries.map(a=>a.account),batch.entries.map(a=>a.amount),batch.entries.map(a=>a.balance)])};
    atomicWrite(path.join(dir,'plans',`${batch.batchId.slice(2)}.json`),{...batch.audit,auditHash:batch.auditHash,guardedTransaction:candidate});
    return await submit(provider,signer,c,e,state,file,candidate);
   }
   state.round.nextIndex=batch.end;
   if(batch.end>=state.round.allocations.length)state.round=null;
   writeJournal(file,state);
  }
  const head=await provider.getBlock('latest');
  if(await feeVault.creatorAccrued({blockTag:head.number})>=BigInt(e.minimumHarvestWei))
   return await submit(provider,signer,c,e,state,file,{kind:'harvest',to:e.feeVault,data:fees.encodeFunctionData('claimCreator'),deadline:null,headHash:head.hash});
  for(const account of [...ledger.accounts.keys()].sort()){
   if(now-(state.retryAt[account]??0)<e.retryIntervalSeconds)continue;
   if(await vault.pending(account,{blockTag:head.number})>0n)
    return await submit(provider,signer,c,e,state,file,{kind:'retry',recipient:account,to:c.distributor,data:rewards.encodeFunctionData('pay',[account]),deadline:null,headHash:head.hash});
  }
  return {state:'idle',reason:'No eligible funded batch, harvest or due payment retry'};
 }finally{release();}
}

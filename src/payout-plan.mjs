import {Contract,Interface,keccak256,toUtf8Bytes} from 'ethers';
import {LossLedger,address} from './ledger.mjs';
import {transferInterface,rewardInterface} from './replay.mjs';
import {reservePipelinePayouts,verifyReservedBatchLog} from './pipeline-reservations.mjs';
export const payoutInterface=new Interface(['function distributeEligible(bytes32,bytes32,address,uint256,address[],uint256[],uint256[])']);
export async function preparePlan(provider,c,snapshot,{now=Math.floor(Date.now()/1000),reservations}={}) {
 if((await provider.getNetwork()).chainId!==BigInt(c.chainId))throw Error('Wrong chain');
 if(now<snapshot.generatedAt||now-snapshot.generatedAt>c.maxSnapshotAgeSeconds)throw Error('Snapshot generation is stale');
 let ledger=LossLedger.restore(snapshot.ledger);const cp=ledger.checkpoint;
 if(JSON.stringify(cp)!==JSON.stringify(snapshot.checkpoint))throw Error('Snapshot checkpoint mismatch');
 const [block,finalized,head]=await Promise.all([provider.getBlock(cp.blockNumber),provider.getBlock('finalized'),provider.getBlock('latest')]);
 if(!block||block.hash!==cp.blockHash)throw Error('Checkpoint no longer canonical');
 if(cp.blockNumber>finalized.number||finalized.timestamp-cp.timestamp>c.maxSnapshotAgeSeconds)throw Error('Snapshot no longer near finalized head');
 if(now-finalized.timestamp>(c.maxFinalityLagSeconds??7200))throw Error('Finality is stalled');
 const pipeline=c.execution?.confirmationMode==='pipelined-finalized-v1';
 if(pipeline&&reservations===undefined)throw Error('Pipeline planning requires durable payout reservations');
 if(!pipeline&&reservations!==undefined)throw Error('Reservations require explicit pipeline policy');
 const reserved=pipeline?await reservePipelinePayouts(provider,c,snapshot,reservations,head):null;
 if(reserved)ledger=reserved.ledger;
 const seenBatches=new Set();
 const changed=new Set();
 if(head.number>cp.blockNumber){
  for(let from=cp.blockNumber+1;from<=head.number;from+=1000){
   const range={fromBlock:from,toBlock:Math.min(from+999,head.number)};
   const [rewards,transfers]=await Promise.all([
    provider.getLogs({...range,address:c.distributor,topics:[rewardInterface.getEvent('BatchRecorded').topicHash]}),
    provider.getLogs({...range,address:c.token,topics:[transferInterface.getEvent('Transfer').topicHash]})]);
   if(rewards.length&&!reserved)throw Error('Wait for previous reward allocations to finalize before another plan');
   for(const log of rewards){
    const id=verifyReservedBatchLog(log,reserved,c);
    if(seenBatches.has(id))throw Error('Duplicate pipeline reward log');seenBatches.add(id);
   }
   for(const log of transfers){const p=transferInterface.parseLog(log);if(p.args.value===0n||p.args.from===p.args.to)continue;
    changed.add(address(p.args.from));}
  }
 }
 if(reserved&&seenBatches.size!==reserved.tracked.size)throw Error('Missing tracked pipeline reward log');
 if(reserved&&(await provider.getBlock(head.number))?.hash!==head.hash)throw Error('Pipeline planning head changed; reconciliation required');
 for(const a of changed)if(ledger.accounts.has(a))ledger.quarantine(a);
 const vault=new Contract(c.distributor,['function available() view returns(uint256)','function operator() view returns(address)',
  'function processed(bytes32) view returns(bool)'],provider);
 const [pastBudget,currentBudget,operator]=await Promise.all([vault.available({blockTag:cp.blockNumber}),vault.available({blockTag:head.number}),vault.operator()]);
 const remainingPast=reserved?(pastBudget>reserved.reservedWei?pastBudget-reserved.reservedWei:0n):pastBudget;
 const budget=remainingPast<currentBudget?remainingPast:currentBudget;
 // Eligibility is explicitly evaluated at the finalized checkpoint, not falsely marked as a live price.
 const plan=ledger.plan(budget,{...snapshot.oracle,now:cp.timestamp}),expiresAt=now+c.maxSnapshotAgeSeconds;
 const transactions=[];
 for(let i=0;i<plan.allocations.length;i+=c.batchSize){
  const entries=plan.allocations.slice(i,i+c.batchSize);
  const batchId=keccak256(toUtf8Bytes(`${c.chainId}:${address(c.distributor)}:${cp.blockHash}:${i}`));
  if(await vault.processed(batchId))throw Error('Snapshot already has a processed batch; wait for finalized replay');
  transactions.push({chainId:c.chainId,from:operator,to:c.distributor,value:'0',batchId,
   data:payoutInterface.encodeFunctionData('distributeEligible',[batchId,plan.auditHash,c.token,expiresAt,
    entries.map(a=>a.account),entries.map(a=>a.amount),entries.map(a=>ledger.get(a.account).balance)])});
 }
 return {schemaVersion:'robin.payout-plan.v2',checkpoint:cp,checkedHead:{number:head.number,hash:head.hash},
  generatedAt:now,expiresAt,changedAccountsExcluded:[...changed],plan,transactions,status:'unsigned-not-submitted',
  ...(reserved?{reservationLedger:ledger.serialize(),pipelineReservations:{reservedWei:reserved.reservedWei.toString(),batches:reserved.batches}}:{})};
}

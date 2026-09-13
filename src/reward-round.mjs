import {keccak256,toUtf8Bytes} from 'ethers';
import {address,stringify} from './ledger.mjs';
import {transferInterface} from './replay.mjs';

export const commitment=value=>keccak256(toUtf8Bytes(stringify(value)));
export function createRound(prepared){return {id:commitment({checkpoint:prepared.checkpoint,auditHash:prepared.plan.auditHash}),
 checkpoint:prepared.checkpoint,allocations:prepared.plan.allocations.map(a=>({account:a.account,amount:a.amount.toString()})),nextIndex:0};}

/** Keep original proportional entitlements across batches; never recalculate just the first group.
 * Later batches can only shrink: recheck current loss and exclude outgoing transfers since the round snapshot.
 */
export async function nextRoundBatch(provider,c,round,prepared,ledger,snapshot){
 const cp=round.checkpoint;
 if((await provider.getBlock(cp.blockNumber))?.hash!==cp.blockHash)throw Error('Reward round checkpoint changed');
 const changed=new Set(prepared.changedAccountsExcluded);
 for(let from=cp.blockNumber+1;from<=prepared.checkedHead.number;from+=1000){
  const logs=await provider.getLogs({address:c.token,topics:[transferInterface.getEvent('Transfer').topicHash],fromBlock:from,
   toBlock:Math.min(from+999,prepared.checkedHead.number)});
  for(const log of logs){const p=transferInterface.parseLog(log);
   if(p.args.value===0n||p.args.from===p.args.to)continue;changed.add(address(p.args.from));}
 }
 const losses=new Map(ledger.shortfalls({...snapshot.oracle,now:snapshot.checkpoint.timestamp}).map(a=>[a.account,a.loss]));
 const end=Math.min(round.nextIndex+c.batchSize,round.allocations.length);
 const entries=round.allocations.slice(round.nextIndex,end).flatMap(a=>{
  if(changed.has(a.account))return [];
  const loss=losses.get(a.account)??0n,entitlement=BigInt(a.amount),amount=loss<entitlement?loss:entitlement;
  return amount>0n?[{account:a.account,amount,balance:ledger.get(a.account).balance,loss}]:[];
 });
 const total=entries.reduce((s,a)=>s+a.amount,0n);
 if(total>BigInt(prepared.plan.budgetWei))throw Error('Reward round funding changed; reconciliation required');
 const audit={roundId:round.id,originalCheckpoint:cp,currentCheckpoint:snapshot.checkpoint,entries};
 return {entries,total,end,audit,auditHash:commitment(audit),batchId:commitment({chainId:c.chainId,distributor:c.distributor,roundId:round.id,start:round.nextIndex})};
}

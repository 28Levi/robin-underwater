import {Interface,Contract} from 'ethers';
import {LossLedger,ZERO,address} from './ledger.mjs';
import {decodeReceipt,hookInterface} from './receipt-adapter.mjs';
import {twap} from './oracle.mjs';
import {normalizeNative20Receipt,poolInterface} from './native20-adapter.mjs';

export const transferInterface=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export const rewardInterface=new Interface([
 'event BatchRecorded(bytes32 indexed batchId,bytes32 indexed auditHash,uint256 total)',
 'event RewardAllocated(bytes32 indexed batchId,address indexed recipient,uint256 amount)'
]);

/** Apply a complete transaction atomically; malformed input never partly mutates the original. */
export function applyReceipt(ledger,receipt,c,time) {
 const canonical=c.hookFlavor==='native20'?normalizeNative20Receipt(receipt,c):null;
 if(canonical)receipt=canonical.receipt;
 const next=LossLedger.restore(ledger.serialize()),system=new Set([c.poolManager,c.hook,c.distributor,...(c.initializer?[c.initializer]:[]),...c.excludedAddresses].map(address));
 const decoded=decodeReceipt(receipt,{...c,time}),observations=canonical?.observations.map(o=>({time,sqrtPriceX96:o.sqrtPriceX96}))??[];
 if(decoded.supported){
  for(const e of decoded.events) {if(e.account&&system.has(e.account))continue;next.apply(e);}
 }else{
  // Unknown inbound inventory has zero basis. It must not quarantine a victim's entire wallet.
  for(const tr of decoded.transfers){
   if(tr.amount===0n||tr.from===tr.to)continue;
   const eventId=`${receipt.hash??receipt.transactionHash}:${tr.index}:unknown`;
   if(next.seen.has(eventId))throw Error('Duplicate unsupported transfer');
   if(tr.from!==ZERO&&!system.has(tr.from))next.remove(tr.from,tr.amount);
   if(tr.to!==ZERO&&!system.has(tr.to))next.receive(tr.to,tr.amount,time);
   next.seen.add(eventId);
  }
 }
 const batches=new Map();
 for(const log of receipt.logs){
  if(!canonical&&address(log.address)===address(c.hook)){
   let p;try{p=hookInterface.parseLog(log);}catch{}
   if(p&&p.args.poolId?.toLowerCase()===c.poolId.toLowerCase())observations.push({time,sqrtPriceX96:p.args.sqrtPriceX96});
  }
  if(address(log.address)===address(c.distributor)){
   let p;try{p=rewardInterface.parseLog(log);}catch{}
   if(p?.name==='BatchRecorded'){
    if(batches.has(p.args.batchId))throw Error('Duplicate batch header');
    batches.set(p.args.batchId,{total:p.args.total,allocations:[]});
   }
   if(p?.name==='RewardAllocated'){
    const batch=batches.get(p.args.batchId);if(!batch)throw Error('Allocation without batch');
    batch.allocations.push({account:p.args.recipient,amount:p.args.amount});
   }
  }
 }
 for(const [id,batch] of batches){
  if(batch.allocations.reduce((sum,a)=>sum+a.amount,0n)!==batch.total)throw Error('Batch allocation sum mismatch');
  next.acknowledge(id,batch.allocations);
 }
 return {ledger:next,observations,unsupported:decoded.supported?null:{hash:receipt.hash??receipt.transactionHash,reason:decoded.reason,affected:decoded.affected}};
}

export async function buildSnapshot(provider,c,previous=null) {
 if((await provider.getNetwork()).chainId!==BigInt(c.chainId))throw Error('Wrong RPC chain');
 const finalized=await provider.getBlock('finalized');if(!finalized)throw Error('RPC must support finalized reads');
 if(c.deploymentBlock>finalized.number)throw Error('Deployment is not finalized');
 let ledger=previous?LossLedger.restore(previous.ledger):new LossLedger(c);
 let observations=previous?.observations.map(o=>({...o,sqrtPriceX96:BigInt(o.sqrtPriceX96)}))??[];
 const unsupported=[...(previous?.unsupported??[])];let from=c.deploymentBlock;
 if(ledger.checkpoint){
  if(ledger.checkpoint.chainId!==c.chainId)throw Error('Cached chain mismatch');
  if(ledger.checkpoint.blockNumber>finalized.number)throw Error('Finalized RPC moved backwards');
  const prior=await provider.getBlock(ledger.checkpoint.blockNumber);
  if(!prior||prior.hash!==ledger.checkpoint.blockHash)throw Error('Finalized history changed; reconciliation required');
  from=ledger.checkpoint.blockNumber+1;
 }
 const txs=new Map(),blocks=new Map();
 async function scan(filter){const all=[];for(let begin=from;begin<=finalized.number;begin+=1000){
  all.push(...await provider.getLogs({...filter,fromBlock:begin,toBlock:Math.min(begin+999,finalized.number)}));
 }return all;}
 const scans=[
  scan({address:c.token,topics:[transferInterface.getEvent('Transfer').topicHash]}),scan({address:c.hook}),scan({address:c.distributor})
 ];
 if(c.hookFlavor==='native20')scans.push(scan({address:c.poolManager,topics:[
  [poolInterface.getEvent('Initialize').topicHash,poolInterface.getEvent('Swap').topicHash],c.poolId]}));
 for(const logs of await Promise.all(scans))for(const l of logs)txs.set(l.transactionHash,{blockNumber:l.blockNumber,index:l.transactionIndex});
 for(const [hash,info] of [...txs].sort(([,a],[,b])=>a.blockNumber-b.blockNumber||a.index-b.index)){
  if(!blocks.has(info.blockNumber))blocks.set(info.blockNumber,await provider.getBlock(info.blockNumber));
  const block=blocks.get(info.blockNumber),receipt=await provider.getTransactionReceipt(hash);
  if(!receipt||receipt.blockHash!==block.hash||Number(receipt.status)!==1)throw Error('Inconsistent finalized receipt');
  const result=applyReceipt(ledger,receipt,c,block.timestamp);ledger=result.ledger;
  observations.push(...result.observations);if(result.unsupported)unsupported.push(result.unsupported);
 }
 const token=new Contract(c.token,['function balanceOf(address) view returns(uint256)'],provider);
 const system=new Set([c.poolManager,c.hook,c.distributor,...(c.initializer?[c.initializer]:[]),...c.excludedAddresses].map(address));
 for(const [account,a] of ledger.accounts){
  if(system.has(account)){a.quarantined=true;continue;}
  if(await token.balanceOf(account,{blockTag:finalized.number})!==a.balance)throw Error(`Balance reconciliation failed for ${account}`);
 }
 if((await provider.getBlock(finalized.number)).hash!==finalized.hash)throw Error('Finalized checkpoint changed');
 ledger.checkpoint={chainId:c.chainId,blockNumber:finalized.number,blockHash:finalized.hash,timestamp:finalized.timestamp};
 const start=finalized.timestamp-c.twapWindowSeconds,oracle=twap(observations,start,finalized.timestamp);
 let keep=0;for(let i=0;i<observations.length;i++)if(observations[i].time<=start)keep=i;
 observations=observations.slice(keep);
 return {version:1,ledger:ledger.serialize(),checkpoint:ledger.checkpoint,oracle,observations,unsupported,
  generatedAt:Math.floor(Date.now()/1000),transactionsReplayed:txs.size};
}

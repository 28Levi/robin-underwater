import {Interface,Contract} from 'ethers';
import {LossLedger,ZERO,address} from './ledger.mjs';
import {decodeReceipt,hookInterface} from './receipt-adapter.mjs';
import {twap} from './oracle.mjs';
import {normalizeNative20Receipt,poolInterface} from './native20-adapter.mjs';

export const transferInterface=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export const rewardInterface=new Interface([
 'event BatchRecorded(bytes32 indexed batchId,bytes32 indexed auditHash,uint256 total)',
 'event RewardAllocated(bytes32 indexed batchId,address indexed recipient,uint256 amount)',
 'event RewardDeferred(address indexed recipient,uint256 amount)',
 'event RewardPaid(address indexed recipient,uint256 amount)'
]);

/** Apply a complete transaction atomically; malformed input never partly mutates the original. */
export function applyReceipt(ledger,receipt,c,time) {
 // Only real log positions define chronology; Native20's synthetic trade logs do not.
 const logs=receipt.logs.map((log,i)=>({...log,index:log.index??log.logIndex??i}));
 if(logs.some(log=>!Number.isSafeInteger(log.index)||log.index<0)||new Set(logs.map(log=>log.index)).size!==logs.length)
  throw Error('Invalid receipt log positions');
 logs.sort((a,b)=>a.index-b.index);receipt={...receipt,logs};
 const batches=new Map(),timeline=[];
 for(const log of logs){
  if(address(log.address)!==address(c.distributor))continue;
  let p;try{p=rewardInterface.parseLog(log);}catch{}
  if(p?.name==='BatchRecorded'){
   if(batches.has(p.args.batchId)||ledger.seen.has('reward:'+p.args.batchId))throw Error('Duplicate reward batch');
   batches.set(p.args.batchId,{total:p.args.total,sum:0n,recipients:new Set()});
   timeline.push({index:log.index,type:'batch',id:p.args.batchId});
  }else if(p?.name==='RewardAllocated'){
   const batch=batches.get(p.args.batchId);if(!batch)throw Error('Allocation without batch');
   const account=address(p.args.recipient),amount=p.args.amount;
   if(amount<=0n||batch.recipients.has(account))throw Error('Invalid reward allocation');
   batch.recipients.add(account);batch.sum+=amount;
   timeline.push({index:log.index,type:'allocation',account,amount});
  }
 }
 for(const batch of batches.values())if(batch.sum!==batch.total)throw Error('Batch allocation sum mismatch');
 const canonical=c.hookFlavor==='native20'?normalizeNative20Receipt(receipt,c):null;
 if(canonical)receipt=canonical.receipt;
 const next=LossLedger.restore(ledger.serialize()),system=new Set([c.poolManager,c.hook,c.distributor,...(c.initializer?[c.initializer]:[]),...c.excludedAddresses].map(address));
 let decoded=decodeReceipt(receipt,{...c,time});
 const observations=canonical?.observations.map(o=>({time,sqrtPriceX96:o.sqrtPriceX96}))??[];
 // A collapsed router settlement cannot cross an allocation: intermediate ownership
 // matters for relief. Ambiguous mixed receipts retain zero-basis fallback semantics.
 const swap=decoded.supported&&decoded.events.find(e=>e.type==='buy'||e.type==='sell');
 if(swap){
  const positions=decoded.transfers.filter(t=>t.amount>0n).map(t=>t.index),first=Math.min(...positions),last=Math.max(...positions);
  if(timeline.some(e=>e.type==='allocation'&&e.index>first&&e.index<last))
   decoded={...decoded,supported:false,reason:'Reward allocation crosses swap settlement',affected:[...new Set(decoded.transfers.flatMap(t=>[t.from,t.to]))]};
  else swap.index=swap.type==='buy'?last:first;
 }
 if(decoded.supported){
  for(const event of decoded.events){if(event.account&&system.has(event.account))continue;timeline.push({index:event.index,type:'token',event});}
 }else{
  // Unknown inbound inventory has zero basis. It must not quarantine a victim's entire wallet.
  for(const tr of decoded.transfers){
   if(tr.amount===0n||tr.from===tr.to)continue;
   timeline.push({index:tr.index,type:'unknown',transfer:tr});
  }
 }
 for(const entry of timeline.sort((a,b)=>a.index-b.index)){
  if(entry.type==='batch')next.acknowledge(entry.id,[]);
  else if(entry.type==='allocation')next.get(entry.account).relief+=entry.amount;
  else if(entry.type==='token')next.apply(entry.event);
  else{
   const tr=entry.transfer,eventId=`${receipt.hash??receipt.transactionHash}:${tr.index}:unknown`;
   if(next.seen.has(eventId))throw Error('Duplicate unsupported transfer');
   if(tr.from!==ZERO&&!system.has(tr.from))next.remove(tr.from,tr.amount);
   if(tr.to!==ZERO&&!system.has(tr.to))next.receive(tr.to,tr.amount,time);
   next.seen.add(eventId);
  }
 }
 for(const log of receipt.logs){
  if(!canonical&&address(log.address)===address(c.hook)){
   let p;try{p=hookInterface.parseLog(log);}catch{}
   if(p&&p.args.poolId?.toLowerCase()===c.poolId.toLowerCase())observations.push({time,sqrtPriceX96:p.args.sqrtPriceX96});
  }
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
 const txs=new Map(),blocks=new Map(),changedAccounts=new Set();
 const pendingRecipients=new Set(previous?.pendingRecipients??[]);
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
  for(const log of receipt.logs){
   if(address(log.address)===address(c.token)){
    let p;try{p=transferInterface.parseLog(log);}catch{}
    if(p){changedAccounts.add(address(p.args.from));changedAccounts.add(address(p.args.to));}
   }
   if(address(log.address)===address(c.distributor)){
    let p;try{p=rewardInterface.parseLog(log);}catch{}
    if(p?.name==='RewardDeferred')pendingRecipients.add(address(p.args.recipient));
    else if(p?.name==='RewardPaid')pendingRecipients.delete(address(p.args.recipient));
   }
  }
  const result=applyReceipt(ledger,receipt,c,block.timestamp);ledger=result.ledger;
  observations.push(...result.observations);if(result.unsupported)unsupported.push(result.unsupported);
 }
 const token=new Contract(c.token,['function balanceOf(address) view returns(uint256)'],provider);
 const system=new Set([c.poolManager,c.hook,c.distributor,...(c.initializer?[c.initializer]:[]),...c.excludedAddresses].map(address));
 // Unchanged balances were reconciled at the persisted finalized checkpoint.
 // Check only addresses touched in this interval, rather than every historical dust recipient.
 for(const account of previous?changedAccounts:ledger.accounts.keys()){
  const a=ledger.accounts.get(account);if(!a)continue;
  if(system.has(account)){a.quarantined=true;continue;}
  if(await token.balanceOf(account,{blockTag:finalized.number})!==a.balance)throw Error(`Balance reconciliation failed for ${account}`);
 }
 if((await provider.getBlock(finalized.number)).hash!==finalized.hash)throw Error('Finalized checkpoint changed');
 ledger.checkpoint={chainId:c.chainId,blockNumber:finalized.number,blockHash:finalized.hash,timestamp:finalized.timestamp};
 // The finalized cursor prevents replay of prior receipts. Keep deduplication within
 // an interval, without copying all historical event IDs into every future receipt.
 ledger.seen.clear();
 const start=finalized.timestamp-c.twapWindowSeconds,oracle=twap(observations,start,finalized.timestamp);
 let keep=0;for(let i=0;i<observations.length;i++)if(observations[i].time<=start)keep=i;
 observations=observations.slice(keep);
 return {version:1,ledger:ledger.serialize(),checkpoint:ledger.checkpoint,oracle,observations,unsupported,pendingRecipients:[...pendingRecipients].sort(),
  generatedAt:Math.floor(Date.now()/1000),transactionsReplayed:txs.size};
}

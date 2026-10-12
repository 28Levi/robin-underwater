import {Interface,Transaction} from 'ethers';
import {address,LossLedger} from './ledger.mjs';

const payout=new Interface(['function distributeEligible(bytes32,bytes32,address,uint256,address[],uint256[],uint256[])']);
const claim=new Interface(['function claimCreator()']);
const retry=new Interface(['function pay(address)']);
const events=new Interface([
 'event BatchRecorded(bytes32 indexed batchId,bytes32 indexed auditHash,uint256 total)',
 'event RewardAllocated(bytes32 indexed batchId,address indexed recipient,uint256 amount)',
 'event RewardSkipped(bytes32 indexed batchId,address indexed recipient)']);
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x);
const fail=()=>{throw Error('Pipeline transaction evidence mismatch; reconciliation required');};

/** Reservations are derived from the signed transaction, never a loose side list. */
export function decodePipelineRecord(record,c){
 let tx;try{tx=Transaction.from(record.raw);}catch{fail();}
 if(!tx.signature||tx.hash!==record.hash||tx.nonce!==record.nonce||tx.chainId!==BigInt(c.chainId)
  ||tx.value!==0n||tx.type!==2||!c.execution?.operator||address(tx.from)!==address(c.execution.operator))fail();
 if(record.kind==='harvest'){
  if(address(tx.to)!==address(c.execution.feeVault)||tx.data!==claim.encodeFunctionData('claimCreator')||record.deadline!==null)fail();
  return {tx};
 }
 if(address(tx.to)!==address(c.distributor))fail();
 if(record.kind==='retry'){
  if(tx.data!==retry.encodeFunctionData('pay',[record.recipient])||record.deadline!==null)fail();
  return {tx};
 }
 if(record.kind!=='payout')fail();
 let args;try{args=payout.decodeFunctionData('distributeEligible',tx.data);}catch{fail();}
 const [batchId,auditHash,token,deadline,accounts,amounts,balances]=args;
 if(tx.data!==payout.encodeFunctionData('distributeEligible',args)||address(token)!==address(c.token)
  ||deadline!==BigInt(record.deadline)||batchId!==record.batchId||auditHash!==record.auditHash
  ||!hash(record.roundId)||!Number.isSafeInteger(record.roundEnd)||record.roundEnd<1
  ||accounts.length<1||accounts.length>100||accounts.length!==amounts.length||accounts.length!==balances.length
  ||!Array.isArray(record.allocations)||record.allocations.length!==accounts.length)fail();
 const allocations=accounts.map((account,i)=>{
  account=address(account);const saved=record.allocations[i];
  if(amounts[i]<=0n||balances[i]<=0n||(i&&account<=address(accounts[i-1]))||address(saved.account)!==account
   ||BigInt(saved.amount)!==amounts[i]||BigInt(saved.balance)!==balances[i])fail();
  return {account,amount:amounts[i],balance:balances[i]};
 });
 return {tx,batchId,auditHash,allocations,total:amounts.reduce((s,a)=>s+a,0n)};
}

/** A mined receipt must explain every signed recipient, including contract skips. */
export function validatePipelineReceipt(record,receipt,c){
 const decoded=decodePipelineRecord(record,c);
 if(!receipt||Number(receipt.status)!==1||!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<0
  ||!hash(receipt.blockHash)||(receipt.hash??receipt.transactionHash)!==record.hash
  ||(receipt.from&&address(receipt.from)!==address(decoded.tx.from))
  ||(receipt.to&&address(receipt.to)!==address(decoded.tx.to)))fail();
 if(record.kind!=='payout')return decoded;
 const expected=new Map(decoded.allocations.map(a=>[a.account,a.amount])),seen=new Set();
 let batch=null,total=0n;
 for(const log of receipt.logs){
  if(address(log.address)!==address(c.distributor))continue;
  let p;try{p=events.parseLog(log);}catch{}
  if(!p)continue;
  if(p.args.batchId!==decoded.batchId)fail();
  if(p.name==='BatchRecorded'){
   if(batch||p.args.auditHash!==decoded.auditHash)fail();batch=p;
  }else{
   const recipient=address(p.args.recipient);
   if(!expected.has(recipient)||seen.has(recipient))fail();seen.add(recipient);
   if(p.name==='RewardAllocated'){
    if(p.args.amount!==expected.get(recipient))fail();total+=p.args.amount;
   }
  }
 }
 if(!batch||seen.size!==expected.size||batch.args.total!==total)fail();
 return {...decoded,allocatedTotal:total};
}

/** Keep the persisted finalized ledger untouched. A full signed reservation is
 * conservative even if the balance guard skipped someone: release it only when
 * finalized replay includes the actual allocation events.
 */
export async function reservePipelinePayouts(provider,c,snapshot,records,head){
 if(c.execution?.confirmationMode!=='pipelined-finalized-v1'||!Array.isArray(records)
  ||records.length>c.execution.maxInflightTransactions)throw Error('Invalid pipeline reservation policy');
 const ledger=LossLedger.restore(snapshot.ledger),cp=snapshot.checkpoint,tracked=new Map();
 let reservedWei=0n;const batches=[],seenNonces=new Set(),seenHashes=new Set();
 for(const record of records){
  if(seenHashes.has(record.hash)||seenNonces.has(record.nonce))fail();
  seenHashes.add(record.hash);seenNonces.add(record.nonce);
  const decoded=decodePipelineRecord(record,c),mined=record.mined;
  if(!mined||mined.status!==1||!Number.isSafeInteger(mined.blockNumber)||!hash(mined.blockHash))fail();
  const [block,receipt]=await Promise.all([provider.getBlock(mined.blockNumber),provider.getTransactionReceipt(record.hash)]);
  if(!block||block.hash!==mined.blockHash||!receipt||receipt.blockNumber!==mined.blockNumber||receipt.blockHash!==mined.blockHash)fail();
  const verified=validatePipelineReceipt(record,receipt,c);
  if(mined.blockNumber>head.number)fail();
  if(record.kind!=='payout'||mined.blockNumber<=cp.blockNumber)continue;
  if(tracked.has(decoded.batchId))fail();
  tracked.set(decoded.batchId,{record,decoded,allocatedTotal:verified.allocatedTotal});
  ledger.acknowledge(decoded.batchId,decoded.allocations);
  reservedWei+=decoded.total;
  batches.push({hash:record.hash,batchId:decoded.batchId,blockNumber:mined.blockNumber,blockHash:mined.blockHash,
   amountWei:decoded.total.toString()});
 }
 return {ledger,tracked,reservedWei,batches};
}

export function verifyReservedBatchLog(log,reservations,c){
 let parsed;try{parsed=events.parseLog(log);}catch{fail();}
 const item=parsed&&reservations.tracked.get(parsed.args.batchId);
 if(parsed?.name!=='BatchRecorded'||!item||address(log.address)!==address(c.distributor)
  ||log.transactionHash!==item.record.hash||log.blockNumber!==item.record.mined.blockNumber
  ||log.blockHash!==item.record.mined.blockHash||parsed.args.auditHash!==item.decoded.auditHash
  ||parsed.args.total!==item.allocatedTotal)fail();
 return parsed.args.batchId;
}

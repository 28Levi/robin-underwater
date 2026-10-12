import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Transaction} from 'ethers';
import {atomicWrite,fingerprint} from './store.mjs';
import {stringify,address} from './ledger.mjs';
import {validatePayoutSchedule} from './payout-schedule.mjs';

const digest=value=>createHash('sha256').update(stringify(value)).digest('hex');
export function executionBinding(c,operator){return digest({payoutPolicy:'minimum-balance-skip-v1',tokenIdentity:{name:c.name,symbol:c.symbol},ledger:fingerprint(c),execution:c.execution,operator:address(operator),
 batchSize:c.batchSize,maxSnapshotAgeSeconds:c.maxSnapshotAgeSeconds,maxFinalityLagSeconds:c.maxFinalityLagSeconds,
 ...(c.execution?.payoutIntervalSeconds===undefined?{}:{payoutStartTimestamp:c.payoutStartTimestamp})});}
export function readJournal(file,binding){
 if(!fs.existsSync(file))return {binding,reservedGasWei:'0',retryGasWei:'0',retryAttempts:{},pending:null,round:null,history:[],retryAt:{},fault:null};
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 if(saved.schemaVersion!=='robin.execution-journal.v2'||saved.checksum!==digest(saved.state)||saved.state.binding!==binding)
  throw Error('Execution journal integrity/config mismatch');
 const state=saved.state;
 validatePayoutSchedule(state.schedule);
 validatePipelineJournal(state);
 if(state.pending){const tx=Transaction.from(state.pending.raw);
  if(tx.hash!==state.pending.hash||tx.nonce!==state.pending.nonce)throw Error('Execution journal transaction mismatch');}
 return state;
}
/** Pipeline opt-in has its own immutable config binding. Old serial journals
 * cannot silently acquire overlapping transaction state. */
export function validatePipelineJournal(state){
 if(state.pipeline===undefined){if(state.inflight!==undefined)throw Error('Inflight records require pipeline journal');return;}
 const p=state.pipeline,integer=x=>Number.isSafeInteger(x)&&x>=0,hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x);
 if(!p||p.version!==1||!integer(p.initialNonce)||!integer(p.nextNonce)||p.nextNonce<p.initialNonce
  ||(p.lastHarvestAttemptAt!==null&&!integer(p.lastHarvestAttemptAt))||!Array.isArray(state.inflight)||state.inflight.length+(state.pending?1:0)>8)
  throw Error('Invalid pipeline journal');
 const known=new Map();
 for(const h of state.history){
  if(!integer(h.nonce)||!hash(h.hash)||known.has(h.nonce)||h.status!==1)throw Error('Invalid pipeline finality history');
  known.set(h.nonce,h.hash);
 }
 for(const record of [...state.inflight,...(state.pending?[state.pending]:[])]){
  const tx=Transaction.from(record.raw);
  if(tx.hash!==record.hash||tx.nonce!==record.nonce||!integer(record.nonce))throw Error('Pipeline journal transaction mismatch');
  if(record!==state.pending){
   if(!record.mined||record.mined.status!==1||!integer(record.mined.blockNumber)||!hash(record.mined.blockHash)||typeof record.finalized!=='boolean')
    throw Error('Invalid pipeline mined record');
   if(record.finalized){
    const h=state.history.find(item=>item.nonce===record.nonce);
    if(!h||h.hash!==record.hash||h.blockNumber!==record.mined.blockNumber||h.blockHash!==record.mined.blockHash)
     throw Error('Pipeline finalized record mismatch');
   }else if(known.has(record.nonce))throw Error('Duplicate pipeline nonce');
  }else if(known.has(record.nonce)||record.nonce!==p.nextNonce-1||record.mined)throw Error('Invalid pipeline pending nonce');
  known.set(record.nonce,record.hash);
 }
 if(known.size!==p.nextNonce-p.initialNonce)throw Error('Pipeline nonce history is incomplete');
 for(let nonce=p.initialNonce;nonce<p.nextNonce;nonce++)if(!known.has(nonce))throw Error('Pipeline nonce history is incomplete');
 const active=state.inflight.filter(record=>!record.finalized).map(record=>record.nonce);
 if(new Set(state.inflight.map(record=>record.nonce)).size!==state.inflight.length
  ||active.some(nonce=>state.pending&&nonce>=state.pending.nonce))throw Error('Invalid pipeline nonce order');
}
export function writeJournal(file,state){atomicWrite(file,{schemaVersion:'robin.execution-journal.v2',checksum:digest(state),state});}

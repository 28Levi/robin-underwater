import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Transaction} from 'ethers';
import {atomicWrite,fingerprint} from './store.mjs';
import {stringify,address} from './ledger.mjs';

const digest=value=>createHash('sha256').update(stringify(value)).digest('hex');
export function executionBinding(c,operator){return digest({payoutPolicy:'minimum-balance-skip-v1',ledger:fingerprint(c),execution:c.execution,operator:address(operator),
 batchSize:c.batchSize,maxSnapshotAgeSeconds:c.maxSnapshotAgeSeconds,maxFinalityLagSeconds:c.maxFinalityLagSeconds});}
export function readJournal(file,binding){
 if(!fs.existsSync(file))return {binding,reservedGasWei:'0',pending:null,round:null,history:[],retryAt:{},fault:null};
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 if(saved.schemaVersion!=='robin.execution-journal.v2'||saved.checksum!==digest(saved.state)||saved.state.binding!==binding)
  throw Error('Execution journal integrity/config mismatch');
 const state=saved.state;
 if(state.pending){const tx=Transaction.from(state.pending.raw);
  if(tx.hash!==state.pending.hash||tx.nonce!==state.pending.nonce)throw Error('Execution journal transaction mismatch');}
 return state;
}
export function writeJournal(file,state){atomicWrite(file,{schemaVersion:'robin.execution-journal.v2',checksum:digest(state),state});}

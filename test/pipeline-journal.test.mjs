import test from 'node:test';
import assert from 'node:assert/strict';
import {HDNodeWallet,Transaction} from 'ethers';
import {validatePipelineJournal} from '../src/execution-journal.mjs';

const wallet=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
const blockHash='0x'+'12'.repeat(32),copy=x=>structuredClone(x);
const records=await Promise.all(Array.from({length:9},async(_,i)=>{
 const nonce=7+i,raw=await wallet.signTransaction({chainId:4663,type:2,nonce,to:wallet.address,value:0n,
  data:'0x',gasLimit:21000n,maxFeePerGas:100n,maxPriorityFeePerGas:0n});
 return {nonce,raw,hash:Transaction.from(raw).hash,kind:'harvest',deadline:null,recipient:null,roundEnd:null,
  mined:{blockNumber:10+i,blockHash,status:1},finalized:false};
}));
const state=()=>({pipeline:{version:1,initialNonce:7,nextNonce:15,lastHarvestAttemptAt:900},
 inflight:copy(records.slice(0,8)),pending:null,history:[]});

test('pipeline journal bounds every signed transaction, including an unmined pending transaction',()=>{
 const s=state();assert.doesNotThrow(()=>validatePipelineJournal(s));
 const pending=s.inflight.pop();delete pending.mined;delete pending.finalized;s.pending=pending;
 assert.doesNotThrow(()=>validatePipelineJournal(s));
 s.inflight.push(copy(records[8]));s.pipeline.nextNonce++;
 assert.throws(()=>validatePipelineJournal(s),/Invalid pipeline journal/);
});

test('pipeline journal rejects nonce gaps, duplicate mined records and stale pending cursors',()=>{
 const gap=state();gap.inflight.splice(2,1);assert.throws(()=>validatePipelineJournal(gap),/nonce history is incomplete/);
 const duplicate=state();duplicate.inflight[2]=copy(duplicate.inflight[1]);assert.throws(()=>validatePipelineJournal(duplicate),/Duplicate pipeline nonce/);
 const stale=state();stale.pending=stale.inflight.shift();delete stale.pending.mined;
 assert.throws(()=>validatePipelineJournal(stale),/Invalid pipeline pending nonce/);
 const raw=state();raw.inflight[2].raw=raw.inflight[1].raw;assert.throws(()=>validatePipelineJournal(raw),/transaction mismatch/);
});

test('finalized payout retention must match one exact finalized receipt while still preserving nonce continuity',()=>{
 const s=state(),r=s.inflight[0];r.kind='payout';r.finalized=true;
 s.history.push({nonce:r.nonce,hash:r.hash,blockNumber:r.mined.blockNumber,blockHash:r.mined.blockHash,status:1});
 assert.doesNotThrow(()=>validatePipelineJournal(s));
 const mismatched=copy(s);mismatched.history[0].blockNumber++;
 assert.throws(()=>validatePipelineJournal(mismatched),/finalized record mismatch/);
 const replayed=copy(s);replayed.inflight.shift();assert.doesNotThrow(()=>validatePipelineJournal(replayed));
 const lost=copy(replayed);lost.history=[];assert.throws(()=>validatePipelineJournal(lost),/nonce history is incomplete/);
});

test('legacy journals cannot inherit inflight state without explicit pipeline metadata',()=>{
 assert.doesNotThrow(()=>validatePipelineJournal({pending:null,history:[]}));
 assert.throws(()=>validatePipelineJournal({pending:null,history:[],inflight:[]}),/require pipeline journal/);
});

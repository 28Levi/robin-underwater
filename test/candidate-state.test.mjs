import test from 'node:test';import assert from 'node:assert/strict';
import {verifyCandidateState} from '../src/candidate-state.mjs';
import {transferInterface} from '../src/replay.mjs';
import {payoutInterface} from '../src/payout-plan.mjs';
const c={token:'0x'+'1'.repeat(40),distributor:'0x'+'2'.repeat(40)},original={number:10,hash:'0x'+'a'.repeat(64)};
const head={number:20,hash:'0x'+'b'.repeat(64)},candidate={kind:'payout',headNumber:10,headHash:original.hash};
candidate.data=payoutInterface.encodeFunctionData('distributeEligible',[original.hash,head.hash,c.token,9999999999,[c.token],[1],[1]]);
const provider={getBlock:async n=>n===10?original:head,getLogs:async()=>[]};
test('ordinary new blocks do not starve payment submission',async()=>{
 await verifyCandidateState(provider,c,candidate,head,'estimation');
});
test('changed token balances or allocations still defer the prepared payout',async()=>{
 const transfer=transferInterface.encodeEventLog(transferInterface.getEvent('Transfer'),[c.token,c.distributor,1n]);
 await assert.rejects(verifyCandidateState({...provider,getLogs:async f=>f.address===c.token?[transfer]:[]},c,candidate,head,'estimation'),/Head changed/);
 await assert.rejects(verifyCandidateState({...provider,getLogs:async f=>f.address===c.distributor?[{}]:[]},c,candidate,head,'estimation'),/Head changed/);
});
test('reorganized prepared state or checked head fails closed',async()=>{
 await assert.rejects(verifyCandidateState({...provider,getBlock:async()=>({...original,hash:'0xwrong'})},c,candidate,head,'estimation'),/reorganized/);
 await assert.rejects(verifyCandidateState({...provider,getBlock:async n=>n===10?original:{...head,hash:'0xwrong'}},c,candidate,head,'estimation'),/reorganized/);
});
test('fee harvest is not blocked by ongoing trading, and zero/self transfers do not alter inventory',async()=>{
 await verifyCandidateState({...provider,getLogs:async()=>{throw Error('Harvest does not need token history');}},c,{...candidate,kind:'harvest'},head,'estimation');
 const zero=transferInterface.encodeEventLog(transferInterface.getEvent('Transfer'),[c.token,c.distributor,0n]);
 const self=transferInterface.encodeEventLog(transferInterface.getEvent('Transfer'),[c.token,c.token,1n]);
 await verifyCandidateState({...provider,getLogs:async f=>f.address===c.token?[zero,self]:[]},c,candidate,head,'estimation');
});

test('unrelated transfers and incoming dust do not defer an eligible recipient',async()=>{
 const other='0x'+'3'.repeat(40),another='0x'+'4'.repeat(40);
 for(const [from,to] of [[other,another],[other,c.token]]){
  const transfer=transferInterface.encodeEventLog(transferInterface.getEvent('Transfer'),[from,to,1n]);
  await verifyCandidateState({...provider,getLogs:async f=>f.address===c.token?[transfer]:[]},c,candidate,head,'estimation');
 }
});

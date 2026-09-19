import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as ethers from 'ethers';
import {validateDraft,boundedTransaction,LAUNCH_WALLET,OPERATOR,CREATION_HASH,CHAIN_ID,ANCHOR,MANAGER_HASH,GAS_CAP,PRESERVED_BALANCE} from '../signing-ui/guards.mjs';
const artifact=JSON.parse(fs.readFileSync(new URL('../artifacts/UnderwaterDistributor.json',import.meta.url)));
const creation=await new ethers.ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(OPERATOR);
const predictedAddress=ethers.getCreateAddress({from:LAUNCH_WALLET,nonce:1});
const draft={budgetApproved:true,approvedGasBudgetWei:GAS_CAP.toString(),operator:OPERATOR,predictedAddress,
  creationBytecodeHash:CREATION_HASH,transaction:{from:LAUNCH_WALLET,data:creation.data,chainId:CHAIN_ID,value:'0x0',nonce:'0x1'}};
const simulation={passed:true,localEvmOnly:true,operator:OPERATOR,predictedAddress,exactCreationDataHash:CREATION_HASH};
const hashing={...ethers,keccak256:value=>value==='test-manager-code'?MANAGER_HASH:ethers.keccak256(value)};
const now=1800000000;
function state(){return {account:LAUNCH_WALLET,chainId:CHAIN_ID,anchor:ANCHOR,head:{timestamp:'0x'+now.toString(16)},
  managerCode:'test-manager-code',latestNonce:'0x1',pendingNonce:'0x1',balance:'292742277496000000',gasPrice:'81972000',deployedCode:'0x',gasEstimate:'926429'};}
test('reviewed real creation package binds operator and simulation',()=>{
  validateDraft(draft,simulation,ethers);
  for(const mutate of [d=>{d.transaction.to=LAUNCH_WALLET;},d=>{d.transaction.value='0x1';},d=>{d.transaction.data+='00';},
    d=>{d.operator=LAUNCH_WALLET;},d=>{d.transaction.nonce='0x2';},d=>{d.approvedGasBudgetWei='900000000000000';}]){
    const bad=structuredClone(draft);mutate(bad);assert.throws(()=>validateDraft(bad,simulation,ethers));
  }
});
test('fresh transaction has zero value, pinned sender and gas within cap',()=>{
  const {transaction:t,maximumCost}=boundedTransaction(draft,state(),hashing,now);
  assert.equal(t.value,'0x0');assert.equal(t.to,undefined);assert.equal(t.from,LAUNCH_WALLET);
  assert.equal(t.nonce,'0x1');assert.equal(t.data,draft.transaction.data);
  assert.equal(maximumCost,BigInt(t.gas)*BigInt(t.gasPrice));assert.ok(maximumCost<=GAS_CAP);
});
test('refuses wrong wallet or chain, nonce races, duplicate contract, stale state and overspending',()=>{
  for(const patch of [
    {account:simulation.operator},{chainId:'0x1'},{anchor:{hash:'0x0'}},{managerCode:'0x'},
    {latestNonce:'0x2'},{pendingNonce:'0x2'},{deployedCode:'0x1234'},
    {head:{timestamp:'0x'+(now-301).toString(16)}},{head:{timestamp:'0x'+(now+31).toString(16)}},
    {gasPrice:'1000000000'},{gasEstimate:'100000000'},{gasEstimate:'0'},{balance:PRESERVED_BALANCE.toString()}
  ]) assert.throws(()=>boundedTransaction(draft,{...state(),...patch},hashing,now));
});

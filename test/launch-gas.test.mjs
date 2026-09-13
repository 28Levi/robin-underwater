import test from 'node:test';import assert from 'node:assert/strict';
import {keccak256} from 'ethers';
import {estimateLaunchGas} from '../src/launch-gas.mjs';
const wallet='0x'+'1'.repeat(40),router='0x'+'2'.repeat(40),now=Date.parse('2026-09-12T12:00:00Z');
const intent={chainId:4663,launchWallet:wallet,initialBuyWei:'100000000000000000',maxLaunchValueWei:'100000000000000000',maxGasCostWei:null};
const tx={chainId:'4663',apiVersion:'v4',from:wallet,to:router,valueWei:intent.initialBuyWei,calldata:'0xe5f6b8cd0000',expiresAt:'2026-09-12T12:10:00Z'};
const capabilities={chainDeployment:{contracts:{programmableLaunchStampRouter:{address:router,runtimeCodeHash:keccak256('0x6000')}}}};
function rpc(){return {getNetwork:async()=>({chainId:4663n}),getCode:async()=>'0x6000',estimateGas:async request=>{assert.equal(request.value,100000000000000000n);return 100000n;},
 getFeeData:async()=>({maxFeePerGas:20n,gasPrice:15n,maxPriorityFeePerGas:2n}),getBlock:async()=>({number:42,hash:'0x'+'a'.repeat(64)})};}
const estimate=(provider=rpc(),t=tx,i=intent)=>estimateLaunchGas(provider,i,t,capabilities,{now});
test('gas is separate from purchase and never invents budget approval',async()=>{
 const before=JSON.stringify(intent),r=await estimate();assert.equal(r.purchaseWei,100000000000000000n);
 assert.equal(r.suggestedGasLimit,120000n);assert.equal(r.executionGasCostAtSuggestedCapWei,2400000n);
 assert.equal(r.approvedGasBudgetWei,null);assert.equal(r.executionEstimateWithinApprovedBudget,null);
 assert.equal(r.broadcast,false);assert.equal(r.authorizationVerified,false);assert.equal(JSON.stringify(intent),before);
});
test('wrong chain, wallet, router and increased transaction value are rejected before estimation',async()=>{
 for(const change of [{chainId:'1'},{from:router},{to:wallet},{valueWei:'100000000000000001'}])await assert.rejects(estimate(rpc(),{...tx,...change}));
 await assert.rejects(estimate({...rpc(),getNetwork:async()=>({chainId:1n})}),/Wrong launch chain/);
});
test('expired packages, invalid calldata and changed router runtime are rejected',async()=>{
 await assert.rejects(estimate(rpc(),{...tx,expiresAt:'2026-09-12T11:59:00Z'}),/expired/);
 await assert.rejects(estimate(rpc(),{...tx,calldata:'0x1234'}),/calldata/);
 await assert.rejects(estimate({...rpc(),getCode:async()=>'0x6001'}),/code does not match/);
});
test('an explicitly supplied budget is compared but never raised',async()=>{
 const i={...intent,maxGasCostWei:'1'},r=await estimate(rpc(),tx,i);
 assert.equal(r.executionEstimateWithinApprovedBudget,false);assert.equal(i.maxGasCostWei,'1');
});
test('unavailable fee data fails without treating gas as free',async()=>{
 await assert.rejects(estimate({...rpc(),getFeeData:async()=>({maxFeePerGas:null,gasPrice:null})}),/Gas price unavailable/);
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import solc from 'solc';
import {Contract,JsonRpcSigner,Interface,keccak256,toBeHex,MaxUint256} from 'ethers';
import {compileRobinLaunchContracts,buildRobinLaunchPlan,assertCurrentPlanCapabilities,ATOMIC,GRAPH,MANAGER,PLAN_MANIFEST,PROJECT_GAS_LIMIT,TOTAL_GAS_LIMIT,MAX_ORDER_LIFETIME_SECONDS} from '../src/launch-plan.mjs';
import {runCustomLaunchPlanPackerCliV1} from '../vendor/programmable-launch-plan-v1/request-packer.mjs';
import {parseRobinLaunchPlanOptions} from '../scripts/prepare-robin-launch-plan.mjs';
import {loadNative30Recipe,assertNative30CompiledRuntime,assertNative30MaterializedRuntime,NATIVE30_SOURCE_ARTIFACT} from '../src/native30-runtime.mjs';
import {native20Fixture,E,artifact} from './helpers/native20-fixture.mjs';
process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');const {default:hre}=await import('hardhat');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),intent=read('launch-intent.json'),capabilities=read('vendor/programmable-launch-plan-v1/capabilities-observed.json'),factory=read('vendor/programmable-launch-plan-v1/graph-factory.json');
const now=1800000000,distributor={verified:true,finalized:true,chainId:4663,address:intent.creatorFeeRecipient,operator:intent.operator,runtimeCodeHash:'0x66185b6a0594742a3d828569800982b6f1eaab8aca8ef7b8aa14c0dc0ae7a7f8',checkedAt:new Date(now*1000).toISOString()};
const compiled=compileRobinLaunchContracts(process.cwd(),solc);
const input={intent,compiled,capabilities,factory,distributor,sourceRevision:'1'.repeat(40),nonce:'0x'+'31'.repeat(32),now};
const built=buildRobinLaunchPlan(input);

test('current Atomic source plan packs custom ROBIN 170/30 economics and all four runtime bindings',async()=>{
 const dir=fs.mkdtempSync(path.resolve('output/launch-plan-test-'));fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(built.plan));
 assert.equal(await runCustomLaunchPlanPackerCliV1(['--input',path.join(dir,'plan.json'),'--out',path.join(dir,'request.json'),'--report',path.join(dir,'report.json')]),0);
 const report=read(path.join(dir,'report.json'));assert.equal(report.status,'packed');assert.equal(report.productionAuthority,false);assert.equal(report.walletSigning,false);
 assert.equal(built.plan.manifestDigest,PLAN_MANIFEST);assert.equal(built.plan.publication.symbol,'ROBIN');assert.deepEqual(built.plan.feeObligations,[]);assert.equal(built.plan.executor,'atomic_execute_and_stamp_v2');
 assert.equal(built.plan.components.length,4);assert.equal(built.plan.actions.length,3);assert.equal(new Set(built.plan.actions.map(a=>a.execution.data)).size,1);
 assert.equal(built.plan.budgets.maxTotalGas,TOTAL_GAS_LIMIT);assert.equal(built.report.totalGasLimit,TOTAL_GAS_LIMIT);assert.ok(built.plan.actions.every(a=>a.execution.gasLimit===PROJECT_GAS_LIMIT));
 // The exact deployed factory independently checks the graph commitment in the EVM test below.
 assert.equal(BigInt(built.plan.budgets.deadline)-BigInt(built.plan.budgets.validAfter),BigInt(MAX_ORDER_LIFETIME_SECONDS));assert.ok(BigInt(built.plan.budgets.deadline)>BigInt(now));
 assert.equal(built.report.hookFees.projectBuyBps,170);assert.equal(built.report.hookFees.platformBps,30);assert.equal(built.report.routedTradingFee.waiverVerified,false);
 assert.equal(built.report.hookImplementation.recipe,'robin-native30-no-module');assert.equal(built.report.hookImplementation.canonicalUpstreamReproduced,true);
 assert.equal(built.report.hookImplementation.native30Runtime.normalizedRuntimeAndImmutableOffsetsVerified,true);
 assert.equal(built.report.native30Runtime.localRuntimeBindingsVerified,true);assert.equal(built.report.native30Runtime.platformWaiverVerified,false);
 assert.equal(built.report.native30Runtime.sourceArtifactHash,NATIVE30_SOURCE_ARTIFACT);
 const hookBinding=built.plan.verificationBundle.components.find(c=>c.targetId==='hook');
 assert.equal(hookBinding.contractName,'RobinhookNativeFeeHookV1');assert.equal(hookBinding.compilationUnitId,'robin-native30');
 assert.equal('0x'+compiled.contracts.RobinhoodNativeFeeHookV1.evm.bytecode.object,compiled.reviewed.kernel.creationBytecode);
 assert.notEqual(compiled.contracts.RobinhookNativeFeeHookV1.evm.bytecode.object,compiled.contracts.RobinhoodNativeFeeHookV1.evm.bytecode.object);
 const decoded=new Interface(factory.abi).decodeFunctionData('deployGraph',built.factoryCall);assert.equal(decoded.authorization.authorizedLauncher,ATOMIC);assert.equal(decoded.authorization.totalValue,E/100n);
 assert.ok(built.plan.expectedEffects.some(e=>e.effectId==='feeVault-child'));assert.ok(built.plan.expectedEffects.some(e=>e.effectId==='initial-buyer-output'));
});

test('Native30 compiler and materialization checks reject recipe, complete runtime, immutable positions and custody drift',()=>{
 const recipe=compiled.native30Recipe;
 assertNative30CompiledRuntime(compiled.contracts,recipe);
 for(const mutate of [
  c=>c.RobinhookNativeFeeHookV1.evm.deployedBytecode.object='61'+c.RobinhookNativeFeeHookV1.evm.deployedBytecode.object.slice(2),
  c=>c.RobinhoodNativeFeeVaultV1.evm.deployedBytecode.object='61'+c.RobinhoodNativeFeeVaultV1.evm.deployedBytecode.object.slice(2),
  c=>Object.values(c.RobinhookNativeFeeHookV1.evm.deployedBytecode.immutableReferences)[0][0].start++,
  c=>Object.values(c.RobinhoodNativeFeeVaultV1.evm.deployedBytecode.immutableReferences)[0][0].length=31,
  c=>{const hook=c.RobinhookNativeFeeHookV1,id=Object.keys(hook.evm.deployedBytecode.immutableReferences)[0];hook.names.set(id,'unbound');},
 ]){const contracts=structuredClone(compiled.contracts);mutate(contracts);assert.throws(()=>assertNative30CompiledRuntime(contracts,recipe),/Native30 runtime recipe/);}
 for(const mutate of [r=>r.sourceArtifactHash='sha256:'+'0'.repeat(64),r=>r.hook.immutableWords[0].byteOffsets[0]++,r=>r.vault.runtimeTemplateHex='0x61'+r.vault.runtimeTemplateHex.slice(4)]){
  const changed=structuredClone(recipe);mutate(changed);assert.throws(()=>assertNative30CompiledRuntime(compiled.contracts,changed),/Native30 runtime recipe/);
 }
 const args={recipe,runtimeCodes:built.runtimeCodes,addresses:built.report.addresses,creatorRecipient:intent.creatorFeeRecipient,poolManager:MANAGER,initialSqrtPriceX96:'1747735933952748037356115466503453'};
 assertNative30MaterializedRuntime(args);
 const changedWord=(code,entry,value)=>{for(const offset of entry.byteOffsets){const start=offset*2+2;code=code.slice(0,start)+BigInt(value).toString(16).padStart(64,'0')+code.slice(start+64);}return code;};
 for(const [role,name,value]of [['hook','creatorBuyFeeBps',180],['hook','module',1],['vault','creatorRecipient',1],['vault','kernel',1]]){
  const key=role==='hook'?'hook':'feeVault',runtimeCodes={...built.runtimeCodes};
  runtimeCodes[key]=changedWord(runtimeCodes[key],recipe[role].immutableWords.find(w=>w.name===name),value);
  assert.throws(()=>assertNative30MaterializedRuntime({...args,runtimeCodes}),/parameter differs/);
 }
 const root=fs.mkdtempSync(path.resolve('output/native30-recipe-pin-test-'));
 fs.mkdirSync(path.join(root,'vendor/programmable-native30'),{recursive:true});
 const original=fs.readFileSync('vendor/programmable-native30/runtime-recipes-v2.ts');
 fs.writeFileSync(path.join(root,'vendor/programmable-native30/runtime-recipes-v2.ts'),Buffer.concat([original,Buffer.from('\n')]));
 assert.throws(()=>loadNative30Recipe(root),/pinned published recipe bytes changed/);
});

test('plan rejects retired/unbound capabilities, altered economics, stale custody evidence and missing source identity',()=>{
 for(const mutate of [x=>x.intent.symbol='HOOD',x=>x.intent.projectBuyFeeBps=180,x=>x.intent.platformFeeBps=20,x=>x.intent.maxGasCostWei='900000000000000',x=>x.distributor.verified=false,x=>x.distributor.checkedAt=new Date((now-3601)*1000).toISOString(),x=>x.distributor.operator=x.intent.launchWallet,x=>x.distributor.runtimeCodeHash='0x'+'0'.repeat(64),x=>x.sourceRevision='',x=>x.capabilities.availability.operations.create.state='unavailable',x=>x.capabilities.availability.bindings.execution.atomic.address=GRAPH,x=>x.capabilities.manifestDigest='sha256:'+'0'.repeat(64)]){
  const x={...input,intent:structuredClone(intent),distributor:structuredClone(distributor),capabilities:structuredClone(capabilities)};mutate(x);assert.throws(()=>buildRobinLaunchPlan(x));
 }
 assert.throws(()=>assertCurrentPlanCapabilities({schemaVersion:'programmable.custom-launch-capabilities.v2'}));
 for(const validitySeconds of [60,86401,172800])assert.throws(()=>buildRobinLaunchPlan({...input,validitySeconds}),/Atomic order lifetime/);
 assert.throws(()=>buildRobinLaunchPlan({...input,totalGasLimit:PROJECT_GAS_LIMIT}),/Outer gas budget/);
});

test('explicit preflight-only preparation preserves real create availability without altering the exact plan',()=>{
 for(const state of ['canary','disabled','degraded']){
  const observed=structuredClone(capabilities),reasons=[{code:'PLAN_OPERATION_DISABLED',message:'Fixture operation is not open for create.'}];
  observed.availability.operations.create={state,reasons};
  assert.throws(()=>assertCurrentPlanCapabilities(observed),/capability/);
  assert.throws(()=>buildRobinLaunchPlan({...input,capabilities:observed}),/capability/);
  assert.equal(assertCurrentPlanCapabilities(observed,{preflightOnly:true}),observed);
  const prepared=buildRobinLaunchPlan({...input,capabilities:observed,preflightOnly:true});
  assert.deepEqual(prepared.plan,built.plan);assert.equal(prepared.factoryCall,built.factoryCall);
  assert.deepEqual(prepared.report.platformAvailability.create,{state,reasons});
  assert.equal(prepared.report.platformAvailability.preflight.state,'active');
  assert.equal(prepared.report.preparationMode,'preflight-only');assert.equal(prepared.report.readiness,'preflight-only-not-admitted-not-wallet-ready');
  for(const key of ['platformAdmission','walletReady','walletSigning','transactionBroadcast','automaticRewardsEnabled'])assert.equal(prepared.report[key],false);
  observed.availability.operations.create.reasons[0].message='changed after preparation';
  assert.equal(prepared.report.platformAvailability.create.reasons[0].message,'Fixture operation is not open for create.');
 }
 assert.equal(built.report.preparationMode,'launch-preparation');assert.equal(built.report.walletReady,false);
});

test('preflight-only still requires active preflight and every exact chain, manifest, executor and runtime binding',()=>{
 for(const state of ['canary','disabled','degraded','unavailable',undefined]){
  const observed=structuredClone(capabilities);observed.availability.operations.preflight.state=state;
  assert.throws(()=>buildRobinLaunchPlan({...input,capabilities:observed,preflightOnly:true}),/capability/);
 }
 for(const state of ['unavailable','retired',undefined]){
  const observed=structuredClone(capabilities);observed.availability.operations.create.state=state;
  assert.throws(()=>assertCurrentPlanCapabilities(observed,{preflightOnly:true}),/capability/);
 }
 const changed=[c=>c.schemaVersion='unknown',c=>c.chainId='1',c=>c.manifestDigest='sha256:'+'0'.repeat(64),
  c=>c.availability.manifestDigest='sha256:'+'0'.repeat(64),
  ...['executorKind','address','runtimeCodeHash','selector','poolManager','poolManagerRuntimeCodeHash','permitAuthority','permitAuthorityRuntimeCodeHash']
   .map(key=>c=>{c.availability.bindings.execution.atomic[key]='changed';})];
 for(const mutate of changed){const observed=structuredClone(capabilities);mutate(observed);
  assert.throws(()=>buildRobinLaunchPlan({...input,capabilities:observed,preflightOnly:true}),/capability/);
 }
 assert.throws(()=>assertCurrentPlanCapabilities(capabilities,{preflightOnly:'true'}),/capability/);
 assert.throws(()=>buildRobinLaunchPlan({...input,preflightOnly:true,factory:{...factory,runtimeCodeHash:'0x'+'0'.repeat(64)}}),/GraphFactory/);
 assert.throws(()=>buildRobinLaunchPlan({...input,preflightOnly:true,distributor:{...distributor,verified:false}}),/distributor/);
});

test('preflight-only CLI flag is standalone, explicit and cannot swallow or duplicate valued options',()=>{
 const base=['--source-revision','1'.repeat(40),'--capabilities','capabilities.json','--distributor','distributor.json','--out','new-output'];
 assert.equal(parseRobinLaunchPlanOptions(base).has('--preflight-only'),false);
 for(const args of [['--preflight-only',...base],[...base,'--preflight-only']]){
  const parsed=parseRobinLaunchPlanOptions(args);assert.equal(parsed.get('--preflight-only'),true);assert.equal(parsed.get('--out'),'new-output');
 }
 for(const args of [[...base,'--preflight-only','true'],[...base,'--preflight-only','--preflight-only'],[...base,'--nonce','--preflight-only'],
  [...base,'--out','other-output'],[...base,'--enable-create'],['--preflight-only']])assert.throws(()=>parseRobinLaunchPlanOptions(args));
});

test('exact factory runtime executes the graph from Atomic caller, preserving buyer, fees, runtime and buy/sell behavior',async t=>{
 const f=await native20Fixture(hre,{name:'fixture',symbol:'FIXTURE',firstBuyWei:E/100n});
 try{
  const {provider,owner,alice,swapper}=f;
  await hre.network.provider.send('hardhat_setCode',[GRAPH,factory.runtimeCode]);
  const graph=new Contract(GRAPH,factory.abi,owner);
  assert.equal(keccak256(await provider.getCode(GRAPH)),factory.runtimeCodeHash);
  await assert.rejects(owner.sendTransaction({to:GRAPH,data:built.factoryCall,value:E/100n,gasLimit:PROJECT_GAS_LIMIT}),/revert/i);
  await hre.network.provider.send('hardhat_impersonateAccount',[ATOMIC]);await hre.network.provider.send('hardhat_setBalance',[ATOMIC,toBeHex(E)]);
  const atomic=new JsonRpcSigner(provider,ATOMIC);
  const [commitment,total]=await graph.computeGraphCommitment(built.authorization,built.targets);assert.equal(commitment,built.authorization.graphCommitment);assert.equal(total,E/100n);
  const receipt=await(await atomic.sendTransaction({to:GRAPH,data:built.factoryCall,value:E/100n,gasLimit:PROJECT_GAS_LIMIT})).wait();assert.equal(receipt.status,1);assert.ok(receipt.gasUsed<=BigInt(PROJECT_GAS_LIMIT));
  t.diagnostic('Custom ROBIN 170/30 exact factory project gas: '+receipt.gasUsed.toString()+'; Atomic wrapper excluded.');
  for(const [id,code]of Object.entries(built.runtimeCodes))assert.equal(await provider.getCode(built.report.addresses[id]),code,id+' exact runtime');
  const addresses=built.report.addresses,token=new Contract(addresses.token,compiled.contracts.RobinhoodNative20Token.abi,alice),hook=new Contract(addresses.hook,compiled.contracts.RobinhookNativeFeeHookV1.abi,provider),initializer=new Contract(addresses.initializer,compiled.contracts.RobinhoodNative20Initializer.abi,provider),vault=new Contract(addresses.feeVault,compiled.contracts.RobinhoodNativeFeeVaultV1.abi,provider);
  assert.equal(await token.name(),'ROBINHOOK');assert.equal(await token.symbol(),'ROBIN');assert.equal(await token.totalSupply(),10n**27n);assert.equal(await initializer.initialBuyer(),intent.launchWallet);assert.equal(await initializer.initialBuyWei(),E/100n);assert.ok(await token.balanceOf(intent.launchWallet)>=BigInt(intent.minimumTokensOut));
  assert.equal(await hook.creatorBuyFeeBps(),170n);assert.equal(await hook.creatorSellFeeBps(),170n);assert.equal(await hook.PLATFORM_FEE_BPS(),30n);assert.equal(await vault.creatorRecipient(),intent.creatorFeeRecipient);
  const key={currency0:'0x'+'0'.repeat(40),currency1:addresses.token,fee:0,tickSpacing:60,hooks:addresses.hook};
  const buy=await(await swapper.connect(alice).swap(key,{zeroForOne:true,amountSpecified:-E/100n,sqrtPriceLimitX96:4295128740n},{takeClaims:false,settleUsingBurn:false},'0x',{value:E/100n})).wait();
  const fees=buy.logs.map(l=>{try{return hook.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='NativeFeesAccrued').args;
  assert.equal(fees.platformFee,E/100n*30n/10000n);assert.equal(fees.creatorFee,E/100n*170n/10000n);
  await(await token.approve(await swapper.getAddress(),MaxUint256)).wait();const held=await token.balanceOf(await alice.getAddress());assert.ok(held>0n);
  await(await swapper.connect(alice).swap(key,{zeroForOne:false,amountSpecified:-held,sqrtPriceLimitX96:1461446703485210103287273052203988822378723970341n},{takeClaims:false,settleUsingBurn:false},'0x')).wait();assert.equal(await token.balanceOf(await alice.getAddress()),0n);
  await assert.rejects(atomic.sendTransaction({to:GRAPH,data:built.factoryCall,value:E/100n,gasLimit:PROJECT_GAS_LIMIT}),/revert/i);
  const impossible=buildRobinLaunchPlan({...input,nonce:'0x'+'32'.repeat(32),intent:{...intent,minimumTokensOut:'999999999999999999999999999'}});
  await assert.rejects(atomic.sendTransaction({to:GRAPH,data:impossible.factoryCall,value:E/100n,gasLimit:PROJECT_GAS_LIMIT}),/revert/i);
  for(const address of Object.values(impossible.report.addresses))assert.equal(await provider.getCode(address),'0x','minimum-output failure reverts every project deployment');
 }finally{f.provider.destroy();}
});

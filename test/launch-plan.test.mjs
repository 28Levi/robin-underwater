import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import solc from 'solc';
import {Contract,JsonRpcSigner,Interface,keccak256,toBeHex,MaxUint256} from 'ethers';
import {compileRobinLaunchContracts,buildRobinLaunchPlan,assertCurrentPlanCapabilities,ATOMIC,GRAPH,MANAGER,PLAN_MANIFEST,PROJECT_GAS_LIMIT,TOTAL_GAS_LIMIT,MAX_ORDER_LIFETIME_SECONDS} from '../src/launch-plan.mjs';
import {runCustomLaunchPlanPackerCliV1} from '../vendor/programmable-launch-plan-v1/request-packer.mjs';
import {native20Fixture,E,artifact} from './helpers/native20-fixture.mjs';
process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');const {default:hre}=await import('hardhat');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),intent=read('launch-intent.json'),capabilities=read('vendor/programmable-launch-plan-v1/capabilities-observed.json'),factory=read('vendor/programmable-launch-plan-v1/graph-factory.json');
const now=1800000000,distributor={verified:true,finalized:true,chainId:4663,address:intent.creatorFeeRecipient,operator:intent.operator,runtimeCodeHash:'0x66185b6a0594742a3d828569800982b6f1eaab8aca8ef7b8aa14c0dc0ae7a7f8',checkedAt:new Date(now*1000).toISOString()};
const compiled=compileRobinLaunchContracts(process.cwd(),solc);
const input={intent,compiled,capabilities,factory,distributor,sourceRevision:'1'.repeat(40),nonce:'0x'+'31'.repeat(32),now};
const built=buildRobinLaunchPlan(input);

test('current Atomic source plan packs exact unchanged Native20 economics and all four runtime bindings',async()=>{
 const dir=fs.mkdtempSync(path.resolve('output/launch-plan-test-'));fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(built.plan));
 assert.equal(await runCustomLaunchPlanPackerCliV1(['--input',path.join(dir,'plan.json'),'--out',path.join(dir,'request.json'),'--report',path.join(dir,'report.json')]),0);
 const report=read(path.join(dir,'report.json'));assert.equal(report.status,'packed');assert.equal(report.productionAuthority,false);assert.equal(report.walletSigning,false);
 assert.equal(built.plan.manifestDigest,PLAN_MANIFEST);assert.equal(built.plan.publication.symbol,'ROBIN');assert.deepEqual(built.plan.feeObligations,[]);assert.equal(built.plan.executor,'atomic_execute_and_stamp_v2');
 assert.equal(built.plan.components.length,4);assert.equal(built.plan.actions.length,3);assert.equal(new Set(built.plan.actions.map(a=>a.execution.data)).size,1);
 assert.equal(built.plan.budgets.maxTotalGas,TOTAL_GAS_LIMIT);assert.equal(built.report.totalGasLimit,TOTAL_GAS_LIMIT);assert.ok(built.plan.actions.every(a=>a.execution.gasLimit===PROJECT_GAS_LIMIT));
 // Captured from the previous official helper for this fixed source/nonce; the
 // published implementation has no dependency on that unshipped toolchain.
 assert.equal(built.authorization.graphCommitment,'0x9ddc8c7f7c56a6e6cc6829bc658465a722781bf22075b37358b2a5347496e17f');
 assert.equal(BigInt(built.plan.budgets.deadline)-BigInt(built.plan.budgets.validAfter),BigInt(MAX_ORDER_LIFETIME_SECONDS));assert.ok(BigInt(built.plan.budgets.deadline)>BigInt(now));
 assert.equal(built.report.hookFees.projectBuyBps,180);assert.equal(built.report.hookFees.platformBps,20);assert.equal(built.report.routedTradingFee.waiverVerified,false);
 const decoded=new Interface(factory.abi).decodeFunctionData('deployGraph',built.factoryCall);assert.equal(decoded.authorization.authorizedLauncher,ATOMIC);assert.equal(decoded.authorization.totalValue,E/100n);
 assert.ok(built.plan.expectedEffects.some(e=>e.effectId==='feeVault-child'));assert.ok(built.plan.expectedEffects.some(e=>e.effectId==='initial-buyer-output'));
});

test('plan rejects retired/unbound capabilities, altered economics, stale custody evidence and missing source identity',()=>{
 for(const mutate of [x=>x.intent.symbol='HOOD',x=>x.intent.projectBuyFeeBps=170,x=>x.intent.platformFeeBps=30,x=>x.intent.maxGasCostWei='900000000000000',x=>x.distributor.verified=false,x=>x.distributor.checkedAt=new Date((now-3601)*1000).toISOString(),x=>x.distributor.operator=x.intent.launchWallet,x=>x.distributor.runtimeCodeHash='0x'+'0'.repeat(64),x=>x.sourceRevision='',x=>x.capabilities.availability.operations.create.state='unavailable',x=>x.capabilities.availability.bindings.execution.atomic.address=GRAPH,x=>x.capabilities.manifestDigest='sha256:'+'0'.repeat(64)]){
  const x={...input,intent:structuredClone(intent),distributor:structuredClone(distributor),capabilities:structuredClone(capabilities)};mutate(x);assert.throws(()=>buildRobinLaunchPlan(x));
 }
 assert.throws(()=>assertCurrentPlanCapabilities({schemaVersion:'programmable.custom-launch-capabilities.v2'}));
 for(const validitySeconds of [60,86401,172800])assert.throws(()=>buildRobinLaunchPlan({...input,validitySeconds}),/Atomic order lifetime/);
 assert.throws(()=>buildRobinLaunchPlan({...input,totalGasLimit:PROJECT_GAS_LIMIT}),/Outer gas budget/);
});

test('exact factory runtime executes the graph from Atomic caller, preserving buyer, fees, runtime and buy/sell behavior',async()=>{
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
  for(const [id,code]of Object.entries(built.runtimeCodes))assert.equal(await provider.getCode(built.report.addresses[id]),code,id+' exact runtime');
  const addresses=built.report.addresses,token=new Contract(addresses.token,compiled.contracts.RobinhoodNative20Token.abi,alice),hook=new Contract(addresses.hook,compiled.contracts.RobinhoodNativeFeeHookV1.abi,provider),initializer=new Contract(addresses.initializer,compiled.contracts.RobinhoodNative20Initializer.abi,provider),vault=new Contract(addresses.feeVault,compiled.contracts.RobinhoodNativeFeeVaultV1.abi,provider);
  assert.equal(await token.name(),'ROBINHOOK');assert.equal(await token.symbol(),'ROBIN');assert.equal(await token.totalSupply(),10n**27n);assert.equal(await initializer.initialBuyer(),intent.launchWallet);assert.equal(await initializer.initialBuyWei(),E/100n);assert.ok(await token.balanceOf(intent.launchWallet)>=BigInt(intent.minimumTokensOut));
  assert.equal(await hook.creatorBuyFeeBps(),180n);assert.equal(await hook.creatorSellFeeBps(),180n);assert.equal(await vault.creatorRecipient(),intent.creatorFeeRecipient);
  const key={currency0:'0x'+'0'.repeat(40),currency1:addresses.token,fee:0,tickSpacing:60,hooks:addresses.hook};
  const buy=await(await swapper.connect(alice).swap(key,{zeroForOne:true,amountSpecified:-E/100n,sqrtPriceLimitX96:4295128740n},{takeClaims:false,settleUsingBurn:false},'0x',{value:E/100n})).wait();
  const fees=buy.logs.map(l=>{try{return hook.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='NativeFeesAccrued').args;
  assert.equal(fees.platformFee,E/100n*20n/10000n);assert.equal(fees.creatorFee,E/100n*180n/10000n);
  await(await token.approve(await swapper.getAddress(),MaxUint256)).wait();const held=await token.balanceOf(await alice.getAddress());assert.ok(held>0n);
  await(await swapper.connect(alice).swap(key,{zeroForOne:false,amountSpecified:-held,sqrtPriceLimitX96:1461446703485210103287273052203988822378723970341n},{takeClaims:false,settleUsingBurn:false},'0x')).wait();assert.equal(await token.balanceOf(await alice.getAddress()),0n);
  await assert.rejects(atomic.sendTransaction({to:GRAPH,data:built.factoryCall,value:E/100n,gasLimit:PROJECT_GAS_LIMIT}),/revert/i);
  const impossible=buildRobinLaunchPlan({...input,nonce:'0x'+'32'.repeat(32),intent:{...intent,minimumTokensOut:'999999999999999999999999999'}});
  await assert.rejects(atomic.sendTransaction({to:GRAPH,data:impossible.factoryCall,value:E/100n,gasLimit:PROJECT_GAS_LIMIT}),/revert/i);
  for(const address of Object.values(impossible.report.addresses))assert.equal(await provider.getCode(address),'0x','minimum-output failure reverts every project deployment');
 }finally{f.provider.destroy();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {Contract,Interface,JsonRpcSigner,getAddress,toBeHex} from 'ethers';
import {compileRobinLaunchContracts,buildRobinLaunchPlan,ATOMIC,GRAPH,PROJECT_GAS_LIMIT} from '../src/launch-plan.mjs';
import {EARLY_BUYERS,LAUNCH_GUARD_RECIPE,assertLaunchGuardIntent} from '../src/launch-guard-policy.mjs';
import {loadPlanContract} from '../src/launch-platform-contract.mjs';
import {native20Fixture,E} from './helpers/native20-fixture.mjs';

process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');
const {default:hre}=await import('hardhat');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const intent=read('launch-guard-intent.json'),factory=read('vendor/programmable-launch-plan-v1/graph-factory.json');
const capabilities=read('vendor/programmable-launch-plan-v1/capabilities-observed.json');
const now=1800000000,compiled=compileRobinLaunchContracts(process.cwd(),solc,{launchGuard:true});
const distributor={verified:true,finalized:true,chainId:4663,address:intent.creatorFeeRecipient,operator:intent.operator,
  runtimeCodeHash:'0x66185b6a0594742a3d828569800982b6f1eaab8aca8ef7b8aa14c0dc0ae7a7f8',checkedAt:new Date(now*1000).toISOString()};
const input={intent,compiled,capabilities,factory,distributor,now,sourceRevision:'1'.repeat(40),nonce:'0x'+'45'.repeat(32)};
const built=buildRobinLaunchPlan(input);

test('guarded plan preserves launch funding and binds the exact five-wallet policy and distinct source',async()=>{
  assert.equal(built.report.hookImplementation.recipe,LAUNCH_GUARD_RECIPE);
  assert.equal(built.report.hookImplementation.normalizedNative30Runtime,false);
  assert.equal(built.report.native30Runtime,null);
  assert.deepEqual(built.plan.verificationBundle.compilationUnits.map(unit=>unit.compilationUnitId),
    ['kernel','native20','robin-launch-guard']);
  assert.deepEqual(built.report.launchGuard.allowedBuyers,EARLY_BUYERS);
  assert.equal(built.report.launchGuard.windowSeconds,30);
  assert.equal(built.report.initialBuyRecipient,intent.launchWallet.toLowerCase());
  assert.equal(built.plan.controller.address,getAddress(intent.launchWallet));
  const binding=built.plan.verificationBundle.components.find(row=>row.targetId==='hook');
  assert.equal(binding.contractName,'RobinhookLaunchGuardHookV1');
  assert.equal(binding.compilationUnitId,'robin-launch-guard');
  assert.equal(binding.sourcePath,'src/robinhook-launch-guard-v1/RobinhookLaunchGuardHookV1.sol');
  const graphCall=new Interface(factory.abi).decodeFunctionData('deployGraph',built.factoryCall);
  const initial=new Interface(compiled.contracts.RobinhoodNative20Initializer.abi)
    .decodeFunctionData('initialize',graphCall.targets[0].initializerCalldata);
  assert.equal(initial[2],getAddress(intent.launchWallet));
  assert.equal(graphCall.authorization.totalValue,E/100n);
  assert.equal(built.report.routedTradingFee.waiverVerified,false);
  assert.equal(built.report.routedTradingFee.totalTradingFeeConfirmed,false);
  assert.equal(built.plan.dependencies.filter(row=>row.dependencyId==='early-buy-router').length,1);
  for(let i=0;i<5;i++)assert.ok(built.plan.expectedEffects.some(effect=>effect.effectId==='early-buyer-'+i));
  for(const capFile of ['vendor/programmable-launch-plan-v1/capabilities-observed.json','vendor/programmable-launch-plan-v1/current-c525/capabilities-observed.json']){
    const caps=read(capFile),plan=buildRobinLaunchPlan({...input,capabilities:caps}).plan;
    const {runCustomLaunchPlanPackerCliV1:pack}=await import(loadPlanContract(caps.manifestDigest).packerUrl.href);
    const dir=fs.mkdtempSync(path.resolve('output/guard-plan-packer-'));
    fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan));
    assert.equal(await pack(['--input',path.join(dir,'plan.json'),'--out',path.join(dir,'request.json'),'--report',path.join(dir,'report.json')]),0);
    const report=read(path.join(dir,'report.json'));
    assert.equal(report.status,'packed');assert.equal(report.productionAuthority,false);assert.equal(report.walletSigning,false);
  }
});

test('guarded preparation refuses changed wallets, duration, buyer, or an unguarded compilation',()=>{
  for(const change of [x=>x.launchGuard.allowedBuyers.pop(),x=>x.launchGuard.allowedBuyers.push(EARLY_BUYERS[0]),
    x=>x.launchGuard.allowedBuyers[0]=EARLY_BUYERS[1],x=>x.launchGuard.windowSeconds=31,
    x=>x.initialBuyRecipient=null,x=>x.initialBuyRecipient=EARLY_BUYERS[0],x=>x.launchWallet=EARLY_BUYERS[0]]){
    const altered=structuredClone(intent);change(altered);
    assert.throws(()=>assertLaunchGuardIntent(altered));
    assert.throws(()=>buildRobinLaunchPlan({...input,intent:altered}));
  }
  const wrongCompilation={...compiled,customHook:{...compiled.customHook,recipe:'robin-native30-no-module'}};
  assert.throws(()=>buildRobinLaunchPlan({...input,compiled:wrongCompilation}),/Compiled hook/);
});

test('exact GraphFactory launch retains B519 purchase, starts a fixed30s clock and allows public buys at expiry',async t=>{
  const f=await native20Fixture(hre,{name:'unrelated-fixture',symbol:'FIX',firstBuyWei:E/100n});
  try{
    const {provider,alice,swapper}=f;
    await hre.network.provider.send('hardhat_setCode',[GRAPH,factory.runtimeCode]);
    await hre.network.provider.send('hardhat_impersonateAccount',[ATOMIC]);
    await hre.network.provider.send('hardhat_setBalance',[ATOMIC,toBeHex(E)]);
    const executor=new JsonRpcSigner(provider,ATOMIC);
    const receipt=await(await executor.sendTransaction({to:GRAPH,data:built.factoryCall,value:E/100n,gasLimit:PROJECT_GAS_LIMIT})).wait();
    assert.equal(receipt.status,1);assert.ok(receipt.gasUsed<=BigInt(PROJECT_GAS_LIMIT));
    t.diagnostic('Guarded project graph gas '+receipt.gasUsed+'; actual Atomic wrapper requires separate platform simulation.');
    for(const [id,code]of Object.entries(built.runtimeCodes))assert.equal(await provider.getCode(built.report.addresses[id]),code,id);
    const a=built.report.addresses,hook=new Contract(a.hook,compiled.contracts.RobinhookLaunchGuardHookV1.abi,provider);
    const token=new Contract(a.token,compiled.contracts.RobinhoodNative20Token.abi,provider);
    const init=new Contract(a.initializer,compiled.contracts.RobinhoodNative20Initializer.abi,provider);
    const vault=new Contract(a.feeVault,compiled.contracts.RobinhoodNativeFeeVaultV1.abi,provider);
    const block=await provider.getBlock(receipt.blockNumber),opens=block.timestamp+30;
    assert.equal(await hook.publicBuysAt(),BigInt(opens));
    assert.equal(await init.initialBuyer(),getAddress(intent.launchWallet));
    assert.ok(await token.balanceOf(intent.launchWallet)>=BigInt(intent.minimumTokensOut));
    for(let i=0;i<5;i++)assert.equal(await hook['earlyBuyer'+i](),getAddress(EARLY_BUYERS[i]));
    const key={currency0:'0x'+'0'.repeat(40),currency1:a.token,fee:0,tickSpacing:60,hooks:a.hook};
    const params={zeroForOne:true,amountSpecified:-E/1000n,sqrtPriceLimitX96:4295128740n};
    const feesBefore=await vault.creatorAccrued();
    await assert.rejects(swapper.connect(alice).swap(key,params,{takeClaims:false,settleUsingBurn:false},'0x',{value:E/1000n,gasLimit:1_000_000}).then(tx=>tx.wait()));
    assert.equal(await vault.creatorAccrued(),feesBefore);assert.equal(await hook.publicBuysAt(),BigInt(opens));
    await hre.network.provider.send('evm_setNextBlockTimestamp',[opens]);
    const bought=await(await swapper.connect(alice).swap(key,params,{takeClaims:false,settleUsingBurn:false},'0x',{value:E/1000n,gasLimit:1_000_000})).wait();
    assert.equal(bought.status,1);assert.ok(await token.balanceOf(await alice.getAddress())>0n);
    assert.equal(await vault.creatorAccrued()-feesBefore,E/1000n*170n/10000n);
    await assert.rejects(executor.sendTransaction({to:GRAPH,data:built.factoryCall,value:E/100n,gasLimit:PROJECT_GAS_LIMIT}).then(tx=>tx.wait()));
    assert.equal(await hook.publicBuysAt(),BigInt(opens));
  }finally{f.provider.destroy();}
});

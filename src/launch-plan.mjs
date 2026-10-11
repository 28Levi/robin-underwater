import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AbiCoder,Interface,ZeroAddress,keccak256,toUtf8Bytes,toBeHex,getCreate2Address,getCreateAddress,getAddress,concat,zeroPadValue} from 'ethers';
import {assertRobinLaunchIntent} from './launch-intent.mjs';
import {loadNative30Recipe,assertNative30CompiledRuntime,assertNative30MaterializedRuntime} from './native30-runtime.mjs';

export const PLAN_MANIFEST='sha256:3cd25308629f932d6a75e4a7694e6bcb67e4471fd2c1782d3b11ba5a7e3f8b61';
export const ATOMIC='0xe21827818Fea1F14d59929CAE36a93c0B44e0aE1';
export const ATOMIC_HASH='0x9c97ca89d17ec48ba9603920f6a27899e83ac0c4514f9acb7a37f4903d374fad';
export const GRAPH='0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd';
export const GRAPH_HASH='0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8';
export const MANAGER='0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const MANAGER_HASH='0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626';
export const PERMIT_AUTHORITY='0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06';
export const PERMIT_AUTHORITY_HASH='0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c';
export const DISTRIBUTOR_HASH='0x66185b6a0594742a3d828569800982b6f1eaab8aca8ef7b8aa14c0dc0ae7a7f8';
export const PRICE='1747735933952748037356115466503453';
// The local exact-factory test checks this project-call ceiling for the current
// source. The platform must separately simulate the complete Atomic wrapper.
export const PROJECT_GAS_LIMIT='7300000';
// Separate outer ceiling reserves room for calldata, EIP-150, signature checks
// and provenance writes. Admission must still supply a fresh full estimate.
export const TOTAL_GAS_LIMIT='12000000';
// The verified Atomic V2 contract rejects an order lifetime above 24 hours.
export const MAX_ORDER_LIFETIME_SECONDS=86400;
const coder=AbiCoder.defaultAbiCoder();
const saltType=keccak256(toUtf8Bytes('ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)'));
const targetCommitmentType=keccak256(toUtf8Bytes('ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,bytes32 initializerCalldataHash)'));
const graphCommitmentType=keccak256(toUtf8Bytes('ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,bytes32 targetCommitmentsHash)'));
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const uint=(s,label)=>{if(typeof s!=='string'||!/^\d+$/.test(s)||String(BigInt(s))!==s)throw Error('Invalid '+label);return BigInt(s);};
export const canonicalJson=value=>Array.isArray(value)?'['+value.map(canonicalJson).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}':JSON.stringify(value);
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));

/** Reproduce the upstream kernel, then compile the separately identified ROBIN fork. No network or signing. */
export function compileRobinLaunchContracts(root,solc){
 const reviewed=read(path.join(root,'vendor/programmable-native20/artifact.json'));
 if(solc.version()!==reviewed.compilerVersion)throw Error('Exact reviewed compiler required');
 const kernel=structuredClone(reviewed.standardJsonInput),native=structuredClone(kernel),robin=structuredClone(kernel);
 const customHookPath='src/robinhook-fee-v1/RobinhookNativeFeeHookV1.sol';
 robin.sources[customHookPath]={content:fs.readFileSync(path.join(root,customHookPath),'utf8')};
 Object.assign(native.sources,read(path.join(root,'vendor/programmable-native20/native20-dependencies.json')).sources);
 for(const name of ['RobinhoodNative20Token','RobinhoodNative20Initializer'])native.sources[`src/${name}.sol`]={content:fs.readFileSync(path.join(root,`vendor/programmable-native20/src/${name}.sol`),'utf8')};
 const units=[],contracts={};
 for(const [id,input]of [['kernel',kernel],['native20',native],['robin-native30',robin]]){
  const output=JSON.parse(solc.compile(JSON.stringify(input)));
  const errors=(output.errors??[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
  const bytes=Buffer.from(canonicalJson(input));units.push({compilationUnitId:id,compilerVersion:solc.version().split('.Emscripten')[0],standardJsonInputBase64:bytes.toString('base64'),standardJsonInputSha256:sha(bytes)});
  const names=new Map();const walk=x=>{if(!x||typeof x!=='object')return;if(x.nodeType==='VariableDeclaration'&&x.mutability==='immutable')names.set(String(x.id),x.name);for(const v of Object.values(x))if(Array.isArray(v))v.forEach(walk);else walk(v);};
  for(const source of Object.values(output.sources))walk(source.ast);
  for(const [sourcePath,row]of Object.entries(output.contracts))for(const [contractName,c]of Object.entries(row)){
   if(!['RobinhoodNativeFeeHookV1','RobinhookNativeFeeHookV1','RobinhoodNativeFeeVaultV1','RobinhoodNative20Token','RobinhoodNative20Initializer'].includes(contractName))continue;
   if(id==='native20'&&contractName.startsWith('RobinhoodNativeFee'))continue;
   if(id==='robin-native30'&&contractName!=='RobinhookNativeFeeHookV1')continue;
   contracts[contractName]={...c,sourcePath,contractName,compilationUnitId:id,names};
  }
 }
 if('0x'+contracts.RobinhoodNativeFeeHookV1.evm.bytecode.object!==reviewed.kernel.creationBytecode)throw Error('Reviewed Native20 kernel changed');
 const native30Recipe=loadNative30Recipe(root),native30Runtime=assertNative30CompiledRuntime(contracts,native30Recipe);
 return {units,contracts,reviewed,native30Recipe,customHook:{recipe:'robin-native30-no-module',contractName:'RobinhookNativeFeeHookV1',sourcePath:customHookPath,native30Runtime,
  sourceSha256:sha(Buffer.from(robin.sources[customHookPath].content)),upstreamContractName:reviewed.kernel.contractName,
  upstreamSourceSha256:sha(Buffer.from(kernel.sources[reviewed.kernel.sourcePath].content)),canonicalUpstreamReproduced:true}};
}

function materialize(c,values){
 const bytes=Buffer.from(c.evm.deployedBytecode.object,'hex'),immutableReferences=[],runtimeImmutables=[];
 for(const [immutableId,ranges]of Object.entries(c.evm.deployedBytecode.immutableReferences)){
  const name=c.names.get(immutableId),v=values[name];if(!v)throw Error('Missing immutable '+name);
  const word=Buffer.from(coder.encode([v.type],[v.value]).slice(2),'hex');
  for(const r of ranges){if(r.length!==32||r.start+32>bytes.length)throw Error('Invalid immutable range');word.copy(bytes,r.start);}
  immutableReferences.push({immutableId,ranges});runtimeImmutables.push({immutableId,abiType:v.type,literal:String(v.value)});
 }
 return {immutableReferences,runtimeImmutables,deployedRuntimeCodeBase64:bytes.toString('base64'),deployedRuntimeCodeHash:keccak256(bytes)};
}
function constructor(c,args){const types=c.abi.find(a=>a.type==='constructor')?.inputs??[];const encoded=coder.encode(types,args);return {args:encoded,initCode:concat(['0x'+c.evm.bytecode.object,encoded])};}

export function assertCurrentPlanCapabilities(capabilities,{preflightOnly=false}={}){
 const c=capabilities,a=c?.availability?.bindings?.execution?.atomic;
 const createState=c?.availability?.operations?.create?.state;
 // Offline preflight preparation is not admission: only the create-availability
 // requirement changes. Unknown states and all exact execution roots still fail.
 if(typeof preflightOnly!=='boolean'||c?.schemaVersion!=='programmable.custom-launch-capabilities.v1'||c.chainId!=='4663'||c.manifestDigest!==PLAN_MANIFEST
  ||c.availability?.manifestDigest!==PLAN_MANIFEST||!(preflightOnly?['active','canary','disabled','degraded'].includes(createState):createState==='active')||c.availability?.operations?.preflight?.state!=='active'
  ||a?.executorKind!=='atomic_execute_and_stamp_v2'||!same(a.address,ATOMIC)||a.runtimeCodeHash!==ATOMIC_HASH||a.selector!=='0x506aba45'
  ||!same(a.poolManager,MANAGER)||a.poolManagerRuntimeCodeHash!==MANAGER_HASH||!same(a.permitAuthority,PERMIT_AUTHORITY)||a.permitAuthorityRuntimeCodeHash!==PERMIT_AUTHORITY_HASH)
  throw Error('Current released Atomic launch capability required');
 return c;
}

/** Deterministic project-side plan. This does not issue platform admission or a wallet transaction. */
export function buildRobinLaunchPlan({intent,compiled,capabilities,factory,distributor,sourceRevision,nonce,now=Math.floor(Date.now()/1000),graphGasLimit=PROJECT_GAS_LIMIT,totalGasLimit=TOTAL_GAS_LIMIT,validitySeconds=MAX_ORDER_LIFETIME_SECONDS,preflightOnly=false}){
 assertRobinLaunchIntent(intent);assertCurrentPlanCapabilities(capabilities,{preflightOnly});
 if(intent.chainId!==4663||intent.decimals!==18||intent.projectBuyFeeBps!==170||intent.projectSellFeeBps!==170||intent.platformFeeBps!==30
  ||intent.lpFeePips!==0||intent.totalBuyFeeBps!==200||intent.totalSellFeeBps!==200||intent.hookRecipe!=='robin-native30-no-module'
  ||intent.initialLiquidityWei!=='0'||intent.maxLaunchValueWei!==intent.initialBuyWei||intent.maxGasCostWei!=='800000000000000')throw Error('ROBIN launch economics changed');
 if(!same(intent.launchWallet,'0x9479ac7ED3A72866F63F37013F2c7Cc68936B519')||!same(intent.creatorFeeRecipient,'0x62C12ae94CcbbE470CC1857261Fae9E36074Fb36')||!same(intent.operator,'0x9C366d4E42b8f987e8398A27b3b9A02803493088'))throw Error('ROBIN launch authority changed');
 if(!/^[a-f0-9]{40}$/.test(sourceRevision??''))throw Error('Exact published source revision required');
 if(!/^0x[0-9a-f]{64}$/.test(nonce??'')||BigInt(nonce)===0n)throw Error('Fresh nonzero graph nonce required');
 if(!Number.isSafeInteger(now)||now<61||!Number.isSafeInteger(validitySeconds)||validitySeconds<=60||validitySeconds>MAX_ORDER_LIFETIME_SECONDS)throw Error('Invalid Atomic order lifetime');
 if(uint(graphGasLimit,'graph gas limit')<1000000n||BigInt(graphGasLimit)>30000000n)throw Error('Unreasonable graph gas limit');
 if(uint(totalGasLimit,'total gas limit')<=BigInt(graphGasLimit)*64n/63n+40000n||BigInt(totalGasLimit)>30000000n)throw Error('Outer gas budget must cover Atomic EIP-150 overhead');
 if(uint(intent.minimumTokensOut,'minimum output')<=0n||BigInt(intent.minimumTokensOut)>=10n**27n)throw Error('Invalid initial token minimum');
 if(!same(factory?.address,GRAPH)||factory.runtimeCodeHash!==GRAPH_HASH||keccak256(factory.runtimeCode)!==GRAPH_HASH)throw Error('Exact GraphFactory evidence required');
 const verifiedAge=now-Date.parse(distributor?.checkedAt)/1000;
 if(distributor?.verified!==true||distributor.finalized!==true||distributor.chainId!==4663||!same(distributor.address,intent.creatorFeeRecipient)||!same(distributor.operator,intent.operator)
  ||distributor.runtimeCodeHash!==DISTRIBUTOR_HASH||!Number.isFinite(verifiedAge)||verifiedAge< -30||verifiedAge>3600)throw Error('Fresh finalized distributor verification required');
 const names={initializer:'RobinhoodNative20Initializer',token:'RobinhoodNative20Token',hook:'RobinhookNativeFeeHookV1',feeVault:'RobinhoodNativeFeeVaultV1'};
 const sourceCommitment=sha(Buffer.from(canonicalJson(compiled.units)));
 const routeNamespace=keccak256(coder.encode(['string','address','bytes32','bytes32'],['ROBINHOOK custom launch plan v1',intent.launchWallet,zeroPadValue('0x'+sourceRevision,32),'0x'+sourceCommitment.slice(7)]));
 const topologyHash=keccak256(toUtf8Bytes(canonicalJson({targets:['initializer','token','hook'],pool:{manager:MANAGER,fee:0,tickSpacing:60},sourceRevision})));
 const targetIdHash=id=>keccak256(toUtf8Bytes(id));
 const effectiveSalt=(id,salt)=>keccak256(coder.encode(['bytes32','uint256','address','bytes32','bytes32','bytes32','bytes32','address'],[saltType,4663,GRAPH,routeNamespace,nonce,targetIdHash(id),salt,ATOMIC]));
 const predict=(id,salt,code)=>getCreate2Address(GRAPH,effectiveSalt(id,salt),keccak256(code));
 const contracts=compiled.contracts,constructors={},addresses={},salts={initializer:toBeHex(1,32),token:toBeHex(2,32)};
 constructors.initializer=constructor(contracts[names.initializer],[MANAGER,GRAPH]);addresses.initializer=predict('initializer',salts.initializer,constructors.initializer.initCode);
 constructors.token=constructor(contracts[names.token],[addresses.initializer,intent.name,intent.symbol]);addresses.token=predict('token',salts.token,constructors.token.initCode);
 constructors.hook=constructor(contracts[names.hook],[MANAGER,[addresses.token,0,60,PRICE,addresses.initializer,intent.creatorFeeRecipient,170,170,ZeroAddress,0]]);
 for(let i=0;i<262144;i++){salts.hook=toBeHex(i,32);addresses.hook=predict('hook',salts.hook,constructors.hook.initCode);if((BigInt(addresses.hook)&0x3fffn)===0x20ccn)break;}
 if((BigInt(addresses.hook)&0x3fffn)!==0x20ccn)throw Error('Hook salt search exhausted');
 addresses.feeVault=getCreateAddress({from:addresses.hook,nonce:1});constructors.feeVault=constructor(contracts[names.feeVault],[MANAGER,intent.creatorFeeRecipient]);
 const a=value=>({type:'address',value}),u=(value,type='uint256')=>({type,value});
 const values={poolManager:a(MANAGER),graphFactory:a(GRAPH),token:a(addresses.token),initializer:a(addresses.initializer),feeVault:a(addresses.feeVault),kernel:a(addresses.hook),creatorRecipient:a(intent.creatorFeeRecipient),lpFee:u(0,'uint24'),tickSpacing:u(60,'int24'),initialSqrtPriceX96:u(PRICE,'uint160'),creatorBuyFeeBps:u(170,'uint16'),creatorSellFeeBps:u(170,'uint16'),module:a(ZeroAddress),moduleCodeHash:u('0x'+'00'.repeat(32),'bytes32'),maxModuleLpFeePips:u(0,'uint24')};
 const materializations=Object.fromEntries(Object.entries(names).map(([id,name])=>[id,materialize(contracts[name],values)]));
 const runtimeCodes=Object.fromEntries(Object.entries(materializations).map(([id,m])=>[id,'0x'+Buffer.from(m.deployedRuntimeCodeBase64,'base64').toString('hex')]));
 const native30Runtime=assertNative30MaterializedRuntime({recipe:compiled.native30Recipe,runtimeCodes,addresses,creatorRecipient:intent.creatorFeeRecipient,poolManager:MANAGER,initialSqrtPriceX96:PRICE});
 const init=new Interface(contracts[names.initializer].abi).encodeFunctionData('initialize',[addresses.token,addresses.hook,intent.launchWallet,intent.minimumTokensOut]);
 const targets=['initializer','token','hook'].map(id=>({targetIdHash:targetIdHash(id),applicantSalt:salts[id],deploymentValue:'0',initializerValue:id==='initializer'?intent.initialBuyWei:'0',initCode:constructors[id].initCode,initializerCalldata:id==='initializer'?init:'0x',runtimeCodeHash:materializations[id].deployedRuntimeCodeHash}));
 // Match the verified factory's _reviewedGraphCommitment directly. No legacy
 // Router tooling or undeclared viem dependency is required by the release.
 const targetCommitments=targets.map((target,index)=>keccak256(coder.encode(
  ['bytes32','uint256','bytes32','bytes32','uint256','uint256','bytes32','bytes32'],
  [targetCommitmentType,index,target.targetIdHash,target.applicantSalt,target.deploymentValue,target.initializerValue,keccak256(target.initCode),keccak256(target.initializerCalldata)])));
 const graphCommitment=keccak256(coder.encode(
  ['bytes32','uint256','address','bytes32','bytes32','bytes32','address','uint256','bytes32'],
  [graphCommitmentType,4663,GRAPH,routeNamespace,nonce,topologyHash,ATOMIC,intent.initialBuyWei,keccak256(coder.encode(['bytes32[]'],[targetCommitments]))]));
 const authorization={routeNamespace,routeNonce:nonce,topologyHash,graphCommitment,authorizedLauncher:ATOMIC,totalValue:intent.initialBuyWei};
 const factoryCall=new Interface(factory.abi).encodeFunctionData('deployGraph',[authorization,targets]);
 const execution={target:{address:GRAPH},data:factoryCall,value:intent.initialBuyWei,gasLimit:graphGasLimit};
 const components=Object.keys(names).map(id=>({componentId:id,artifactId:id,expectedAddress:addresses[id],runtimeCodeHash:materializations[id].deployedRuntimeCodeHash,tags:[id]}));
 const effects=components.map(c=>({effectId:c.componentId+'-runtime',kind:'runtime',criticality:'critical',target:{componentId:c.componentId},runtimeCodeHash:c.runtimeCodeHash}));
 effects.push({effectId:'feeVault-child',kind:'child',criticality:'critical',componentId:'feeVault',runtimeCodeHash:materializations.feeVault.deployedRuntimeCodeHash,derivation:{kind:'create',parent:{componentId:'hook'},nonce:'1'}});
 const callEffect=(id,componentId,fn,args,outputs,result)=>{const iface=new Interface(contracts[names[componentId]].abi);effects.push({effectId:id,kind:'callResult',criticality:'critical',target:{componentId},data:iface.encodeFunctionData(fn,args),expected:coder.encode(outputs,result)});};
 callEffect('token-name','token','name',[],['string'],[intent.name]);callEffect('token-symbol','token','symbol',[],['string'],[intent.symbol]);callEffect('fixed-supply','token','totalSupply',[],['uint256'],['1000000000000000000000000000']);
 callEffect('initial-buyer','initializer','initialBuyer',[],['address'],[intent.launchWallet]);callEffect('initial-value','initializer','initialBuyWei',[],['uint256'],[intent.initialBuyWei]);
 callEffect('initial-minimum','initializer','minimumInitialTokensOut',[],['uint256'],[intent.minimumTokensOut]);callEffect('initialized','initializer','initialized',[],['bool'],[true]);
 callEffect('rewards-destination','feeVault','creatorRecipient',[],['address'],[intent.creatorFeeRecipient]);
 callEffect('reward-buy-fee','hook','creatorBuyFeeBps',[],['uint16'],[170]);callEffect('reward-sell-fee','hook','creatorSellFeeBps',[],['uint16'],[170]);
 callEffect('platform-fee','hook','PLATFORM_FEE_BPS',[],['uint16'],[30]);
 effects.push({effectId:'initial-buyer-output',kind:'balance',criticality:'critical',target:{address:intent.launchWallet},asset:addresses.token,minimum:intent.minimumTokensOut,maximum:'1000000000000000000000000000'});
 const plan={schemaVersion:'programmable.custom-launch-plan.v1',manifestDigest:PLAN_MANIFEST,admissionPolicy:'programmable.custom-launch-policy.provenance.v1',chainId:'4663',controller:{kind:'eoa',address:getAddress(intent.launchWallet)},executor:'atomic_execute_and_stamp_v2',
  verificationBundle:{schemaVersion:'programmable.exact-source-verification-bundle.v2',compilationUnits:compiled.units,components:Object.keys(names).sort().map(id=>{const c=contracts[names[id]];return {targetId:id,compilationUnitId:c.compilationUnitId,sourcePath:c.sourcePath,contractName:c.contractName,constructorArguments:constructors[id].args,runtimeMaterialization:materializations[id]};})},components,
  actions:['initializer','token','hook'].map((id,index)=>({actionId:'deploy-'+id,kind:'deployCreate2',componentId:id,factory:{address:GRAPH},salt:effectiveSalt(id,salts[id]),initCode:constructors[id].initCode,dependsOn:index?['deploy-'+['initializer','token','hook'][index-1]]:[],authority:{kind:'controller'},preconditions:[],postconditions:[],execution})),
  markets:[{marketId:'robin-native',kind:'uniswap_v4',poolManager:MANAGER,currency0:{address:ZeroAddress},currency1:{componentId:'token'},fee:0,tickSpacing:60,hooks:{componentId:'hook'}}],
  hookBindings:[{componentId:'hook',poolManager:MANAGER,permissions:0x20cc,callbackAbi:contracts[names.hook].abi.filter(x=>x.type==='function'&&/^(before|after)/.test(x.name))}],
  dependencies:[{dependencyId:'pool-manager',chainId:'4663',address:MANAGER,runtimeCodeHash:MANAGER_HASH},{dependencyId:'graph-factory',chainId:'4663',address:GRAPH,runtimeCodeHash:GRAPH_HASH},{dependencyId:'reward-distributor',chainId:'4663',address:getAddress(intent.creatorFeeRecipient),runtimeCodeHash:distributor.runtimeCodeHash,authoritySnapshot:{operator:getAddress(intent.operator)}}],
  expectedEffects:effects,budgets:{maxTotalValue:intent.initialBuyWei,maxTotalGas:totalGasLimit,validAfter:String(now-60),deadline:String(now-60+validitySeconds)},feeObligations:[],claimDescriptors:[],distributionPreferences:[],
  publication:{visibility:'listed',name:intent.name,symbol:intent.symbol,description:intent.descriptionDraft,imageUrl:intent.image,primaryComponentId:'token',primaryMarketId:'robin-native',links:[intent.website,intent.x,intent.publicSource.url+'/tree/'+sourceRevision]}};
 return {plan,report:{schemaVersion:'robin.launch-plan-preparation.v1',checkedAt:new Date(now*1000).toISOString(),sourceRevision,sourceCommitment,addresses,manifestDigest:PLAN_MANIFEST,graphCommitment:authorization.graphCommitment,authorizedLauncher:ATOMIC,factory:GRAPH,projectCallDataHash:keccak256(factoryCall),initialBuyWei:intent.initialBuyWei,minimumTokensOut:intent.minimumTokensOut,maximumLaunchGasCostWei:intent.maxGasCostWei,graphGasLimit,totalGasLimit,hookFees:{projectBuyBps:170,projectSellBps:170,platformBps:30,lpFeePips:0},hookImplementation:structuredClone(compiled.customHook),native30Runtime,routedTradingFee:{...capabilities.currentTradeFeePolicy,waiverVerified:false,totalTradingFeeConfirmed:false},
  preparationMode:preflightOnly?'preflight-only':'launch-preparation',
  readiness:preflightOnly?'preflight-only-not-admitted-not-wallet-ready':'not-admitted-not-wallet-ready',
  platformAvailability:{create:structuredClone(capabilities.availability.operations.create),preflight:structuredClone(capabilities.availability.operations.preflight)},
  platformAdmission:false,walletReady:false,walletSigning:false,transactionBroadcast:false,automaticRewardsEnabled:false},factoryCall,authorization,targets,runtimeCodes};
}

import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getCreateAddress} from 'ethers';
import {LAUNCH_GUARD_RECIPE, EARLY_BUYERS} from './launch-guard-policy.mjs';
import {loadNative30Recipe} from './native30-runtime.mjs';

export const LAUNCH_GUARD_SOURCE_PATH='src/robinhook-launch-guard-v1/RobinhookLaunchGuardHookV1.sol';
export const LAUNCH_GUARD_SOURCE_SHA256='sha256:37d2edbdac27f7b4ecbd5b953ba2da5040e7087b8502362af71d9cbec0dc558e';
export const LAUNCH_GUARD_RECIPE_SHA256='sha256:415e603bb0fedea6cfc02c55c419161850acf0b076a6b7969d2109c74631d37b';
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error('ROBIN launch guard runtime: '+message);};
const names={hook:'RobinhookLaunchGuardHookV1',vault:'RobinhoodNativeFeeVaultV1'};
const checkRecipe=recipe=>{
 need(recipe?.schemaVersion==='robinhook.project-runtime-pin.v1'&&recipe.recipeId===LAUNCH_GUARD_RECIPE
   &&recipe.sourceSha256===LAUNCH_GUARD_SOURCE_SHA256&&recipe.platformRecognitionVerified===false
   &&sha(JSON.stringify(recipe,null,2)+'\n')===LAUNCH_GUARD_RECIPE_SHA256,'project recipe identity changed');
};

/** Project review pin, not a platform-recognized fee recipe or a live waiver. */
export function loadLaunchGuardRecipe(root){
 const bytes=fs.readFileSync(path.join(root,'vendor/robin-launch-guard-v1/runtime-pin.json'));
 need(sha(bytes)===LAUNCH_GUARD_RECIPE_SHA256,'pinned recipe bytes changed');
 const recipe=JSON.parse(bytes);checkRecipe(recipe);
 need(recipe.sourcePath===LAUNCH_GUARD_SOURCE_PATH
   &&sha(fs.readFileSync(path.join(root,LAUNCH_GUARD_SOURCE_PATH)))===LAUNCH_GUARD_SOURCE_SHA256,'reviewed Solidity source changed');
 const officialVault=loadNative30Recipe(root).vault;
 need(recipe.vault.runtimeTemplateHex===officialVault.runtimeTemplateHex
   &&JSON.stringify([...recipe.vault.immutableWords].sort((a,b)=>a.name.localeCompare(b.name)))
     ===JSON.stringify([...officialVault.immutableWords].sort((a,b)=>a.name.localeCompare(b.name))),
 'base fee vault no longer matches the pinned native30 vault');
 return recipe;
}

/** Full creation/runtime bytes and named offsets bind constructor and runtime behavior. */
export function assertLaunchGuardCompiledRuntime(contracts,recipe){
 checkRecipe(recipe);
 for(const [role,name]of Object.entries(names)){
  const compiled=contracts?.[name],expected=recipe[role],runtime=compiled?.evm?.deployedBytecode;
  need(compiled?.sourcePath===expected.sourcePath&&runtime
    &&'0x'+runtime.object===expected.runtimeTemplateHex
    &&sha(Buffer.from(compiled.evm.bytecode.object,'hex'))===expected.creationBytecodeSha256,role+' full compiled code differs');
  if(role==='hook')need(compiled.compilationUnitId===recipe.compilationUnitId,'hook compilation unit differs');
  const actual=new Map();
  for(const [id,ranges]of Object.entries(runtime.immutableReferences)){
   const name=compiled.names?.get(id);
   need(name&&!actual.has(name)&&ranges.length&&ranges.every(r=>r.length===32),role+' invalid named immutable');
   actual.set(name,ranges.map(r=>r.start).sort((a,b)=>a-b));
  }
  need(actual.size===expected.immutableWords.length,role+' immutable count differs');
  for(const word of expected.immutableWords)need(JSON.stringify(actual.get(word.name))===JSON.stringify(word.byteOffsets),role+' immutable locations differ: '+word.name);
 }
 return {recipeId:LAUNCH_GUARD_RECIPE,sourceSha256:LAUNCH_GUARD_SOURCE_SHA256,
  normalizedRuntimeAndImmutableOffsetsVerified:true,platformRecognitionVerified:false,platformWaiverVerified:false};
}

function words(recipe,runtime){
 need(typeof runtime==='string'&&/^0x[0-9a-f]+$/i.test(runtime)&&runtime.length===recipe.runtimeTemplateHex.length,'materialized runtime size differs');
 let normalized=runtime.toLowerCase();const result={},used=new Set();
 for(const entry of recipe.immutableWords){
  need(!Object.hasOwn(result,entry.name)&&entry.byteOffsets.length,'invalid immutable word');let value;
  for(const offset of entry.byteOffsets){
   need(Number.isSafeInteger(offset)&&offset>=0&&offset*2+66<=runtime.length,'immutable outside runtime');
   const start=offset*2+2,candidate=runtime.slice(start,start+64).toLowerCase();
   need(recipe.runtimeTemplateHex.slice(start,start+64)==='0'.repeat(64)&&(value===undefined||value===candidate),'inconsistent immutable word');
   for(let i=offset;i<offset+32;i++){need(!used.has(i),'overlapping immutable');used.add(i);}
   value=candidate;normalized=normalized.slice(0,start)+'0'.repeat(64)+normalized.slice(start+64);
  }
  result[entry.name]=BigInt('0x'+value);
 }
 need(normalized===recipe.runtimeTemplateHex.toLowerCase(),'materialized code differs beyond immutables');return result;
}

/** Verify this project's requested buyers plus all original fee-custody bindings. */
export function assertLaunchGuardMaterializedRuntime({recipe,runtimeCodes,addresses,creatorRecipient,poolManager,initialSqrtPriceX96,earlyBuyers}){
 checkRecipe(recipe);
 need(Array.isArray(earlyBuyers)&&earlyBuyers.length===EARLY_BUYERS.length
  &&earlyBuyers.every((buyer,i)=>typeof buyer==='string'&&buyer.toLowerCase()===EARLY_BUYERS[i]),'exact ordered early buyers required');
 need(getCreateAddress({from:addresses.hook,nonce:1}).toLowerCase()===addresses.feeVault.toLowerCase(),'fee vault is not the hook child');
 const expectedHook={poolManager,token:addresses.token,initializer:addresses.initializer,feeVault:addresses.feeVault,
  creatorBuyFeeBps:170,creatorSellFeeBps:170,lpFee:0,tickSpacing:60,initialSqrtPriceX96,module:0,moduleCodeHash:0,maxModuleLpFeePips:0,
  ...Object.fromEntries(earlyBuyers.map((buyer,i)=>['earlyBuyer'+i,buyer]))};
 const expectedVault={poolManager,kernel:addresses.hook,creatorRecipient};
 for(const [role,runtime,expected]of [['hook',runtimeCodes.hook,expectedHook],['vault',runtimeCodes.feeVault,expectedVault]]){
  const actual=words(recipe[role],runtime);need(Object.keys(actual).length===Object.keys(expected).length,role+' parameter count differs');
  for(const [name,value]of Object.entries(expected))need(actual[name]===BigInt(value),role+' parameter differs: '+name);
 }
 return {recipeId:LAUNCH_GUARD_RECIPE,sourceSha256:LAUNCH_GUARD_SOURCE_SHA256,
  localRuntimeBindingsVerified:true,platformRecognitionVerified:false,platformWaiverVerified:false};
}

import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getCreateAddress} from 'ethers';

export const NATIVE30_SOURCE_ARTIFACT='sha256:402e473c66ff65813e61f7fdf370600b3552e9499b54c4d19b7e592632495841';
export const NATIVE30_RECIPE_SHA256='71c1a1f78656e7b50ce74fc15de2762bec727a580582b061b250d62d5e3eec20';
const require=(condition,message)=>{if(!condition)throw Error('Native30 runtime recipe: '+message);};
const contractsByRole={hook:'RobinhookNativeFeeHookV1',vault:'RobinhoodNativeFeeVaultV1'};

/** Official public runtime property recipe; this is not an official source bundle or a live waiver. */
export function loadNative30Recipe(root){
 const bytes=fs.readFileSync(path.join(root,'vendor/programmable-native30/runtime-recipes-v2.ts'));
 require(createHash('sha256').update(bytes).digest('hex')===NATIVE30_RECIPE_SHA256,'pinned published recipe bytes changed');
 const text=bytes.toString('utf8'),recipes=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
 const recipe=recipes.native30_fee_kernel_v2;
 require(recipe?.sourceArtifactHash===NATIVE30_SOURCE_ARTIFACT,'source artifact identity changed');
 return recipe;
}

/** Prove full template bytes AND named immutable locations, not just selected constants. */
export function assertNative30CompiledRuntime(contracts,recipe){
 require(recipe?.sourceArtifactHash===NATIVE30_SOURCE_ARTIFACT,'source artifact identity changed');
 for(const [role,name]of Object.entries(contractsByRole)){
  const compiled=contracts[name],expected=recipe[role],runtime=compiled?.evm?.deployedBytecode;
  require(runtime&&'0x'+runtime.object===expected.runtimeTemplateHex,role+' full normalized runtime differs');
  const actual=new Map();
  for(const [id,ranges]of Object.entries(runtime.immutableReferences)){
   const immutableName=compiled.names.get(id);
   require(immutableName&&!actual.has(immutableName)&&ranges.every(r=>r.length===32),role+' invalid named immutable');
   actual.set(immutableName,ranges.map(r=>r.start).sort((a,b)=>a-b));
  }
  require(actual.size===expected.immutableWords.length,role+' immutable count differs');
  for(const word of expected.immutableWords)require(JSON.stringify(actual.get(word.name))===JSON.stringify([...word.byteOffsets].sort((a,b)=>a-b)),role+' immutable locations differ: '+word.name);
 }
 return {recipeId:'native30_fee_kernel_v2',sourceArtifactHash:NATIVE30_SOURCE_ARTIFACT,normalizedRuntimeAndImmutableOffsetsVerified:true};
}

function readRuntimeWords(recipe,runtime){
 require(typeof runtime==='string'&&/^0x[0-9a-f]+$/i.test(runtime)&&runtime.length===recipe.runtimeTemplateHex.length,'materialized runtime size differs');
 let normalized=runtime.toLowerCase();const words={},used=new Set();
 for(const entry of recipe.immutableWords){
  require(!Object.hasOwn(words,entry.name)&&entry.byteOffsets.length,'invalid immutable word');
  let value;
  for(const offset of entry.byteOffsets){
   require(Number.isSafeInteger(offset)&&offset>=0&&offset*2+66<=runtime.length,'immutable outside runtime');
   const start=offset*2+2,candidate=runtime.slice(start,start+64).toLowerCase();
   require(recipe.runtimeTemplateHex.slice(start,start+64)==='0'.repeat(64)&&(!value||value===candidate),'inconsistent immutable word');
   for(let i=offset;i<offset+32;i++){require(!used.has(i),'overlapping immutable');used.add(i);}
   value=candidate;normalized=normalized.slice(0,start)+'0'.repeat(64)+normalized.slice(start+64);
  }
  words[entry.name]=BigInt('0x'+value);
 }
 require(normalized===recipe.runtimeTemplateHex.toLowerCase(),'materialized code differs beyond immutables');
 return words;
}

/** Locally bind predicted fee custody; chain observations and platform waiver confirmation stay separate. */
export function assertNative30MaterializedRuntime({recipe,runtimeCodes,addresses,creatorRecipient,poolManager,initialSqrtPriceX96}){
 require(recipe?.sourceArtifactHash===NATIVE30_SOURCE_ARTIFACT,'source artifact identity changed');
 require(getCreateAddress({from:addresses.hook,nonce:1}).toLowerCase()===addresses.feeVault.toLowerCase(),'fee vault is not the hook child');
 const hook=readRuntimeWords(recipe.hook,runtimeCodes.hook),vault=readRuntimeWords(recipe.vault,runtimeCodes.feeVault);
 const expectedHook={poolManager,token:addresses.token,initializer:addresses.initializer,feeVault:addresses.feeVault,
  creatorBuyFeeBps:170,creatorSellFeeBps:170,lpFee:0,tickSpacing:60,initialSqrtPriceX96,module:0,moduleCodeHash:0,maxModuleLpFeePips:0};
 const expectedVault={poolManager,kernel:addresses.hook,creatorRecipient};
 for(const [role,actual,expected]of [['hook',hook,expectedHook],['vault',vault,expectedVault]]){
  require(Object.keys(actual).length===Object.keys(expected).length,role+' parameter count differs');
  for(const [name,value]of Object.entries(expected))require(actual[name]===BigInt(value),role+' parameter differs: '+name);
 }
 return {recipeId:'native30_fee_kernel_v2',sourceArtifactHash:NATIVE30_SOURCE_ARTIFACT,
  localRuntimeBindingsVerified:true,platformWaiverVerified:false};
}

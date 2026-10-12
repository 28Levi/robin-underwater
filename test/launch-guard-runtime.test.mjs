import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import solc from 'solc';
import {getCreateAddress} from 'ethers';
import {compileRobinLaunchContracts} from '../src/launch-plan.mjs';
import {EARLY_BUYERS} from '../src/launch-guard-policy.mjs';
import {loadLaunchGuardRecipe,assertLaunchGuardCompiledRuntime,assertLaunchGuardMaterializedRuntime,LAUNCH_GUARD_SOURCE_PATH} from '../src/launch-guard-runtime.mjs';

const recipe=loadLaunchGuardRecipe(process.cwd());
const compiled=compileRobinLaunchContracts(process.cwd(),solc,{launchGuard:true});
const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const addresses={hook:addr(100),token:addr(101),initializer:addr(102)};
addresses.feeVault=getCreateAddress({from:addresses.hook,nonce:1});
const values={poolManager:addr(200),token:addresses.token,initializer:addresses.initializer,feeVault:addresses.feeVault,
 creatorBuyFeeBps:170,creatorSellFeeBps:170,lpFee:0,tickSpacing:60,initialSqrtPriceX96:1747735933952748037356115466503453n,
 module:0,moduleCodeHash:0,maxModuleLpFeePips:0,kernel:addresses.hook,creatorRecipient:addr(201),
 ...Object.fromEntries(EARLY_BUYERS.map((address,i)=>['earlyBuyer'+i,address]))};
function materialize(role,overrides={}){let bytes=recipe[role].runtimeTemplateHex;for(const {name,byteOffsets}of recipe[role].immutableWords){const word=BigInt(overrides[name]??values[name]).toString(16).padStart(64,'0');for(const offset of byteOffsets){const start=offset*2+2;bytes=bytes.slice(0,start)+word+bytes.slice(start+64);}}return bytes;}
function input(){return {recipe,runtimeCodes:{hook:materialize('hook'),feeVault:materialize('vault')},addresses,
 creatorRecipient:values.creatorRecipient,poolManager:values.poolManager,initialSqrtPriceX96:values.initialSqrtPriceX96,earlyBuyers:[...EARLY_BUYERS]};}

test('project pin reproduces full creation/runtime and fee vault without claiming platform recognition',()=>{
 const result=assertLaunchGuardCompiledRuntime(compiled.contracts,recipe);
 assert.equal(result.normalizedRuntimeAndImmutableOffsetsVerified,true);
 assert.equal(result.platformRecognitionVerified,false);assert.equal(result.platformWaiverVerified,false);
 assert.equal(recipe.hook.immutableWords.filter(w=>w.name.startsWith('earlyBuyer')).length,5);
 assert.equal(assertLaunchGuardMaterializedRuntime(input()).localRuntimeBindingsVerified,true);
});

test('pin rejects changed source and changed artifact bytes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'robin-guard-pin-'));
 try{
  for(const file of ['vendor/robin-launch-guard-v1/runtime-pin.json','vendor/programmable-native30/runtime-recipes-v2.ts',LAUNCH_GUARD_SOURCE_PATH]){
   fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(file,path.join(root,file));
  }
  assert.equal(loadLaunchGuardRecipe(root).sourceSha256,recipe.sourceSha256);
  fs.appendFileSync(path.join(root,LAUNCH_GUARD_SOURCE_PATH),'\n');
  assert.throws(()=>loadLaunchGuardRecipe(root),/source changed/);
  fs.copyFileSync(LAUNCH_GUARD_SOURCE_PATH,path.join(root,LAUNCH_GUARD_SOURCE_PATH));
  fs.appendFileSync(path.join(root,'vendor/robin-launch-guard-v1/runtime-pin.json'),' ');
  assert.throws(()=>loadLaunchGuardRecipe(root),/recipe bytes changed/);
 }finally{
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('robin-guard-pin-'));
  fs.rmSync(root,{recursive:true,force:true});
 }
});

test('compiled pin rejects changed runtime, creation code, source identity and immutable offsets',()=>{
 for(const mutate of [c=>c.evm.deployedBytecode.object='01'+c.evm.deployedBytecode.object.slice(2),
  c=>c.evm.bytecode.object='01'+c.evm.bytecode.object.slice(2),c=>c.sourcePath='other.sol',
  c=>c.compilationUnitId='kernel',c=>Object.values(c.evm.deployedBytecode.immutableReferences)[0][0].start++,
  c=>c.names.set(Object.keys(c.evm.deployedBytecode.immutableReferences)[0],'unknown')]){
  const contracts=structuredClone(compiled.contracts);mutate(contracts.RobinhookLaunchGuardHookV1);
  assert.throws(()=>assertLaunchGuardCompiledRuntime(contracts,recipe));
 }
 const bad=structuredClone(recipe);bad.hook.immutableWords[0].byteOffsets[0]++;
 assert.throws(()=>assertLaunchGuardCompiledRuntime(compiled.contracts,bad),/recipe identity/);
});

test('materialization binds all five ordered recipients and all custody parameters',()=>{
 for(const word of recipe.hook.immutableWords){const x=input();x.runtimeCodes.hook=materialize('hook',{[word.name]:BigInt(values[word.name])+1n});assert.throws(()=>assertLaunchGuardMaterializedRuntime(x),/parameter differs/);}
 for(const word of recipe.vault.immutableWords){const x=input();x.runtimeCodes.feeVault=materialize('vault',{[word.name]:BigInt(values[word.name])+1n});assert.throws(()=>assertLaunchGuardMaterializedRuntime(x),/parameter differs/);}
 for(const buyers of [EARLY_BUYERS.slice(0,4),[...EARLY_BUYERS].reverse(),[...EARLY_BUYERS.slice(0,4),addr(999)]])assert.throws(()=>assertLaunchGuardMaterializedRuntime({...input(),earlyBuyers:buyers}),/ordered early buyers/);
});

test('materialization rejects unpinned opcodes, inconsistent repeats and unrelated vault children',()=>{
 const x=input();x.runtimeCodes.hook='0x00'+x.runtimeCodes.hook.slice(4);assert.throws(()=>assertLaunchGuardMaterializedRuntime(x),/beyond immutables/);
 const repeated=recipe.hook.immutableWords.find(w=>w.byteOffsets.length>1),y=input(),offset=repeated.byteOffsets[0]*2+2;
 y.runtimeCodes.hook=y.runtimeCodes.hook.slice(0,offset)+'0'.repeat(64)+y.runtimeCodes.hook.slice(offset+64);
 assert.throws(()=>assertLaunchGuardMaterializedRuntime(y),/inconsistent immutable/);
 assert.throws(()=>assertLaunchGuardMaterializedRuntime({...input(),addresses:{...addresses,feeVault:addr(999)}}),/hook child/);
});

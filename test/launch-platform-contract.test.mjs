import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LEGACY_PLAN_MANIFEST,CURRENT_PLAN_MANIFEST,loadPlanContract,verifyCurrentPlanContract,assertSupportedPlanCapabilities} from '../src/launch-platform-contract.mjs';
import {loadReplanPacker} from '../scripts/reconcile-launch-replan.mjs';

const root='vendor/programmable-launch-plan-v1/',read=file=>fs.readFileSync(root+file);
const material=()=>({manifestBytes:read('current-c525/manifest.json'),indexBytes:read('current-c525/artifact-index.json'),
 packerBytes:read('current-c525/request-packer.mjs'),legacyManifest:JSON.parse(read('manifest.json'))});

test('only the exact two published manifests and their separate official packers are supported',()=>{
 const old=loadPlanContract(LEGACY_PLAN_MANIFEST),current=loadPlanContract(CURRENT_PLAN_MANIFEST);
 assert.notEqual(old.packerUrl.href,current.packerUrl.href);
 assert.equal(old.tradeFeePolicy.rateBps,30);assert.equal(current.tradeFeePolicy.rateBps,100);
 assert.equal(verifyCurrentPlanContract(material()).manifest.manifestDigest,CURRENT_PLAN_MANIFEST);
 for(const unknown of [undefined,'sha256:'+'0'.repeat(64),CURRENT_PLAN_MANIFEST.toUpperCase()])assert.throws(()=>loadPlanContract(unknown),/unsupported manifest/);
});

test('read-only replan reconciliation selects the same pinned current or historical packer and denies unknown revisions',async()=>{
 const old=await loadReplanPacker(LEGACY_PLAN_MANIFEST),current=await loadReplanPacker(CURRENT_PLAN_MANIFEST);
 assert.notEqual(old.entry.contentSha256,current.entry.contentSha256);
 assert.equal(current.entry.contentSha256,'sha256:0ab5c5d510f2b83f885e4816d216205a1631740095ecb5f123b2ee1ed865c298');
 await assert.rejects(loadReplanPacker('sha256:'+'0'.repeat(64)),/unsupported manifest/);
});

test('pinned public artifact bytes and exact legacy-to-current execution mapping cannot be replaced',()=>{
 for(const key of ['manifestBytes','indexBytes','packerBytes']){
  const input=material();input[key]=Buffer.concat([input[key],Buffer.from('\n')]);assert.throws(()=>verifyCurrentPlanContract(input),/bytes changed/);
 }
 const input=material();input.legacyManifest.schemaVersion='changed';
 assert.throws(()=>verifyCurrentPlanContract(input),/unreviewed schema, execution or policy/);
});

test('current capability cannot conceal route policy or mix historical manifest identity',()=>{
 const capabilities=JSON.parse(read('current-c525/capabilities-observed.json'));
 assert.equal(assertSupportedPlanCapabilities(capabilities).manifestDigest,CURRENT_PLAN_MANIFEST);
 for(const change of [x=>x.availability.manifestDigest=LEGACY_PLAN_MANIFEST,x=>x.currentTradeFeePolicy.rateBps=30,
  x=>x.currentTradeFeePolicy.verifiedExistingPoolFee='unconditionally-free',x=>delete x.currentTradeFeePolicy]){
  const altered=structuredClone(capabilities);change(altered);assert.throws(()=>assertSupportedPlanCapabilities(altered));
 }
});

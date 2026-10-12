import fs from 'node:fs';
import {createHash} from 'node:crypto';

export const LEGACY_PLAN_MANIFEST='sha256:3cd25308629f932d6a75e4a7694e6bcb67e4471fd2c1782d3b11ba5a7e3f8b61';
export const CURRENT_PLAN_MANIFEST='sha256:c5255621a411c6cb23602bf455b4bd22f65a9cdb24fe890d50f89c00e9468df1';
const currentFiles=Object.freeze({
 'manifest.json':'sha256:9f868ed3d50f9753efeb048bb14a0458fd3f1bb9c0ee23c80b5a311631e77767',
 'artifact-index.json':'sha256:813946d98987f21bd38d8e2825df50f02b3ce40b84dde97e17b421dbae63387f',
 'request-packer.mjs':'sha256:0ab5c5d510f2b83f885e4816d216205a1631740095ecb5f123b2ee1ed865c298',
});
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error('Published platform capability contract: '+message);};
const base=new URL('../vendor/programmable-launch-plan-v1/',import.meta.url);

/** Public artifacts are exact recorded bytes, never an approval or fee waiver. */
export function verifyCurrentPlanContract({manifestBytes,indexBytes,packerBytes,legacyManifest}){
 for(const [file,bytes]of [['manifest.json',manifestBytes],['artifact-index.json',indexBytes],['request-packer.mjs',packerBytes]])
  need(Buffer.isBuffer(bytes)&&sha(bytes)===currentFiles[file],'pinned '+file+' bytes changed');
 const manifest=JSON.parse(manifestBytes),index=JSON.parse(indexBytes);
 need(legacyManifest?.manifestDigest===LEGACY_PLAN_MANIFEST&&manifest.manifestDigest===CURRENT_PLAN_MANIFEST
  &&index.schemaVersion==='programmable.custom-launch-artifact-index.v1'&&index.manifestDigest===CURRENT_PLAN_MANIFEST,'manifest identity changed');
 const expected=structuredClone(legacyManifest);
 expected.manifestDigest=CURRENT_PLAN_MANIFEST;
 Object.assign(expected.admissionPolicies.openProvenance.tradeFeePolicy,{policyVersion:'programmable.routed-swap-fee.v3',rateBps:100,ratePercent:'1.00%'});
 need(canonical(expected)===canonical(manifest),'unreviewed schema, execution or policy change');
 for(const [file,bytes]of [['manifest.json',manifestBytes],['request-packer.mjs',packerBytes]]){
  const entries=index.artifacts.filter(a=>a.fileName===file),entry=entries[0];
  need(entries.length===1&&entry.contentSha256===sha(bytes)&&entry.byteLength===bytes.length
   &&entry.path==='/v4/chains/4663/custom-launch-contract/'+file,'artifact index differs');
 }
 return {manifest,index};
}

/** Only these two independently recorded platform revisions are supported. */
export function loadPlanContract(manifestDigest){
 need([LEGACY_PLAN_MANIFEST,CURRENT_PLAN_MANIFEST].includes(manifestDigest),'unsupported manifest');
 const current=manifestDigest===CURRENT_PLAN_MANIFEST,root=current?new URL('current-c525/',base):base;
 const bytes=file=>fs.readFileSync(new URL(file,root));
 let manifest,index;
 if(current)({manifest,index}=verifyCurrentPlanContract({manifestBytes:bytes('manifest.json'),indexBytes:bytes('artifact-index.json'),
  packerBytes:bytes('request-packer.mjs'),legacyManifest:JSON.parse(fs.readFileSync(new URL('manifest.json',base)))}));
 else{
  manifest=JSON.parse(bytes('manifest.json'));index=JSON.parse(bytes('artifact-index.json'));
  need(manifest.manifestDigest===manifestDigest&&index.manifestDigest===manifestDigest,'legacy artifact identity changed');
  need(index.artifacts.find(a=>a.fileName==='request-packer.mjs')?.contentSha256===sha(bytes('request-packer.mjs')),'legacy packer bytes changed');
 }
 return {manifestDigest,manifest,index,packerUrl:new URL('request-packer.mjs',root),
  tradeFeePolicy:structuredClone(manifest.admissionPolicies.openProvenance.tradeFeePolicy)};
}

export function assertSupportedPlanCapabilities(capabilities){
 const contract=loadPlanContract(capabilities?.manifestDigest);
 need(capabilities.availability?.manifestDigest===contract.manifestDigest,'capability manifest mismatch');
 if(contract.manifestDigest===CURRENT_PLAN_MANIFEST)
  need(canonical(capabilities.currentTradeFeePolicy)===canonical(contract.tradeFeePolicy),'current routed fee policy differs');
 return contract;
}

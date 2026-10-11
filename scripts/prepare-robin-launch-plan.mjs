import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomBytes,createHash} from 'node:crypto';import solc from 'solc';
import {compileRobinLaunchContracts,buildRobinLaunchPlan,PROJECT_GAS_LIMIT,TOTAL_GAS_LIMIT} from '../src/launch-plan.mjs';

export function parseRobinLaunchPlanOptions(argv){
 const args=new Map(),values=['--source-revision','--capabilities','--distributor','--out','--nonce','--graph-gas-limit','--total-gas-limit'];
 for(let i=0;i<argv.length;i++){
  const k=argv[i];
  if(args.has(k))throw Error('Repeated launch preparation option');
  if(k==='--preflight-only'){args.set(k,true);continue;}
  const v=argv[++i];
  if(!values.includes(k)||!v||v.startsWith('--'))throw Error('Use --source-revision COMMIT --capabilities FILE --distributor FILE --out NEW_DIRECTORY [--preflight-only] [--nonce HEX32] [--graph-gas-limit UNITS] [--total-gas-limit UNITS]');
  args.set(k,v);
 }
 for(const k of ['--source-revision','--capabilities','--distributor','--out'])if(!args.has(k))throw Error('Missing '+k);
 return args;
}

export async function prepareRobinLaunchPlan(argv){
 const args=parseRobinLaunchPlanOptions(argv),root=process.cwd(),out=path.resolve(args.get('--out'));
 if(fs.existsSync(out))throw Error('Preserve the previous request; choose a new output directory');
 const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
 const index=read('vendor/programmable-launch-plan-v1/artifact-index.json'),packer=fs.readFileSync('vendor/programmable-launch-plan-v1/request-packer.mjs');
 if('sha256:'+createHash('sha256').update(packer).digest('hex')!==index.artifacts.find(a=>a.fileName==='request-packer.mjs').contentSha256)throw Error('Public packer hash changed');
 const {runCustomLaunchPlanPackerCliV1}=await import('../vendor/programmable-launch-plan-v1/request-packer.mjs');
 const built=buildRobinLaunchPlan({intent:read('launch-intent.json'),compiled:compileRobinLaunchContracts(root,solc),capabilities:read(args.get('--capabilities')),factory:read('vendor/programmable-launch-plan-v1/graph-factory.json'),distributor:read(args.get('--distributor')),sourceRevision:args.get('--source-revision'),nonce:args.get('--nonce')??'0x'+randomBytes(32).toString('hex'),graphGasLimit:args.get('--graph-gas-limit')??PROJECT_GAS_LIMIT,totalGasLimit:args.get('--total-gas-limit')??TOTAL_GAS_LIMIT,preflightOnly:args.has('--preflight-only')});
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify(built.plan,null,2)+'\n',{flag:'wx'});
 const code=await runCustomLaunchPlanPackerCliV1(['--input',path.join(out,'plan.json'),'--out',path.join(out,'request.canonical.json'),'--report',path.join(out,'pack-report.json')]);
 const status=code===0?(args.has('--preflight-only')?'offline-packed-preflight-only-not-admitted-not-wallet-ready':'offline-packed-platform-preflight-required'):'offline-pack-rejected';
 const report={...built.report,packer:read(path.join(out,'pack-report.json')),status};
 fs.writeFileSync(path.join(out,'preparation.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:report.status,preparationMode:report.preparationMode,readiness:report.readiness,platformAvailability:report.platformAvailability,output:out,addresses:report.addresses,planHash:report.packer.planHash,platformAdmission:false,walletReady:false,walletSigning:false,transactionBroadcast:false,automaticRewardsEnabled:false},null,2));
 return code;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await prepareRobinLaunchPlan(process.argv.slice(2));

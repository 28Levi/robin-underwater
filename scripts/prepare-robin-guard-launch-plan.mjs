import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import solc from 'solc';
import {compileRobinLaunchContracts,buildRobinLaunchPlan,PROJECT_GAS_LIMIT,TOTAL_GAS_LIMIT} from '../src/launch-plan.mjs';
import {assertLaunchGuardIntent} from '../src/launch-guard-policy.mjs';
import {loadPlanContract} from '../src/launch-platform-contract.mjs';
import {parseRobinLaunchPlanOptions} from './prepare-robin-launch-plan.mjs';

// A separate command prevents reusing an old, unguarded request or silently
// selecting a recipient for the controller's initial purchase.
export async function prepareRobinGuardLaunchPlan(argv) {
  const args=parseRobinLaunchPlanOptions(argv),root=process.cwd(),out=path.resolve(args.get('--out'));
  if(fs.existsSync(out))throw Error('Preserve the previous request; choose a new output directory');
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  const intent=read('launch-guard-intent.json');
  assertLaunchGuardIntent(intent);
  const capabilities=read(args.get('--capabilities')),contract=loadPlanContract(capabilities.manifestDigest);
  const {runCustomLaunchPlanPackerCliV1}=await import(contract.packerUrl.href);
  const built=buildRobinLaunchPlan({intent,compiled:compileRobinLaunchContracts(root,solc,{launchGuard:true}),
    capabilities,factory:read('vendor/programmable-launch-plan-v1/graph-factory.json'),
    distributor:read(args.get('--distributor')),sourceRevision:args.get('--source-revision'),
    nonce:args.get('--nonce')??'0x'+randomBytes(32).toString('hex'),
    graphGasLimit:args.get('--graph-gas-limit')??PROJECT_GAS_LIMIT,
    totalGasLimit:args.get('--total-gas-limit')??TOTAL_GAS_LIMIT,preflightOnly:args.has('--preflight-only')});
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify(built.plan,null,2)+'\n',{flag:'wx'});
  const code=await runCustomLaunchPlanPackerCliV1(['--input',path.join(out,'plan.json'),
    '--out',path.join(out,'request.canonical.json'),'--report',path.join(out,'pack-report.json')]);
  const status=code===0?'guarded-plan-packed-not-admitted-not-wallet-ready':'guarded-plan-pack-rejected';
  const report={...built.report,packer:read(path.join(out,'pack-report.json')),status};
  fs.writeFileSync(path.join(out,'preparation.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status,output:out,launchGuard:report.launchGuard,addresses:report.addresses,
    planHash:report.packer.planHash,platformAdmission:false,walletReady:false,walletSigning:false,
    transactionBroadcast:false,automaticRewardsEnabled:false},null,2));
  return code;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.exitCode=await prepareRobinGuardLaunchPlan(process.argv.slice(2));}
  catch(error){console.error(error.message);process.exitCode=2;}
}

import fs from 'node:fs';
const coverage=JSON.parse(fs.readFileSync('research/current/coverage.json'));
const intent=JSON.parse(fs.readFileSync('launch-intent.json'));
const compiled=fs.existsSync('artifacts/native20-build-evidence.json');
const readback=JSON.parse(fs.readFileSync('research/current/rpc-readback.json'));
const result={chainId:coverage.chainId,profile:coverage.profile.profileVersion,latestCapabilityCheck:readback.checkedAt,
 readyToSubmit:false,status:'original-reward-model-retained; production-validation-and-setup-pending',
 rewardModelDecision:intent.rewardModelDecision,
 economicAssessment:intent.economicAssessment,
 confirmed:{name:intent.name,symbol:intent.symbol,supply:intent.supply,capitalSource:intent.capitalSource,nativeSeedWei:'0',
 totalBuyFeeBps:intent.totalBuyFeeBps,totalSellFeeBps:intent.totalSellFeeBps,launchWallet:intent.launchWallet,initialBuyWei:intent.initialBuyWei},
 integration:{recipe:'Unchanged reviewed Native20 hook/token/initializer; immutable creator fee recipient is the separate reward distributor',
 canonicalKernelReproduced:compiled,localPayoutExecutorImplemented:true,upstreamRouterTests:'six flows pass locally',
 exactLiveRouterVerified:false,liveRuntimeCompatibilityTests:'six flows with copied deployed router and Permit2 runtime',
 productionEntryPointPrepared:true,productionActivated:false,serverAccepted:false,liveSigned:false,liveBroadcast:false},
 assets:{logo:intent.localImage,publicLogo:intent.image,publicSource:intent.publicSource,website:intent.website,separateWebsiteRequired:false},
 wallet:{balanceWeiAtReadback:readback.walletBalanceWei,checkedAt:readback.checkedAt},
 missing:['Minimum token output, reviewed gas budgets and wallet funding',
 'Project X profile required by platform metadata',
 'Deployed reward distributor and its declared trusted operator',
 'Production host, dedicated operator custody, historical-state RPC and ongoing gas funding',
 'Fresh platform quote, exact launch pack, authenticated preflight and wallet handoff']};
console.log(JSON.stringify(result,null,2));
process.exitCode=2;

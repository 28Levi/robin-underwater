import fs from 'node:fs';
const coverage=JSON.parse(fs.readFileSync('research/current/coverage.json'));
const intent=JSON.parse(fs.readFileSync('launch-intent.json'));
const canonicalBuildEvidencePresent=fs.existsSync('artifacts/native20-build-evidence.json');
const customHookBuildEvidencePresent=fs.existsSync('artifacts/robin-native30-build-evidence.json');
const readback=JSON.parse(fs.readFileSync('research/current/rpc-readback.json'));
const result={chainId:coverage.chainId,profile:coverage.profile.profileVersion,historicalCapabilityEvidenceAt:readback.checkedAt,
 readyToSubmit:false,status:'offline-reference-report; live-launch-readiness-not-checked',
 rewardModelDecision:intent.rewardModelDecision,
 economicAssessment:intent.economicAssessment,
 confirmed:{name:intent.name,symbol:intent.symbol,supply:intent.supply,capitalSource:intent.capitalSource,nativeSeedWei:'0',
 projectBuyFeeBps:intent.projectBuyFeeBps,projectSellFeeBps:intent.projectSellFeeBps,platformFeeBps:intent.platformFeeBps,
 totalBuyFeeBps:intent.totalBuyFeeBps,totalSellFeeBps:intent.totalSellFeeBps,launchWallet:intent.launchWallet,initialBuyWei:intent.initialBuyWei},
 integration:{recipe:intent.hookRecipe,implementation:'Custom RobinhookNativeFeeHookV1 with 170 bps rewards and 30 bps Programmable; unchanged upstream token and initializer',
 canonicalBuildEvidencePresent,customHookBuildEvidencePresent,artifactsRebuiltByThisCommand:false,localPayoutExecutorImplemented:true,
 upstreamRouterTests:'Historical canonical Native20 180/20 evidence: six local flows; not verification of the current custom hook or exact launch',
 exactLiveRouterVerified:false,liveRuntimeCompatibilityTests:'Historical canonical Native20 flows with copied router and Permit2 runtimes; current custom-hook route fees and compatibility require separate verification',
 productionEntryPointPrepared:true,productionActivationChecked:false,serverAcceptanceChecked:false,liveSigned:false,liveBroadcast:false},
 assets:{logo:intent.localImage,publicLogo:intent.image,publicSource:intent.publicSource,website:intent.website,separateWebsiteRequired:false},
 wallet:{balanceWeiAtReadback:readback.walletBalanceWei,checkedAt:readback.checkedAt},
 readinessMustBeConfirmedWithCurrentEvidence:['Fresh finalized distributor and infrastructure runtime readback',
 'Current manifest, capabilities and owned review for the exact newly packed 170/30 package',
 'Issuer-prepared execution permit and complete Atomic transaction simulation',
 'Exact wallet handoff, current funding and reviewed gas limits',
 'Production host source revision and post-launch activation bound to the approved package']};
console.log(JSON.stringify(result,null,2));
process.exitCode=2;

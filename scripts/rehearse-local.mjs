import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {JsonRpcProvider,HDNodeWallet,keccak256} from 'ethers';
import {native20Fixture,E} from '../test/helpers/native20-fixture.mjs';
import {buildSnapshot} from '../src/replay.mjs';
import {LossLedger,stringify} from '../src/ledger.mjs';
const require=createRequire(import.meta.url),root=path.resolve('.'),rpcUrl='http://127.0.0.1:18545';
const runDirectory=path.join(root,'output','rehearsal',String(Date.now()));fs.mkdirSync(runDirectory,{recursive:true});
const reviewedManifest=JSON.parse(fs.readFileSync(new URL('../test/fixtures/native30-execution-limits.json',import.meta.url),'utf8'));
const feeProfilePath=process.argv[2];
if(process.argv.length>3)throw Error('Usage: node scripts/rehearse-local.mjs [observed-live-fee-profile.json]');
const observedFees=feeProfilePath?JSON.parse(fs.readFileSync(feeProfilePath,'utf8')):null;
if(observedFees){
 assert.equal(observedFees.chainId,4663);assert.ok(Number.isSafeInteger(observedFees.block));
 assert.ok(Number.isFinite(Date.parse(observedFees.checkedAt)));
 assert.match(observedFees.baseFeePerGas,/^[1-9][0-9]*$/);
 assert.match(observedFees.feeData.maxPriorityFeePerGas,/^(0|[1-9][0-9]*)$/);
}
const reportFile='output/robin-native30-scheduled-process-rehearsal.json';
const report={schemaVersion:'robin.native30-scheduled-process-rehearsal.v1',startedAt:new Date().toISOString(),network:'disposable local Hardhat EVM',
 mainnetTransactionsSent:0,realFundsSpentWei:'0',publicTestMnemonicOnly:true,graphFactorySimulated:true,simulatedLocalClock:true,checks:[],cycles:[]};
report.reviewedExecutionLimits=reviewedManifest.execution;
report.observedLiveFees=observedFees;
const server=spawn(process.execPath,[require.resolve('hardhat/internal/cli/cli.js'),'node','--hostname','127.0.0.1','--port','18545'],
 {cwd:root,env:{...process.env,LOCALAPPDATA:path.join(runDirectory,'runtime'),APPDATA:path.join(runDirectory,'runtime'),
  HARDHAT_CONFIG:path.join(root,'hardhat.rehearsal.config.cjs')},stdio:'ignore',windowsHide:true});
const rpc=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});
let f,slowRpc,feeRpc;
const check=(name,details={})=>{report.checks.push({name,passed:true,...details});console.log('PASS: '+name);};
try{
 let online=false;
 for(let i=0;i<60;i++){
  if(server.exitCode!==null)throw Error('Local node failed to start; port may be in use.');
  try{const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'hardhat_metadata',params:[]})});
   const b=await r.json();if(b.result?.chainId===4663){online=true;break;}}catch{}
  await delay(200);
 }
 if(!online)throw Error('Local node unavailable');
 let executorRpcUrl=rpcUrl;
 if(observedFees){
  // Only the disposable chain's fee quote is modeled. No live RPC or real signer is used.
  feeRpc=http.createServer(async(req,res)=>{
   try{let body='';for await(const chunk of req)body+=chunk;
    const upstream=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body});
    const requests=JSON.parse(body),reply=await upstream.json();
    const requestList=Array.isArray(requests)?requests:[requests],replies=Array.isArray(reply)?reply:[reply];
    for(const item of replies)if(requestList.find(r=>r.id===item.id)?.method==='eth_maxPriorityFeePerGas')
     item.result='0x'+BigInt(observedFees.feeData.maxPriorityFeePerGas).toString(16);
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(Array.isArray(reply)?replies:replies[0]));
   }catch{res.writeHead(502);res.end();}
  });
  await new Promise(resolve=>feeRpc.listen(18547,'127.0.0.1',resolve));
  executorRpcUrl='http://127.0.0.1:18547';
 }
 const remote={network:{provider:{send:(method,params)=>rpc.send(method,params),request:({method,params})=>rpc.send(method,params??[])}}};
 f=await native20Fixture(remote,{operatorIndex:3,name:'ROBINHOOK',symbol:'ROBIN',firstBuyWei:E/100n,feeProfile:'robin-native30'});
 const {provider,owner,alice,bob,token,hook,feeVault,reward,c,swap}=f;
 c.minimumAgeSeconds=300;c.maxFinalityLagSeconds=1800;
 c.payoutStartTimestamp=(await provider.getBlock(f.launched.blockNumber)).timestamp;
 const interval=900,nextBoundary=time=>c.payoutStartTimestamp+(Math.floor((time-c.payoutStartTimestamp)/interval)+1)*interval;
 const advanceTo=async timestamp=>{assert.ok(timestamp>(await rpc.getBlock('latest')).timestamp);await rpc.send('evm_setNextBlockTimestamp',[timestamp]);await rpc.send('evm_mine',[]);};
 report.policy={minimumAgeSeconds:c.minimumAgeSeconds,twapWindowSeconds:c.twapWindowSeconds,payoutIntervalSeconds:interval,payoutStartTimestamp:c.payoutStartTimestamp};
 const addresses={early:await owner.getAddress(),alice:await alice.getAddress(),bob:await bob.getAddress(),recipient:await(await provider.getSigner(4)).getAddress()};
 const lateBuyer=await provider.getSigner(5);
 const receipts=[f.launched,await swap(bob,true,E),await swap(alice,true,E/10n),await swap(lateBuyer,true,E/5n),
  await swap(bob,false,(await token.balanceOf(addresses.bob))/2n)];
 const fees=receipts.flatMap(r=>r.logs.map(l=>{try{return hook.interface.parseLog(l);}catch{return null;}})).filter(l=>l?.name==='NativeFeesAccrued');
 for(const fee of fees){assert.equal(fee.args.creatorFee+fee.args.platformFee,(fee.args.grossNative*200n+9999n)/10000n);
  assert.equal(fee.args.platformFee,(fee.args.grossNative*30n+9999n)/10000n);}
 assert.equal(await hook.creatorBuyFeeBps(),170n);assert.equal(await hook.creatorSellFeeBps(),170n);
 assert.equal(await hook.PLATFORM_FEE_BPS(),30n);
 assert.equal(await feeVault.creatorAccrued(),fees.reduce((sum,p)=>sum+p.args.creatorFee,0n));
 check('Real swaps charge 2% total and separate project/platform fee balances',{swaps:fees.length});
 // Price history is independent of the shorter holding delay: retain the complete 30-minute TWAP.
 await rpc.send('evm_increaseTime',[c.twapWindowSeconds+1]);await rpc.send('evm_mine',[]);
 const beforeSnapshot=await buildSnapshot(provider,c),beforeLedger=LossLedger.restore(beforeSnapshot.ledger);
 const original={...beforeLedger.get(addresses.alice)};
 const transferAmount=(await token.balanceOf(addresses.alice))/2n;
 const transferReceipt=await(await token.connect(alice).transfer(addresses.recipient,transferAmount)).wait();
 const transferTime=(await provider.getBlock(transferReceipt.blockNumber)).timestamp;
 const afterTransfer=LossLedger.restore((await buildSnapshot(provider,c)).ledger);
 assert.equal(afterTransfer.get(addresses.alice).cost+afterTransfer.get(addresses.recipient).cost,original.cost);
 assert.equal(afterTransfer.get(addresses.alice).balance+afterTransfer.get(addresses.recipient).balance,original.balance);
 assert.equal(afterTransfer.get(addresses.alice).cost,original.cost-original.cost*transferAmount/original.balance);
 await advanceTo(transferTime+299);
 const notMature=await buildSnapshot(provider,c);
 assert.ok(!LossLedger.restore(notMature.ledger).shortfalls({...notMature.oracle,now:notMature.checkpoint.timestamp}).some(a=>a.account===addresses.recipient.toLowerCase()));
 await advanceTo(transferTime+300);
 const matured=await buildSnapshot(provider,c),ledger=LossLedger.restore(matured.ledger);
 const lossMap=new Map(ledger.shortfalls({...matured.oracle,now:matured.checkpoint.timestamp}).map(a=>[a.account,a.loss]));
 const originalLoss=beforeLedger.shortfalls({...beforeSnapshot.oracle,now:beforeSnapshot.checkpoint.timestamp}).find(a=>a.account===addresses.alice.toLowerCase()).loss;
 const combined=(lossMap.get(addresses.alice.toLowerCase())??0n)+(lossMap.get(addresses.recipient.toLowerCase())??0n);
 assert.ok(combined<=originalLoss+1n && combined>=originalLoss-1n);
 assert.ok(!lossMap.has(addresses.early.toLowerCase()));
 assert.ok((lossMap.get(addresses.recipient.toLowerCase())??0n)>0n);
 check('Transferred inventory is ineligible at 299 seconds and eligible at 300 seconds, with an independent 30-minute TWAP',
  {transferTime,immatureAt:notMature.checkpoint.timestamp,matureAt:matured.checkpoint.timestamp});
 check('Transferring half the tokens carries half the basis; combined loss stays the same within 1 wei');
 // Advancing multiple intervals is local EVM time travel. Give each independent
 // bot process the corresponding clock, preserving all production freshness and
 // deadline limits instead of inflating them to accommodate accelerated tests.
 const clockShim=path.join(runDirectory,'local-clock.mjs');
 fs.writeFileSync(clockShim,"const started=performance.now(), epoch=Number(process.env.ROBIN_REHEARSAL_CLOCK_MS);\n"
  +"if(!Number.isSafeInteger(epoch)||epoch<=0)throw Error('Invalid local rehearsal clock');\n"
  +"Date.now=()=>epoch+Math.floor(performance.now()-started);\n");
 const operator=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/3");
 const config={...c,rpcUrlEnvironment:'ROBIN_REHEARSAL_RPC_URL',execution:{mode:'local-only',operator:operator.address,feeVault:await feeVault.getAddress(),
  maxGasPerTransactionWei:reviewedManifest.execution.maxGasPerTransactionWei,maxTotalGasWei:reviewedManifest.execution.maxTotalGasWei,
  minimumHarvestWei:reviewedManifest.execution.minimumHarvestWei,minimumBatchWei:reviewedManifest.execution.minimumBatchWei,
  retryIntervalSeconds:reviewedManifest.execution.retryIntervalSeconds,payoutIntervalSeconds:interval,codeHashes:{}}};
 for(const name of ['token','hook','distributor','feeVault'])config.execution.codeHashes[name]=keccak256(await provider.getCode(name==='feeVault'?config.execution.feeVault:config[name]));
 const configFile=path.join(runDirectory,'config.json');fs.writeFileSync(configFile,stringify(config));
 const stateDirectory=path.join(runDirectory,'bot-state');
 const readJournal=()=>JSON.parse(fs.readFileSync(path.join(stateDirectory,'journal.json'))).state;
 async function cycle(endpoint=executorRpcUrl){
  if(observedFees){await rpc.send('hardhat_setNextBlockBaseFeePerGas',['0x'+BigInt(observedFees.baseFeePerGas).toString(16)]);await rpc.send('evm_mine',[]);}
  const child=spawn(process.execPath,['--import',pathToFileURL(clockShim).href,'scripts/executor.mjs',configFile,'--once'],{cwd:root,windowsHide:true,
   env:{...process.env,ROBIN_REHEARSAL_CLOCK_MS:String((await rpc.getBlock('latest')).timestamp*1000),
    ROBIN_REHEARSAL_RPC_URL:endpoint,ROBIN_LOCAL_OPERATOR_PRIVATE_KEY:operator.privateKey,ROBIN_STATE_DIRECTORY:stateDirectory},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>{output+=b.toString();});child.stderr.resume();
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  const status=JSON.parse(output.trim().split('\n').at(-1));report.cycles.push({pid:child.pid,exitCode:code,chainTime:(await rpc.getBlock('latest')).timestamp,...status});
  console.log(`Bot process ${child.pid}: ${status.state}${status.kind?' / '+status.kind:''}`);
  return status;
 }
 const platformBefore=await feeVault.platformAccrued();
 assert.equal((await cycle()).kind,'harvest');assert.equal((await cycle()).state,'confirmed');
 assert.equal(await feeVault.creatorAccrued(),0n);assert.equal(await feeVault.platformAccrued(),platformBefore);
 const snapshot=await buildSnapshot(provider,c),expected=LossLedger.restore(snapshot.ledger).plan(await reward.available(),{...snapshot.oracle,now:snapshot.checkpoint.timestamp});
 assert.ok(expected.allocations.length>0);
 assert.equal(expected.policy,'deepest-percentage-first-v1');
 assert.ok(expected.allocated<expected.totalLoss,'Use a scarce reward pot to exercise recovery priority.');
 const positions=LossLedger.restore(snapshot.ledger).shortfalls({...snapshot.oracle,now:snapshot.checkpoint.timestamp});
 const paidAccounts=new Set(expected.allocations.map(a=>a.account));
 for(const paid of expected.allocations)for(const waiting of positions.filter(a=>!paidAccounts.has(a.account)))
  assert.ok((paid.loss-paid.amount+1n)*waiting.basis>=waiting.loss*paid.basis,'No deeper unpaid tier may be overtaken beyond integer rounding');
 const balances=new Map(await Promise.all(expected.allocations.map(async a=>[a.account,await provider.getBalance(a.account)])));
 assert.equal((await cycle()).kind,'payout');assert.equal((await cycle()).state,'confirmed');
 for(const a of expected.allocations)assert.equal((await provider.getBalance(a.account))-balances.get(a.account),a.amount);
 check('Separate bot processes harvest fees and pay the exact recovery-ladder entitlements',
  {recipients:expected.allocations,allocatedWei:expected.allocated,profitableEarlyBuyerPaid:false});
 const paidSnapshot=await buildSnapshot(provider,c),paidLedger=LossLedger.restore(paidSnapshot.ledger);
 for(const a of expected.allocations)assert.equal(paidLedger.get(a.account).relief,a.amount);
 assert.notEqual((await cycle()).state,'submitted');assert.notEqual((await cycle()).state,'submitted');
 const journal=readJournal();
 assert.equal(journal.history.length,2);assert.equal(journal.pending,null);
 assert.equal(new Set(report.cycles.map(s=>s.pid)).size,report.cycles.length);
 check('Fresh bot processes share the durable journal without duplicate payouts');
 // A funded treasury cannot start a second allocation round before the next anchored boundary.
 const nextDue=nextBoundary((await rpc.getBlock('latest')).timestamp);
 await(await owner.sendTransaction({to:await reward.getAddress(),value:E/10_000n})).wait();
 const secondRoundBudget=await reward.available(),beforeNextRoundHistory=readJournal().history.length;
 assert.ok(secondRoundBudget>=BigInt(config.execution.minimumBatchWei));
 assert.notEqual((await cycle()).state,'submitted');
 assert.equal(await reward.available(),secondRoundBudget);assert.equal(readJournal().history.length,beforeNextRoundHistory);
 await advanceTo(nextDue-2);
 assert.notEqual((await cycle()).state,'submitted');
 assert.equal(await reward.available(),secondRoundBudget);assert.equal(readJournal().history.length,beforeNextRoundHistory);
 await advanceTo(nextDue);
 const secondSnapshot=await buildSnapshot(provider,c),secondExpected=LossLedger.restore(secondSnapshot.ledger).plan(secondRoundBudget,{...secondSnapshot.oracle,now:secondSnapshot.checkpoint.timestamp});
 const secondBalances=new Map(await Promise.all(secondExpected.allocations.map(async a=>[a.account,await provider.getBalance(a.account)])));
 assert.equal((await cycle()).kind,'payout');assert.equal((await cycle()).state,'confirmed');
 for(const a of secondExpected.allocations)assert.equal((await provider.getBalance(a.account))-secondBalances.get(a.account),a.amount);
 check('A separately funded second round waits for the next 15-minute boundary across process restarts',
  {nextDueAt:nextDue,allocatedWei:secondExpected.allocated,recipients:secondExpected.allocations});
 const afterSecondSnapshot=await buildSnapshot(provider,c),afterSecondLedger=LossLedger.restore(afterSecondSnapshot.ledger);
 // Post-relief transfer must move already-paid relief as well as basis.
 const costBefore=afterSecondLedger.get(addresses.alice).cost,reliefBefore=afterSecondLedger.get(addresses.alice).relief;
 const recipientCost=afterSecondLedger.get(addresses.recipient).cost,recipientRelief=afterSecondLedger.get(addresses.recipient).relief;
 await(await token.connect(alice).transfer(addresses.recipient,await token.balanceOf(addresses.alice))).wait();
 const moved=LossLedger.restore((await buildSnapshot(provider,c)).ledger);
 assert.equal(moved.get(addresses.alice).cost,0n);assert.equal(moved.get(addresses.alice).relief,0n);
 assert.equal(moved.get(addresses.recipient).cost,costBefore+recipientCost);
 assert.equal(moved.get(addresses.recipient).relief,reliefBefore+recipientRelief);
 check('Moving tokens after a payout also moves prior relief and cannot reset the reward history');
 // Empty new blocks are routine on the live chain; a safe bot must still make progress.
 await swap(bob,true,E/1000n);
 const thirdDue=nextBoundary((await rpc.getBlock('latest')).timestamp);
 await advanceTo(thirdDue);
 const boundaryCrossing={scheduledBoundary:thirdDue,crossTo:thirdDue+interval+1,crossed:false};
 const harvestSelector=feeVault.interface.getFunction('claimCreator').selector.toLowerCase();
 slowRpc=http.createServer(async(req,res)=>{
  try{let body='';for await(const chunk of req)body+=chunk;
   const requests=JSON.parse(body),items=Array.isArray(requests)?requests:[requests];
   if(!boundaryCrossing.crossed&&items.some(item=>item.method==='eth_estimateGas'&&item.params?.[0]?.data?.toLowerCase()===harvestSelector)){
    boundaryCrossing.before=(await rpc.getBlock('latest')).timestamp;
    await advanceTo(boundaryCrossing.crossTo);boundaryCrossing.crossed=true;
   }
   const upstream=await fetch(executorRpcUrl,{method:'POST',headers:{'content-type':'application/json'},body});
   const reply=await upstream.text();await delay(250);res.writeHead(200,{'content-type':'application/json'});res.end(reply);
  }catch{res.writeHead(502);res.end();}
 });
 await new Promise(resolve=>slowRpc.listen(18546,'127.0.0.1',resolve));
 await rpc.send('evm_setIntervalMining',[100]);
 const moving=await cycle('http://127.0.0.1:18546');
 assert.equal(moving.kind,'harvest');
 if(moving.state==='submitted')assert.equal((await cycle('http://127.0.0.1:18546')).state,'confirmed');
 await rpc.send('evm_setIntervalMining',[0]);
 report.movingBlockProbe={intervalMs:100,rpcResponseDelayMs:250,state:moving.state,kind:moving.kind??null,boundaryCrossing,passed:moving.state==='submitted'&&boundaryCrossing.crossed};
 assert.ok(report.movingBlockProbe.passed,'Bot cannot submit while empty blocks advance and RPC replies take 250ms; fix liveness before live testing.');
 check('Bot makes progress while new empty blocks arrive every 100 milliseconds');
 const afterHarvest=await buildSnapshot(provider,c),thirdExpected=LossLedger.restore(afterHarvest.ledger).plan(await reward.available(),{...afterHarvest.oracle,now:afterHarvest.checkpoint.timestamp});
 assert.ok(thirdExpected.allocated>=BigInt(config.execution.minimumBatchWei));
 const thirdBalances=new Map(await Promise.all(thirdExpected.allocations.map(async a=>[a.account,await provider.getBalance(a.account)])));
 assert.equal((await cycle()).kind,'payout');assert.equal((await cycle()).state,'confirmed');
 for(const a of thirdExpected.allocations)assert.equal((await provider.getBalance(a.account))-thirdBalances.get(a.account),a.amount);
 const finalHistory=readJournal().history.length;
 assert.notEqual((await cycle()).state,'submitted');assert.equal(readJournal().history.length,finalHistory);
 assert.equal(new Set(report.cycles.map(s=>s.pid)).size,report.cycles.length);
 check('A harvest crossing the next schedule boundary keeps its allocation phase and pays exactly once after restart',
  {recipients:thirdExpected.allocations,allocatedWei:thirdExpected.allocated,journalTransactions:finalHistory});
 report.passed=true;
}catch(error){report.passed=false;report.failure=error.message;console.error('REHEARSAL FAILED: '+error.message);process.exitCode=1;}
finally{
 report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(runDirectory,'report.json'),stringify(report)+'\n');
 fs.writeFileSync(reportFile,stringify(report)+'\n');
 slowRpc?.close();feeRpc?.close();f?.provider.destroy();rpc.destroy();server.kill();
 console.log(`Evidence: ${reportFile} (local funds only)`);
}

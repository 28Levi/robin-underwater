import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {BrowserProvider,JsonRpcSigner,HDNodeWallet,ContractFactory,Contract,ZeroAddress,MaxUint256,ZeroHash,getCreate2Address,keccak256,toBeHex,AbiCoder} from 'ethers';
import {buildSnapshot} from '../src/replay.mjs';
import {LossLedger} from '../src/ledger.mjs';
import {normalizeNative20Receipt} from '../src/native20-adapter.mjs';
import {decodeReceipt} from '../src/receipt-adapter.mjs';
import {executeCycle} from '../src/executor.mjs';
process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');
const {default:hre}=await import('hardhat');
const artifact=n=>JSON.parse(fs.readFileSync(`artifacts/${n}.json`));
const E=10n**18n,MANAGER='0x8366a39CC670B4001A1121B8F6A443A643e40951',GRAPH='0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd',TREASURY='0xD88539d3c4C460136a733A3Fd60cf6BF269079da';
const FIRST_BUY=E/10n;
test('exact Native20 source: 1 billion tokens, buyer-funded liquidity and separate platform/reward fees',async t=>{
 await hre.network.provider.send('hardhat_reset');
 const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const owner=await provider.getSigner(0),alice=await provider.getSigner(1),helper=await provider.getSigner(2);
 const ownerAddress=await owner.getAddress(),aliceAddress=await alice.getAddress();
 assert.equal((await provider.getNetwork()).chainId,4663n);
 async function deploy(n,args=[]){const a=artifact(n),c=await new ContractFactory(a.abi,a.bytecode,owner).deploy(...args);await c.waitForDeployment();return c;}
 // Local EVM only: run the real PoolManager constructor AT its canonical address so immutable
 // NoDelegateCall/self bindings are correct. This is not a live chain fork or a graph-factory launch.
 const managerInit=(await new ContractFactory(artifact('PoolManager').abi,artifact('PoolManager').bytecode,owner).getDeployTransaction(ownerAddress)).data;
 await hre.network.provider.send('hardhat_setCode',[MANAGER,managerInit]);
 const runtime=await provider.call({from:ownerAddress,to:MANAGER});
 await(await owner.sendTransaction({to:MANAGER,gasLimit:5_000_000})).wait();
 await hre.network.provider.send('hardhat_setCode',[MANAGER,runtime]);
 const manager=new Contract(MANAGER,artifact('PoolManager').abi,owner);
 const reward=await deploy('UnderwaterDistributor',[ownerAddress]);
 const initializer=await deploy('RobinhoodNative20Initializer',[MANAGER,GRAPH]);
 const token=await deploy('RobinhoodNative20Token',[await initializer.getAddress(),'ROBINHOOD','ROBIN']);
 const factory=await deploy('Create2Deployer');
 const hookConfig={token:await token.getAddress(),lpFee:0,tickSpacing:60,initialSqrtPriceX96:1747735933952748037356115466503453n,
  initializer:await initializer.getAddress(),creatorFeeRecipient:await reward.getAddress(),creatorBuyFeeBps:180,creatorSellFeeBps:180,
  module:ZeroAddress,maxModuleLpFeePips:0};
 const code=(await new ContractFactory(artifact('RobinhoodNativeFeeHookV1').abi,artifact('RobinhoodNativeFeeHookV1').bytecode,owner).getDeployTransaction(MANAGER,hookConfig)).data;
 const hash=keccak256(code),factoryAddress=await factory.getAddress();let salt,hookAddress;
 for(let i=0;i<1_000_000;i++){salt=toBeHex(i,32);hookAddress=getCreate2Address(factoryAddress,salt,hash);if((BigInt(hookAddress)&0x3fffn)===0x20ccn)break;}
 await(await factory.deploy(salt,code)).wait();
 const hook=new Contract(hookAddress,artifact('RobinhoodNativeFeeHookV1').abi,owner);
 const feeVault=new Contract(await hook.feeVault(),artifact('RobinhoodNativeFeeVaultV1').abi,owner);
 const key={currency0:ZeroAddress,currency1:await token.getAddress(),fee:0,tickSpacing:60,hooks:hookAddress};
 const poolId=keccak256(AbiCoder.defaultAbiCoder().encode(['address','address','uint24','int24','address'],[ZeroAddress,key.currency1,0,60,hookAddress]));
 const swapper=await deploy('PoolSwapTest',[MANAGER]);
 await hre.network.provider.send('hardhat_impersonateAccount',[GRAPH]);await hre.network.provider.send('hardhat_setBalance',[GRAPH,toBeHex(10n*E)]);
 const graphSigner=new JsonRpcSigner(provider,GRAPH);
 const c={chainId:4663,token:key.currency1,hook:hookAddress,hookFlavor:'native20',initializer:await initializer.getAddress(),poolManager:MANAGER,
  distributor:await reward.getAddress(),poolId,excludedAddresses:[await swapper.getAddress()],
  deploymentBlock:(await token.deploymentTransaction().wait()).blockNumber,minimumAgeSeconds:3600,twapWindowSeconds:1800,maxOracleAgeSeconds:300};
 const launched=await(await initializer.connect(graphSigner).initialize(key.currency1,hookAddress,ownerAddress,1,{value:FIRST_BUY})).wait();
 await t.test('zero ETH seed; first real buy creates native reserves and locked token liquidity',async()=>{
  assert.equal(await token.totalSupply(),1_000_000_000n*E);assert.equal(await token.name(),'ROBINHOOD');assert.equal(await token.symbol(),'ROBIN');
  assert.equal(await initializer.initialBuyWei(),FIRST_BUY);assert.ok(await initializer.seededTokenAmount()>0n);
  assert.ok(await initializer.lockedLiquidity()>0n);assert.ok(await token.balanceOf(ownerAddress)>0n);
  assert.equal(BigInt(await hre.network.provider.send('eth_getBalance',[MANAGER,'latest'])),FIRST_BUY);
  assert.equal(await feeVault.creatorAccrued(),FIRST_BUY*180n/10000n);
  assert.equal(await feeVault.platformAccrued(),FIRST_BUY*20n/10000n);
  const evidence={schemaVersion:'robin.local-launch-simulation.v1',chain:'local EVM configured as 4663',
   liveQuote:false,graphFactorySimulated:true,buyerIsLocalTestAccount:true,minimumTokensOutIsTestOnly:true,
   firstBuyWei:FIRST_BUY.toString(),buyerTokensRaw:(await token.balanceOf(ownerAddress)).toString(),
   projectFeeWei:(await feeVault.creatorAccrued()).toString(),platformFeeWei:(await feeVault.platformAccrued()).toString(),
   initializationGasUsed:launched.gasUsed.toString(),gasExcludesDeploymentAndPlatformGraph:true};
  fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/local-launch-simulation.json',JSON.stringify(evidence,null,2));
  assert.equal(initializer.interface.getFunction('withdraw'),null);
  await assert.rejects(initializer.connect(graphSigner).initialize(key.currency1,hookAddress,ownerAddress,1,{value:E/1000n}));
 });
 await t.test('initial buy decoder distinguishes seed inventory from user purchase',()=>{
  const norm=normalizeNative20Receipt(launched,c),decoded=decodeReceipt(norm.receipt,{...c,time:0});
  assert.equal(decoded.supported,true);assert.equal(decoded.events[0].account,ownerAddress.toLowerCase());
  assert.equal(decoded.events[0].costWei,FIRST_BUY);
 });
 async function swap(who,buy,amount,value=0n){return(await swapper.connect(who).swap(key,{zeroForOne:buy,amountSpecified:amount,
  sqrtPriceLimitX96:buy?4295128740n:1461446703485210103287273052203988822378723970341n},
  {takeClaims:false,settleUsingBurn:false},'0x',{value})).wait();}
 await(await token.approve(await swapper.getAddress(),MaxUint256)).wait();
 await swap(owner,true,-E,E);await swap(alice,true,-E/1000n,E/1000n);
 await swap(owner,false,-(await token.balanceOf(ownerAddress))/2n);
 const automationBase=await hre.network.provider.send('evm_snapshot');
 await t.test('creator fees fund the reward contract; platform fee stays in its separate ledger',async()=>{
  const creator=await feeVault.creatorAccrued(),platform=await feeVault.platformAccrued();assert.ok(creator>0n&&platform>0n);
  const before=BigInt(await hre.network.provider.send('eth_getBalance',[TREASURY,'latest']));
  await(await feeVault.connect(helper).claimCreator()).wait();assert.equal(await reward.available(),creator);
  assert.equal(await feeVault.platformAccrued(),platform);
  await(await feeVault.connect(helper).claimPlatform()).wait();
  assert.equal(BigInt(await hre.network.provider.send('eth_getBalance',[TREASURY,'latest']))-before,platform);
  assert.equal(await feeVault.creatorRecipient(),await reward.getAddress());
  assert.equal(await hook.creatorBuyFeeBps(),180n);assert.equal(await hook.creatorSellFeeBps(),180n);
 });
 await t.test('canonical swap history feeds the same automatic loss and payout engine',async()=>{
  await hre.network.provider.send('evm_increaseTime',[3700]);await hre.network.provider.send('evm_mine');
  const snapshot=await buildSnapshot(provider,c),ledger=LossLedger.restore(snapshot.ledger);
  assert.equal(ledger.get(aliceAddress).balance,await token.balanceOf(aliceAddress));
  assert.equal(ledger.get(aliceAddress).cost,E/1000n);
  const plan=ledger.plan(await reward.available(),{...snapshot.oracle,now:snapshot.checkpoint.timestamp});
  const allocation=plan.allocations.find(a=>a.account===aliceAddress.toLowerCase());assert.ok(allocation?.amount>0n);
  const before=BigInt(await hre.network.provider.send('eth_getBalance',[aliceAddress,'latest']));
  await(await reward.distribute(keccak256('0x1234'),plan.auditHash,plan.allocations.map(a=>a.account),plan.allocations.map(a=>a.amount))).wait();
  assert.equal(BigInt(await hre.network.provider.send('eth_getBalance',[aliceAddress,'latest']))-before,allocation.amount);
 });
 await hre.network.provider.send('evm_revert',[automationBase]);
 await hre.network.provider.send('evm_increaseTime',[3700]);await hre.network.provider.send('evm_mine');
 const automationConfig={...c,maxSnapshotAgeSeconds:300,maxFinalityLagSeconds:7200,batchSize:100,
  execution:{mode:'local-only',feeVault:await feeVault.getAddress(),maxGasPerTransactionWei:(E/100n).toString(),maxTotalGasWei:E.toString(),
   minimumHarvestWei:'1',minimumBatchWei:'1',retryIntervalSeconds:3600,codeHashes:{}}};
 for(const name of ['token','hook','distributor','feeVault'])automationConfig.execution.codeHashes[name]=keccak256(await provider.getCode(name==='feeVault'?await feeVault.getAddress():automationConfig[name]));
 // This is Hardhat's public fixture mnemonic, never a live user wallet.
 const localSigner=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
 assert.equal(localSigner.address,ownerAddress);
 let localTime=(await provider.getBlock('latest')).timestamp;const realNow=Date.now;Date.now=()=>localTime*1000;
 let executionBase=await hre.network.provider.send('evm_snapshot');
 async function resetExecutor(){await hre.network.provider.send('evm_revert',[executionBase]);executionBase=await hre.network.provider.send('evm_snapshot');
  localTime=(await provider.getBlock('latest')).timestamp;fs.mkdirSync('output/test',{recursive:true});return fs.mkdtempSync('output/test/executor-');}
 try{
  await t.test('executor harvests and pays automatically, then restart reconciles allocation exactly once',async()=>{
   const dir=await resetExecutor();const before=await provider.getBalance(aliceAddress);
   const harvest=await executeCycle(provider,localSigner,automationConfig,dir);assert.equal(harvest.kind,'harvest');assert.equal(harvest.state,'submitted');
   const recovered=await executeCycle(provider,localSigner,automationConfig,dir);assert.equal(recovered.state,'confirmed');
   const payout=await executeCycle(provider,localSigner,automationConfig,dir);assert.equal(payout.kind,'payout');assert.equal(payout.state,'submitted');
   assert.equal((await executeCycle(provider,localSigner,automationConfig,dir)).state,'confirmed');
   assert.ok(await provider.getBalance(aliceAddress)>before);
   const snapshot=await buildSnapshot(provider,automationConfig),ledger=LossLedger.restore(snapshot.ledger);
   assert.ok(ledger.get(aliceAddress).relief>0n);
   const next=await executeCycle(provider,localSigner,automationConfig,dir);assert.equal(next.state,'idle');
   const journal=JSON.parse(fs.readFileSync(`${dir}/journal.json`)).state;assert.equal(journal.history.length,2);assert.equal(journal.pending,null);
  });
  await t.test('broadcast timeout after mining is recovered from the saved hash without paying twice',async()=>{
   const dir=await resetExecutor();let sends=0;
   const uncertain=new Proxy(provider,{get(target,prop){if(prop==='broadcastTransaction')return async raw=>{sends++;await target.broadcastTransaction(raw);throw Error('Simulated lost RPC response');};
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
   assert.equal((await executeCycle(uncertain,localSigner,automationConfig,dir)).state,'broadcast-uncertain');
   assert.equal((await executeCycle(uncertain,localSigner,automationConfig,dir)).state,'confirmed');assert.equal(sends,1);
  });
  await t.test('executor rejects a different operator, gas overspend and non-local execution',async()=>{
   const dir=await resetExecutor();const wrong=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/1");
   await assert.rejects(executeCycle(provider,wrong,automationConfig,dir),/operator signer/);
   await assert.rejects(executeCycle(provider,localSigner,{...automationConfig,execution:{...automationConfig.execution,maxGasPerTransactionWei:'1'}},dir),/gas budget/);
   await assert.rejects(executeCycle(provider,localSigner,{...automationConfig,execution:{...automationConfig.execution,mode:'live'}},dir),/local EVM/);
   assert.equal(fs.existsSync(`${dir}/journal.json`),false);
  });
  await t.test('lost broadcast before acceptance reuses the exact saved signed transaction',async()=>{
   const dir=await resetExecutor();
   const offline=new Proxy(provider,{get(target,prop){if(prop==='broadcastTransaction')return async()=>{throw Error('Simulated dropped request');};
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
   const first=await executeCycle(offline,localSigner,automationConfig,dir);assert.equal(first.state,'broadcast-uncertain');
   const saved=JSON.parse(fs.readFileSync(`${dir}/journal.json`)).state;
   const retry=await executeCycle(provider,localSigner,automationConfig,dir);assert.equal(retry.state,'rebroadcast');assert.equal(retry.hash,first.hash);
   const after=JSON.parse(fs.readFileSync(`${dir}/journal.json`)).state;
   assert.equal(after.pending.raw,saved.pending.raw);assert.equal(after.reservedGasWei,saved.reservedGasWei);
   assert.equal((await executeCycle(provider,localSigner,automationConfig,dir)).state,'confirmed');
  });
  await t.test('a mined transaction must finalize before a subsequent reward can be signed',async()=>{
   const dir=await resetExecutor();const first=await executeCycle(provider,localSigner,automationConfig,dir);
   const receipt=await provider.getTransactionReceipt(first.hash),oldFinalized=await provider.getBlock(receipt.blockNumber-1);
   const lagging=new Proxy(provider,{get(target,prop){if(prop==='getBlock')return async tag=>tag==='finalized'?oldFinalized:target.getBlock(tag);
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
   assert.equal((await executeCycle(lagging,localSigner,automationConfig,dir)).state,'waiting-for-finality');
   const journal=JSON.parse(fs.readFileSync(`${dir}/journal.json`)).state;assert.equal(journal.pending.hash,first.hash);assert.equal(journal.history.length,0);
   assert.equal((await executeCycle(provider,localSigner,automationConfig,dir)).state,'confirmed');
  });
  await t.test('a transfer during gas estimation discards the candidate before it is signed',async()=>{
   const dir=await resetExecutor();await(await feeVault.claimCreator()).wait();
   const racing=new Proxy(provider,{get(target,prop){if(prop==='estimateGas')return async request=>{const units=await target.estimateGas(request);
     await(await token.connect(alice).transfer(await helper.getAddress(),1n)).wait();return units;};
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
   assert.equal((await executeCycle(racing,localSigner,automationConfig,dir)).state,'idle');
   const journal=JSON.parse(fs.readFileSync(`${dir}/journal.json`)).state;assert.equal(journal.pending,null);assert.equal(journal.reservedGasWei,'0');
  });
  await t.test('failed ETH receiver keeps credit and automatic retry does not allocate twice',async()=>{
   const dir=await resetExecutor(),reject=await deploy('RejectEther'),recipient=await reject.getAddress();
   await(await token.connect(alice).transfer(recipient,(await token.balanceOf(aliceAddress))/2n)).wait();
   await hre.network.provider.send('evm_increaseTime',[3700]);await hre.network.provider.send('evm_mine');localTime=(await provider.getBlock('latest')).timestamp;
   assert.equal((await executeCycle(provider,localSigner,automationConfig,dir)).kind,'harvest');
   await executeCycle(provider,localSigner,automationConfig,dir);
   assert.equal((await executeCycle(provider,localSigner,automationConfig,dir)).kind,'payout');
   await executeCycle(provider,localSigner,automationConfig,dir);
   const pending=await reward.pending(recipient);assert.ok(pending>0n);
   const snapshot=await buildSnapshot(provider,automationConfig),relief=LossLedger.restore(snapshot.ledger).get(recipient).relief;
   assert.equal((await executeCycle(provider,localSigner,automationConfig,dir)).kind,'retry');
   await executeCycle(provider,localSigner,automationConfig,dir);
   assert.equal(await reward.pending(recipient),pending);
   assert.equal(LossLedger.restore((await buildSnapshot(provider,automationConfig)).ledger).get(recipient).relief,relief);
   assert.equal((await executeCycle(provider,localSigner,automationConfig,dir)).state,'idle');
   for(let retry=1;retry<3;retry++){
    await hre.network.provider.send('evm_increaseTime',[automationConfig.execution.retryIntervalSeconds+1]);await hre.network.provider.send('evm_mine');
    localTime=(await provider.getBlock('latest')).timestamp;
    assert.equal((await executeCycle(provider,localSigner,automationConfig,dir)).kind,'retry');
    await executeCycle(provider,localSigner,automationConfig,dir);
   }
   await hre.network.provider.send('evm_increaseTime',[automationConfig.execution.retryIntervalSeconds+1]);await hre.network.provider.send('evm_mine');
   localTime=(await provider.getBlock('latest')).timestamp;
   const before=JSON.parse(fs.readFileSync(`${dir}/journal.json`)).state;
   assert.equal((await executeCycle(provider,localSigner,automationConfig,dir)).state,'idle');
   const after=JSON.parse(fs.readFileSync(`${dir}/journal.json`)).state;
   assert.equal(after.retryAttempts[recipient.toLowerCase()],3);assert.equal(after.reservedGasWei,before.reservedGasWei);
   assert.ok(BigInt(after.retryGasWei)<=BigInt(automationConfig.execution.maxTotalGasWei)/10n);
   assert.equal(await reward.pending(recipient),pending);
  });
  await t.test('journal edits are rejected instead of trusting a modified pending transaction',async()=>{
   const dir=await resetExecutor();await executeCycle(provider,localSigner,automationConfig,dir);
   const file=`${dir}/journal.json`,journal=JSON.parse(fs.readFileSync(file));journal.state.reservedGasWei='0';fs.writeFileSync(file,JSON.stringify(journal));
   await assert.rejects(executeCycle(provider,localSigner,automationConfig,dir),/journal integrity/);
  });
  await t.test('a round continues across batches and restarts until every eligible holder is paid',async()=>{
   const dir=await resetExecutor(),helperAddress=await helper.getAddress();
   await(await token.connect(alice).transfer(helperAddress,(await token.balanceOf(aliceAddress))/2n)).wait();
   await hre.network.provider.send('evm_increaseTime',[3700]);await hre.network.provider.send('evm_mine');localTime=(await provider.getBlock('latest')).timestamp;
   const config={...automationConfig,batchSize:1};
   await executeCycle(provider,localSigner,config,dir);await executeCycle(provider,localSigner,config,dir);
   const before=new Map(await Promise.all([aliceAddress,helperAddress].map(async a=>[a.toLowerCase(),await provider.getBalance(a)])));
   const first=await executeCycle(provider,localSigner,config,dir);assert.equal(first.kind,'payout');
   const initialRound=JSON.parse(fs.readFileSync(`${dir}/journal.json`)).state.round;assert.ok(initialRound.allocations.length>=2);
   const hashes=[first.hash];
   await executeCycle(provider,localSigner,config,dir);
   for(let i=1;i<initialRound.allocations.length;i++){
    const next=await executeCycle(provider,localSigner,config,dir);assert.equal(next.kind,'payout');hashes.push(next.hash);
    await executeCycle(provider,localSigner,config,dir);
   }
   assert.equal(new Set(hashes).size,initialRound.allocations.length);
   const allocations=new Map();
   for(const hash of hashes)for(const log of (await provider.getTransactionReceipt(hash)).logs){
    let p;try{p=reward.interface.parseLog(log);}catch{}if(p?.name==='RewardAllocated')allocations.set(p.args.recipient.toLowerCase(),p.args.amount);
   }
   for(const entry of initialRound.allocations){assert.equal(allocations.get(entry.account),BigInt(entry.amount));
    if(before.has(entry.account))assert.equal((await provider.getBalance(entry.account))-before.get(entry.account),BigInt(entry.amount));}
   const journal=JSON.parse(fs.readFileSync(`${dir}/journal.json`)).state;assert.equal(journal.round,null);assert.equal(journal.history.length,1+initialRound.allocations.length);
   assert.equal((await executeCycle(provider,localSigner,config,dir)).state,'idle');
  });
  await t.test('onchain payout guard rejects sold balances and expired transactions atomically',async()=>{
   await resetExecutor();await(await feeVault.claimCreator()).wait();
   const balance=await token.balanceOf(aliceAddress),batch=keccak256('0xaabb'),audit=keccak256('0xccdd');
   await(await token.connect(alice).transfer(await helper.getAddress(),1n)).wait();
   await assert.rejects(reward.distributeGuarded(batch,audit,await token.getAddress(),localTime+300,[aliceAddress],[1n],[balance]),/Holder balance changed/);
   await assert.rejects(reward.distributeGuarded(batch,audit,await token.getAddress(),1,[aliceAddress],[1n],[balance-1n]),/Expired payout/);
   assert.equal(await reward.processed(batch),false);
  });
  await t.test('eligible payout accepts incoming dust and skips only recipients whose balance fell',async()=>{
   await resetExecutor();await(await feeVault.claimCreator()).wait();
   const helperAddress=await helper.getAddress(),original=await token.balanceOf(aliceAddress);
   await(await token.connect(alice).transfer(helperAddress,original/4n)).wait();
   const expectedAlice=await token.balanceOf(aliceAddress),expectedHelper=await token.balanceOf(helperAddress);
   // Alice sends one unit after the measured checkpoint; helper receives it.
   await(await token.connect(alice).transfer(helperAddress,1n)).wait();
   const rows=[{account:aliceAddress,balance:expectedAlice},{account:helperAddress,balance:expectedHelper}].sort((a,b)=>a.account.toLowerCase().localeCompare(b.account.toLowerCase()));
   const batch=keccak256('0xe111'),audit=keccak256('0xe222'),before=await reward.available();
   const receipt=await(await reward.distributeEligible(batch,audit,await token.getAddress(),localTime+300,rows.map(r=>r.account),[11n,11n],rows.map(r=>r.balance))).wait();
   const logs=receipt.logs.map(l=>{try{return reward.interface.parseLog(l);}catch{return null;}}).filter(Boolean);
   assert.deepEqual(logs.filter(l=>l.name==='RewardAllocated').map(l=>l.args.recipient),[helperAddress]);
   assert.deepEqual(logs.filter(l=>l.name==='RewardSkipped').map(l=>l.args.recipient),[aliceAddress]);
   assert.equal(before-await reward.available(),11n);assert.equal(await reward.processed(batch),true);
   await assert.rejects(reward.distributeEligible(batch,audit,await token.getAddress(),localTime+300,rows.map(r=>r.account),[11n,11n],rows.map(r=>r.balance)),/Already processed/);
   const second=keccak256('0xe333'),remaining=await reward.available();
   const empty=await(await reward.distributeEligible(second,audit,await token.getAddress(),localTime+300,[aliceAddress],[11n],[expectedAlice])).wait();
   assert.equal(await reward.available(),remaining);assert.equal(await reward.processed(second),true);
   const replayed=await buildSnapshot(provider,c);const allocations=LossLedger.restore(replayed.ledger);
   assert.ok(allocations.get(helperAddress).relief>=11n,'only actual allocations enter reward accounting');
   const parsed=empty.logs.map(l=>{try{return reward.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='BatchRecorded');
   assert.equal(parsed.args.total,0n);
  });
 }finally{Date.now=realNow;}
});

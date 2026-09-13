import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import hre from 'hardhat';
import {BrowserProvider,ContractFactory,Contract,ZeroAddress,ZeroHash,MaxUint256,keccak256,getCreate2Address,toBeHex,id,AbiCoder} from 'ethers';
import {decodeReceipt} from '../src/receipt-adapter.mjs';
import {LossLedger} from '../src/ledger.mjs';
import {buildSnapshot} from '../src/replay.mjs';
import {runCycle} from '../src/worker.mjs';
import {preparePlan} from '../src/payout-plan.mjs';
const E=10n**18n,MIN=4295128740n,MAX=1461446703485210103287273052203988822378723970341n;
function artifact(n){return JSON.parse(fs.readFileSync(`artifacts/${n}.json`));}
test('real Uniswap v4 PoolManager integration and funded ETH distribution',async t=>{
 await hre.network.provider.send('hardhat_reset');
 const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const admin=await provider.getSigner(0),trader=await provider.getSigner(1),other=await provider.getSigner(2);
 const adminAddress=await admin.getAddress(),traderAddress=await trader.getAddress(),otherAddress=await other.getAddress();
 async function deploy(n,args=[]){const a=artifact(n);const c=await new ContractFactory(a.abi,a.bytecode,admin).deploy(...args);await c.waitForDeployment();return c;}
 const token=await deploy('SherwoodToken',['ROBINHOOD','ROBIN',1_000_000n*E,adminAddress]);
 const manager=await deploy('PoolManager',[adminAddress]);
 const vault=await deploy('UnderwaterDistributor',[adminAddress]);
 const factory=await deploy('Create2Deployer');
 const args=[await manager.getAddress(),await token.getAddress(),await vault.getAddress(),60];
 const code=(await new ContractFactory(artifact('UnderwaterHook').abi,artifact('UnderwaterHook').bytecode,admin).getDeployTransaction(...args)).data;
 const codeHash=keccak256(code),factoryAddress=await factory.getAddress();let salt,hookAddress;
 for(let i=0;i<1_000_000;i++) {salt=toBeHex(i,32);hookAddress=getCreate2Address(factoryAddress,salt,codeHash);if((BigInt(hookAddress)&0x3fffn)===0x30ccn)break;}
 assert.equal(BigInt(hookAddress)&0x3fffn,0x30ccn);
 await (await factory.deploy(salt,code)).wait();
 const hook=new Contract(hookAddress,artifact('UnderwaterHook').abi,admin);
 const swapper=await deploy('PoolSwapTest',[args[0]]),liquidity=await deploy('PoolModifyLiquidityTest',[args[0]]);
 const key={currency0:ZeroAddress,currency1:args[1],fee:0,tickSpacing:60,hooks:hookAddress};
 const poolId=keccak256(AbiCoder.defaultAbiCoder().encode(['address','address','uint24','int24','address'],[ZeroAddress,args[1],0,60,hookAddress]));
 await(await manager.initialize(key,1n<<96n)).wait();
 await(await token.approve(await liquidity.getAddress(),MaxUint256)).wait();
 await(await liquidity['modifyLiquidity((address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)'](
  key,{tickLower:-600,tickUpper:600,liquidityDelta:1000n*E,salt:ZeroHash},'0x',{value:100n*E})).wait();
 await(await token.transfer(traderAddress,100n*E)).wait();
 await(await token.connect(trader).approve(await swapper.getAddress(),MaxUint256)).wait();
 const base=await hre.network.provider.send('evm_snapshot');let checkpoint=base;
 async function reset(){await hre.network.provider.send('evm_revert',[checkpoint]);checkpoint=await hre.network.provider.send('evm_snapshot');}
 async function swap(buy,amount,value=0n,limit=buy?MIN:MAX){return (await swapper.connect(trader).swap(key,
  {zeroForOne:buy,amountSpecified:amount,sqrtPriceLimitX96:limit},{takeClaims:false,settleUsingBurn:false},'0x',{value})).wait();}
 function observation(receipt){return receipt.logs.map(l=>{try{return hook.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='TradeObserved').args;}
 for(const [name,buy,amount,value] of [
  ['exact-input buy',true,-E,E],['exact-output buy',true,E,2n*E],
  ['exact-input sell',false,-E,0n],['exact-output sell',false,E/2n,0n]
 ])await t.test(name+' charges exactly one fixed fee and settles all PoolManager deltas',async()=>{
  await reset();const receipt=await swap(buy,amount,value),o=observation(receipt);
  assert.equal(o.feeNative,(o.grossNative+49n)/50n);
  assert.equal(await manager.balanceOf(hookAddress,0),o.feeNative);
  const decoded=decodeReceipt(receipt,{token:args[1],hook:hookAddress,poolManager:args[0],poolId,time:100});
  assert.equal(decoded.supported,true);assert.equal(decoded.events[0].account,traderAddress.toLowerCase());
  assert.equal(decoded.events[0].type,buy?'buy':'sell');
  if(buy)assert.equal(decoded.events[0].costWei,o.grossNative);
  await(await hook.connect(other).harvest()).wait();
  assert.equal(await vault.available(),o.feeNative);assert.equal(await manager.balanceOf(hookAddress,0),0n);
 });
 await t.test('partial fill reverts atomically without collecting fees',async()=>{
  await reset();const balance=await token.balanceOf(traderAddress);
  await assert.rejects(swap(true,-E,E,(1n<<96n)-1n));
  assert.equal(await manager.balanceOf(hookAddress,0),0n);assert.equal(await token.balanceOf(traderAddress),balance);
 });
 await t.test('direct callback, wrong pool and bad hook address are rejected',async()=>{
  await reset();await assert.rejects(hook.beforeInitialize(adminAddress,key,1n<<96n));
  await assert.rejects(hook.unlockCallback('0x'));
  await assert.rejects(manager.initialize({...key,fee:100},1n<<96n));
  await assert.rejects(deploy('UnderwaterHook',args));
 });
 await t.test('plain ERC20 transfers remain available and untaxed',async()=>{
  await reset();await(await token.connect(trader).transfer(otherAddress,E)).wait();
  assert.equal(await token.balanceOf(otherAddress),E);assert.equal(await token.totalSupply(),1_000_000n*E);
  assert.equal(token.interface.getFunction('mint'),null);assert.equal(token.interface.getFunction('pause'),null);
 });
 await t.test('ordinary buy -> price falls -> decoded loss -> fee harvest -> automatic wallet payout',async()=>{
  await reset();
  const receipt=await(await swapper.connect(other).swap(key,{zeroForOne:true,amountSpecified:-E,sqrtPriceLimitX96:MIN},
   {takeClaims:false,settleUsingBurn:false},'0x',{value:E})).wait();
  const ledger=new LossLedger({minimumAgeSeconds:0});
  for(const e of decodeReceipt(receipt,{token:args[1],hook:hookAddress,poolManager:args[0],poolId,time:100}).events)ledger.apply(e);
  const sell=await swap(false,-10n*E),o=observation(sell);
  const price=((1n<<192n)*E)/(o.sqrtPriceX96*o.sqrtPriceX96);
  await(await hook.harvest()).wait();
  const plan=ledger.plan(await vault.available(),{priceWeiPerToken:price,observedAt:200,now:200});
  assert.equal(plan.allocations.length,1);assert.equal(plan.allocations[0].account,otherAddress.toLowerCase());
  assert.ok(plan.allocated>0n&&plan.allocated<=plan.totalLoss);
  const before=BigInt(await hre.network.provider.send('eth_getBalance',[otherAddress,'latest']));
  await(await vault.distribute(id('end-to-end'),plan.auditHash,plan.allocations.map(a=>a.account),plan.allocations.map(a=>a.amount))).wait();
  const after=BigInt(await hre.network.provider.send('eth_getBalance',[otherAddress,'latest']));
  assert.equal(after-before,plan.allocated);
  ledger.acknowledge('end-to-end',plan.allocations);
  assert.ok(ledger.plan(E,{priceWeiPerToken:price,observedAt:200,now:200}).totalLoss<plan.totalLoss);
 });
 await t.test('automatic payouts preserve failed-recipient credit and cannot replay or overspend',async()=>{
  await reset();const reject=await deploy('RejectEther'),rejectAddress=await reject.getAddress();
  await(await admin.sendTransaction({to:args[2],value:E})).wait();
  const recipients=[traderAddress,rejectAddress].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),amounts=recipients.map(()=>E/4n);
  const batch=id('batch'),audit=id('audited input');
  const before=BigInt(await hre.network.provider.send('eth_getBalance',[traderAddress,'latest']));
  await assert.rejects(vault.connect(other).distribute(batch,audit,recipients,amounts));
  await(await vault.distribute(batch,audit,recipients,amounts)).wait();
  const after=BigInt(await hre.network.provider.send('eth_getBalance',[traderAddress,'latest']));
  assert.equal(after-before,E/4n);assert.equal(await vault.pending(rejectAddress),E/4n);
  assert.equal(await vault.reserved(),E/4n);assert.equal(await vault.available(),E/2n);
  await assert.rejects(vault.distribute(batch,audit,recipients,amounts));
  await assert.rejects(vault.distribute(id('overspend'),audit,[traderAddress],[E]));
  await(await vault.connect(other).pay(rejectAddress)).wait();assert.equal(await vault.reserved(),E/4n);
 });
 await t.test('background worker replays chain history, prepares rewards, survives restart and sees payment',async()=>{
  await reset();
  const receipt=await(await swapper.connect(other).swap(key,{zeroForOne:true,amountSpecified:-E,sqrtPriceLimitX96:MIN},
   {takeClaims:false,settleUsingBurn:false},'0x',{value:E})).wait();
  await swap(false,-10n*E);await(await hook.harvest()).wait();
  await hre.network.provider.send('evm_increaseTime',[3700]);await hre.network.provider.send('evm_mine');
  const c={chainId:31337,token:args[1],hook:hookAddress,poolManager:args[0],distributor:args[2],poolId,
   deploymentBlock:(await token.deploymentTransaction().wait()).blockNumber,
   excludedAddresses:[await swapper.getAddress(),await liquidity.getAddress()],minimumAgeSeconds:3600,
   twapWindowSeconds:1800,maxOracleAgeSeconds:300,maxSnapshotAgeSeconds:300,maxFinalityLagSeconds:7200,batchSize:100};
  // Local EVM time was advanced; pin wall-clock only for freshness checks in this isolated test.
  const realNow=Date.now;const current=await provider.getBlock('latest');Date.now=()=>current.timestamp*1000;
  try{
   fs.mkdirSync('output/test',{recursive:true});const dir=fs.mkdtempSync('output/test/worker-');
   const first=await runCycle(provider,c,dir);assert.equal(first.state,'prepared',JSON.stringify(first));
   const same=await runCycle(provider,c,dir);assert.equal(same.state,'unchanged');
   const prepared=JSON.parse(fs.readFileSync(first.planFile));assert.equal(prepared.transactions.length,1);
   assert.ok(prepared.plan.allocations.some(a=>a.account===otherAddress.toLowerCase()));
   const tx=prepared.transactions[0],decoded=vault.interface.parseTransaction({data:tx.data});
   assert.equal(prepared.schemaVersion,'robin.payout-plan.v2');
   assert.equal(decoded.name,'distributeEligible');assert.equal(decoded.args[2].toLowerCase(),c.token.toLowerCase());
   assert.equal(decoded.args[3],BigInt(prepared.expiresAt));
   const beforeExpiry=await hre.network.provider.send('evm_snapshot');
   await hre.network.provider.send('evm_increaseTime',[301]);await hre.network.provider.send('evm_mine');
   await assert.rejects(admin.sendTransaction({to:tx.to,data:tx.data,value:0}),/Expired payout/);
   await hre.network.provider.send('evm_revert',[beforeExpiry]);
   await(await admin.sendTransaction({to:tx.to,data:tx.data,value:0})).wait();
   const snapshot=await buildSnapshot(provider,c);
   const rebuilt=LossLedger.restore(snapshot.ledger);assert.ok(rebuilt.get(otherAddress).relief>0n);
   const incremental=await buildSnapshot(provider,c,snapshot);assert.equal(incremental.transactionsReplayed,0);
   assert.equal(incremental.ledger,snapshot.ledger);
   await assert.rejects(preparePlan(provider,c,{...snapshot,generatedAt:0},{now:current.timestamp}),/stale/);
   const corrupt={...snapshot,ledger:JSON.stringify({...JSON.parse(snapshot.ledger),checkpoint:{...snapshot.checkpoint,blockHash:ZeroHash}})};
   await assert.rejects(buildSnapshot(provider,c,corrupt),/history changed/);
  }finally{Date.now=realNow;}
 });
});

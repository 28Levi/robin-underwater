import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {Contract,ContractFactory,AbiCoder,ZeroAddress,ZeroHash,MaxUint256,keccak256} from 'ethers';
import {native20Fixture,E,MANAGER} from './helpers/native20-fixture.mjs';
import {normalizeNative20Receipt,poolInterface} from '../src/native20-adapter.mjs';
import {decodeReceipt} from '../src/receipt-adapter.mjs';
process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');const {default:hre}=await import('hardhat');
const abi=AbiCoder.defaultAbiCoder(),poolTuple='tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const swapTuple=`tuple(${poolTuple} poolKey,bool zeroForOne,uint128 amount,uint128 bound,bytes hookData)`;
const PERMIT2='0x000000000022D473030F116dDEE9F6B43aC78BA3';

for(const liveRuntime of [false,true])test(liveRuntime?'Robinhood deployed router and Permit2 runtime replayed locally':'published Universal Router 2.1.0 with real Permit2 and canonical Native20 fees',async t=>{
 const f=await native20Fixture(hre),{provider,owner,alice,token,key,hook,c}=f;
 const verified=JSON.parse(fs.readFileSync('research/permit2-sourcify.json'));
 const provenance=JSON.parse(fs.readFileSync('research/router-test-provenance.json'));
 assert.equal(verified.runtimeMatch,'match');assert.equal(verified.chainId,'1');assert.equal(verified.address.toLowerCase(),PERMIT2.toLowerCase());
 const cap=liveRuntime?JSON.parse(fs.readFileSync('research/current/capabilities.json')):null;
 const permitCode=liveRuntime?fs.readFileSync('research/current/permit2-runtime.txt','utf8'):verified.runtimeBytecode.onchainBytecode;
 if(liveRuntime)assert.equal(keccak256(permitCode),cap.chainDeployment.contracts.permit2.runtimeCodeHash);
 await hre.network.provider.send('hardhat_setCode',[PERMIT2,permitCode]);
 const permit=new Contract(PERMIT2,verified.abi,owner);
 const a=JSON.parse(fs.readFileSync('node_modules/@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json'));
 assert.equal(keccak256(a.bytecode),provenance.routerCreationBytecodeHash);
 assert.equal(keccak256(verified.runtimeBytecode.onchainBytecode),provenance.permit2RuntimeHash);
 let router;
 if(liveRuntime){const deployed=cap.chainDeployment.contracts.universalRouter,code=fs.readFileSync('research/current/universalRouter-runtime.txt','utf8');
  assert.equal(keccak256(code),deployed.runtimeCodeHash);
  await hre.network.provider.send('hardhat_setCode',[deployed.address,code]);router=new Contract(deployed.address,a.abi,owner);
 }else router=await new ContractFactory(a.abi,a.bytecode,owner).deploy({permit2:PERMIT2,weth9:ZeroAddress,v2Factory:ZeroAddress,v3Factory:ZeroAddress,
  pairInitCodeHash:ZeroHash,poolInitCodeHash:ZeroHash,v4PoolManager:MANAGER,v3NFTPositionManager:ZeroAddress,v4PositionManager:ZeroAddress,spokePool:ZeroAddress});
 await router.waitForDeployment();const routerAddress=await router.getAddress();
 c.excludedAddresses.push(routerAddress,PERMIT2);
 for(const who of [owner,alice]){await(await token.connect(who).approve(PERMIT2,MaxUint256)).wait();
  await(await permit.connect(who).approve(c.token,routerAddress,(1n<<160n)-1n,(1n<<48n)-1n)).wait();}
 await(await token.transfer(await alice.getAddress(),1_000_000n*E)).wait();
 let checkpoint=await hre.network.provider.send('evm_snapshot');
 const reset=async()=>{await hre.network.provider.send('evm_revert',[checkpoint]);checkpoint=await hre.network.provider.send('evm_snapshot');};
 async function execute(who,buy,exactIn,amount,bound,{custody=false}={}){
  const input=buy?ZeroAddress:c.token,output=buy?c.token:ZeroAddress;
  const params=[abi.encode([swapTuple],[[key,buy,amount,bound,'0x']]),abi.encode(['address','uint256'],[input,exactIn?amount:bound])];
  let actions=(exactIn?'06':'08')+'0c',commands='10';
  if(custody){actions+='0e';params.push(abi.encode(['address','address','uint256'],[output,routerAddress,0]));}
  else{actions+='0f';params.push(abi.encode(['address','uint256'],[output,exactIn?bound:amount]));}
  const inputs=[abi.encode(['bytes','bytes[]'],['0x'+actions,params])];
  if(custody){commands+='04';inputs.push(abi.encode(['address','address','uint256'],[output,await who.getAddress(),0]));}
  // Sweep excess ETH on exact-output buys; it is not part of the purchase cost.
  if(buy&&!exactIn){commands+='04';inputs.push(abi.encode(['address','address','uint256'],[ZeroAddress,await who.getAddress(),0]));}
  const deadline=(await provider.getBlock('latest')).timestamp+300;
  return(await router.connect(who)['execute(bytes,bytes[],uint256)']('0x'+commands,inputs,deadline,{value:buy?(exactIn?amount:bound):0n})).wait();
 }
 const cases=[['exact-input buy',true,true,E/1000n,1n],['exact-output buy',true,false,1000n*E,E/100n],
  ['exact-input sell through Permit2',false,true,1000n*E,1n],['exact-output sell through Permit2',false,false,1000000000000n,100000n*E]];
 for(const [name,buy,exactIn,amount,bound] of cases)await t.test(name,async()=>{
  await reset();const before=await provider.getBalance(await alice.getAddress());
  const r=await execute(alice,buy,exactIn,amount,bound),norm=normalizeNative20Receipt(r,c);
  const decoded=decodeReceipt(norm.receipt,{...c,time:0});assert.equal(decoded.supported,true);
  assert.equal(decoded.events[0].account,(await alice.getAddress()).toLowerCase());assert.equal(decoded.events[0].type,buy?'buy':'sell');
  const fee=r.logs.map(l=>{try{return hook.interface.parseLog(l);}catch{return null;}}).find(p=>p?.name==='NativeFeesAccrued').args;
  const core=r.logs.filter(l=>l.address.toLowerCase()===MANAGER.toLowerCase()).map(l=>{try{return poolInterface.parseLog(l);}catch{return null;}}).find(p=>p?.name==='Swap').args;
  const netNative=buy?-core.amount0:amount;
  const total=exactIn?(fee.grossNative*200n+9999n)/10000n:fee.grossNative-netNative;
  assert.equal(fee.platformFee,(fee.grossNative*20n+9999n)/10000n);
  // The reviewed kernel rounds the combined fee once; creator receives the remainder.
  assert.equal(fee.creatorFee,total-fee.platformFee);
  if(buy){assert.equal(decoded.events[0].costWei,fee.grossNative);
   assert.equal(before-(await provider.getBalance(await alice.getAddress()))-r.gasUsed*r.gasPrice,fee.grossNative);
   if(!exactIn)assert.ok(fee.grossNative<bound);}
  assert.equal(await provider.getBalance(routerAddress),0n);assert.equal(await token.balanceOf(routerAddress),0n);
 });
 await t.test('buy with router custody then sweep credits the final holder',async()=>{
  await reset();const r=await execute(alice,true,true,E/1000n,1n,{custody:true});
  const decoded=decodeReceipt(normalizeNative20Receipt(r,c).receipt,{...c,time:0});assert.equal(decoded.supported,true);
  assert.equal(decoded.events[0].account,(await alice.getAddress()).toLowerCase());
 });
 await t.test('impossible output bound reverts without creating fee or holder changes',async()=>{
  await reset();const before=await token.balanceOf(await alice.getAddress()),feesBefore=await f.feeVault.creatorAccrued();
  await assert.rejects(execute(alice,true,true,E/1000n,1_000_000_000n*E));
  assert.equal(await token.balanceOf(await alice.getAddress()),before);assert.equal(await f.feeVault.creatorAccrued(),feesBefore);
 });
 fs.mkdirSync('output',{recursive:true});fs.writeFileSync(liveRuntime?'output/live-runtime-compatibility.json':'output/router-compatibility.json',JSON.stringify({testedAt:new Date().toISOString(),
  routerPackage:'@uniswap/universal-router@2.1.0',routerCreationBytecodeHash:keccak256(a.bytecode),permit2RuntimeHash:keccak256(verified.runtimeBytecode.onchainBytecode),
  cases:cases.map(x=>x[0]).concat(['router custody then sweep','slippage rollback']),network:'local EVM',
  exactRobinhoodRuntimeTested:liveRuntime,liveChainTransactionSent:false,liveDeploymentSourceVerified:false,
  ...(liveRuntime?{runtimeHash:cap.chainDeployment.contracts.universalRouter.runtimeCodeHash,permit2DeployedRuntimeHash:keccak256(permitCode)}:{})},null,2));
});

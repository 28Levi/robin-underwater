import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {BrowserProvider,JsonRpcSigner,ContractFactory,Contract,ZeroAddress,MaxUint256,keccak256,getCreate2Address,toBeHex,AbiCoder} from 'ethers';
import {compileRobinLaunchContracts} from '../../src/launch-plan.mjs';
import {E,MANAGER,GRAPH,artifact} from './native20-fixture.mjs';

export {E,MANAGER,GRAPH};
export const ROUTER='0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99';
export const ROUTER_HASH='0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5';
export const MAIN_CONTROLLER='0x9479ac7ED3A72866F63F37013F2c7Cc68936B519';
const PERMIT2='0x000000000022D473030F116dDEE9F6B43aC78BA3';
const abi=AbiCoder.defaultAbiCoder();
const poolTuple='tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const swapTuple=`tuple(${poolTuple} poolKey,bool zeroForOne,uint128 amount,uint128 bound,bytes hookData)`;
let compiled;
function guardArtifact(){
 if(!compiled){
  const output=compileRobinLaunchContracts(process.cwd(),solc,{launchGuard:true});
  const c=output.contracts.RobinhookLaunchGuardHookV1;
  if(!c)throw Error('Compile plumbing must explicitly enable the launch guard artifact');
  compiled={abi:c.abi,bytecode:'0x'+c.evm.bytecode.object};
 }
 return compiled;
}
let spoofArtifact;
function getSpoofArtifact(){
 if(spoofArtifact)return spoofArtifact;
 const source=`pragma solidity ^0.8.26;
 import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
 import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
 contract SpoofBuyerRouter is PoolSwapTest {
  address private immutable fakeBuyer;
  constructor(IPoolManager manager,address fake) PoolSwapTest(manager){fakeBuyer=fake;}
  function msgSender() external view returns(address){return fakeBuyer;}
 }`;
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'SpoofBuyerRouter.sol':{content:source}},
  settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),
  {import:name=>{try{return {contents:fs.readFileSync(path.join('node_modules',name),'utf8')};}catch{return {error:'Missing local test dependency'};}}}));
 const errors=output.errors?.filter(e=>e.severity==='error')??[];
 if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
 const c=output.contracts['SpoofBuyerRouter.sol'].SpoofBuyerRouter;
 spoofArtifact={abi:c.abi,bytecode:'0x'+c.evm.bytecode.object};return spoofArtifact;
}

/** Local EVM only: exact pinned deployed router runtime, real pool/initializer/token. */
export async function launchGuardFixture(hre){
 const hookArtifact=guardArtifact();
 await hre.network.provider.send('hardhat_reset');
 const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const controller=await provider.getSigner(0),buyers=await Promise.all([1,2,3,4].map(i=>provider.getSigner(i))),outsider=await provider.getSigner(5);
 await hre.network.provider.send('hardhat_impersonateAccount',[MAIN_CONTROLLER]);
 await hre.network.provider.send('hardhat_setBalance',[MAIN_CONTROLLER,toBeHex(10n*E)]);
 buyers.push(new JsonRpcSigner(provider,MAIN_CONTROLLER));
 const controllerAddress=await controller.getAddress(),earlyBuyers=await Promise.all(buyers.map(b=>b.getAddress()));
 async function deploy(name,args=[]){const a=typeof name==='string'?artifact(name):name,c=await new ContractFactory(a.abi,a.bytecode,controller).deploy(...args);await c.waitForDeployment();return c;}
 const managerInit=(await new ContractFactory(artifact('PoolManager').abi,artifact('PoolManager').bytecode,controller).getDeployTransaction(controllerAddress)).data;
 await hre.network.provider.send('hardhat_setCode',[MANAGER,managerInit]);const runtime=await provider.call({from:controllerAddress,to:MANAGER});
 await(await controller.sendTransaction({to:MANAGER,gasLimit:5_000_000})).wait();await hre.network.provider.send('hardhat_setCode',[MANAGER,runtime]);
 const manager=new Contract(MANAGER,artifact('PoolManager').abi,controller);
 const reward=await deploy('UnderwaterDistributor',[controllerAddress]),initializer=await deploy('RobinhoodNative20Initializer',[MANAGER,GRAPH]);
 const token=await deploy('RobinhoodNative20Token',[await initializer.getAddress(),'ROBIN GUARD LOCAL','LOCAL']);
 const factory=await deploy('Create2Deployer');
 const config={token:await token.getAddress(),lpFee:0,tickSpacing:60,initialSqrtPriceX96:1747735933952748037356115466503453n,
  initializer:await initializer.getAddress(),creatorFeeRecipient:await reward.getAddress(),creatorBuyFeeBps:170,creatorSellFeeBps:170,module:ZeroAddress,maxModuleLpFeePips:0};
 const hookCode=(await new ContractFactory(hookArtifact.abi,hookArtifact.bytecode,controller).getDeployTransaction(MANAGER,config,earlyBuyers)).data;
 const codeHash=keccak256(hookCode),factoryAddress=await factory.getAddress();let salt,hookAddress;
 for(let i=0;i<1_000_000;i++){salt=toBeHex(i,32);hookAddress=getCreate2Address(factoryAddress,salt,codeHash);if((BigInt(hookAddress)&0x3fffn)===0x20ccn)break;}
 if((BigInt(hookAddress)&0x3fffn)!==0x20ccn)throw Error('Local hook salt search exhausted');
 await(await factory.deploy(salt,hookCode)).wait();
 const hook=new Contract(hookAddress,hookArtifact.abi,controller),feeVault=new Contract(await hook.feeVault(),artifact('RobinhoodNativeFeeVaultV1').abi,controller);
 const key={currency0:ZeroAddress,currency1:await token.getAddress(),fee:0,tickSpacing:60,hooks:hookAddress};
 const swapper=await deploy('PoolSwapTest',[MANAGER]);
 const spoofRouter=await deploy(getSpoofArtifact(),[MANAGER,earlyBuyers[0]]);
 const routerCode=fs.readFileSync('research/current/universalRouter-runtime.txt','utf8').trim();
 if(keccak256(routerCode)!==ROUTER_HASH)throw Error('Pinned router runtime changed');
 await hre.network.provider.send('hardhat_setCode',[ROUTER,routerCode]);
 const routerAbi=JSON.parse(fs.readFileSync('node_modules/@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json')).abi;
 const router=new Contract(ROUTER,routerAbi,controller);
 const permitArtifact=JSON.parse(fs.readFileSync('research/permit2-sourcify.json'));
 await hre.network.provider.send('hardhat_setCode',[PERMIT2,fs.readFileSync('research/current/permit2-runtime.txt','utf8').trim()]);
 const permit=new Contract(PERMIT2,permitArtifact.abi,controller);
 for(const who of [controller,...buyers,outsider]){
  await(await token.connect(who).approve(await swapper.getAddress(),MaxUint256)).wait();
  await(await token.connect(who).approve(await spoofRouter.getAddress(),MaxUint256)).wait();
  await(await token.connect(who).approve(PERMIT2,MaxUint256)).wait();
  await(await permit.connect(who).approve(key.currency1,ROUTER,(1n<<160n)-1n,(1n<<48n)-1n)).wait();
 }
 await hre.network.provider.send('hardhat_impersonateAccount',[GRAPH]);await hre.network.provider.send('hardhat_setBalance',[GRAPH,toBeHex(10n*E)]);
 const graphSigner=new JsonRpcSigner(provider,GRAPH);
 const launch=async(buyer=MAIN_CONTROLLER)=>(await initializer.connect(graphSigner).initialize(key.currency1,hookAddress,buyer,1,{value:E/100n,gasLimit:6_000_000})).wait();
 const customSwap=async(who,{buy=true,exactIn=true,amount=E/1000n,bound=1n,hookData='0x',via=swapper}={})=>(await via.connect(who).swap(key,
  {zeroForOne:buy,amountSpecified:exactIn?-amount:amount,sqrtPriceLimitX96:buy?4295128740n:1461446703485210103287273052203988822378723970341n},
  {takeClaims:false,settleUsingBurn:false},hookData,{value:buy?(exactIn?amount:bound):0n,gasLimit:3_000_000})).wait();
 const routedSwap=async(who,{buy=true,exactIn=true,amount=E/1000n,bound=1n,hookData='0x',recipient}={})=>{
  const input=buy?ZeroAddress:key.currency1,output=buy?key.currency1:ZeroAddress;
  let actions=(exactIn?'06':'08')+'0c';
  const params=[abi.encode([swapTuple],[[key,buy,amount,bound,hookData]]),abi.encode(['address','uint256'],[input,exactIn?amount:bound])];
  if(recipient){actions+='0e';params.push(abi.encode(['address','address','uint256'],[output,recipient,0]));}
  else{actions+='0f';params.push(abi.encode(['address','uint256'],[output,exactIn?bound:amount]));}
  let commands='10';const inputs=[abi.encode(['bytes','bytes[]'],['0x'+actions,params])];
  if(buy&&!exactIn){commands+='04';inputs.push(abi.encode(['address','address','uint256'],[ZeroAddress,await who.getAddress(),0]));}
  const deadline=(await provider.getBlock('latest')).timestamp+300;
  return(await router.connect(who)['execute(bytes,bytes[],uint256)']('0x'+commands,inputs,deadline,{value:buy?(exactIn?amount:bound):0n,gasLimit:3_000_000})).wait();
 };
 return {provider,controller,controllerAddress,buyers,earlyBuyers,outsider,hook,feeVault,token,initializer,manager,key,router,swapper,spoofRouter,
  routerCode,launch,customSwap,routedSwap,hookArtifact,config,factory,deploy};
}

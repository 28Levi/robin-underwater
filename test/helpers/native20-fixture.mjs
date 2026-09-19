import fs from 'node:fs';
import {BrowserProvider,JsonRpcSigner,ContractFactory,Contract,ZeroAddress,MaxUint256,keccak256,getCreate2Address,toBeHex,AbiCoder} from 'ethers';
export const E=10n**18n,MANAGER='0x8366a39CC670B4001A1121B8F6A443A643e40951',GRAPH='0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd';
export const artifact=name=>JSON.parse(fs.readFileSync(`artifacts/${name}.json`));
export async function native20Fixture(hre,{operatorIndex=0,name='ROBINHOOD',symbol='ROBIN',firstBuyWei=E/10n}={}){
 await hre.network.provider.send('hardhat_reset');
 const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const owner=await provider.getSigner(0),alice=await provider.getSigner(1),bob=await provider.getSigner(2),ownerAddress=await owner.getAddress();
 async function deploy(name,args=[]){const a=artifact(name),c=await new ContractFactory(a.abi,a.bytecode,owner).deploy(...args);await c.waitForDeployment();return c;}
 const managerInit=(await new ContractFactory(artifact('PoolManager').abi,artifact('PoolManager').bytecode,owner).getDeployTransaction(ownerAddress)).data;
 await hre.network.provider.send('hardhat_setCode',[MANAGER,managerInit]);const runtime=await provider.call({from:ownerAddress,to:MANAGER});
 await(await owner.sendTransaction({to:MANAGER,gasLimit:5_000_000})).wait();await hre.network.provider.send('hardhat_setCode',[MANAGER,runtime]);
 const keeper=await provider.getSigner(operatorIndex);
 const reward=await deploy('UnderwaterDistributor',[await keeper.getAddress()]),initializer=await deploy('RobinhoodNative20Initializer',[MANAGER,GRAPH]);
 const token=await deploy('RobinhoodNative20Token',[await initializer.getAddress(),name,symbol]),factory=await deploy('Create2Deployer');
 const config={token:await token.getAddress(),lpFee:0,tickSpacing:60,initialSqrtPriceX96:1747735933952748037356115466503453n,
  initializer:await initializer.getAddress(),creatorFeeRecipient:await reward.getAddress(),creatorBuyFeeBps:180,creatorSellFeeBps:180,module:ZeroAddress,maxModuleLpFeePips:0};
 const code=(await new ContractFactory(artifact('RobinhoodNativeFeeHookV1').abi,artifact('RobinhoodNativeFeeHookV1').bytecode,owner).getDeployTransaction(MANAGER,config)).data;
 const codeHash=keccak256(code),factoryAddress=await factory.getAddress();let salt,hookAddress;
 for(let i=0;i<1_000_000;i++){salt=toBeHex(i,32);hookAddress=getCreate2Address(factoryAddress,salt,codeHash);if((BigInt(hookAddress)&0x3fffn)===0x20ccn)break;}
 if((BigInt(hookAddress)&0x3fffn)!==0x20ccn)throw Error('Hook salt search exhausted');
 await(await factory.deploy(salt,code)).wait();
 const hook=new Contract(hookAddress,artifact('RobinhoodNativeFeeHookV1').abi,owner),feeVault=new Contract(await hook.feeVault(),artifact('RobinhoodNativeFeeVaultV1').abi,owner);
 const key={currency0:ZeroAddress,currency1:await token.getAddress(),fee:0,tickSpacing:60,hooks:hookAddress};
 const poolId=keccak256(AbiCoder.defaultAbiCoder().encode(['address','address','uint24','int24','address'],[ZeroAddress,key.currency1,0,60,hookAddress]));
 const swapper=await deploy('PoolSwapTest',[MANAGER]);
 await hre.network.provider.send('hardhat_impersonateAccount',[GRAPH]);await hre.network.provider.send('hardhat_setBalance',[GRAPH,toBeHex(E)]);
 const launched=await(await initializer.connect(new JsonRpcSigner(provider,GRAPH)).initialize(key.currency1,hookAddress,ownerAddress,1,{value:firstBuyWei})).wait();
 const c={name,symbol,chainId:4663,token:key.currency1,hook:hookAddress,hookFlavor:'native20',initializer:await initializer.getAddress(),poolManager:MANAGER,
  distributor:await reward.getAddress(),poolId,excludedAddresses:[await swapper.getAddress()],deploymentBlock:(await token.deploymentTransaction().wait()).blockNumber,
  minimumAgeSeconds:3600,twapWindowSeconds:1800,maxOracleAgeSeconds:300,maxSnapshotAgeSeconds:300,maxFinalityLagSeconds:7200,batchSize:100};
 for(const who of [owner,alice,bob])await(await token.connect(who).approve(await swapper.getAddress(),MaxUint256)).wait();
 const swap=async(who,buy,input)=> (await swapper.connect(who).swap(key,{zeroForOne:buy,amountSpecified:-input,
  sqrtPriceLimitX96:buy?4295128740n:1461446703485210103287273052203988822378723970341n},
  {takeClaims:false,settleUsingBurn:false},'0x',{value:buy?input:0n})).wait();
 return {provider,owner,alice,bob,keeper,ownerAddress,token,reward,initializer,hook,feeVault,key,c,swapper,swap,launched,deploy};
}

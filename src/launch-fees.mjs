import {getAddress,getCreateAddress,ZeroAddress} from 'ethers';
import {POOL_MANAGER} from './production-network.mjs';

// Rebind the official Native20 example's zero project fees before final packing.
// A changed constructor changes the deterministic hook address and its child vault.
export function bindRobinLaunchFees(original,artifact,reviewed,distributor,hookAddress=null){
  const recipient=getAddress(distributor);
  if(recipient===ZeroAddress)throw Error('Reward distributor is required');
  if(artifact.bytecode!==reviewed.kernel.creationBytecode||artifact.deployedBytecode!==reviewed.kernel.runtimeTemplate)throw Error('Reviewed hook artifact mismatch');
  const config=structuredClone(original),hook=config.targets.find(t=>t.targetId===config.pool.hookTargetId);
  const args=hook?.constructorArguments?.[1];
  if(config.chainId!=='4663'||config.pool.fee!==0||config.pool.tickSpacing!==60||config.pool.quoteCurrency!==ZeroAddress
    ||!Array.isArray(args)||args.length!==10||getAddress(hook.constructorArguments[0])!==getAddress(POOL_MANAGER)
    ||args[0]?.target!==config.pool.tokenTargetId||Number(args[1])!==0||Number(args[2])!==60
    ||args[3]!=='1747735933952748037356115466503453'||args[4]?.target!=='initializer'
    ||getAddress(args[8])!==ZeroAddress||Number(args[9])!==0)throw Error('Unexpected Native20 launch structure');
  args[5]=recipient;args[6]=180;args[7]=180;
  const vault=hookAddress?getCreateAddress({from:getAddress(hookAddress),nonce:1}):ZeroAddress;
  const values={poolManager:POOL_MANAGER,token:{target:config.pool.tokenTargetId},lpFee:'0',tickSpacing:'60',
    initialSqrtPriceX96:args[3],initializer:{target:'initializer'},creatorBuyFeeBps:'180',creatorSellFeeBps:'180',
    module:ZeroAddress,moduleCodeHash:'0x'+'00'.repeat(32),maxModuleLpFeePips:'0',feeVault:vault};
  const refs=artifact.immutableReferences,entries=[];
  for(const [name,immutable] of Object.entries(reviewed.kernel.immutables)){
    const matches=Object.entries(refs??{}).filter(([,ranges])=>JSON.stringify(ranges)===JSON.stringify(immutable.ranges));
    if(matches.length!==1||values[name]===undefined)throw Error('Reviewed immutable layout mismatch');
    const value=values[name];entries.push({immutableId:matches[0][0],abiType:immutable.abiType,
      ...(typeof value==='object'?{target:value.target}:{literal:value})});
  }
  if(entries.length!==Object.keys(refs).length)throw Error('Incomplete immutable coverage');
  hook.runtimeImmutables=entries.sort((a,b)=>Number(a.immutableId)-Number(b.immutableId));
  return {config,feeVault:vault};
}

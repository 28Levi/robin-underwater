import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {ZeroAddress,getCreateAddress} from 'ethers';
import {bindRobinLaunchFees} from '../src/launch-fees.mjs';
import {POOL_MANAGER} from '../src/production-network.mjs';
const artifact=JSON.parse(fs.readFileSync('artifacts/RobinhoodNativeFeeHookV1.json'));
const reviewed=JSON.parse(fs.readFileSync('vendor/programmable-native20/artifact.json'));
const recipient='0x0000000000000000000000000000000000000001';
const config={chainId:'4663',pool:{hookTargetId:'hook',tokenTargetId:'token',fee:0,tickSpacing:60,quoteCurrency:ZeroAddress},targets:[{
  targetId:'hook',constructorArguments:[POOL_MANAGER,[{target:'token'},0,60,'1747735933952748037356115466503453',
    {target:'initializer'},'0x0000000000000000000000000000000000000002',0,0,ZeroAddress,0]],runtimeImmutables:[]}]};
test('official zero-fee example is rebound to distributor and 180bps with exact compiled immutable locations',()=>{
  const hookAddress='0x00000000000000000000000000000000000020cc';
  const bound=bindRobinLaunchFees(config,artifact,reviewed,recipient,hookAddress),hook=bound.config.targets[0];
  assert.deepEqual(hook.constructorArguments[1].slice(5,8),[recipient,180,180]);
  assert.equal(config.targets[0].constructorArguments[1][6],0);
  assert.equal(bound.feeVault,getCreateAddress({from:hookAddress,nonce:1}));
  for(const name of ['creatorBuyFeeBps','creatorSellFeeBps','feeVault']){
    const ranges=reviewed.kernel.immutables[name].ranges;
    const id=Object.entries(artifact.immutableReferences).find(([,r])=>JSON.stringify(r)===JSON.stringify(ranges))[0];
    assert.equal(hook.runtimeImmutables.find(x=>x.immutableId===id).literal,name==='feeVault'?bound.feeVault:'180');
  }
});
test('wrong kernel, altered pool and missing recipient fail closed',()=>{
  assert.throws(()=>bindRobinLaunchFees(config,{...artifact,bytecode:'0x00'},reviewed,recipient),/artifact mismatch/);
  const changed=structuredClone(config);changed.targets[0].constructorArguments[1][1]=3000;
  assert.throws(()=>bindRobinLaunchFees(changed,artifact,reviewed,recipient),/structure/);
  assert.throws(()=>bindRobinLaunchFees(config,artifact,reviewed,ZeroAddress),/distributor/);
});

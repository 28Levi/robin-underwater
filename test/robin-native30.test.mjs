import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Interface,keccak256,toUtf8Bytes} from 'ethers';
import {native20Fixture,E,artifact} from './helpers/native20-fixture.mjs';

process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');
const {default:hre}=await import('hardhat');
const ceilDiv=(numerator,denominator)=>(numerator+denominator-1n)/denominator;

test('custom ROBIN hook keeps canonical upstream artifacts and identifies its own source/profile',()=>{
 const reviewed=JSON.parse(fs.readFileSync('vendor/programmable-native20/artifact.json','utf8'));
 const original=artifact('RobinhoodNativeFeeHookV1'),custom=artifact('RobinhookNativeFeeHookV1');
 assert.equal(original.bytecode,reviewed.kernel.creationBytecode);
 assert.notEqual(custom.bytecode,original.bytecode);
 assert.equal(custom.source,'src/robinhook-fee-v1/RobinhookNativeFeeHookV1.sol');
 const input=JSON.parse(fs.readFileSync('artifacts/standard-json-robin-native30.json','utf8'));
 assert.equal(input.sources[custom.source].content,fs.readFileSync(custom.source,'utf8'));
 assert.equal(input.sources[reviewed.kernel.sourcePath].content,reviewed.standardJsonInput.sources[reviewed.kernel.sourcePath].content);
 assert.deepEqual(new Interface(custom.abi).format(),new Interface(original.abi).format(),'same settlement and accounting ABI; separate implementation bytecode');
});

test('ROBIN 170/30 charges all four buy/sell modes and pays actual ETH to separate fixed destinations',async t=>{
 const f=await native20Fixture(hre,{name:'ROBINHOOK',symbol:'ROBIN',firstBuyWei:E/100n,feeProfile:'robin-native30'});
 try{
  const {provider,hook,feeVault,reward,owner,alice,token,swapper,key}=f;
  assert.equal(await hook.PLATFORM_FEE_BPS(),30n);
  assert.equal(await hook.creatorBuyFeeBps(),170n);assert.equal(await hook.creatorSellFeeBps(),170n);
  assert.equal(await hook.FEE_PROFILE(),keccak256(toUtf8Bytes('programmable.robinhood-native-fee.v2.gross-native.ceil-per-trade.zero-custom-delta')));
  assert.equal(await feeVault.creatorAccrued(),E/100n*170n/10000n);
  assert.equal(await feeVault.platformAccrued(),E/100n*30n/10000n);
  const initial=(receipt)=>receipt.logs.map(log=>{try{return hook.interface.parseLog(log);}catch{return null;}}).filter(event=>event?.name==='NativeFeesAccrued');
  const first=initial(f.launched);assert.equal(first.length,1);assert.equal(first[0].args.grossNative,E/100n);

  await t.test('gross and net quotes round once for total fees and reserve ceil(gross * 30 / 10000) for Programmable',async()=>{
   for(const amount of [1n,2n,49n,50n,51n,333n,334n,9999n,10000n,10001n,E/100n,E,2n**120n]){
    for(const amountIsNet of [false,true])for(const buy of [false,true]){
     const [gross,platform,creator]=await hook.quoteFees(amount,amountIsNet,buy);
     const expectedGross=amountIsNet?ceilDiv(amount*10000n,9800n):amount;
     const total=amountIsNet?expectedGross-amount:ceilDiv(expectedGross*200n,10000n);
     assert.equal(gross,expectedGross);assert.equal(platform,ceilDiv(gross*30n,10000n));
     assert.equal(platform+creator,total);assert.equal(creator,total-platform);assert.ok(creator>=0n);
    }
   }
   assert.deepEqual(Array.from(await hook.quoteFees(E,false,true)),[E,3n*E/1000n,17n*E/1000n]);
  });

  const execute=async({who,buy,amount,value=0n})=>{
   const beforePlatform=await feeVault.platformAccrued(),beforeRewards=await feeVault.creatorAccrued();
   const receipt=await(await swapper.connect(who).swap(key,{zeroForOne:buy,amountSpecified:amount,
    sqrtPriceLimitX96:buy?4295128740n:1461446703485210103287273052203988822378723970341n},
    {takeClaims:false,settleUsingBurn:false},'0x',{value})).wait();
   const logs=initial(receipt);assert.equal(logs.length,1);const fee=logs[0].args;
   assert.equal(fee.isBuy,buy);assert.ok(fee.grossNative>0n);
   assert.equal(fee.platformFee,ceilDiv(fee.grossNative*30n,10000n));
   assert.equal(fee.creatorFee+fee.platformFee,ceilDiv(fee.grossNative*200n,10000n));
   assert.equal(await feeVault.platformAccrued()-beforePlatform,fee.platformFee);
   assert.equal(await feeVault.creatorAccrued()-beforeRewards,fee.creatorFee);
   return fee;
  };
  await t.test('native exact-input buy',async()=>{
   const fee=await execute({who:alice,buy:true,amount:-E/100n,value:E/100n});assert.equal(fee.grossNative,E/100n);
  });
  await t.test('token exact-input sell',async()=>{
   const amount=(await token.balanceOf(await alice.getAddress()))/10n;
   await execute({who:alice,buy:false,amount:-amount});
  });
  await t.test('token exact-output buy',async()=>{
   const before=await token.balanceOf(await alice.getAddress()),amount=1000n*E;
   await execute({who:alice,buy:true,amount,value:E/100n});
   assert.equal(await token.balanceOf(await alice.getAddress())-before,amount);
  });
  await t.test('native exact-output sell',async()=>{
   const net=E/10000n,fee=await execute({who:owner,buy:false,amount:net});
   assert.equal(fee.grossNative-fee.platformFee-fee.creatorFee,net);
  });
  await t.test('permissionless claims transfer measured ETH only to Programmable and the rewards distributor',async()=>{
   const platform=await feeVault.platformAccrued(),rewards=await feeVault.creatorAccrued();
   const treasury=await feeVault.PLATFORM_RECIPIENT(),before=await provider.getBalance(treasury);
   assert.equal(await hook.PLATFORM_RECIPIENT(),treasury);assert.equal(treasury,'0xD88539d3c4C460136a733A3Fd60cf6BF269079da');
   await(await feeVault.connect(alice).claimPlatform()).wait();
   assert.equal(await provider.getBalance(treasury)-before,platform);assert.equal(await feeVault.platformAccrued(),0n);
   assert.equal(await feeVault.creatorAccrued(),rewards);assert.equal(await reward.available(),0n);
   await(await feeVault.connect(alice).claimCreator()).wait();
   assert.equal(await reward.available(),rewards);assert.equal(await feeVault.creatorAccrued(),0n);
   await assert.rejects(feeVault.claimPlatform());await assert.rejects(feeVault.claimCreator());
  });
 }finally{f.provider.destroy();}
});

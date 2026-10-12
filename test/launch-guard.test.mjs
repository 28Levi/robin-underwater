import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {AbiCoder,ContractFactory,ZeroAddress,keccak256,getCreate2Address,toBeHex} from 'ethers';
import {launchGuardFixture,E,MANAGER,ROUTER,ROUTER_HASH,MAIN_CONTROLLER} from './helpers/launch-guard-fixture.mjs';
process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');
const {default:hre}=await import('hardhat');
const ceilDiv=(a,b)=>(a+b-1n)/b;
const abi=AbiCoder.defaultAbiCoder();

test('30-second launch guard authenticates all five buyers on the actual pinned router and preserves native30 fees',async t=>{
 const f=await launchGuardFixture(hre);
 try{
  const {provider,hook,token,feeVault,earlyBuyers,controller,controllerAddress,buyers,outsider,initializer,manager,key}=f;
  assert.equal(await hook.EARLY_BUY_WINDOW(),30n);
  assert.equal(await hook.CANONICAL_EARLY_BUY_ROUTER(),ROUTER);
  assert.equal(await hook.CANONICAL_EARLY_BUY_ROUTER_CODE_HASH(),ROUTER_HASH);
  assert.equal(keccak256(await provider.getCode(ROUTER)),ROUTER_HASH);
  assert.equal(await hook.publicBuysAt(),0n);assert.equal(await hook.initialized(),false);
  for(let i=0;i<5;i++){assert.equal(await hook['earlyBuyer'+i](),earlyBuyers[i]);assert.equal(await hook.isEarlyBuyer(earlyBuyers[i]),true);}
  assert.equal(await hook.isEarlyBuyer(controllerAddress),false);assert.equal(await hook.isEarlyBuyer(MAIN_CONTROLLER),true);
  await t.test('only the authenticated initializer can start the clock; a rejected mandatory buyer rolls initialization back',async()=>{
   await assert.rejects(manager.initialize(key,f.config.initialSqrtPriceX96,{gasLimit:2_000_000}).then(tx=>tx.wait()));
   await assert.rejects(hook.beforeInitialize(await initializer.getAddress(),key,f.config.initialSqrtPriceX96));
   assert.equal(await hook.publicBuysAt(),0n);assert.equal(await hook.initialized(),false);
   for(const buyer of [controllerAddress,await outsider.getAddress()]){
    await assert.rejects(f.launch(buyer));
    assert.equal(await hook.publicBuysAt(),0n);assert.equal(await hook.initialized(),false);assert.equal(await initializer.initialized(),false);
    assert.equal(await feeVault.creatorAccrued(),0n);assert.equal(await feeVault.platformAccrued(),0n);
    assert.equal(await token.balanceOf(await initializer.getAddress()),await token.totalSupply());
   }
  });
  let beforeLaunch=await hre.network.provider.send('evm_snapshot');
  await t.test('all five permitted recipients including B519 can receive the mandatory first buy from a different funder',async()=>{
   for(const buyer of earlyBuyers){
    await hre.network.provider.send('evm_revert',[beforeLaunch]);beforeLaunch=await hre.network.provider.send('evm_snapshot');
    const receipt=await f.launch(buyer),block=await provider.getBlock(receipt.blockNumber);
    assert.equal(await initializer.initialBuyer(),buyer);assert.ok(await token.balanceOf(buyer)>0n);
    assert.equal(await token.balanceOf(controllerAddress),0n);assert.equal(await hook.publicBuysAt(),BigInt(block.timestamp+30));
   }
  });
  await hre.network.provider.send('evm_revert',[beforeLaunch]);
  const launch=await f.launch(),launchedAt=(await provider.getBlock(launch.blockNumber)).timestamp,publicAt=launchedAt+30;
  let baseline=await hre.network.provider.send('evm_snapshot');
  async function reset(){await hre.network.provider.send('evm_revert',[baseline]);baseline=await hre.network.provider.send('evm_snapshot');}
  const fees=receipt=>receipt.logs.map(log=>{try{return hook.interface.parseLog(log);}catch{return null;}}).filter(event=>event?.name==='NativeFeesAccrued');
  async function checkFees(execute,{buy=true}={}){
   const platform=await feeVault.platformAccrued(),creator=await feeVault.creatorAccrued(),receipt=await execute(),events=fees(receipt);
   assert.equal(events.length,1);const event=events[0].args;
   assert.equal(event.isBuy,buy);assert.ok(event.grossNative>0n);
   assert.equal(event.platformFee,ceilDiv(event.grossNative*30n,10000n));
   assert.equal(event.creatorFee+event.platformFee,ceilDiv(event.grossNative*200n,10000n));
   assert.equal(await feeVault.platformAccrued()-platform,event.platformFee);assert.equal(await feeVault.creatorAccrued()-creator,event.creatorFee);
   return receipt;
  }
  await t.test('all five buyers including B519 can buy exact-input and exact-output during the restricted window',async()=>{
   for(const buyer of buyers)for(const exactIn of [true,false]){
    await reset();const before=await token.balanceOf(await buyer.getAddress());
    const receipt=await checkFees(()=>f.routedSwap(buyer,exactIn?{}:{exactIn:false,amount:1000n*E,bound:E/100n}));
    assert.ok((await provider.getBlock(receipt.blockNumber)).timestamp<publicAt);
    const gained=await token.balanceOf(await buyer.getAddress())-before;assert.ok(gained>0n);if(!exactIn)assert.equal(gained,1000n*E);
   }
  });
  await t.test('unauthorized canonical-router buyers fail in both modes even when hookData names an allowed wallet',async()=>{
   for(const exactIn of [true,false])for(const hookData of ['0x',abi.encode(['address'],[earlyBuyers[0]])]){
    await reset();const before=await token.balanceOf(await outsider.getAddress()),creator=await feeVault.creatorAccrued(),platform=await feeVault.platformAccrued();
    await assert.rejects(f.routedSwap(outsider,{exactIn,hookData,amount:exactIn?E/1000n:1000n*E,bound:exactIn?1n:E/100n}));
    assert.equal(await token.balanceOf(await outsider.getAddress()),before);assert.equal(await feeVault.creatorAccrued(),creator);assert.equal(await feeVault.platformAccrued(),platform);
   }
  });
  await t.test('alternate routers cannot authenticate buyers by a forged msgSender() or hookData',async()=>{
   for(const via of [f.swapper,f.spoofRouter])for(const exactIn of [true,false]){
    await reset();assert.equal(await f.spoofRouter.msgSender(),earlyBuyers[0]);
    await assert.rejects(f.customSwap(outsider,{via,exactIn,amount:exactIn?E/1000n:1000n*E,bound:exactIn?1n:E/100n,
     hookData:abi.encode(['address'],[earlyBuyers[0]])}));
   }
  });
  await t.test('even a router at the pinned address cannot change its runtime during the window',async()=>{
   await reset();await hre.network.provider.send('hardhat_setCode',[ROUTER,await provider.getCode(await f.spoofRouter.getAddress())]);
   const spoofAtCanonical=f.spoofRouter.attach(ROUTER);
   assert.equal(await spoofAtCanonical.msgSender(),earlyBuyers[0]);
   await assert.rejects(f.customSwap(buyers[0],{via:spoofAtCanonical}));
   assert.equal(await feeVault.creatorAccrued(),E/100n*170n/10000n);
  });
  await t.test('authorization is for the authenticated initiator, not the token recipient',async()=>{
   await reset();const recipient=await outsider.getAddress(),before=await token.balanceOf(recipient);
   await checkFees(()=>f.routedSwap(buyers[0],{recipient}));assert.ok(await token.balanceOf(recipient)>before);
  });
  await t.test('outsiders remain blocked at 29 seconds and both buy modes open exactly at 30 seconds',async()=>{
   for(const exactIn of [true,false]){
    await reset();await hre.network.provider.send('evm_setNextBlockTimestamp',[publicAt-1]);
    await assert.rejects(f.routedSwap(outsider,{exactIn,amount:exactIn?E/1000n:1000n*E,bound:exactIn?1n:E/100n}));
    assert.equal((await provider.getBlock('latest')).timestamp,publicAt-1);
    await hre.network.provider.send('evm_setNextBlockTimestamp',[publicAt]);
    const receipt=await checkFees(()=>f.routedSwap(outsider,{exactIn,amount:exactIn?E/1000n:1000n*E,bound:exactIn?1n:E/100n}));
    assert.equal((await provider.getBlock(receipt.blockNumber)).timestamp,publicAt);
   }
  });
  await t.test('all routers become public at the boundary, with unchanged buy fees',async()=>{
   for(const via of [f.swapper,f.spoofRouter])for(const exactIn of [true,false]){
    await reset();await hre.network.provider.send('evm_setNextBlockTimestamp',[publicAt]);
    const receipt=await checkFees(()=>f.customSwap(outsider,{via,exactIn,amount:exactIn?E/1000n:1000n*E,bound:exactIn?1n:E/100n}));
    assert.equal((await provider.getBlock(receipt.blockNumber)).timestamp,publicAt);
   }
  });
  await t.test('unlisted holders can sell in both modes through either router before 30 seconds',async()=>{
   for(const custom of [false,true])for(const exactIn of [true,false]){
    await reset();await(await token.connect(buyers[4]).transfer(await outsider.getAddress(),100000n*E)).wait();
    const execute=custom?f.customSwap:f.routedSwap;
    const receipt=await checkFees(()=>execute(outsider,{buy:false,exactIn,amount:exactIn?1000n*E:E/1000000n,bound:exactIn?1n:100000n*E}),{buy:false});
    assert.ok((await provider.getBlock(receipt.blockNumber)).timestamp<publicAt);
   }
  });
  await t.test('initialization cannot restart the window, including after public trading opens',async()=>{
   await reset();const original=await hook.publicBuysAt();
   for(const later of [false,true]){
    if(later)await hre.network.provider.send('evm_setNextBlockTimestamp',[publicAt+100]);
    await assert.rejects(f.launch());await assert.rejects(manager.initialize(key,f.config.initialSqrtPriceX96,{gasLimit:2_000_000}).then(tx=>tx.wait()));
    assert.equal(await hook.publicBuysAt(),original);assert.equal(await hook.initialized(),true);
   }
   assert.equal(hook.interface.getFunction('setEarlyBuyers'),null);assert.equal(hook.interface.getFunction('setPublicBuysAt'),null);
  });
  await t.test('zero and duplicate allowlist addresses fail constructor validation',async()=>{
   for(const invalid of [[ZeroAddress,...earlyBuyers.slice(1)],[earlyBuyers[0],earlyBuyers[0],...earlyBuyers.slice(2)]]){
    await reset();const code=(await new ContractFactory(f.hookArtifact.abi,f.hookArtifact.bytecode,controller).getDeployTransaction(MANAGER,f.config,invalid)).data;
    const factory=await f.factory.getAddress(),hash=keccak256(code);let salt,address;
    for(let i=0;i<1_000_000;i++){salt=toBeHex(i,32);address=getCreate2Address(factory,salt,hash);if((BigInt(address)&0x3fffn)===0x20ccn)break;}
    assert.equal(BigInt(address)&0x3fffn,0x20ccn);await assert.rejects(f.factory.deploy(salt,code,{gasLimit:6_000_000}).then(tx=>tx.wait()));
    assert.equal(await provider.getCode(address),'0x');
   }
  });
 }finally{f.provider.destroy();}
});

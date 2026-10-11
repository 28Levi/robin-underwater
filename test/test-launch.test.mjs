import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {native20Fixture,E} from './helpers/native20-fixture.mjs';
import {verifyProductionToken} from '../src/production-network.mjs';
import {executionBinding} from '../src/execution-journal.mjs';
process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');const {default:hre}=await import('hardhat');
test('separate test branding retains current ROBIN fees and production identity checks',async()=>{
 const f=await native20Fixture(hre,{operatorIndex:3,name:'Moss Circuit',symbol:'MOSSC',firstBuyWei:E/1000n,feeProfile:'robin-native30'});
 try{
  const {provider,c,token,initializer,feeVault,ownerAddress}=f;
  await verifyProductionToken(provider,c);
  await assert.rejects(verifyProductionToken(provider,{...c,name:'ROBINHOOD',symbol:'ROBIN'}),/configured token identity/);
  await assert.rejects(verifyProductionToken(provider,{...c,symbol:null}),/explicit production token identity/);
  assert.notEqual(executionBinding(c,ownerAddress),executionBinding({...c,name:'ROBINHOOD',symbol:'ROBIN'},ownerAddress));
  const out=await token.balanceOf(ownerAddress);
  assert.equal(await initializer.initialBuyWei(),E/1000n);
  assert.equal(await feeVault.creatorAccrued(),17000000000000n);assert.equal(await feeVault.platformAccrued(),3000000000000n);
  fs.writeFileSync('output/test-branding-robin30-initial-buy-simulation.json',JSON.stringify({checkedAt:new Date().toISOString(),name:c.name,symbol:c.symbol,
   feeProfile:'robin-native30',projectFeeBps:170,platformFeeBps:30,
   initialBuyWei:(E/1000n).toString(),tokensOutRaw:out.toString(),illustrativeMinimumAtOnePercentBelowSimulationRaw:(out*99n/100n).toString(),
   minimumOutputApproved:false,localSimulationOnly:true,graphFactorySimulated:true,liveQuote:false,mainnetTransactionsSent:0},null,2)+'\n');
 }finally{f.provider.destroy();}
});

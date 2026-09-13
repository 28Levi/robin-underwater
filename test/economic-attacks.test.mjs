import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {keccak256} from 'ethers';
import {native20Fixture,E} from './helpers/native20-fixture.mjs';
import {buildSnapshot} from '../src/replay.mjs';import {LossLedger,stringify} from '../src/ledger.mjs';
process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');const {default:hre}=await import('hardhat');

test('economic probe: related wallets can receive relief while retaining realized gains elsewhere',async()=>{
 const f=await native20Fixture(hre,{operatorIndex:3}),{provider,owner,alice,bob,keeper,token,swap,hook,feeVault,reward,c}=f;
 const aliceAddress=await alice.getAddress(),ownerAddress=await owner.getAddress();
 const fees=r=>r.logs.map(l=>{try{return hook.interface.parseLog(l);}catch{return null;}}).find(p=>p?.name==='NativeFeesAccrued').args;
 const netSell=r=>{const p=fees(r);return p.grossNative-p.platformFee-p.creatorFee;};
 // An unrelated trader pays actual hook fees and exits before the two-wallet strategy.
 const accumulation=await swap(owner,true,9n*E/10n);
 const bobBuy=await swap(bob,true,2n*E),bobSell=await swap(bob,false,await token.balanceOf(await bob.getAddress()));
 const outsideProjectFees=fees(bobBuy).creatorFee+fees(bobSell).creatorFee;
 const buy=await swap(alice,true,E/10n),sell=await swap(owner,false,await token.balanceOf(ownerAddress));
 await hre.network.provider.send('evm_increaseTime',[3700]);await hre.network.provider.send('evm_mine');
 await(await feeVault.connect(keeper).claimCreator()).wait();
 const snapshot=await buildSnapshot(provider,c),ledger=LossLedger.restore(snapshot.ledger);
 const plan=ledger.plan(await reward.available(),{...snapshot.oracle,now:snapshot.checkpoint.timestamp});
 const aid=plan.allocations.find(a=>a.account===aliceAddress.toLowerCase())?.amount??0n;
 assert.ok(aid>0n,'related buyer has an eligible unrealized loss');
 const payout=await(await reward.connect(keeper).distributeGuarded(keccak256('0xbadcafe0'),plan.auditHash,c.token,snapshot.checkpoint.timestamp+300,
  plan.allocations.map(a=>a.account),plan.allocations.map(a=>a.amount),plan.allocations.map(a=>ledger.get(a.account).balance))).wait();
 const exit=await swap(alice,false,await token.balanceOf(aliceAddress));
 const initialCost=E,pumpCost=E/10n,proceeds=netSell(sell)+netSell(exit);
 const tradingGas=[accumulation,buy,sell,exit].reduce((sum,r)=>sum+r.gasUsed*r.gasPrice,0n);
 const report={status:proceeds+aid-initialCost-pumpCost-tradingGas>0n?'profitable-counterexample':'not-profitable-in-this-scenario',scenario:'Early buyer and later underwater buyer controlled together; unrelated trader supplied real trading fees',
  outsideProjectFeesWei:outsideProjectFees,launchPurchaseWei:E/10n,additionalEarlyPurchasesWei:9n*E/10n,earlyPositionTotalCostWei:initialCost,
  laterPurchaseWei:pumpCost,earlyWalletRealizedPnlWei:netSell(sell)-initialCost,saleProceedsWei:proceeds,reliefWei:aid,
  groupPnlBeforeReliefAndGasWei:proceeds-initialCost-pumpCost,groupPnlAfterReliefBeforeGasWei:proceeds+aid-initialCost-pumpCost,
  strategyTradingGasWei:tradingGas,groupPnlAfterReliefAndTradingGasWei:proceeds+aid-initialCost-pumpCost-tradingGas,
  keeperGasWei:payout.gasUsed*payout.gasPrice,excludes:'contract deployment and initial launch gas; production chain ordering and fees differ',
  chain:'local real PoolManager + canonical Native20 hook',operatorIsSeparateHonestWallet:true,productionSafe:false};
 const cappedAid=aid<fees(buy).creatorFee?aid:fees(buy).creatorFee;
 report.feeCappedAlternative={implementedInLiveFormula:false,rule:'Each recipient can receive at most its own contributed project fees, less prior refunds',
  reliefWei:cappedAid,groupPnlAfterReliefAndTradingGasWei:proceeds+cappedAid-initialCost-pumpCost-tradingGas,
  limitation:'This becomes capped fee rebates, not unrestricted cross-holder loss compensation; one blocked scenario is not a full economic proof.'};
 fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/economic-counterexample.json',stringify(report));
 assert.ok(report.groupPnlBeforeReliefAndGasWei<0n);
 assert.ok(report.groupPnlAfterReliefAndTradingGasWei>0n,'strategy extracts net value after its trading gas');
 assert.ok(report.feeCappedAlternative.groupPnlAfterReliefAndTradingGasWei<0n);
});

test('regression: a tiny ordinary transfer cannot restart the mature holding age gate',()=>{
 const victim='0x'+'1'.repeat(40),attacker='0x'+'2'.repeat(40),ledger=new LossLedger();
 ledger.apply({id:'victim-buy',type:'buy',account:victim,amount:E,costWei:2n*E,time:0});
 ledger.apply({id:'attacker-buy',type:'buy',account:attacker,amount:1n,costWei:1n,time:0});
 const oracle={priceWeiPerToken:E,observedAt:7200,now:7200};
 assert.equal(ledger.shortfalls(oracle).find(a=>a.account===victim).loss,E);
 ledger.apply({id:'dust-gift',type:'transfer',from:attacker,to:victim,amount:1n,time:7199});
 assert.equal(ledger.shortfalls(oracle).find(a=>a.account===victim).loss,E-1n);
 assert.equal(ledger.shortfalls({...oracle,now:10799,observedAt:10799}).find(a=>a.account===victim).loss,E);
});

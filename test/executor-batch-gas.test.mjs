import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {HDNodeWallet,Transaction,keccak256,toBeHex} from 'ethers';
import {native20Fixture,E} from './helpers/native20-fixture.mjs';
import {executeCycle} from '../src/executor.mjs';

process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');process.env.HARDHAT_NETWORK='hardhat';
const {default:hre}=await import('hardhat');
assert.equal(hre.network.name,'hardhat');assert.equal(hre.network.config.forking?.enabled??false,false);
// Observed production fee data at 2026-10-11T20:04:57Z, block 86099542.
// Only the local test provider uses this fixed quote. Production still fetches it.
const MAX_FEE=41420000n,PER_TRANSACTION_CAP=200000000000000n,TOTAL_CAP=5000000000000000n;

test('100 eligible holders retain original entitlements while gas-limited slices survive restart',async t=>{
 const f=await native20Fixture(hre,{name:'ROBINHOOK',symbol:'ROBIN',firstBuyWei:E/100n,feeProfile:'robin-native30'});
 const realNow=Date.now;
 try{
  const {provider,token,owner,ownerAddress,feeVault,reward}=f;
  const accounts=Array.from({length:100},(_,i)=>toBeHex(i+0x1000,20)),portion=(await token.balanceOf(ownerAddress))/200n;
  for(const account of accounts)await(await token.transfer(account,portion)).wait();
  await f.swap(owner,false,await token.balanceOf(ownerAddress));
  await hre.network.provider.send('evm_increaseTime',[3700]);await hre.network.provider.send('evm_mine');
  const config={...f.c,batchSize:100,maxFinalityLagSeconds:1800,execution:{mode:'local-only',operator:ownerAddress,
   feeVault:await feeVault.getAddress(),maxGasPerTransactionWei:String(PER_TRANSACTION_CAP),maxTotalGasWei:String(TOTAL_CAP),
   minimumHarvestWei:'10000000000000',minimumBatchWei:'10000000000000',retryIntervalSeconds:3600,codeHashes:{}}};
  for(const name of ['token','hook','distributor','feeVault'])config.execution.codeHashes[name]=keccak256(await provider.getCode(name==='feeVault'?config.execution.feeVault:config[name]));
  const rpc=new Proxy(provider,{get(target,key){
   if(key==='getFeeData')return async()=>({gasPrice:20710000n,maxFeePerGas:MAX_FEE,maxPriorityFeePerGas:0n});
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  let base=await hre.network.provider.send('evm_snapshot');
  fs.mkdirSync('output/test',{recursive:true});
  async function setup(changes={}){
   await hre.network.provider.send('evm_revert',[base]);base=await hre.network.provider.send('evm_snapshot');
   const c={...config,...changes,execution:{...config.execution,...changes.execution}};
   const dir=fs.mkdtempSync('output/test/executor-batch-gas-'),signed=[];
   const signer=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
   const observedSigner={getAddress:()=>signer.getAddress(),signTransaction:async tx=>{signed.push({...tx});return signer.signTransaction(tx);}};
   const cycle=async()=>{const now=(await provider.getBlock('latest')).timestamp;Date.now=()=>now*1000;return executeCycle(rpc,observedSigner,c,dir);};
   const journal=()=>JSON.parse(fs.readFileSync(path.join(dir,'journal.json'),'utf8')).state;
   return {c,dir,signed,cycle,journal};
  }
  await t.test('oversized 100-holder candidate becomes bounded batches with no skipped, repriced or duplicate entitlements',async()=>{
   const s=await setup();
   assert.equal((await s.cycle()).kind,'harvest');assert.equal((await s.cycle()).state,'confirmed');
   const first=await s.cycle();assert.equal(first.kind,'payout');assert.equal(first.state,'submitted');
   const started=s.journal(),entitlements=started.round.allocations.map(row=>({...row}));
   assert.equal(entitlements.length,100);assert.equal(started.round.nextIndex,0);
   assert.ok(started.pending.roundEnd>0&&started.pending.roundEnd<100,'must shrink below the configured 100');
   const paid=new Map(),hashes=new Set();let cursor=0,current=first;
   while(true){
    const pending=s.journal().pending;assert.ok(pending.roundEnd>cursor);assert.ok(!hashes.has(current.hash));hashes.add(current.hash);
    const tx=Transaction.from(pending.raw);assert.ok(tx.gasLimit*tx.maxFeePerGas<=PER_TRANSACTION_CAP);
    const receipt=await provider.getTransactionReceipt(current.hash);
    for(const log of receipt.logs){let parsed;try{parsed=reward.interface.parseLog(log);}catch{}
     if(parsed?.name==='RewardAllocated'){
      const account=parsed.args.recipient.toLowerCase();assert.ok(!paid.has(account));paid.set(account,parsed.args.amount);
     }
    }
    cursor=pending.roundEnd;
    assert.equal((await s.cycle()).state,'confirmed');
    const restored=s.journal();
    if(!restored.round)break;
    assert.equal(restored.round.nextIndex,cursor);
    assert.deepEqual(restored.round.allocations,entitlements,'restart must keep the original complete round');
    current=await s.cycle();assert.equal(current.kind,'payout');
   }
   assert.ok(hashes.size>1);assert.equal(cursor,100);assert.equal(paid.size,100);
   for(const expected of entitlements){
    assert.equal(paid.get(expected.account),BigInt(expected.amount));
    assert.equal(await provider.getBalance(expected.account),BigInt(expected.amount));
   }
   const reservations=s.signed.reduce((sum,tx)=>sum+tx.gasLimit*tx.maxFeePerGas,0n);
   assert.equal(BigInt(s.journal().reservedGasWei),reservations);assert.ok(reservations<=TOTAL_CAP);
   assert.equal(s.journal().round,null);assert.equal(s.journal().pending,null);
   assert.equal((await s.cycle()).state,'idle');assert.equal(s.signed.length,hashes.size+1);
  });

  await t.test('cumulative exhaustion is a distinct error and cannot reset reservations or advance unpaid holders',async()=>{
   const s=await setup({execution:{maxTotalGasWei:'210000000000000'}});
   assert.equal((await s.cycle()).kind,'harvest');await s.cycle();
   assert.equal((await s.cycle()).kind,'payout');await s.cycle();
   const before=fs.readFileSync(path.join(s.dir,'journal.json'),'utf8'),signatures=s.signed.length;
   assert.ok(s.journal().round.nextIndex>0&&s.journal().round.nextIndex<100);
   await assert.rejects(s.cycle(),error=>error.code==='CUMULATIVE_GAS_CAP'&&/cumulative cap/.test(error.message));
   assert.equal(fs.readFileSync(path.join(s.dir,'journal.json'),'utf8'),before);assert.equal(s.signed.length,signatures);
  });

  await t.test('an unaffordable single-recipient slice blocks without signing or discarding its entitlement',async()=>{
   // Negative policy fixture uses one-wei thresholds/cap to exercise the single
   // recipient limit independently of fee harvest and the normal minimum batch.
   const s=await setup({batchSize:1,execution:{maxGasPerTransactionWei:'1',minimumBatchWei:'1'}});
   await(await feeVault.connect(f.alice).claimCreator()).wait();
   await assert.rejects(s.cycle(),error=>error.code==='PER_TRANSACTION_GAS_CAP'&&/per-transaction cap/.test(error.message));
   assert.equal(s.signed.length,0);assert.equal(s.journal().reservedGasWei,'0');assert.equal(s.journal().pending,null);
   assert.equal(s.journal().round.allocations.length,100);assert.equal(s.journal().round.nextIndex,0);
  });

  await t.test('splitting cannot silently lower the minimum batch value or skip its unpaid cursor',async()=>{
   const s=await setup();
   // Enough for one minimum-sized 100-holder round, but every gas-fitting
   // prefix is below that minimum. Unharvested fees are deliberately separate.
   await(await owner.sendTransaction({to:await reward.getAddress(),value:10000000000100n})).wait();
   await assert.rejects(s.cycle(),error=>error.code==='PAYOUT_GAS_MINIMUM_CONFLICT'&&/minimum batch value/.test(error.message));
   assert.equal(s.signed.length,0);assert.equal(s.journal().reservedGasWei,'0');assert.equal(s.journal().pending,null);
   assert.equal(s.journal().round.allocations.length,100);assert.equal(s.journal().round.nextIndex,0);
   assert.ok(s.journal().round.allocations.reduce((sum,row)=>sum+BigInt(row.amount),0n)>=10000000000000n);
  });
 }finally{Date.now=realNow;f.provider.destroy();}
});

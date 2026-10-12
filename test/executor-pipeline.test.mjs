import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {HDNodeWallet,Transaction,keccak256,toBeHex} from 'ethers';
import {native20Fixture,E} from './helpers/native20-fixture.mjs';
import {executeCycle} from '../src/executor.mjs';
import {LossLedger} from '../src/ledger.mjs';
import {readSnapshot} from '../src/store.mjs';
import {operatorFailureStatus} from '../src/operator-status.mjs';
import {withReadOnlyRpcRetries} from '../src/read-only-rpc-retry.mjs';

process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');
process.env.HARDHAT_NETWORK='hardhat';
const {default:hre}=await import('hardhat');
assert.equal(hre.network.name,'hardhat');
assert.equal(hre.network.config.forking?.enabled??false,false);
const alter=(provider,overrides)=>new Proxy(provider,{get(target,key){
  if(Object.hasOwn(overrides,key))return overrides[key];
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
}});
const readState=dir=>JSON.parse(fs.readFileSync(path.join(dir,'journal.json'),'utf8')).state;
const temporary=prefix=>{fs.mkdirSync('output/test',{recursive:true});return fs.mkdtempSync(`output/test/${prefix}-`);};
const copyState=(dir,prefix)=>{const target=temporary(prefix);fs.cpSync(dir,target,{recursive:true});return target;};
const timeout=()=>Object.assign(new Error('private endpoint detail'),{code:'TIMEOUT'});
const receiptAllocations=(receipt,reward)=>receipt.logs.flatMap(log=>{
  let parsed;try{parsed=reward.interface.parseLog(log);}catch{}
  return parsed?.name==='RewardAllocated'?[{account:parsed.args.recipient.toLowerCase(),amount:parsed.args.amount}]:[];
});

test('real EVM pays three 15-minute rounds under 18-minute finality, preserving exact pending bytes and compensation',async()=>{
  const f=await native20Fixture(hre,{operatorIndex:3,name:'ROBINHOOK',symbol:'ROBIN',firstBuyWei:E/100n,feeProfile:'robin-native30'});
  const realNow=Date.now;
  try{
    const {provider,token,owner,ownerAddress,reward}=f;
    const portion=(await token.balanceOf(ownerAddress))/4n;
    await(await token.transfer(await f.alice.getAddress(),portion)).wait();
    await(await token.transfer(await f.bob.getAddress(),portion)).wait();
    await f.swap(owner,false,await token.balanceOf(ownerAddress));
    const launched=await provider.getBlock(f.launched.blockNumber),anchor=launched.timestamp;
    const operator=await f.keeper.getAddress();
    const c={...f.c,deploymentBlock:f.launched.blockNumber,minimumAgeSeconds:300,maxFinalityLagSeconds:1800,payoutStartTimestamp:anchor,
      execution:{mode:'local-only',operator,feeVault:await f.feeVault.getAddress(),payoutIntervalSeconds:900,
        confirmationMode:'pipelined-finalized-v1',maxInflightTransactions:8,
        maxGasPerTransactionWei:'200000000000000',maxTotalGasWei:'5000000000000000',
        minimumHarvestWei:String(E),minimumBatchWei:'1000000000',retryIntervalSeconds:3600,codeHashes:{}}};
    for(const name of ['token','hook','distributor','feeVault'])
      c.execution.codeHashes[name]=keccak256(await provider.getCode(name==='feeVault'?c.execution.feeVault:c[name]));
    const dir=temporary('executor-pipeline'),journalFile=path.join(dir,'journal.json');
    const wallet=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/3");
    assert.equal(await wallet.getAddress(),operator);
    let finalized=launched,clock=anchor,dropFirstBroadcast=true;
    const signs=[],broadcasts=[],payouts=[];
    const signer={getAddress:()=>wallet.getAddress(),signTransaction:async tx=>{
      signs.push({at:clock,tx});return wallet.signTransaction(tx);
    }};
    const rpc=alter(provider,{
      getBlock:tag=>provider.getBlock(tag==='finalized'?finalized.number:tag),
      getFeeData:async()=>({maxFeePerGas:41420000n,maxPriorityFeePerGas:0n}),
      broadcastTransaction:async raw=>{
        broadcasts.push(raw);if(dropFirstBroadcast){dropFirstBroadcast=false;throw timeout();}
        return provider.broadcastTransaction(raw);
      },
    });
    Date.now=()=>clock*1000;
    const at=async offset=>{
      await hre.network.provider.send('evm_setNextBlockTimestamp',[anchor+offset]);
      await hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas',[toBeHex(20710000n)]);
      await hre.network.provider.send('evm_mine');clock=(await provider.getBlock('latest')).timestamp;
      return provider.getBlock('latest');
    };
    const cycle=async(overrides={},target=dir)=>{
      clock=(await provider.getBlock('latest')).timestamp;
      return executeCycle(withReadOnlyRpcRetries(alter(rpc,overrides)),signer,c,target);
    };
    const tranche=E/100000n;
    await at(1800);await(await owner.sendTransaction({to:c.distributor,value:tranche})).wait();
    const firstCheckpoint=await at(2520);
    await at(2700);await(await owner.sendTransaction({to:c.distributor,value:tranche})).wait();
    const secondCheckpoint=await at(3420);
    await at(3599);await(await owner.sendTransaction({to:c.distributor,value:tranche})).wait();
    finalized=firstCheckpoint;
    const beforePayoutWorld=await hre.network.provider.send('evm_snapshot');

    // A separate operator transaction appearing while gas is estimated must be
    // caught by the final nonce check, before any signature or gas reservation.
    const racedDir=temporary('executor-pipeline-nonce-race');let nonceChanged=false;
    await assert.rejects(cycle({
      estimateGas:async(...args)=>{const units=await provider.estimateGas(...args);nonceChanged=true;return units;},
      getTransactionCount:async(...args)=>(await provider.getTransactionCount(...args))+(nonceChanged?1:0),
    },racedDir),/nonce changed/i);
    assert.equal(signs.length,0);assert.equal(broadcasts.length,0);
    assert.equal(readState(racedDir).pending,null);assert.equal(readState(racedDir).reservedGasWei,'0');

    // A timeout before acknowledgement is ambiguous. Durable reload must resend
    // precisely the same signed transaction, without reserving/signing again.
    const first=await cycle();assert.equal(first.state,'broadcast-uncertain');assert.equal(first.kind,'payout');
    const persisted=fs.readFileSync(journalFile,'utf8'),pending=readState(dir).pending;
    assert.equal(Transaction.from(pending.raw).hash,first.hash);assert.equal(signs.length,1);
    const receiptReadFailure={getTransactionReceipt:async()=>{throw timeout();}};
    await assert.rejects(cycle(receiptReadFailure),error=>operatorFailureStatus(error).code==='TRANSIENT_RPC_READ');
    assert.equal(fs.readFileSync(journalFile,'utf8'),persisted);assert.equal(signs.length,1);
    const beforeExpiry=await hre.network.provider.send('evm_snapshot'),expiredDir=copyState(dir,'executor-pipeline-expired');
    await at(3901);
    await assert.rejects(cycle({},expiredDir),/Unresolved signed payout expired/);
    assert.equal(signs.length,1);assert.equal(broadcasts.length,1);
    assert.equal(readState(expiredDir).pending.raw,pending.raw);
    assert.equal(await hre.network.provider.send('evm_revert',[beforeExpiry]),true);
    assert.equal((await cycle()).state,'rebroadcast');
    assert.equal(broadcasts.length,2);assert.equal(broadcasts[0],broadcasts[1]);assert.equal(signs.length,1);
    assert.equal(fs.readFileSync(journalFile,'utf8'),persisted);
    const recovered=await cycle();assert.equal(recovered.state,'mined');assert.equal(recovered.finalized,false);
    assert.equal(readState(dir).pending,null);assert.equal(readState(dir).round,null);
    assert.equal(readState(dir).inflight.length,1);
    assert.equal(readState(dir).schedule.nextDueAt,anchor+4500);
    const firstReceipt=await provider.getTransactionReceipt(first.hash),firstAllocations=receiptAllocations(firstReceipt,reward);
    assert.equal(firstAllocations.length,2);
    assert.equal(firstAllocations.reduce((sum,p)=>sum+p.amount,0n),tranche);
    payouts.push({hash:first.hash,receipt:firstReceipt,allocations:firstAllocations});
    const afterFirst=copyState(dir,'executor-pipeline-after-first');

    // An independently launched process has only these durable files; every
    // executeCycle below reconstructs its state rather than retaining a queue.
    const healthyBefore=fs.readFileSync(journalFile,'utf8');
    for(const method of ['getBlock','getTransactionReceipt']){
      await assert.rejects(cycle({[method]:async()=>{throw timeout();}}),error=>operatorFailureStatus(error).code==='TRANSIENT_RPC_READ');
      assert.equal(fs.readFileSync(journalFile,'utf8'),healthyBefore);assert.equal(signs.length,1);
    }
    for(const [label,overrides] of [
      ['unknown-nonce',{getTransactionCount:async(...args)=>(await provider.getTransactionCount(...args))+1}],
      ['dropped-receipt',{getTransactionReceipt:async hash=>hash===first.hash?null:provider.getTransactionReceipt(hash)}],
      ['changed-receipt-block',{getTransactionReceipt:async hash=>{
        const receipt=await provider.getTransactionReceipt(hash);return hash===first.hash?{...receipt,blockHash:toBeHex(1234,32)}:receipt;
      }}],
      ['changed-canonical-block',{getBlock:async tag=>{
        const block=await rpc.getBlock(tag);return tag===firstReceipt.blockNumber?{...block,hash:toBeHex(5678,32)}:block;
      }}],
      ['reverted-receipt',{getTransactionReceipt:async hash=>{
        const receipt=await provider.getTransactionReceipt(hash);return hash===first.hash?{...receipt,status:0}:receipt;
      }}],
    ]){
      const broken=copyState(afterFirst,`executor-pipeline-${label}`);
      await assert.rejects(cycle(overrides,broken),error=>operatorFailureStatus(error).state==='blocked',label);
      assert.equal(signs.length,1,label);assert.equal(readState(broken).reservedGasWei,readState(afterFirst).reservedGasWei,label);
    }
    assert.equal(fs.readFileSync(journalFile,'utf8'),healthyBefore);

    const thirdCheckpoint=await at(4320);await at(4500);finalized=secondCheckpoint;
    assert.ok(firstReceipt.blockNumber>finalized.number,'second payment must happen while first is unfinalized');
    const second=await cycle();assert.equal(second.state,'submitted');assert.equal(second.kind,'payout');
    const secondReceipt=await provider.getTransactionReceipt(second.hash),secondAllocations=receiptAllocations(secondReceipt,reward);
    payouts.push({hash:second.hash,receipt:secondReceipt,allocations:secondAllocations});
    assert.equal(secondAllocations.reduce((sum,p)=>sum+p.amount,0n),tranche);
    const secondState=readState(dir),secondReport=JSON.parse(fs.readFileSync(path.join(dir,'recovery-reports',`${secondState.round.id.slice(2)}.json`),'utf8'));
    const secondSnapshot=readSnapshot(path.join(dir,'snapshot.json'),c),expectedLedger=LossLedger.restore(secondSnapshot.ledger);
    for(const allocation of firstAllocations)expectedLedger.get(allocation.account).relief+=allocation.amount;
    const expectedLosses=new Map(expectedLedger.shortfalls({...secondSnapshot.oracle,now:secondSnapshot.checkpoint.timestamp}).map(p=>[p.account,p.loss.toString()]));
    assert.deepEqual(new Map(secondReport.eligiblePositions.map(p=>[p.account,p.loss])),expectedLosses,
      'unfinalized first compensation must reduce the second round loss exactly once');
    assert.equal((await cycle()).state,'mined');assert.equal(readState(dir).inflight.length,2);
    assert.equal(readState(dir).schedule.nextDueAt,anchor+5400);

    await at(5400);finalized=thirdCheckpoint;
    const third=await cycle();assert.equal(third.state,'submitted');assert.equal(third.kind,'payout');
    const thirdReceipt=await provider.getTransactionReceipt(third.hash),thirdAllocations=receiptAllocations(thirdReceipt,reward);
    payouts.push({hash:third.hash,receipt:thirdReceipt,allocations:thirdAllocations});
    assert.equal(thirdAllocations.reduce((sum,p)=>sum+p.amount,0n),tranche);
    assert.deepEqual(signs.map(s=>s.at-anchor),[3600,4500,5400]);
    assert.equal(new Set(payouts.map(p=>p.hash)).size,3);assert.equal(signs.length,3);
    assert.equal((await cycle()).state,'mined');
    const allMined=await at(5402);await at(6482);finalized=allMined;
    assert.equal((await cycle()).state,'idle');
    const complete=readState(dir),snapshot=readSnapshot(path.join(dir,'snapshot.json'),c),ledger=LossLedger.restore(snapshot.ledger);
    assert.equal(complete.pending,null);assert.equal(complete.round,null);assert.equal(complete.inflight.length,0);
    assert.equal(complete.history.filter(p=>p.kind==='payout').length,3);assert.equal(signs.length,3);
    for(const account of [await f.alice.getAddress(),await f.bob.getAddress()]){
      const amount=payouts.flatMap(p=>p.allocations).filter(p=>p.account===account.toLowerCase()).reduce((sum,p)=>sum+p.amount,0n);
      assert.equal(ledger.get(account).relief,amount,'finalized replay must fold reservations into relief exactly once');
    }
    assert.equal(await reward.available(),0n);
    assert.equal((await cycle()).state,'idle');assert.equal(signs.length,3,'durable recovery must not sign duplicate compensation');

    // Exercise a real local EVM reorganization after retaining the durable mined
    // record. The missing receipt must stop; a fresh payment is never signed.
    assert.equal(await hre.network.provider.send('evm_revert',[beforePayoutWorld]),true);
    finalized=firstCheckpoint;await at(3602);
    assert.equal(await provider.getTransactionReceipt(first.hash),null);
    const reorgDir=copyState(afterFirst,'executor-pipeline-real-reorg');
    await assert.rejects(cycle({},reorgDir),error=>operatorFailureStatus(error).state==='blocked');
    assert.equal(signs.length,3);assert.equal(readState(reorgDir).inflight[0].hash,first.hash);
  }finally{Date.now=realNow;f.provider.destroy();}
});

test('real EVM bounds the mined pipeline and resumes the original unpaid round after finality frees capacity',async()=>{
  const f=await native20Fixture(hre,{operatorIndex:15,name:'ROBINHOOK',symbol:'ROBIN',firstBuyWei:E/100n,feeProfile:'robin-native30'});
  const realNow=Date.now;
  try{
    const {provider,token,owner,ownerAddress,reward}=f,portion=(await token.balanceOf(ownerAddress))/18n;
    for(let i=1;i<=9;i++)await(await token.transfer(await(await provider.getSigner(i)).getAddress(),portion)).wait();
    await f.swap(owner,false,await token.balanceOf(ownerAddress));
    await(await owner.sendTransaction({to:await reward.getAddress(),value:9000000000000n})).wait();
    const launched=await provider.getBlock(f.launched.blockNumber),operator=await f.keeper.getAddress();
    const c={...f.c,deploymentBlock:f.launched.blockNumber,minimumAgeSeconds:300,maxFinalityLagSeconds:1800,
      batchSize:1,payoutStartTimestamp:launched.timestamp,
      execution:{mode:'local-only',operator,feeVault:await f.feeVault.getAddress(),payoutIntervalSeconds:900,
        confirmationMode:'pipelined-finalized-v1',maxInflightTransactions:8,
        maxGasPerTransactionWei:'200000000000000',maxTotalGasWei:'5000000000000000',
        minimumHarvestWei:String(E),minimumBatchWei:'1000000000',retryIntervalSeconds:3600,codeHashes:{}}};
    for(const name of ['token','hook','distributor','feeVault'])
      c.execution.codeHashes[name]=keccak256(await provider.getCode(name==='feeVault'?c.execution.feeVault:c[name]));
    await hre.network.provider.send('evm_setNextBlockTimestamp',[launched.timestamp+2000]);
    await hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas',[toBeHex(20710000n)]);
    await hre.network.provider.send('evm_mine');
    let finalized=await provider.getBlock('latest'),clock=finalized.timestamp,signs=0;
    const wallet=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/15");
    const signer={getAddress:()=>wallet.getAddress(),signTransaction:async tx=>{signs++;return wallet.signTransaction(tx);}};
    const rpc=alter(provider,{getBlock:tag=>provider.getBlock(tag==='finalized'?finalized.number:tag),
      getFeeData:async()=>({maxFeePerGas:41420000n,maxPriorityFeePerGas:0n})});
    Date.now=()=>clock*1000;
    const dir=temporary('executor-pipeline-bound'),receipts=[];
    const cycle=async()=>{clock=(await provider.getBlock('latest')).timestamp;return executeCycle(rpc,signer,c,dir);};
    let roundId;
    for(let i=0;i<8;i++){
      const submitted=await cycle();assert.equal(submitted.state,'submitted');assert.equal(submitted.kind,'payout');
      roundId??=readState(dir).round.id;assert.equal(readState(dir).round.id,roundId);
      receipts.push(await provider.getTransactionReceipt(submitted.hash));
      assert.equal((await cycle()).state,'mined');assert.equal(readState(dir).inflight.length,i+1);
    }
    assert.equal(signs,8);assert.equal(readState(dir).round.nextIndex,8);
    const blocked=await cycle();assert.equal(blocked.state,'waiting-for-finality');assert.equal(blocked.inflight,8);
    assert.match(blocked.reason,/Inflight transaction limit/);assert.equal(signs,8);
    finalized=await provider.getBlock(receipts[0].blockNumber);
    const resumed=await cycle();assert.equal(resumed.state,'submitted');assert.equal(resumed.kind,'payout');
    assert.equal(readState(dir).round.id,roundId);assert.equal(signs,9);
    receipts.push(await provider.getTransactionReceipt(resumed.hash));
    assert.equal((await cycle()).state,'mined');assert.equal(readState(dir).round,null);
    assert.equal(readState(dir).inflight.length,8);
    const paid=receipts.flatMap(receipt=>receiptAllocations(receipt,reward));
    assert.equal(paid.length,9);assert.equal(new Set(paid.map(p=>p.account)).size,9);
    assert.equal(paid.reduce((sum,p)=>sum+p.amount,0n),9000000000000n);
    assert.equal(await reward.available(),0n);
    finalized=await provider.getBlock('latest');assert.equal((await cycle()).state,'idle');
    assert.equal(readState(dir).inflight.length,0);assert.equal(readState(dir).history.length,9);assert.equal(signs,9);
  }finally{Date.now=realNow;f.provider.destroy();}
});

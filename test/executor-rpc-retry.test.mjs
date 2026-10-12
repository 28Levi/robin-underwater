import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {HDNodeWallet,Transaction,keccak256} from 'ethers';
import {native20Fixture,E} from './helpers/native20-fixture.mjs';
import {executeCycle} from '../src/executor.mjs';
import {withReadOnlyRpcRetries} from '../src/read-only-rpc-retry.mjs';
import {operatorFailureStatus} from '../src/operator-status.mjs';
import {runProductionOperatorLoop} from '../src/production-operator-loop.mjs';

process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');process.env.HARDHAT_NETWORK='hardhat';
const {default:hre}=await import('hardhat');
assert.equal(hre.network.name,'hardhat');assert.equal(hre.network.config.forking?.enabled??false,false);

test('transient reads preserve exact pending bytes, nonce, gas reservation and eventual recovery',async()=>{
  const f=await native20Fixture(hre,{name:'ROBINHOOK',symbol:'ROBIN',firstBuyWei:E/100n,feeProfile:'robin-native30'});
  const realNow=Date.now;
  try{
    const c={...f.c,minimumAgeSeconds:300,payoutStartTimestamp:(await f.provider.getBlock(f.launched.blockNumber)).timestamp,
      execution:{mode:'local-only',operator:f.ownerAddress,feeVault:await f.feeVault.getAddress(),
        maxGasPerTransactionWei:String(E),maxTotalGasWei:String(2n*E),minimumHarvestWei:'10000000000000',
        minimumBatchWei:'10000000000000',retryIntervalSeconds:3600,payoutIntervalSeconds:900,codeHashes:{}}};
    for(const name of ['token','hook','distributor','feeVault'])c.execution.codeHashes[name]=keccak256(await f.provider.getCode(name==='feeVault'?c.execution.feeVault:c[name]));
    await hre.network.provider.send('evm_increaseTime',[1900]);await hre.network.provider.send('evm_mine');
    fs.mkdirSync('output/test',{recursive:true});const dir=fs.mkdtempSync('output/test/executor-rpc-retry-');
    const journalFile=path.join(dir,'journal.json'),journal=()=>JSON.parse(fs.readFileSync(journalFile,'utf8')).state;
    const timeout=()=>Object.assign(new Error('private endpoint detail'),{code:'TIMEOUT'});
    let failFirstCode=true,failReceipt=false,dropFirstBroadcast=true,unknownNonce=false,badRuntime=false,signs=0;
    const sent=[];
    const rawProvider=new Proxy(f.provider,{get(target,key){
      if(key==='getCode')return async(...args)=>{if(failFirstCode){failFirstCode=false;throw timeout();}if(badRuntime)return '0x';return target.getCode(...args);};
      if(key==='getTransactionReceipt')return async(...args)=>{if(failReceipt){failReceipt=false;throw timeout();}return target.getTransactionReceipt(...args);};
      if(key==='getTransactionCount')return async(...args)=>(await target.getTransactionCount(...args))+(unknownNonce?1:0);
      if(key==='broadcastTransaction')return async raw=>{sent.push(raw);if(dropFirstBroadcast){dropFirstBroadcast=false;throw timeout();}return target.broadcastTransaction(raw);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    const provider=withReadOnlyRpcRetries(rawProvider),wallet=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
    const signer={getAddress:()=>wallet.getAddress(),signTransaction:async tx=>{signs++;return wallet.signTransaction(tx);}};
    const cycle=async()=>{const head=await f.provider.getBlock('latest');Date.now=()=>head.timestamp*1000;return executeCycle(provider,signer,c,dir);};
    const stop=new AbortController(),statuses=[],waits=[];
    await runProductionOperatorLoop({signal:stop.signal,cycle,report:s=>statuses.push(s),wait:async ms=>{
      waits.push(ms);if(statuses.at(-1).state==='broadcast-uncertain')stop.abort();}});
    assert.equal(statuses[0].code,'TRANSIENT_RPC_READ');assert.equal(statuses[1].state,'broadcast-uncertain');
    assert.deepEqual(waits,[30000,30000]);assert.equal(signs,1);assert.equal(sent.length,1);
    const persisted=fs.readFileSync(journalFile,'utf8'),pending=journal().pending;
    assert.equal(Transaction.from(pending.raw).hash,pending.hash);

    failReceipt=true;
    await assert.rejects(cycle(),error=>operatorFailureStatus(error).code==='TRANSIENT_RPC_READ');
    assert.equal(fs.readFileSync(journalFile,'utf8'),persisted);assert.equal(signs,1);assert.equal(sent.length,1);

    unknownNonce=true;
    await assert.rejects(cycle(),error=>/unknown transaction/.test(error.message)&&operatorFailureStatus(error).state==='blocked');
    assert.equal(fs.readFileSync(journalFile,'utf8'),persisted);unknownNonce=false;
    badRuntime=true;
    await assert.rejects(cycle(),error=>/runtime changed/.test(error.message)&&operatorFailureStatus(error).state==='blocked');
    assert.equal(fs.readFileSync(journalFile,'utf8'),persisted);badRuntime=false;

    const recovery=await cycle();assert.equal(recovery.state,'rebroadcast');assert.equal(recovery.hash,pending.hash);
    assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);assert.equal(signs,1);
    assert.equal(fs.readFileSync(journalFile,'utf8'),persisted);
    assert.equal((await cycle()).state,'confirmed');
    assert.equal(journal().pending,null);assert.equal(journal().history.at(-1).hash,pending.hash);
    assert.equal(journal().reservedGasWei,JSON.parse(persisted).state.reservedGasWei);assert.equal(signs,1);
  }finally{Date.now=realNow;f.provider.destroy();}
});

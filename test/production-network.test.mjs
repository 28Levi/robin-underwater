import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {verifyProductionNetwork,ROBINHOOD_ANCHOR,POOL_MANAGER} from '../src/production-network.mjs';
import {executionPolicy,executeCycle} from '../src/executor.mjs';
const code=fs.readFileSync('research/current/poolManager-runtime.txt','utf8'),now=1800000000;
const c={chainId:4663,poolManager:POOL_MANAGER,maxFinalityLagSeconds:7200};
const provider={getNetwork:async()=>({chainId:4663n}),getCode:async()=>code,getBlock:async n=>n===ROBINHOOD_ANCHOR.blockNumber?
 {hash:ROBINHOOD_ANCHOR.blockHash}:{number:ROBINHOOD_ANCHOR.blockNumber+100,timestamp:now-60}};
test('production verification requires canonical chain history, runtime and historical RPC state',async()=>{
 assert.ok((await verifyProductionNetwork(provider,c,{now})).finalized);
 await assert.rejects(verifyProductionNetwork({...provider,getNetwork:async()=>({chainId:31337n})},c,{now}),/Wrong production chain/);
 await assert.rejects(verifyProductionNetwork({...provider,getCode:async()=> '0x'},c,{now}),/runtime changed/);
 await assert.rejects(verifyProductionNetwork({...provider,getBlock:async()=>({hash:'0xwrong'})},c,{now}),/anchor mismatch/);
 await assert.rejects(verifyProductionNetwork({...provider,getCode:async(_,block)=>block?Promise.reject(Error('archive required')):code},c,{now}),/archive required/);
 await assert.rejects(verifyProductionNetwork(provider,c,{now:now+9000}),/stale/);
});
test('production execution cannot sign or broadcast until explicit activation and budgets exist',async()=>{
 const execution={mode:'production',broadcastEnabled:false,operator:'0x'+'1'.repeat(40),feeVault:'0x'+'2'.repeat(40),
  codeHashes:Object.fromEntries(['token','hook','distributor','feeVault'].map(n=>[n,'0x'+'a'.repeat(64)])),
  maxGasPerTransactionWei:'1',maxTotalGasWei:'1',minimumHarvestWei:'1',minimumBatchWei:'1',retryIntervalSeconds:3600};
 const config={...c,hookFlavor:'native20',batchSize:100,execution};
 assert.equal(executionPolicy(config).mode,'production');
 assert.throws(()=>executionPolicy({...config,execution:{...execution,maxTotalGasWei:null}}),/Missing positive/);
 let touched=false;
 const forbidden=new Proxy({}, {get(){touched=true;throw Error('Must not touch provider or signer');}});
 const dir=fs.mkdtempSync('output/test/production-');
 await assert.rejects(executeCycle(forbidden,forbidden,config,dir),/not activated/);assert.equal(touched,false);
});

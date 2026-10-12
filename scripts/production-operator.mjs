import fs from 'node:fs';import path from 'node:path';
import {FetchRequest,JsonRpcProvider,Wallet} from 'ethers';
import {loadConfig} from '../src/config.mjs';import {executionPolicy,verifyExecution,executeCycle} from '../src/executor.mjs';
import {atomicWrite} from '../src/store.mjs';
import {withReadOnlyRpcRetries,assertOperatorRunning} from '../src/read-only-rpc-retry.mjs';
import {runProductionOperatorLoop} from '../src/production-operator-loop.mjs';

const c=loadConfig(process.argv[2]),check=process.argv.includes('--check'),send=process.argv.includes('--send');
if(check===send||c.execution?.mode!=='production')throw Error('Use a production config and exactly one of --check or --send');
const e=executionPolicy(c),rpc=process.env[c.rpcUrlEnvironment];
if(!rpc||new URL(rpc).protocol!=='https:')throw Error('Set an HTTPS production RPC URL');
const stop=new AbortController();process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
const request=new FetchRequest(rpc);request.timeout=20000;
const provider=withReadOnlyRpcRetries(new JsonRpcProvider(request),{signal:stop.signal}),dir=process.env.ROBIN_STATE_DIRECTORY??'output/production';
try{
 if(check){
  await verifyExecution(provider,{getAddress:async()=>e.operator},c,e);
  console.log(JSON.stringify({status:'deployment-verified',broadcastEnabled:e.broadcastEnabled===true,signing:false,broadcast:false,
   operator:e.operator,operatorBalanceWei:(await provider.getBalance(e.operator)).toString()}));
 }else{
  if(e.broadcastEnabled!==true)throw Error('Production broadcasting is not activated');
  // Secret files are mounted by the host. Neither private keys nor passwords belong in this repo or chat.
  const keystore=process.env.ROBIN_KEYSTORE_FILE,passwordFile=process.env.ROBIN_KEYSTORE_PASSWORD_FILE;
  if(!keystore||!passwordFile)throw Error('Configure the operator encrypted keystore and password secret mounts');
  const wallet=await Wallet.fromEncryptedJson(fs.readFileSync(keystore,'utf8'),fs.readFileSync(passwordFile,'utf8').replace(/\r?\n$/,''));
  const signer={getAddress:()=>wallet.getAddress(),signTransaction:tx=>{assertOperatorRunning(stop.signal);return wallet.signTransaction(tx);}};
  const result=await runProductionOperatorLoop({signal:stop.signal,once:process.argv.includes('--once'),
   cycle:()=>executeCycle(provider,signer,c,dir),report:status=>{
    atomicWrite(path.join(dir,'status.json'),{...status,checkedAt:new Date().toISOString()});console.log(JSON.stringify(status));
   }});
  if(result.blocked)process.exitCode=2;
 }
}catch{console.error('Production verification or startup failed; no secret values printed. Check configuration, RPC and operator custody.');process.exitCode=2;
}finally{provider.destroy();}

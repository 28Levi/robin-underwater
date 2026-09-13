import fs from 'node:fs';import path from 'node:path';
import {JsonRpcProvider,Wallet} from 'ethers';import {setTimeout as delay} from 'node:timers/promises';
import {loadConfig} from '../src/config.mjs';import {executionPolicy,verifyExecution,executeCycle} from '../src/executor.mjs';
import {atomicWrite} from '../src/store.mjs';

const c=loadConfig(process.argv[2]),check=process.argv.includes('--check'),send=process.argv.includes('--send');
if(check===send||c.execution?.mode!=='production')throw Error('Use a production config and exactly one of --check or --send');
const e=executionPolicy(c),rpc=process.env[c.rpcUrlEnvironment];
if(!rpc||new URL(rpc).protocol!=='https:')throw Error('Set an HTTPS production RPC URL');
const provider=new JsonRpcProvider(rpc),dir=process.env.ROBIN_STATE_DIRECTORY??'output/production';
const stop=new AbortController();process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
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
  const signer=await Wallet.fromEncryptedJson(fs.readFileSync(keystore,'utf8'),fs.readFileSync(passwordFile,'utf8').replace(/\r?\n$/,''));
  do{
   let status;
   try{status=await executeCycle(provider,signer,c,dir);}catch(error){
    const deferred=['Head changed during preparation; rebuild next cycle','Head changed during estimation; rebuild next cycle'].includes(error.message);
    const waiting=['Missing window history','Deployment is not finalized','Wait for previous reward allocations to finalize before another plan'].includes(error.message);
    status=deferred||waiting?{state:'waiting',reason:'Waiting for stable finalized history'}:{state:'blocked',reason:'Operator stopped; reconcile deployment, RPC, funding and durable journal before restart'};
   }
   atomicWrite(path.join(dir,'status.json'),{...status,checkedAt:new Date().toISOString()});console.log(JSON.stringify(status));
   if(status.state==='blocked'){process.exitCode=2;break;}
   if(process.argv.includes('--once'))break;
   try{await delay(30_000,undefined,{signal:stop.signal});}catch{break;}
  }while(!stop.signal.aborted);
 }
}catch{console.error('Production verification or startup failed; no secret values printed. Check configuration, RPC and operator custody.');process.exitCode=2;
}finally{provider.destroy();}

import {JsonRpcProvider,Wallet} from 'ethers';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {loadConfig} from '../src/config.mjs';
import {executeCycle} from '../src/executor.mjs';
import {atomicWrite} from '../src/store.mjs';

const c=loadConfig(process.argv[2]);
if(c.execution?.mode!=='local-only')throw Error('Only local EVM execution is currently supported');
const rpc=process.env[c.rpcUrlEnvironment],key=process.env.ROBIN_LOCAL_OPERATOR_PRIVATE_KEY;
if(!rpc||!key)throw Error('Set the local RPC URL and ROBIN_LOCAL_OPERATOR_PRIVATE_KEY for your local test operator');
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(rpc).hostname))throw Error('The local executor requires a loopback RPC URL');
const provider=new JsonRpcProvider(rpc),signer=new Wallet(key),once=process.argv.includes('--once');
const stateDirectory=process.env.ROBIN_STATE_DIRECTORY??'output/executor';
const stop=new AbortController();process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
try{
 do{
  let status;
  try{status=await executeCycle(provider,signer,c,stateDirectory);}catch(error){
   // Never print signed bytes, secrets or credential-bearing RPC exception bodies.
   const moved=['Head changed during preparation; rebuild next cycle','Head changed during estimation; rebuild next cycle'].includes(error.message);
   const waiting=['Missing window history','Deployment is not finalized','Wait for previous reward allocations to finalize before another plan'].includes(error.message);
   status=moved?{state:'deferred',reason:'Chain head moved during preparation; retry on the next cycle'}
    :waiting?{state:'waiting-for-history',reason:'Waiting for finalized deployment, price history or previous allocations'}
     :{state:'blocked',reason:'Execution stopped. Reconcile the local configuration, gas budget and journal before restarting.'};
  }
  atomicWrite(path.join(stateDirectory,'status.json'),{...status,checkedAt:new Date().toISOString()});console.log(JSON.stringify(status));
  if(status.state==='blocked'){process.exitCode=2;break;}
  if(once)break;
  try{await delay(30_000,undefined,{signal:stop.signal});}catch{break;}
 }while(!stop.signal.aborted);
}finally{provider.destroy();}

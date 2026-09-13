import {JsonRpcProvider} from 'ethers';
import {setTimeout as delay} from 'node:timers/promises';
import {loadConfig} from '../src/config.mjs';
import {acquireLock} from '../src/store.mjs';
import {runCycle} from '../src/worker.mjs';
const c=loadConfig(process.argv[2]),rpc=process.env[c.rpcUrlEnvironment];if(!rpc)throw Error('Missing configured RPC URL');
const once=process.argv.includes('--once');
const release=acquireLock('output/operator.lock'),provider=new JsonRpcProvider(rpc);
const stop=new AbortController();process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
try{
 do{
  const status=await runCycle(provider,c);console.log(JSON.stringify(status));
  if(once){if(status.state==='blocked')process.exitCode=2;break;}
  try{await delay(30_000,undefined,{signal:stop.signal});}catch{break;}
 }while(!stop.signal.aborted);
}finally{provider.destroy();release();}

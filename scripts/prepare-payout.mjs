import {JsonRpcProvider} from 'ethers';
import {loadConfig} from '../src/config.mjs';
import {readSnapshot,atomicWrite,acquireLock} from '../src/store.mjs';
import {preparePlan} from '../src/payout-plan.mjs';
const c=loadConfig(process.argv[2]),rpc=process.env[c.rpcUrlEnvironment];if(!rpc)throw Error('Missing configured RPC URL');
const release=acquireLock('output/operator.lock'),provider=new JsonRpcProvider(rpc);
try{
 const snapshot=readSnapshot(process.argv[3]??'output/snapshot.json',c);if(!snapshot)throw Error('Run snapshot first');
 const plan=await preparePlan(provider,c,snapshot);atomicWrite('output/payout-plan.json',plan);
 console.log(`Prepared ${plan.transactions.length} unsigned batches. No transaction sent.`);
}finally{provider.destroy();release();}

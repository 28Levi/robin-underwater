import {JsonRpcProvider} from 'ethers';
import {loadConfig} from '../src/config.mjs';
import {buildSnapshot} from '../src/replay.mjs';
import {readSnapshot,writeSnapshot,acquireLock} from '../src/store.mjs';
const c=loadConfig(process.argv[2]),rpc=process.env[c.rpcUrlEnvironment];
if(!rpc)throw Error('Missing configured RPC URL');
const release=acquireLock('output/operator.lock'),provider=new JsonRpcProvider(rpc);
try{
 const snapshot=await buildSnapshot(provider,c,readSnapshot('output/snapshot.json',c));
 writeSnapshot('output/snapshot.json',c,snapshot);
 console.log(`Finalized block ${snapshot.checkpoint.blockNumber}; ${snapshot.transactionsReplayed} new transactions replayed.`);
}finally{provider.destroy();release();}

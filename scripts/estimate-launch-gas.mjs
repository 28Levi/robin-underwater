import fs from 'node:fs';
import {JsonRpcProvider} from 'ethers';
import {estimateLaunchGas} from '../src/launch-gas.mjs';
import {atomicWrite} from '../src/store.mjs';
import {stringify} from '../src/ledger.mjs';

const file=process.argv[2];
if(!file){console.error('Usage: npm run estimate:gas -- <official-wallet-transaction.json> [fresh-capabilities.json]');process.exit(2);}
if(!process.env.ROBIN_RPC_URL){console.error('Set ROBIN_RPC_URL; no wallet key is needed.');process.exit(2);}
const provider=new JsonRpcProvider(process.env.ROBIN_RPC_URL);
try{
 const exported=JSON.parse(fs.readFileSync(file,'utf8'));
 const intent=JSON.parse(fs.readFileSync('launch-intent.json','utf8'));
 const capabilities=JSON.parse(fs.readFileSync(process.argv[3]??'research/capabilities.json','utf8'));
 const report=await estimateLaunchGas(provider,intent,exported.walletTransaction??exported,capabilities);
 atomicWrite('output/launch-gas-estimate.json',report);console.log(stringify(report));
}catch(error){
 // RPC error bodies can include credential-bearing URLs. Never print them.
 const safe=/^(Wrong |Invalid |Transaction differs|Launch transaction expired|Launch router code|Gas estimate unavailable|Gas price unavailable)/.test(error.message);
 console.error(safe?error.message:'Unable to estimate this transaction; check the package and RPC configuration. No transaction sent.');process.exitCode=2;
}finally{provider.destroy();}

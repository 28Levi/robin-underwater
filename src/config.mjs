import fs from 'node:fs';import {address} from './ledger.mjs';
export function loadConfig(file){
 if(!file)throw Error('Provide config.local.json');const c=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const f of ['token','hook','distributor','poolManager'])c[f]=address(c[f]??'');
 if(c.hookFlavor!==undefined&&!['prototype','native20'].includes(c.hookFlavor))throw Error('Invalid hook flavor');
 if(c.hookFlavor==='native20')c.initializer=address(c.initializer??'');
 if(!/^0x[0-9a-fA-F]{64}$/.test(c.poolId??''))throw Error('Missing poolId');c.poolId=c.poolId.toLowerCase();
 for(const f of ['chainId','deploymentBlock','minimumAgeSeconds','twapWindowSeconds','maxOracleAgeSeconds','maxSnapshotAgeSeconds','batchSize'])
  if(!Number.isSafeInteger(c[f])||c[f]<0)throw Error(`Invalid ${f}`);
 if(c.chainId!==4663&&c.chainId!==31337)throw Error('Only intended Robinhood chain or local test chain is supported');
 if(c.batchSize<1||c.batchSize>100||c.twapWindowSeconds===0)throw Error('Invalid batch/window size');
 if(!Array.isArray(c.excludedAddresses))throw Error('Missing excludedAddresses');c.excludedAddresses=c.excludedAddresses.map(address);
 if(c.hookFlavor==='native20')c.excludedAddresses=[...new Set([...c.excludedAddresses,c.initializer])];
 if(c.maxFinalityLagSeconds!==undefined&&(!Number.isSafeInteger(c.maxFinalityLagSeconds)||c.maxFinalityLagSeconds<1))throw Error('Invalid maxFinalityLagSeconds');
 if(!/^[A-Z][A-Z0-9_]*$/.test(c.rpcUrlEnvironment??''))throw Error('Invalid RPC environment variable name');
 return c;
}

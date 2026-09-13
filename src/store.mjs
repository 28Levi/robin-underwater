import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {stringify,LEDGER_VERSION} from './ledger.mjs';
const hash=s=>'0x'+createHash('sha256').update(s).digest('hex');
export function fingerprint(c){
 const {chainId,token,hook,hookFlavor,initializer,distributor,poolManager,poolId,deploymentBlock,excludedAddresses,
  minimumAgeSeconds,twapWindowSeconds,maxOracleAgeSeconds}=c;
 return hash(stringify({ledgerVersion:LEDGER_VERSION,chainId,token,hook,hookFlavor,initializer,distributor,poolManager,poolId,deploymentBlock,excludedAddresses,
  minimumAgeSeconds,twapWindowSeconds,maxOracleAgeSeconds}));
}
export function atomicWrite(file,value) {
 fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${randomUUID()}.tmp`,fd=fs.openSync(temp,'wx',0o600);
 try{fs.writeFileSync(fd,stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);
}
export function writeSnapshot(file,c,snapshot){const payload=stringify(snapshot);
 atomicWrite(file,{schemaVersion:'robin.snapshot.v1',configHash:fingerprint(c),payloadHash:hash(payload),payload});}
export function readSnapshot(file,c){
 if(!fs.existsSync(file))return null;const stored=JSON.parse(fs.readFileSync(file,'utf8'));
 if(stored.schemaVersion!=='robin.snapshot.v1'||stored.configHash!==fingerprint(c)||stored.payloadHash!==hash(stored.payload))
  throw Error('Snapshot integrity/config mismatch; do not reuse for payouts');
 return JSON.parse(stored.payload);
}
export function acquireLock(file){
 fs.mkdirSync(path.dirname(file),{recursive:true});let fd;
 try{fd=fs.openSync(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Another worker or stale lock exists; reconcile before restarting');throw e;}
 fs.writeFileSync(fd,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));fs.closeSync(fd);
 return ()=>fs.unlinkSync(file);
}

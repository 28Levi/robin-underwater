import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Execute the real supervisor control flow with offline process/RPC/feed
// boundaries. No signer, child operator, network or existing state is touched.
const supervisor=fs.readFileSync(new URL('../scripts/watch-launch.mjs',import.meta.url),'utf8');
const stubs=String.raw`
import fs from 'node:fs';import path from 'node:path';import {EventEmitter} from 'node:events';
const dir=process.env.FIXTURE_DIRECTORY,mode=process.env.FIXTURE_MODE;
const record=(event,extra={})=>fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({event,...extra})+'\n');
let cycles=0;
export class FetchRequest {constructor(url){if(url!=='https://offline.invalid')throw Error('Wrong test URL');}}
export class JsonRpcProvider {destroy(){record('provider-destroy');}}
export const acquireLock=()=>{record('supervisor-lock');return()=>record('supervisor-unlock');};
export const atomicWrite=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
export async function runLaunchBootstrapCycle(_provider,manifest,_directory,options){
 cycles++;record('verify-gate',{cycle:cycles});
 if(manifest.id!=='exact-reviewed-manifest'||options.expectedManifestSha256!=='sha256:fixture'
  ||options.approvedManifestSha256!=='sha256:fixture'||options.sourceRevision!=='fixture-reviewed-revision')throw Error('Gate inputs changed');
 if(mode==='verification-fails'&&cycles===2)throw Error('Exact financial verification failed');
 return {state:mode==='unapproved'?'waiting-for-user-review':'activated',automaticRewardsApproved:mode!=='unapproved',
  readOnlyConfig:path.join(dir,'feed-config.json'),operatorConfig:path.join(dir,'operator-config.json')};
}
export function walletFeedIntervalSeconds(value){if(value==='invalid')throw Error('Invalid display interval');return 300;}
export async function runWalletFeedCycle(){
 record('feed-start');await new Promise(resolve=>setTimeout(resolve,30));record('feed-failure');
 throw Error('Optional feed lock/write error: mock-private-value-must-not-be-logged');
}
export function spawn(_node,args,options){
 if(path.basename(args[0])!=='production-operator.mjs'||args[1]!==path.join(dir,'operator-config.json')||args[2]!=='--send'
  ||options.env.ROBIN_STATE_DIRECTORY!==path.join(dir,'state','operator'))throw Error('Unbound operator invocation');
 record('operator-start');const child=new EventEmitter();child.kill=signal=>{record('operator-stop',{signal});child.emit('exit',0);return true;};return child;
}
export async function delay(){
 record('loop-delay');if(mode==='verification-fails'&&cycles===1)return;
 record('termination-signal');process.emit('SIGTERM');
}
`;
function run(mode,{publisherMismatch=false,invalidInterval=false,stopMarker=false,badFeedConfig=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'main-watch-feed-isolation-'));
 try{
  let source=supervisor;
  for(const [original,replacement]of [
   ["import {spawn} from 'node:child_process';","import {spawn} from './stubs.mjs';"],
   ["import {FetchRequest, JsonRpcProvider} from 'ethers';","import {FetchRequest, JsonRpcProvider} from './stubs.mjs';"],
   ["import {setTimeout as delay} from 'node:timers/promises';","import {delay} from './stubs.mjs';"],
   ["from '../src/launch-bootstrap.mjs'","from './stubs.mjs'"],
   ["from '../src/wallet-feed.mjs'","from './stubs.mjs'"],
   ["from '../src/store.mjs'","from './stubs.mjs'"],
  ]){assert.ok(source.includes(original));source=source.replace(original,replacement);}
  fs.writeFileSync(path.join(dir,'watch-launch.mjs'),source);fs.writeFileSync(path.join(dir,'stubs.mjs'),stubs);
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({id:'exact-reviewed-manifest'}));
  fs.writeFileSync(path.join(dir,'feed-config.json'),badFeedConfig?'invalid-json':'{}');
  fs.writeFileSync(path.join(dir,'operator-config.json'),'{}');
  if(stopMarker){fs.mkdirSync(path.join(dir,'state'));fs.writeFileSync(path.join(dir,'state/operator-stopped.json'),'{}');}
  const env={SystemRoot:process.env.SystemRoot??'',FIXTURE_DIRECTORY:dir,FIXTURE_MODE:mode,
   ROBIN_RPC_URL:'https://offline.invalid',ROBIN_LAUNCH_STATE_DIRECTORY:path.join(dir,'state'),
   ROBIN_SOURCE_REVISION:'fixture-reviewed-revision',ROBIN_AUTOMATION_APPROVED_MANIFEST_SHA256:'sha256:fixture',
   ...(publisherMismatch?{ROBIN_WALLET_FEED_URL:'https://offline.invalid/api/wallet-snapshot'}:{}),
   ...(invalidInterval?{ROBIN_WALLET_FEED_INTERVAL_SECONDS:'invalid'}:{})};
  const result=spawnSync(process.execPath,[path.join(dir,'watch-launch.mjs'),'--manifest',path.join(dir,'manifest.json'),
   '--manifest-sha256','sha256:fixture','--loop','--services'],{env,encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(result.stdout+result.stderr,/mock-private-value|lock\/write error/);
  return {events:fs.readFileSync(path.join(dir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse),
   statuses:result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse)};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('slow failing optional feed runs after approved operator startup and cannot stop it',()=>{
 const {events,statuses}=run('feed-fails'),names=events.map(e=>e.event);
 assert.ok(names.indexOf('verify-gate')<names.indexOf('operator-start'));
 assert.ok(names.indexOf('operator-start')<names.indexOf('feed-start'));
 assert.ok(names.indexOf('feed-failure')<names.indexOf('termination-signal'));
 assert.ok(names.indexOf('operator-stop')>names.indexOf('termination-signal'));
 assert.equal(statuses[0].state,'activated');assert.equal(statuses[0].walletFeed,'unavailable');
 assert.equal(statuses[0].operator,'running-under-reviewed-gate');
});

test('optional publication, interval and local feed config failures leave the financial gate intact',()=>{
 for(const options of [{publisherMismatch:true},{invalidInterval:true},{badFeedConfig:true}]){
  const {events,statuses}=run('feed-fails',options);
  assert.equal(events.filter(e=>e.event==='operator-start').length,1);assert.equal(events.some(e=>e.event==='feed-start'),false);
  assert.equal(statuses[0].walletFeed,'unavailable');assert.equal(statuses[0].operator,'running-under-reviewed-gate');
 }
});

test('feed failure cannot bypass absent authorization or an existing operator stop marker',()=>{
 for(const [mode,options]of [['unapproved',{}],['feed-fails',{stopMarker:true}]]){
  const {events,statuses}=run(mode,options);assert.equal(events.some(e=>e.event==='operator-start'),false);
  assert.equal(statuses[0].walletFeed,'unavailable');
  assert.equal(statuses[0].operator,options.stopMarker?'blocked-reconciliation-required':'not-started');
 }
});

test('a subsequent financial verification failure still stops the running operator',()=>{
 const {events,statuses}=run('verification-fails'),names=events.map(e=>e.event);
 assert.equal(events.filter(e=>e.event==='operator-start').length,1);
 assert.ok(names.indexOf('operator-stop')<names.indexOf('termination-signal'));
 assert.equal(statuses[1].state,'blocked');assert.equal(statuses[1].signing,false);assert.equal(statuses[1].broadcast,false);
});

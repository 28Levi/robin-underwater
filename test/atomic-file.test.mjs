import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createAtomicFileWriter, atomicFileFailureStatus} from '../src/atomic-file.mjs';
import {atomicWrite, acquireLock, writeSnapshot, readSnapshot} from '../src/store.mjs';
import {operatorFailureStatus} from '../src/operator-status.mjs';
import {runProductionOperatorLoop} from '../src/production-operator-loop.mjs';
import {stringify} from '../src/ledger.mjs';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../output/test/atomic-file-faults');
const secret = 'SHOULD_NOT_APPEAR';
const failure = code => Object.assign(new Error(`https://rpc.invalid/${secret}`), {
  code, path: secret, dest: secret, cause: {privateKey: secret}, extra: secret});
const digest = text => createHash('sha256').update(text).digest('hex');

function fixture(t, {faults = [], platform = 'win32', failStage, faultCode = 'EIO'} = {}) {
  fs.mkdirSync(fixtures, {recursive:true});
  const dir = fs.mkdtempSync(path.join(fixtures, 'atomic-'));
  t.after(() => {
    assert.ok(dir.startsWith(fixtures + path.sep));fs.rmSync(dir, {recursive:true,force:true});
  });
  const file = path.join(dir, 'snapshot.json'), temp = `${file}.one-exclusive-id.tmp`;
  const oldBytes = '{"old":"state"}\n', bytes = '{"new":"fixed","amount":"19"}\n';
  fs.writeFileSync(file, oldBytes);
  const events = [], waits = [], renames = [], seenTemps = [];
  let idCalls = 0, retry = 0;
  const io = new Proxy(fs, {get(target, key) {
    const value = target[key];
    if (typeof value !== 'function') return value;
    return (...args) => {
      events.push(key);
      if (key === 'openSync') {
        assert.equal(args[0], temp);assert.equal(args[1], 'wx');assert.equal(args[2], 0o600);
      }
      if (key === 'renameSync') {
        renames.push([...args]);assert.deepEqual(args, [temp, file]);
        assert.equal(fs.readFileSync(file, 'utf8'), oldBytes);
        const content = fs.readFileSync(temp, 'utf8');assert.equal(content, bytes);
        seenTemps.push({bytes:digest(content), ino:fs.statSync(temp).ino});
        const code = faults[retry++];if (code) throw failure(code);
      }
      if (key === failStage) {
        // Release the fixture descriptor before simulating an uncertain close outcome.
        if (key === 'closeSync') value.apply(target, args);
        throw failure(faultCode);
      }
      return value.apply(target, args);
    };
  }});
  const writer = createAtomicFileWriter({io, platform, makeId:() => {idCalls++;return 'one-exclusive-id';},
    wait:ms => {waits.push(ms);assert.equal(fs.readFileSync(temp,'utf8'),bytes);}});
  return {dir,file,temp,bytes,oldBytes,writer,events,waits,renames,seenTemps,get idCalls(){return idCalls;}};
}

test('Windows sharing failures retry only one closed, synced, immutable temp until successful replacement', t => {
  const f = fixture(t,{faults:['EPERM','EBUSY','EPERM']});f.writer(f.file,f.bytes);
  assert.equal(fs.readFileSync(f.file,'utf8'),f.bytes);assert.equal(fs.existsSync(f.temp),false);
  assert.deepEqual(f.waits,[10,25,50]);assert.equal(f.idCalls,1);
  assert.deepEqual(f.events,['mkdirSync','openSync','writeFileSync','fsyncSync','closeSync',
    'renameSync','renameSync','renameSync','renameSync']);
  assert.equal(new Set(f.seenTemps.map(item=>item.bytes)).size,1);
  assert.equal(new Set(f.seenTemps.map(item=>item.ino)).size,1);
});

test('six failed Windows rename attempts preserve original destination and synced temp with bounded diagnostics', t => {
  const f=fixture(t,{faults:Array(20).fill('EPERM')});let error;
  try {f.writer(f.file,f.bytes);} catch(caught) {error=caught;}
  assert.ok(error);assert.deepEqual(f.waits,[10,25,50,100,200]);assert.equal(f.renames.length,6);
  assert.equal(fs.readFileSync(f.file,'utf8'),f.oldBytes);assert.equal(fs.readFileSync(f.temp,'utf8'),f.bytes);
  assert.deepEqual(atomicFileFailureStatus(error).filesystem,{stage:'rename',errorCode:'EPERM',
    renameAttempts:6,renameRetries:5,retryDelayMs:385});
  assert.equal(operatorFailureStatus(error).state,'blocked');
  assert.doesNotMatch(JSON.stringify(atomicFileFailureStatus(error))+String(error)+JSON.stringify(error),/SHOULD_NOT_APPEAR|rpc\.invalid/);
});

test('EACCES and other non-sharing errors fail immediately without rename fallback or file cleanup', t => {
  for(const code of ['EACCES','ENOENT','EXDEV','ENOSPC','EIO','EROFS','EEXIST','NOT_A_SAFE_CODE']) {
    const f=fixture(t,{faults:[code]});let error;
    try {f.writer(f.file,f.bytes);}catch(caught){error=caught;}
    assert.equal(f.renames.length,1);assert.deepEqual(f.waits,[]);
    assert.equal(fs.readFileSync(f.file,'utf8'),f.oldBytes);assert.equal(fs.readFileSync(f.temp,'utf8'),f.bytes);
    assert.equal(atomicFileFailureStatus(error).filesystem.errorCode,code==='NOT_A_SAFE_CODE'?'UNKNOWN':code);
    assert.equal(f.events.some(name=>['unlinkSync','copyFileSync','truncateSync'].includes(name)),false);
  }
});

test('non-Windows hosts never retry even EPERM or EBUSY',t=>{
  for(const platform of ['linux','darwin'])for(const code of ['EPERM','EBUSY']) {
    const f=fixture(t,{faults:[code],platform});assert.throws(()=>f.writer(f.file,f.bytes));
    assert.equal(f.renames.length,1);assert.deepEqual(f.waits,[]);
  }
});

test('pre-rename faults close open handles and never retry or replace the destination',t=>{
  for(const [method,stage] of [['mkdirSync','mkdir'],['openSync','open'],['writeFileSync','write'],
    ['fsyncSync','fsync'],['closeSync','close']]) {
    const f=fixture(t,{failStage:method,faultCode:'EBUSY'});let error;
    try {f.writer(f.file,f.bytes);}catch(caught){error=caught;}
    assert.equal(atomicFileFailureStatus(error).filesystem.stage,stage);
    assert.equal(f.renames.length,0);assert.deepEqual(f.waits,[]);
    assert.equal(fs.readFileSync(f.file,'utf8'),f.oldBytes);
    if(['write','fsync','close'].includes(stage))assert.equal(f.events.filter(x=>x==='closeSync').length,1);
  }
});

test('exclusive temp collision cannot overwrite existing evidence',t=>{
  const f=fixture(t);fs.writeFileSync(f.temp,'existing evidence');let error;
  try{f.writer(f.file,f.bytes);}catch(caught){error=caught;}
  assert.equal(atomicFileFailureStatus(error).filesystem.errorCode,'EEXIST');
  assert.equal(fs.readFileSync(f.temp,'utf8'),'existing evidence');assert.equal(f.renames.length,0);
  assert.equal(fs.readFileSync(f.file,'utf8'),f.oldBytes);
});

test('caller-held worker lock remains unchanged throughout retries and exhaustion',t=>{
  const f=fixture(t,{faults:Array(9).fill('EBUSY')}),lock=path.join(f.dir,'worker.lock');
  const release=acquireLock(lock),raw=fs.readFileSync(lock,'utf8');
  try{
    const writer=createAtomicFileWriter({platform:'win32',makeId:()=> 'locked',io:new Proxy(fs,{get(target,key){
      if(key==='renameSync')return()=>{assert.equal(fs.readFileSync(lock,'utf8'),raw);
        assert.throws(()=>acquireLock(lock),/lock/);throw failure('EBUSY');};
      return typeof target[key]==='function'?target[key].bind(target):target[key];
    }}),wait:()=>{assert.equal(fs.readFileSync(lock,'utf8'),raw);}});
    assert.throws(()=>writer(f.file,f.bytes));assert.equal(fs.readFileSync(lock,'utf8'),raw);
  }finally{release();}
  assert.equal(fs.existsSync(lock),false);
});

test('store serializes exactly once and retains existing snapshot bytes/integrity semantics',t=>{
  const f=fixture(t),config={chainId:4663,token:'token',minimumAgeSeconds:300};let serializations=0;
  atomicWrite(f.file,{toJSON(){serializations++;return {amount:'17'};}});
  assert.equal(serializations,1);assert.equal(fs.readFileSync(f.file,'utf8'),stringify({amount:'17'}));
  writeSnapshot(f.file,config,{amount:19n});assert.deepEqual(readSnapshot(f.file,config),{amount:'19'});
  assert.throws(()=>readSnapshot(f.file,{...config,chainId:1}),/mismatch/);
});

test('diagnostic provenance and fields cannot be forged or polluted by external error details',t=>{
  assert.equal(atomicFileFailureStatus({code:'FILESYSTEM_WRITE_FAILED',filesystem:{stage:secret}}),null);
  assert.equal(atomicFileFailureStatus(failure('EPERM')),null);
  const f=fixture(t,{faults:['EIO']});let error;
  try{f.writer(f.file,f.bytes);}catch(caught){error=caught;}
  error.message=secret;error.code=secret;
  const a=atomicFileFailureStatus(error);a.filesystem.stage=secret;a.reason=secret;
  const b=atomicFileFailureStatus(error);assert.equal(b.filesystem.stage,'rename');
  assert.doesNotMatch(JSON.stringify(operatorFailureStatus(error)),/SHOULD_NOT_APPEAR/);
});

test('errno accessors are read once and cannot inject secrets or bypass diagnostic sanitization',t=>{
  for(const behavior of ['flip','throw','object']){
    const f=fixture(t);let reads=0,error;
    const untrusted=Object.defineProperty({},'code',{get(){reads++;
      if(behavior==='throw')throw Error(secret);
      if(behavior==='object')return {toString(){throw Error(secret);}};
      return reads===1?'EACCES':secret;
    }});
    const io=new Proxy(fs,{get(target,key){
      if(key==='renameSync')return()=>{throw untrusted;};
      return typeof target[key]==='function'?target[key].bind(target):target[key];
    }});
    const writer=createAtomicFileWriter({io,platform:'win32',wait:()=>assert.fail('must not retry')});
    try{writer(f.file,f.bytes);}catch(caught){error=caught;}
    assert.equal(reads,1);assert.equal(atomicFileFailureStatus(error).filesystem.errorCode,
      behavior==='flip'?'EACCES':'UNKNOWN');
    assert.doesNotMatch(JSON.stringify(atomicFileFailureStatus(error)),/SHOULD_NOT_APPEAR/);
  }
});

test('failed persistence blocks the operator after one cycle; no retry of signing or broadcasting',async t=>{
  const f=fixture(t,{faults:Array(9).fill('EBUSY')}),statuses=[];let cycles=0,signs=0,broadcasts=0,waits=0;
  const result=await runProductionOperatorLoop({cycle:async()=>{
    cycles++;signs++;f.writer(f.file,f.bytes);broadcasts++;return {state:'sent'};
  },report:status=>statuses.push(status),wait:async()=>{waits++;}});
  assert.deepEqual(result,{blocked:true});assert.equal(cycles,1);assert.equal(signs,1);
  assert.equal(broadcasts,0);assert.equal(waits,0);assert.equal(statuses[0].code,'FILESYSTEM_WRITE_FAILED');
});

test('status-file persistence failures remain outside the operator retry catch',async t=>{
  const f=fixture(t,{faults:['EIO']});let cycles=0,waits=0;
  await assert.rejects(runProductionOperatorLoop({cycle:async()=>{cycles++;return {state:'waiting'};},
    report:()=>f.writer(f.file,f.bytes),wait:async()=>{waits++;}}),error=>atomicFileFailureStatus(error)?.filesystem.errorCode==='EIO');
  assert.equal(cycles,1);assert.equal(waits,0);
});

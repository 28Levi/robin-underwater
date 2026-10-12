import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const failures = new WeakMap();
const windowsRenameCodes = new Set(['EPERM', 'EBUSY']);
const safeCodes = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOENT', 'EEXIST', 'ENOSPC',
  'EDQUOT', 'EROFS', 'EIO', 'EMFILE', 'ENFILE', 'ENOTDIR', 'EISDIR', 'EXDEV', 'EINVAL']);
const renameWaits = Object.freeze([10, 25, 50, 100, 200]);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleep = ms => Atomics.wait(sleeper, 0, 0, ms);

function safeErrorCode(error) {
  let code;
  try { code = error?.code; } catch { return 'UNKNOWN'; }
  return typeof code === 'string' && safeCodes.has(code) ? code : 'UNKNOWN';
}

function failure(error, stage, renameAttempts, retryDelayMs, code = safeErrorCode(error)) {
  const safe = new Error('Atomic file write failed; preserve files and reconcile before restarting');
  const status = {state: 'blocked', code: 'FILESYSTEM_WRITE_FAILED',
    reason: 'Atomic file write failed; preserve the destination and any temporary file and reconcile before restart',
    filesystem: Object.freeze({stage, errorCode: code,
      renameAttempts, renameRetries: Math.max(0, renameAttempts - 1), retryDelayMs})};
  failures.set(safe, Object.freeze(status));
  return safe;
}

/** Fixed diagnostics from errors created here only. Never retain or print raw filesystem errors. */
export function atomicFileFailureStatus(error) {
  const status = failures.get(error);
  return status ? {...status, filesystem: {...status.filesystem}} : null;
}

/** Dependency injection is for offline fault tests; production uses the fixed defaults below.
 * The caller must retain its worker lock throughout this synchronous operation.
 * Retry ONLY rename of one already-written, fsynced, closed temporary file.
 */
export function createAtomicFileWriter({io = fs, platform = process.platform, wait = sleep,
  makeId = randomUUID} = {}) {
  return (file, bytes) => {
    if (typeof bytes !== 'string') throw new TypeError('Atomic file content must be serialized text');
    let fd;
    const temp = `${file}.${makeId()}.tmp`;
    try { io.mkdirSync(path.dirname(file), {recursive: true}); }
    catch (error) { throw failure(error, 'mkdir', 0, 0); }
    try { fd = io.openSync(temp, 'wx', 0o600); }
    catch (error) { throw failure(error, 'open', 0, 0); }
    let problem = null, stage = 'write';
    try {
      io.writeFileSync(fd, bytes);
      stage = 'fsync';
      io.fsyncSync(fd);
    } catch (error) { problem = failure(error, stage, 0, 0); }
    try { io.closeSync(fd); }
    catch (error) { problem ??= failure(error, 'close', 0, 0); }
    if (problem) throw problem;

    let retryDelayMs = 0;
    for (let attempt = 1; ; attempt++) {
      try { io.renameSync(temp, file); return; }
      catch (error) {
        const code = safeErrorCode(error);
        const pause = renameWaits[attempt - 1];
        // EACCES is deliberately excluded: it can mean a persistent access-policy denial.
        if (platform !== 'win32' || !windowsRenameCodes.has(code) || pause === undefined)
          throw failure(error, 'rename', attempt, retryDelayMs, code);
        wait(pause);
        retryDelayMs += pause;
      }
    }
  };
}

export const writeAtomicText = createAtomicFileWriter();

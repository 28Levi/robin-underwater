import fs from 'node:fs';
import path from 'node:path';
import { createPlanApi, runPlanOperation } from '../src/launch-plan-api.mjs';

const [action, requestPath, reportPath, statePath, ...flags] = process.argv.slice(2);
const allowPendingAtomicReview = flags.length === 1 && flags[0] === '--allow-pending-atomic-review';
if (!['credential', 'preflight', 'create', 'status'].includes(action) || !requestPath || !reportPath || !statePath
    || flags.length && (!allowPendingAtomicReview || action !== 'create')) {
  throw Error('Usage: node scripts/robin-launch-api.mjs credential|preflight|create|status request.json pack-report.json state-directory [--allow-pending-atomic-review (create only)]');
}
const bytes = fs.readFileSync(path.resolve(requestPath)), report = JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8'));
console.log('Waiting for existing Programmable API credential on non-echoing stdin. No signing or broadcasting.');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
const key = await new Promise(resolve => {
  let value = '';
  const read = chunk => {
    value += chunk;
    if (/[\r\n]/.test(value)) { process.stdin.off('data', read); resolve(value.split(/[\r\n]/)[0].trim()); }
  };
  process.stdin.on('data', read);
});
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
try {
  const result = await runPlanOperation({ action, bytes, report, api: createPlanApi(key), stateDirectory: statePath, allowPendingAtomicReview });
  console.log(JSON.stringify({ httpStatus: result.httpStatus, planId: result.data?.planId, status: result.data?.status ?? result.data?.launchEligibility?.status,
    manualReview: result.data?.manualReview?.state, reviewId: result.data?.manualReview?.reviewId ?? result.data?.reviewId,
    findings: result.data?.findings ?? [], headers: result.headers, stateDirectory: path.resolve(statePath), signing: false, broadcast: false }));
  if (result.ok === false) process.exitCode = 2;
} catch (error) { console.error(String(error.message).replaceAll(key, '[redacted]')); process.exitCode = 2; }

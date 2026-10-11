import fs from 'node:fs';
import path from 'node:path';
import { createPlanApi } from '../src/launch-plan-api.mjs';
import { createReviewApi, runReviewOperation } from '../src/launch-review-api.mjs';

const [action, originalDirectory, originalState, reviewState, replacementDirectory, replacementState, ...extra] = process.argv.slice(2);
if (!['ownerRead', 'replace'].includes(action) || !originalDirectory || !originalState || !reviewState || extra.length ||
    (action === 'replace' ? !replacementDirectory || !replacementState : replacementDirectory || replacementState)) {
  throw Error('Usage: node scripts/robin-launch-review-api.mjs ownerRead|replace original-package-directory original-submission-state review-state-directory [replacement-package-directory replacement-submission-state (replace only)]');
}
const bundle = (directory, stateDirectory) => ({ bytes: fs.readFileSync(path.resolve(directory, 'request.canonical.json')),
  report: JSON.parse(fs.readFileSync(path.resolve(directory, 'pack-report.json'), 'utf8')), stateDirectory: path.resolve(stateDirectory) });
const original = bundle(originalDirectory, originalState);
const replacement = action === 'replace' ? bundle(replacementDirectory, replacementState) : undefined;
console.log('Waiting for existing Programmable API credential on non-echoing stdin. Review metadata only; no signing or broadcasting.');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8'); process.stdin.resume();
let key = await new Promise((resolve, reject) => {
  let value = '';
  const read = chunk => {
    value += chunk;
    if (value.includes('\u0003') || value.length > 8192) { process.stdin.off('data', read); reject(Error('Credential entry cancelled or too long')); }
    else if (/[\r\n]/.test(value)) { process.stdin.off('data', read); resolve(value.split(/[\r\n]/)[0].trim()); }
  };
  process.stdin.on('data', read);
}).finally(() => { if (process.stdin.isTTY) process.stdin.setRawMode(false); process.stdin.pause(); });
try {
  const result = await runReviewOperation({ action, original, replacement, stateDirectory: reviewState, api: createPlanApi(key), reviewApi: createReviewApi(key) });
  console.log(JSON.stringify({ httpStatus: result.httpStatus, status: result.status, planId: result.planId, reviewId: result.reviewId,
    replacementPlanId: result.replacementPlanId, headers: result.headers, stateDirectory: path.resolve(reviewState), signing: false, broadcast: false }));
  if (result.ok === false) process.exitCode = 2;
} catch (error) { console.error(String(error.message).replaceAll(key, '[redacted]')); process.exitCode = 2; }
finally { key = null; }

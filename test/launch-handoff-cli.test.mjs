import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseHandoffOptions, readHandoffInputs, prepareLaunchHandoff} from '../scripts/prepare-launch-handoff.mjs';
import {validateLaunchManifest} from '../src/launch-manifest.mjs';
import {launchReviewFixture} from './helpers/launch-review-fixture.mjs';

function fixture(t) {
  const base = path.resolve(os.tmpdir()), dir = fs.mkdtempSync(path.join(base, 'robin-handoff-cli-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), base);
    assert.ok(path.basename(dir).startsWith('robin-handoff-cli-'));
    fs.rmSync(dir, {recursive: true, force: true});
  });
  const values = {request: '{"canonical":"exact bytes"}', 'pack-report': '{"packed":true}',
    preparation: '{"prepared":true}', 'accepted-package': '{"resource":true}',
    distributor: '{"address":"explicit-test-receipt","verified":true}', policy: '{"manual":true}'};
  const args = [];
  for (const [key, text] of Object.entries(values)) {
    const file = path.join(dir, key + '.json'); fs.writeFileSync(file, text); args.push('--' + key, file);
  }
  args.push('--source-revision', '1'.repeat(40), '--out', path.join(dir, 'new-handoff'));
  return {dir, args};
}

test('handoff CLI loads the explicit distributor path and preserves exact canonical request bytes without local deploy files', t => {
  const {args} = fixture(t), inputs = readHandoffInputs(parseHandoffOptions(args));
  assert.deepEqual(inputs.distributor, {address: 'explicit-test-receipt', verified: true});
  assert.equal(inputs.requestBytes.toString(), '{"canonical":"exact bytes"}');
  assert.equal(inputs.activationMode, 'manual');
  assert.equal(fs.existsSync(inputs.out), false);
});

test('automatic payout preparation is an explicit CLI choice and invalid activation modes are rejected', t => {
  const {args} = fixture(t);
  assert.equal(readHandoffInputs(parseHandoffOptions([...args, '--activation', 'manual'])).activationMode, 'manual');
  assert.equal(readHandoffInputs(parseHandoffOptions([...args, '--activation', 'after-reviewed-launch'])).activationMode, 'after-reviewed-launch');
  for (const mode of ['automatic', 'true', 'now']) assert.throws(() => parseHandoffOptions([...args, '--activation', mode]), /Activation must/);
});

test('worker revision is a separate explicit CLI binding, leaving original contract revision and request bytes intact', t => {
  const {args} = fixture(t), original = readHandoffInputs(parseHandoffOptions(args));
  const revised = readHandoffInputs(parseHandoffOptions([...args, '--worker-source-revision', '2'.repeat(40)]));
  assert.equal(Object.hasOwn(original, 'workerSourceRevision'), false);
  assert.equal(revised.workerSourceRevision, '2'.repeat(40)); assert.equal(revised.sourceRevision, original.sourceRevision);
  assert.deepEqual(revised.requestBytes, original.requestBytes);
  for (const revision of ['main', 'abc', 'G'.repeat(40)]) assert.throws(() => parseHandoffOptions([...args, '--worker-source-revision', revision]), /Worker source revision/);
  assert.throws(() => parseHandoffOptions([...args, '--worker-source-revision', '2'.repeat(40), '--worker-source-revision', '3'.repeat(40)]), /repeated/);
});

test('missing distributor and malformed inputs fail before any network or output creation', async t => {
  const {args} = fixture(t), missing = args.filter((_, i) => args[i] !== '--distributor' && args[i - 1] !== '--distributor');
  assert.throws(() => parseHandoffOptions(missing), /Required: --distributor/);
  assert.throws(() => parseHandoffOptions([...args, '--distributor', 'other']), /repeated/);
  let requests = 0; t.mock.method(globalThis, 'fetch', async () => { requests++; throw Error('Unexpected network'); });
  const file = args[args.indexOf('--distributor') + 1]; fs.writeFileSync(file, 'not JSON');
  await assert.rejects(prepareLaunchHandoff(args), SyntaxError);
  assert.equal(requests, 0); assert.equal(fs.existsSync(args.at(-1)), false);
});

test('guarded handoff selects its explicit intent file before any network call', async t => {
  const {dir,args}=fixture(t),intent=path.join(dir,'guard-intent.json');
  fs.writeFileSync(intent,'not JSON');
  let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('Unexpected network');});
  await assert.rejects(prepareLaunchHandoff([...args,'--intent',intent]),SyntaxError);
  assert.equal(requests,0);assert.equal(fs.existsSync(args.at(-1)),false);
  assert.throws(()=>parseHandoffOptions([...args,'--intent',intent,'--intent',intent]),/repeated/);
});

test('handoff CLI preserves previous output evidence instead of overwriting it', t => {
  const {args} = fixture(t), out = args.at(-1); fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'manifest.json'), 'original');
  assert.throws(() => readHandoffInputs(parseHandoffOptions(args)), /previous handoff evidence/);
  assert.equal(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'), 'original');
});

test('shipped policy example is a valid bounded manual review draft, not automatic payout consent', () => {
  const policy = JSON.parse(fs.readFileSync('docs/launch-policy.example.json', 'utf8'));
  const {manifest} = launchReviewFixture(); Object.assign(manifest, policy);
  assert.throws(() => validateLaunchManifest(manifest), /accounting policy/);
  Object.assign(manifest, {schemaVersion: 'robinhook.launch-bootstrap.v4', workerSourceRevision: '2'.repeat(40)});
  validateLaunchManifest(manifest);
  assert.equal(manifest.activation.mode, 'manual');
  assert.deepEqual(Object.keys(policy).sort(), ['accounting', 'execution', 'preserveLaunchBalanceWei']);
  assert.equal(policy.preserveLaunchBalanceWei, '1000000000000000');
  assert.equal(policy.execution.minimumHarvestWei, '10000000000000');
  assert.equal(policy.execution.minimumBatchWei, '10000000000000');
  assert.equal(policy.accounting.minimumAgeSeconds, 300);
  assert.equal(policy.execution.payoutIntervalSeconds, 900);
  assert.equal(policy.execution.confirmationMode, 'pipelined-finalized-v1');
  assert.equal(policy.execution.maxInflightTransactions, 8);
});

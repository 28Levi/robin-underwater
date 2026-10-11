import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshLaunchReviewInputs, verifyLaunchReviewInputs} from '../src/launch-review-server.mjs';
import {NOW, copy, launchReviewFixture} from './helpers/launch-review-fixture.mjs';

test('restart refreshes expired saved admission without changing immutable launch evidence', async () => {
  const f = launchReviewFixture({automatic: true}), stale = copy(f.acceptedResource);
  stale.admission.expiresAt = new Date(NOW - 1).toISOString();
  assert.throws(() => verifyLaunchReviewInputs({...f, acceptedResource: stale, now: NOW}));
  let reads = 0;
  const current = await refreshLaunchReviewInputs({...f, acceptedResource: stale, now: NOW,
    readCurrentResource: async () => { reads++; return copy(f.acceptedResource); }});
  assert.equal(reads, 1); assert.deepEqual(current, f.acceptedResource);
  assert.equal(stale.admission.expiresAt, new Date(NOW - 1).toISOString(), 'saved receipt remains unchanged');
});

test('restart rejects corrupt saved identity before reading and rejects unbound or expired current resources', async () => {
  const f = launchReviewFixture(); let reads = 0;
  await assert.rejects(refreshLaunchReviewInputs({...f, now: NOW, requestBytes: Buffer.concat([f.requestBytes, Buffer.from('\n')]),
    readCurrentResource: async () => { reads++; return f.acceptedResource; }}));
  assert.equal(reads, 0);
  for (const mutate of [r => r.planId = 'different-plan', r => r.plan.publication.symbol = 'OTHER',
    r => r.admission.expiresAt = new Date(NOW - 1).toISOString(), r => r.manualReview.state = 'rejected',
    r => r.steps[0].transaction.nonce = '8']) {
    const current = copy(f.acceptedResource); mutate(current);
    await assert.rejects(refreshLaunchReviewInputs({...f, now: NOW, readCurrentResource: async () => current}));
  }
  await assert.rejects(refreshLaunchReviewInputs({...f, now: NOW, readCurrentResource: async () => { throw Error('Unavailable'); }}), /Unavailable/);
});

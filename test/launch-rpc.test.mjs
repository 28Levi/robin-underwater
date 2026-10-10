import test from 'node:test';
import assert from 'node:assert/strict';
import {launchRpcUrl, runLaunchCommand, PUBLIC_LAUNCH_RPC} from '../src/launch-rpc.mjs';

test('launch RPC accepts an explicit HTTPS archive key path and rejects insecure or embedded-login endpoints', () => {
  assert.equal(launchRpcUrl('https://archive.example/v2/mock-secret'), 'https://archive.example/v2/mock-secret');
  assert.equal(launchRpcUrl(''), PUBLIC_LAUNCH_RPC + '/');
  for (const url of ['http://archive.example/mock-secret', 'https://user:mock-secret@archive.example/',
    'https://archive.example/#mock-secret', 'mock-secret']) assert.throws(() => launchRpcUrl(url));
});

test('CLI boundary redacts raw RPC exceptions including key-bearing URLs and nested provider bodies', async () => {
  const messages = [];
  const ok = await runLaunchCommand(async () => { throw Error('https://archive.example/v2/mock-secret provider body token=private-token'); }, message => messages.push(message));
  assert.equal(ok, false); assert.equal(messages.length, 1);
  assert.ok(messages[0].includes('archive RPC'));
  for (const hidden of ['archive.example', 'mock-secret', 'private-token', 'provider body']) assert.equal(messages[0].includes(hidden), false);
  assert.equal(await runLaunchCommand(async () => {}, message => messages.push(message)), true);
  assert.equal(messages.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {assertRobinLaunchIntent} from '../src/launch-intent.mjs';

const intent = JSON.parse(fs.readFileSync(new URL('../launch-intent.json', import.meta.url), 'utf8'));
const config = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'));

test('current launch inputs agree on ROBINHOOK / ROBIN and pass preparation validation', () => {
  assert.equal(assertRobinLaunchIntent(intent), intent);
  assert.deepEqual([intent.name, intent.symbol], ['ROBINHOOK', 'ROBIN']);
  assert.deepEqual([config.name, config.symbol], [intent.name, intent.symbol]);
});

test('stale HOOD and earlier ROBINHOOD branding cannot prepare the current launch', () => {
  for (const identity of [
    {name: 'ROBINHOOK', symbol: 'HOOD'},
    {name: 'HOOD', symbol: 'HOOD'},
    {name: 'ROBINHOOD', symbol: 'ROBIN'},
  ]) assert.throws(() => assertRobinLaunchIntent({...intent, ...identity}), /ROBINHOOK \/ ROBIN intent required/);
});

test('ticker update preserves purchase, supply, approval and social-identity guards', () => {
  for (const patch of [
    {initialBuyWei: '100000000000000000'},
    {supply: '1000000001'},
    {minimumTokensOutApproval: {approved: false}},
    {minimumTokensOutApproval: {approved: 'true'}},
    {x: 'https://x.com/ROBIN'},
  ]) assert.throws(() => assertRobinLaunchIntent({...intent, ...patch}), /intent required/);
  assert.throws(() => assertRobinLaunchIntent(null), /intent required/);
});

test('local canonical token deployment verifies ROBIN and rejects stale HOOD configuration', async () => {
  process.env.HARDHAT_CONFIG = path.resolve('hardhat.native20.config.cjs');
  const [{default: hre}, {native20Fixture}, {verifyProductionToken}] = await Promise.all([
    import('hardhat'),
    import('./helpers/native20-fixture.mjs'),
    import('../src/production-network.mjs'),
  ]);
  const fixture = await native20Fixture(hre, {
    operatorIndex: 3, name: intent.name, symbol: intent.symbol, firstBuyWei: BigInt(intent.initialBuyWei),
  });
  try {
    assert.equal(await fixture.token.name(), 'ROBINHOOK');
    assert.equal(await fixture.token.symbol(), 'ROBIN');
    await verifyProductionToken(fixture.provider, fixture.c);
    await assert.rejects(verifyProductionToken(fixture.provider, {...fixture.c, symbol: 'HOOD'}), /configured token identity/);
  } finally {
    fixture.provider.destroy();
  }
});

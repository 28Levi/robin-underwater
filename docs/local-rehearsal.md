# ROBIN local rehearsal — 13 September 2026

The full regression suite passes **87 tests**. A separate-process rehearsal exercises the canonical Native20 token, real Uniswap v4 PoolManager implementation, fixed fee hook, fee vault, distributor and the actual executor command on a disposable local chain. It uses only Hardhat's public test accounts and spends no real ETH.

Run `node scripts/rehearse-local.mjs` after compiling the contracts. The runner starts a loopback Hardhat node, executes buys and sells, moves tokens between holders, advances the local clock through the real one-hour maturity rule, and launches a new executor process for each cycle. Each process reads the same durable journal. Reports are written to `output/local-rehearsal.json`; each run's config, journal and plans remain under `output/rehearsal/`.

The scenario checks fee separation, conserved cost basis, loss-proportional funded rewards, exclusion of the profitable initial holder, restart idempotence and proportional transfer of already-credited relief. Existing integration tests also cover failed ETH receivers, lost RPC responses before and after mining, finality waits, batch continuation, changed recipient balances and gas-budget limits.

## Issue found and fixed

The executor previously required the latest block hash to stay identical through preparation and gas estimation. In the rehearsal with 100 ms blocks and 250 ms RPC delay, that caused the bot to defer a payment even when no relevant state changed. Public RPC sampling observed multiple distinct heads over sequential reads, each taking approximately 200 ms, so this is relevant to the live chain.

The executor now verifies that its original block remains canonical. For payouts it scans intervening blocks for nonzero token transfers or recorded reward allocations and defers if either changed. Empty blocks permit progress. Fee harvesting and retrying existing credits also tolerate advancing canonical blocks. Expiry, onchain minimum-balance guards, pinned contract identities, nonce checks, per-transaction gas caps and the cumulative gas journal remain enforced.

`output/local-rehearsal.before-liveness-fix.json` preserves the failing rehearsal. `test/candidate-state.test.mjs` covers advancing blocks, changed balances/allocations, and reorganized state; the existing transfer-during-estimation integration test continues to reject that race before signing.

## What remains for a live test

The local graph factory caller is simulated. This does not prove platform admission, real-network transaction inclusion or an active Render payout service. Render still runs its idle setup command and the local fix has not been deployed there. A separate live test proposal is in `deploy/live-test.proposed.json`: clearly labelled test token, separate distributor/operator/journal and a proposed 0.008 ETH total cap. It requires approval, completed metadata, exact package preflight and fresh gas estimates before spending.

The previously accepted two-wallet farming limitation is unchanged. These execution tests are not a proof that the economic design cannot be exploited.

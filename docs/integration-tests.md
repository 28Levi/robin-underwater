# Wallet-feed integration

Run this maintained suite separately from the backend unit tests. It exercises the actual backend exporter, site Worker and browser view model together. A missing site checkout fails immediately; it never silently skips coverage.

From the backend checkout, install the locked development dependencies and compile both local contract sets:

```text
npm ci
npm run compile
npm run compile:native20
node --test --test-concurrency=1 integration/wallet-feed-site.test.mjs
```

By default the site is resolved at `../robinhook-site`, relative to the backend checkout. To use another reviewed site checkout, set `ROBIN_SITE_CHECKOUT` to its root. For example, in PowerShell:

```powershell
$env:ROBIN_SITE_CHECKOUT = 'C:\work\robinhook-site'
node --test --test-concurrency=1 integration/wallet-feed-site.test.mjs
```

Relative override paths are resolved from the current working directory. Run from the backend root because the local contract fixture loads compiled artifacts from `artifacts/`. The site must include `worker/index.mjs`, `worker/wallet-feed.mjs`, `dist/wallet-status.mjs` and the imported prelaunch `dist/data/recovery-snapshot.json`; it needs no installed dependencies for this suite.

For a release record, retain the backend commit/release identity, site commit/deployment identity, and complete test output. The test prints SHA-256 hashes and resolved paths for the backend exporter, site Worker, feed validator and browser model actually loaded. These hashes identify those files, not every dependency or the live deployment. Checkouts must be reviewed source; an arbitrary checkout executes JavaScript when imported.

The expected result is eight passing checks: the parent end-to-end flow and seven cases for incremental replay, paid/deferred ETH, exact recovery tiers, expired results, normal finality lag, outage/rollback handling, and prelaunch disablement. Contracts deploy and transact only on a disposable, non-forked Hardhat network; an inherited network selection is overridden. The test never reads a production RPC, wallet key or publishing token.

This is local integration evidence. The EVM transactions are real local executions, while the wall clock is aligned to the accelerated fixture, publication stays in-process, and R2 is an in-memory conditional-write substitute. It does not establish actual chain launch, hosted authentication/R2 routing, live finalized-lag behavior, production RPC quotas or holder capacity. Those production checks remain necessary after the exact launch identity and delivery configuration are installed.

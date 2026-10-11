# Payout readiness fixes — 11 October 2026

This worker update preserves the approved contract source at `8cfe1a33b009925de93aa7ca7b1ef6a5b4b90239`. Contract sources, launch request and economic parameters are unchanged.

## Corrected behavior

- An atomic token creation, inventory seed and initial purchase now retain the initial buyer's measured purchase cost. The exemption is limited to the authenticated fixed-supply launch sequence; ambiguous receipts and ordinary mints do not inherit a purchase cost.
- Large payout batches are reduced using actual gas estimates before signing. Original entitlements and durable progress are preserved; progress advances only after finalized success. Neither the per-transaction nor cumulative gas cap is increased. A minimum-payment/gas conflict or exhausted total allowance stops with an explicit status instead of overspending.
- A version 2 local review manifest binds the rewards worker revision separately from the approved contract revision. Existing version 1 manifests retain their original format and hash. A changed worker requires a new local review and actual host acknowledgement. Existing admission files and journals cannot be overwritten by the installer.
- The local wallet review includes bounded connection handling, current admitted Atomic evidence, an explicit host-readiness gate and restart-time admission refresh. Supporting assets and host checks are included in source packages.

## Validation

The clean release checkout used the locked ethers 6.17.0, Hardhat 2.26.3 and solc 0.8.26 dependencies. `npm test` passed 327 tests with no failures. One historical MOSSC wallet test was skipped because its private old launch evidence is not shipped; current ROBIN wallet tests ran. The separate current-fee and wallet-feed/site integration run passed 13 tests using an explicitly configured site checkout.

Regressions include an actual local GraphFactory atomic creation, 100 eligible holders paid exactly once through smaller batches and journal reloads, lost broadcast responses, finality waiting, noncanonical receipts, unknown nonce consumption, finalized reverts, changed finality history, cumulative gas exhaustion and unsafe review/host revisions. The site integration uses a local Worker/R2 fixture; it is not evidence of live production payouts.

This is a tested source candidate, not a claim that the updated worker is deployed or that a current live payout test has completed. The existing ROBIN launch is held. Programmable's expired admission/pending-step response is tracked in [issue 1035](https://github.com/programmablehq/PROGRAMMABLE/issues/1035); signing checks remain enforced.

## Reproduce

Run `npm ci`, `npm test`, and set `ROBIN_SITE_CHECKOUT` to the matching website checkout before running:

```
node --test --test-concurrency=1 integration/wallet-feed-site.test.mjs integration/readiness-native30-executor-site.test.mjs
```

`node scripts/rehearse-local.mjs` starts a disposable local chain and fresh executor processes. An optional JSON fee-profile argument models a previously observed production base fee and priority fee; the report records that input. The default Hardhat fee market may exceed the reviewed transaction cap. Neither mode uses real funds or a production signing key. The local execution-limit fixture does not authorize a live launch.

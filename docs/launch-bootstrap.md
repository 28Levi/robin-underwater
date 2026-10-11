# Reviewed launch bootstrap

This preparation removes post-launch address and transaction-hash copying. It is not an accepted platform launch package, installed production service, or authorization to send a transaction.

The browser-safe `src/launch-manifest.mjs` defines the immutable manifest shared with the wallet review screen. It pins the current Custom Launch Plan v1.2 identifiers and digests, exact transaction account/nonce/value/calldata, executor runtime, predicted token/hook/initializer/fee-vault addresses and runtime hashes, existing distributor receipt, source revision, fee destinations, initial-buy minimum, accounting settings and approved gas limits. Old retired v4 launch handoffs are rejected. The current model is the reviewed canonical Native20 implementation; another contract design needs its own reviewed verifier, even if a platform can deploy it.

`src/launch-bootstrap.mjs` checks the production chain anchor and archive RPC, scans finalized token mint logs starting after the reviewed checkpoint, and verifies the matching exact wallet transaction. It checks canonical finality, all deployed runtime hashes, token identity/supply, initialized pool, fixed fees, fee recipients, operator, initial purchase/minimum and spending bounds. Code merely existing at the predicted address cannot activate anything. The predicted token must have been absent at the review checkpoint, and the distributor must have no pending rewards from an earlier campaign immediately before launch.

The watcher persists its finalized discovery cursor and discovered transaction with a manifest-bound checksum. It refuses changed manifests, changed source revisions, corrupted state or forks. Generated files are immutable: a different existing configuration or activation gate stops the process rather than replacing state. The operator and wallet exporter have separate persistent subdirectories; journals, gas reservations and snapshots are never deleted or reset by this workflow.

## Prepared host command

The safe prelaunch service can be installed before any accepted package or consent exists:

```text
node scripts/launch-standby.mjs --loop
```

Set `ROBIN_LAUNCH_STATE_DIRECTORY=/var/data/robin/launch`, retain the archive HTTPS `ROBIN_RPC_URL`, and use the host-provided `RENDER_GIT_COMMIT` (or an explicit `ROBIN_SOURCE_REVISION`). With no admission file, standby performs local path checks and reports `waiting-for-reviewed-package`; it makes no RPC requests, reads no signing files and starts no child. `--once` checks this state and exits. Do not add `--services` to the current prelaunch deployment.

Securely deliver one atomic `admission.json` inside that directory containing `{schemaVersion:"robinhook.launch-admission.v1",manifestSha256,manifest}`. `ROBIN_LAUNCH_ADMISSION_FILE` may select another file in the same dedicated directory. The exact validated manifest is pinned as `admitted-manifest.json`; replacement, deletion after admission, a changed digest or a different running source revision blocks the process. Consent remains a separate `launch-review.json` (or `ROBIN_LAUNCH_CONSENT_FILE`) inside the directory. Admission alone starts only the keyless watcher; separate consent and all activation gates below remain mandatory for payouts. No cloud admission/consent delivery endpoint or publisher secret is installed by these scripts.

The child watcher writes beneath `runtime/`; existing operator journals are preserved. An unexpected watcher exit creates `watcher-stopped.json` and requires explicit reconciliation before restarting. The direct command, when a reviewed manifest has already been securely installed, is:

```text
node scripts/watch-launch.mjs --manifest /etc/secrets/robin-launch-manifest.json --manifest-sha256 sha256:EXACT_REVIEWED_DIGEST --consent /var/data/robin-launch/launch-review.json --loop
```

Required host settings are `ROBIN_RPC_URL`, `ROBIN_LAUNCH_STATE_DIRECTORY` (a dedicated durable directory), and `ROBIN_SOURCE_REVISION` or the host-provided `RENDER_GIT_COMMIT`. The running source revision must equal the reviewed manifest. Configure authenticated wallet-feed delivery separately using `ROBIN_WALLET_FEED_URL` and `ROBIN_WALLET_FEED_PUBLISH_TOKEN` as described in [wallet-feed.md](wallet-feed.md). The watcher begins public read-only export after the exact launch is verified. The initial TWAP and holding-period history must accumulate normally; it does not invent values while waiting.

Prelaunch discovery polls every 30 seconds. After verification the complete launch proof and wallet feed refresh every 300 seconds by default (`ROBIN_WALLET_FEED_INTERVAL_SECONDS`, bounded from 60 to 600). Full verification is retained on every refresh; the slower cadence avoids repeating all historical state and per-wallet pending reads every 30 seconds. The operator's independent transaction checks are unchanged.

The default `manual` activation mode generates only `production.readonly.json` with broadcasts disabled. To prepare automatic startup after the final wallet action, the exact manifest must instead contain `after-reviewed-launch`, and the wallet review must explicitly show the automatic payout scope, batching thresholds, cumulative/per-transaction gas caps and accepted economic limitations. A separate server-recorded `robinhook.launch-review.v1` consent file binds that review to the immutable manifest, wallet account and nonce. A flag in a host configuration is insufficient.

The consent record uses UNIX seconds for `reviewedAt`, an exact copy of `manifest.execution`, and the fields `manifestSha256`, `account`, `nonce`, `automationAccepted` and `economicRiskAccepted`. Automatic startup requires both acknowledgements to be true. Manual mode accepts `automationAccepted: false`; it cannot activate payouts. Consent must be securely delivered to the host. No unauthenticated remote activation endpoint is provided, and this code does not provision that delivery.

Only after explicit review and installation may the host add `--services` and set `ROBIN_AUTOMATION_APPROVED_MANIFEST_SHA256` to the same approved digest. The supervisor still waits for the separate matching consent and the exact finalized user transaction. It then writes `production.operator.json` and a receipt/config-bound `operator-activation.json` and starts the existing production operator. The watcher itself has no wallet or signing logic; the existing operator alone loads its already configured encrypted custody files. **Do not run `--services` during preparation or review.**

The supervisor preserves the operator journal across restarts. An unexpected child exit writes `operator-stopped.json` and prevents automatic restart until the cause and durable journal are explicitly reconciled. A temporary loss of launch verification stops the child; finalized state must verify again before it can resume. The website exporter remains a separate read-only operation.

The historical operator ceilings remain 0.005 ETH cumulatively and 0.0002 ETH per transaction, and token-launch gas is capped at 0.0008 ETH. The manifest may use lower limits but cannot raise them. `minimumHarvestWei` and `minimumBatchWei` must be explicitly set and displayed; historical 0.00001 ETH values are preparation defaults only, not hidden spending authorization. Hosting, secret installation, accepted platform admission, consent delivery and actual live end-to-end verification remain separate activation tasks.

These pins verify the token contract's 170-bps project and 30-bps platform fees. They are not a claim about total trading cost through every platform route; any additional router surcharge requires its own launch review. On October 10 the owner chose to retain the current reward rules after the related-wallet finding was explained. That finding remains documented; payouts still require the exact launch and activation gates above.

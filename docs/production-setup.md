# Production activation

The Render worker is live in inactive setup mode at service `srv-daj6jt95efls73foumv0`, with a verified 1 GB persistent disk and $7.25/month base hosting. Following explicit user approval, the dedicated operator's encrypted keystore and password were installed in Render secret storage. On-server decryption restored the expected operator address on 2026-09-13, and the RPC evidence survived a service restart. No token or distributor has been deployed, and no blockchain transaction has been signed or sent.

## Required resources

1. Dedicated operator `0x9C366d4E42b8f987e8398A27b3b9A02803493088`, whose address will be immutable in `UnderwaterDistributor`. Its local backup files are in ignored `.secrets/operator/`, restricted by Windows ACL to the project owner, sandbox account and SYSTEM. The password and keystore are separate files under the same protected directory; security depends on those filesystem permissions. Render mounts the approved copies at `/etc/secrets/robin-operator.keystore.json` and `/etc/secrets/robin-operator.password`, referenced by `ROBIN_KEYSTORE_FILE` and `ROBIN_KEYSTORE_PASSWORD_FILE`. The restore was verified without printing secrets or signing. Do not reuse this wallet for unrelated transactions, paste credentials in chat or commit them.
2. An always-on Node 24 host (or the included Docker image), durable storage, and monitoring of `status.json`. The process exits when it encounters a blocked execution state. Do not configure restart behavior that repeatedly ignores a blocked journal or resets state.
3. Alchemy is configured as `ROBIN_RPC_URL` on Render. Server-side verification on 2026-09-13 passed the production chain anchor and freshness checks, finalized state, archive code, historical calls, event logs, historical receipts and persistent disk writes. The user approved a $5/month shared account API usage cap; it is saved in Alchemy and includes the user's other apps. Do not raise it automatically. A separate latest-only public RPC failed historical reads and is not used for the reward operator. See `deploy/alchemy-setup.json` for evidence without credentials.
4. Explicit maximum gas per transaction and total operator gas budget, plus minimum reward batch/harvest amounts. The total gas reservation is cumulative; exhaustion stops execution and requires a reconciled, deliberate policy update. The user's 0.1 ETH first purchase does not fund this ongoing service.

## Deploy and configure

Deploy the compiled `UnderwaterDistributor` with the dedicated operator address. Its constructor accepts only that address; it does not take custody of the launch wallet. Bind the distributor address as `creatorFeeRecipient` in the reviewed Native20 launch. Keep the canonical hook, token and initializer source unchanged. Project fees are 180 bps each direction plus the platform's 20 bps, for the confirmed 2% total.

After the token launch finalizes, copy `config.example.json` to ignored `config.production.json` and fill the actual token/hook/initializer/distributor addresses, pool ID and deployment block. Add `execution` from `production.execution.example.json`. Fill the operator, actual fee vault, runtime hashes measured from finalized deployed code, and approved gas policy. Keep `broadcastEnabled: false` initially.

The production verifier checks chain 4663, the published historical chain anchor, canonical PoolManager runtime, chain freshness and historical RPC access. It also checks the deployed ROBIN name, symbol, supply, fee settings, pool key, initializer, operator and fee destination. Code hashes and configuration bind the durable execution journal. Changing a configuration is a migration, not an excuse to erase outstanding transactions or rounds.

Run a read-only deployment check with `node scripts/production-operator.mjs config.production.json --check`. Set `ROBIN_RPC_URL` securely on the host. This path does not load a keystore or sign a transaction. Verify the operator's available ETH separately against the chosen budget.

## Start the service

Mount the encrypted keystore and password as read-only secrets. Set `ROBIN_KEYSTORE_FILE`, `ROBIN_KEYSTORE_PASSWORD_FILE`, and `ROBIN_STATE_DIRECTORY` to those host paths and the writable durable state directory. The password file may end with one newline. Keep the state directory private and backed up; journals contain replayable signed transactions.

Only after deployment verification, signer custody and gas funding are complete, deliberately set `broadcastEnabled: true` and run `node scripts/production-operator.mjs config.production.json --send`. Render currently runs an idle setup command; replace it only after the read-only check passes. See `deploy/render-live.json` for actual settings and `deploy/render.proposed.yaml` for the target payout setup. The alternative Dockerfile defaults to `--check` and runs as the non-root `node` user; that Docker image has not been built here.

The loop attempts at most one transaction per cycle and waits for its finality before progressing. It checks deployment identity each cycle, persists exact signed bytes before broadcast, and recovers ambiguous broadcasts with the same transaction hash. Errors and status output do not print credentials. The local integration suite exercises the transaction lifecycle; production mode has additional fail-closed tests. The Render build and idle startup succeeded on Node 24.14.0; this does not verify live payouts.

## Unsigned preparation

The distributor is deployed and finalized at `0x62C12ae94CcbbE470CC1857261Fae9E36074Fb36`, from launch-wallet nonce 1. Transaction `0xe9e909d732221c44d4bcd96b71dc72cf87df1d11cfc4143f5ac7862b0d0c379a` passed receipt, creation-bytecode, runtime and operator verification. Finality was confirmed at 2026-09-13 14:11:43 UTC. Run `node scripts/verify-distributor-mainnet.mjs <transaction-hash>` for a fresh read-only check. See `deploy/distributor.mainnet.json`. Do not prepare or send a second deployment. The former nonce-zero prediction is obsolete.

The official Native20 example defaults to zero creator fees and sends creator fees to the launch wallet. Before final packing, `node scripts/bind-launch-fees.mjs <official-config.json> <deployed-distributor>` changes the constructor to 180 bps each way, binds the distributor recipient, recomputes the deterministic hook prediction and its child fee vault, and builds again. The reviewed Solidity source remains unchanged. Local regression tests check constructor fees, actual compiler immutable locations, child-vault derivation and rejection of wrong artifacts/pool settings. The full CLI build still requires completed official inputs, including a real X profile and a reviewed minimum output; it has not yet run for the launch.

## Payout timing and residual limits

Payout preparation excludes outgoing transfers after the relevant snapshot. Incoming transfers no longer invalidate a whole recipient or round. The executor uses `distributeEligible`: balances at or above the checked amount are accepted, lower balances skip only that recipient, and an all-skipped batch records zero allocated funds. Actual `RewardAllocated` events are the sole relief credits in replay.

The guard does not detect transfers out and back after the last RPC check, nor prove an ETH loss onchain. A trusted operator and pool-derived reference price remain fundamental design assumptions. The documented two-wallet farming strategy remains possible and was accepted by the user; the original loss-weighted reward formula is retained. No model change to capped fee refunds has been made.

## Launch handoff still needed

The user does not want a separate website. The existing public GitHub project page is the website link in the launch metadata; the generated private Site is outside the remaining work. Programmable's current schema still requires a real X profile, alongside the already published image and exact source revision. This metadata requirement is separate from token and rewards functionality. Programmable preflight must accept the exact packed launch before the controller can sign. Both wallets are funded: after distributor deployment the launch wallet had 0.29266699428424 ETH and the operator had 0.005 ETH. The purchase remains capped at 0.1 ETH, token launch gas at 0.0008 ETH and cumulative bot gas at 0.005 ETH. Extra wallet funds and unused distributor gas allowance do not increase these caps.

## Current HOOD preparation — September 19

Current token identity is HOOD / HOOD and the first purchase is 0.01 ETH. The distributor is already deployed and reverified; do not redeploy. The existing Render worker remains idle until the repaired release and exact token configuration pass checks. Use docs/hood-launch-readiness.md for current status; older statements above about no deployments, ROBIN naming, and 0.1 ETH are superseded.

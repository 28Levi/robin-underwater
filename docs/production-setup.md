# Production activation

Code is prepared for deployment. No production service, operator signer or token has been activated.

## Required resources

1. A dedicated operator wallet, controlled by the project, whose address will be immutable in `UnderwaterDistributor`. Do not reuse this wallet for unrelated transactions. Keep its encrypted keystore and password in host secret storage, never in the repository or chat.
2. An always-on Node 24 host (or the included Docker image), durable storage, and monitoring of `status.json`. The process exits when it encounters a blocked execution state. Do not configure restart behavior that repeatedly ignores a blocked journal or resets state.
3. An HTTPS Robinhood Chain RPC that supports finalized block reads, logs from launch onward, and historical state at finalized block numbers. A latest-only RPC is insufficient. Public infrastructure code matched all nine advertised runtime hashes in the 2026-09-13 readback, but historical `eth_getCode` on the public RPC returned -32000. Supply and check a suitable provider before activation.
4. Explicit maximum gas per transaction and total operator gas budget, plus minimum reward batch/harvest amounts. The total gas reservation is cumulative; exhaustion stops execution and requires a reconciled, deliberate policy update. The user's 0.1 ETH first purchase does not fund this ongoing service.

## Deploy and configure

Deploy the compiled `UnderwaterDistributor` with the dedicated operator address. Its constructor accepts only that address; it does not take custody of the launch wallet. Bind the distributor address as `creatorFeeRecipient` in the reviewed Native20 launch. Keep the canonical hook, token and initializer source unchanged. Project fees are 180 bps each direction plus the platform's 20 bps, for the confirmed 2% total.

After the token launch finalizes, copy `config.example.json` to ignored `config.production.json` and fill the actual token/hook/initializer/distributor addresses, pool ID and deployment block. Add `execution` from `production.execution.example.json`. Fill the operator, actual fee vault, runtime hashes measured from finalized deployed code, and approved gas policy. Keep `broadcastEnabled: false` initially.

The production verifier checks chain 4663, the published historical chain anchor, canonical PoolManager runtime, chain freshness and historical RPC access. It also checks the deployed ROBIN name, symbol, supply, fee settings, pool key, initializer, operator and fee destination. Code hashes and configuration bind the durable execution journal. Changing a configuration is a migration, not an excuse to erase outstanding transactions or rounds.

Run a read-only deployment check with `node scripts/production-operator.mjs config.production.json --check`. Set `ROBIN_RPC_URL` securely on the host. This path does not load a keystore or sign a transaction. Verify the operator's available ETH separately against the chosen budget.

## Start the service

Mount the encrypted keystore and password as read-only secrets. Set `ROBIN_KEYSTORE_FILE`, `ROBIN_KEYSTORE_PASSWORD_FILE`, and `ROBIN_STATE_DIRECTORY` to those host paths and the writable durable state directory. The password file may end with one newline. Keep the state directory private and backed up; journals contain replayable signed transactions.

Only after deployment verification, signer custody and gas funding are complete, deliberately set `broadcastEnabled: true` and run `node scripts/production-operator.mjs config.production.json --send`. The Dockerfile defaults to `--check` and runs as the non-root `node` user. Mount config at `/config/config.json`, durable writable state at `/state`, and secret files outside both. No hosting resource is selected or purchased by this package.

The loop attempts at most one transaction per cycle and waits for its finality before progressing. It checks deployment identity each cycle, persists exact signed bytes before broadcast, and recovers ambiguous broadcasts with the same transaction hash. Errors and status output do not print credentials. The local integration suite exercises the transaction lifecycle; production mode has additional fail-closed tests. The Docker image and a live production host have not been exercised in this workspace.

## Payout timing and residual limits

Payout preparation excludes outgoing transfers after the relevant snapshot. Incoming transfers no longer invalidate a whole recipient or round. The executor uses `distributeEligible`: balances at or above the checked amount are accepted, lower balances skip only that recipient, and an all-skipped batch records zero allocated funds. Actual `RewardAllocated` events are the sole relief credits in replay.

The guard does not detect transfers out and back after the last RPC check, nor prove an ETH loss onchain. A trusted operator and pool-derived reference price remain fundamental design assumptions. The documented two-wallet farming strategy remains possible and was accepted by the user; the original loss-weighted reward formula is retained. No model change to capped fee refunds has been made.

## Launch handoff still needed

The user does not want a separate website. The existing public GitHub project page is the website link in the launch metadata; the generated private Site is outside the remaining work. Programmable's current schema still requires a real X profile, alongside the already published image and exact source revision. This metadata requirement is separate from token and rewards functionality. Programmable preflight must accept the exact packed launch before the controller can sign. The latest wallet readback was 0 ETH. Fund the planned 0.1 ETH purchase and separately reviewed launch gas; distributor deployment and operator gas are additional. Never raise the purchase or gas caps automatically.

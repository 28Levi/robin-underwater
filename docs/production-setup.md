# ROBIN production setup

This is the current guide for ROBINHOOK / ROBIN. Dated HOOD and MOSS launch files are historical. Start with [launching later](launch-later.md); use [launch bootstrap](launch-bootstrap.md) for the exact activation gates.

## Installed services

- Public website: https://robinhook.wtf/ and https://www.robinhook.wtf/.
- Backend source: https://github.com/28Levi/robin-underwater, branch `main`. Admission must name the exact deployed commit.
- Render: `robin-rewards`, service `srv-daj6jt95efls73foumv0`, Node 24, 1 GB persistent disk at `/var/data/robin`.
- Start command: `node scripts/launch-standby.mjs --loop`. No admission means `waiting-for-reviewed-package`, with no signing-file reads, operator process or transactions.
- `ROBIN_LAUNCH_STATE_DIRECTORY=/var/data/robin/launch`; Render supplies `RENDER_GIT_COMMIT`.
- Archive RPC: `ROBIN_RPC_URL`. Retain the approved shared provider budget; do not raise it automatically.
- Existing custody: `ROBIN_KEYSTORE_FILE` and `ROBIN_KEYSTORE_PASSWORD_FILE`, pointing to separate Render secret files. Keep them private and unchanged during unrelated diagnosis.

The distributor is already deployed at `0x62C12ae94CcbbE470CC1857261Fae9E36074Fb36`, with immutable operator `0x9C366d4E42b8f987e8398A27b3b9A02803493088`. Deployment transaction: `0xe9e909d732221c44d4bcd96b71dc72cf87df1d11cfc4143f5ac7862b0d0c379a`. Reverify its receipt, finalized runtime, operator and empty campaign baseline. Do not redeploy it to work around an RPC failure.

The token is unlaunched, the worker is in standby and the public wallet feed is inactive. Installed services and passing local tests do not verify production payouts.

## Identity and limits

Use current `launch-intent.json`: ROBINHOOK / ROBIN, chain 4663, 1 billion supply, launch wallet `0x9479ac7ED3A72866F63F37013F2c7Cc68936B519`, and a 0.01 ETH initial purchase. The custom ROBIN fee graph sends 170-bps project fees to the existing distributor, plus 30 bps to the platform, with zero LP fee.

The contract fee is 2%; an all-in quote for every platform route is not established. Current additional route charges and any fee waiver need the actual platform review.

Maximum token-launch gas cost is 0.0008 ETH. Operator ceilings are 0.0002 ETH per transaction and 0.005 ETH cumulatively, with no automatic refill. Fresh gas estimates, balances, spending reserve and reward/harvest thresholds must appear in the final review. Unused funds do not increase caps.

## Install the reviewed launch

1. Complete the current [launch plan](current-launch-plan.md), [API](launch-plan-api.md) and [handoff](launch-handoff-builder.md) flow. A generic token with the same name is not a compatible replacement.
2. Preserve the accepted request, pack report, preparation, actual platform resource, manifest and hash. Render's running commit must equal `manifest.workerSourceRevision` for v2/v3/v4, or `manifest.sourceRevision` for historical v1. A source update after admission requires a new reviewed local manifest and consent.
3. Transfer the actual reviewed public manifest through an authenticated host-management channel and run the [admission installer](launch-admission-install.md) on the host. It checks the digest and running revision, then atomically publishes `/var/data/robin/launch/admission.json` without replacing existing state. Admission contains public launch evidence, never credentials.
4. Preserve the separately server-recorded `launch-review.json` from wallet review and install it through the same authorized channel when required. Do not hand-author consent or infer it from token code. There is no public admission or activation endpoint.
5. The keyless watcher waits for the exact finalized transaction and verifies nonce, source, code, pool, fees, purchase and budgets before producing production configuration.

The default handoff is manual and generates only `production.readonly.json`. If automatic rewards are intended, prepare the prelaunch handoff explicitly with `--activation after-reviewed-launch` and review its scope before signing. An already admitted manual manifest cannot be converted by a host flag. Do not hand-edit `broadcastEnabled` to bypass the watcher. Automatic startup separately requires the exact automatic-mode manifest, recorded review, host-approved digest and `--services` command described in [launch-bootstrap.md](launch-bootstrap.md). No automatic payout service is currently enabled.

The current example policy prepares v4 finalized pipelining with a 15-minute target and an eight-transaction confirmation bound. Five-minute eligibility is measured against finalized history. Allow 30 minutes of finalized price history before the first allocation, approximately 45–50 minutes after launch under the delay observed in the live test; exact arrival times remain dependent on the chain, funding and eligibility. Verify the actual host is armed before opening the user-signed launch transaction. The hosted watcher then discovers the launch and starts rewards automatically after finalized verification.

## Connect actual wallet results

The website does not index the chain. The exporter uses archive history and its own durable directory. A dedicated publisher credential is configured in Sites and Render; the public token identity remains unset. Verify the running host with `npm run wallet-feed:check` after applying its environment. A successful diagnostic proves authentication and storage, not a launched token or live wallet results.

After verifying the real launch:

- Preserve the matching dedicated publisher token in Sites `WALLET_FEED_PUBLISH_TOKEN` and Render `ROBIN_WALLET_FEED_PUBLISH_TOKEN`. It must have at least 32 characters and must never enter client code, URLs, logs or source. Replacing it requires coordinating both hosts.
- Set `ROBIN_WALLET_FEED_URL=https://robinhook.wtf/api/wallet-snapshot`.
- Pin exact `{ chainId: 4663, token, distributor }` in the site's `LIVE_FEED_IDENTITY`, then rebuild and publish.
- Run read-only export once, verify the stored acknowledgement and public feed, then run the loop. See [wallet-feed.md](wallet-feed.md).
- In the website checkout, run `node scripts/verify-website.mjs --url https://robinhook.wtf/ --require-live`. Reconcile known-wallet paid/pending ETH against finalized distributor state.

The complete feed is capped at 2 MiB; roughly 5,000 fixture-sized accounts exceed it. Measure archive-RPC usage, cold replay time, host memory and feed size for the intended launch. A running process does not guarantee a current feed.

## Recovery and operation

Keep launch, operator and exporter state durable and private. Journals can contain replayable signed transactions. Backups must preserve pending hashes/nonces, gas reservations and round cursors together.

Uncertain broadcasts are reconciled using the exact saved transaction. Never delete journals or reset cumulative gas accounting to clear a blocked state. Unexpected exits create stop markers; reconcile the process and chain before clearing markers or stale locks.

Monitor logs and `status.json` for stopped children, stale RPC history, unavailable feeds and exhausted gas budgets. Automatic alert delivery is not provisioned. A controlled real payout, hosted feed delivery, production restart recovery and capacity measurements remain launch-time verification.

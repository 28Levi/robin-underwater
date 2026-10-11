# Launching ROBIN later

The website is public. The token and rewards require this exact custom launch. Connecting a wallet or deploying any token named ROBIN does not configure rewards automatically.

## Keep these identities

| Item | Value |
| --- | --- |
| Project / ticker | ROBINHOOK / ROBIN |
| Chain | Robinhood Chain, 4663 |
| Launch account | `0x9479ac7ED3A72866F63F37013F2c7Cc68936B519` |
| Existing distributor | `0x62C12ae94CcbbE470CC1857261Fae9E36074Fb36` |
| Operator | `0x9C366d4E42b8f987e8398A27b3b9A02803493088` |
| First purchase | 0.01 ETH |
| Launch gas ceiling | 0.0008 ETH |
| Contract fees | 170 bps rewards + 30 bps platform; zero LP fee |

Do not redeploy the distributor or reuse HOOD/MOSS packages. Current route fees are separate from fixed contract fees and need the actual platform quote/review.

## Prepare a fresh package

Use Node 24 and the exact intended published commit from https://github.com/28Levi/robin-underwater. Run `npm ci --ignore-scripts` and `npm test`. For website integration, also run the maintained [integration test](integration-tests.md).

Refresh first-party capabilities from https://api.programmable.market/v4/chains/4663/custom-launch-capabilities. A saved response is historical evidence, not permission to launch later. The preparer refuses unavailable or changed capabilities.

Follow [launch preparation](current-launch-plan.md), supplying the actual source revision and fresh distributor proof. Preserve every output directory. The current flow is Custom Launch Plan V1, response 1.2 and `atomic_execute_and_stamp_v2`; the old `/custom-launches` creation endpoint is retired.

Use [launch:api](launch-plan-api.md) for the existing account/key's scope check, preflight and idempotent creation/recovery. Credentials use the documented hidden stdin channel, never shell arguments or chat. A pending platform review is not a wallet-ready package. A timeout must recover the same request/resource rather than create another launch.

## Review the real transaction

Use [launch:handoff](launch-handoff-builder.md) with the actual accepted resource. It verifies the signed platform envelope, source graph, full transaction simulation, gas, nonce, value, expiry and identities. The default candidate is manual and neither sends money nor activates rewards.

For automatic rewards after launch, explicitly select `--activation after-reviewed-launch` when building this prelaunch handoff. Review the exact resulting automation policy before the final wallet action. That option only prepares a candidate: the separate recorded consent, host-approved digest, service gate and exact finalized launch remain required. An already admitted manual manifest cannot later be switched by changing an environment flag; a separate post-launch activation workflow is not implemented.

Open [launch:review](launch-wallet-review.md) in the browser holding the launch wallet. Check purchase, minimum output, gas and fee destinations before the final wallet action. No private key needs to enter this repository. Preserve the review and transaction hash. If broadcast succeeds but the page loses its response, recover by hash; do not sign again merely because the page timed out.

You can sign the exact prepared transaction in your own browser. A different token launched through the generic platform form will not satisfy the custom graph and fee-recipient checks and will not activate this reward service.

## Finish production wiring

Follow [production setup](production-setup.md) to install the immutable admission/review records on Render and verify the exact finalized launch. Manual mode remains read-only; automatic rewards require the separately reviewed payout policy and activation gates.

Install authenticated wallet-feed delivery and pin the real token identity on the website. Do not replace inactive results with example balances. Allow normal acquisition maturity and price history to accumulate.

## Evidence still needed from the real launch

Local tests cover contracts, fees, allocation, restart recovery, API recovery and feed consumption. They do not prove platform approval or production operation. Before describing everything as live, verify the accepted transaction, deployed graph/fees, archive-RPC capacity, authenticated hosted feed, actual wallet results, operator recovery and a controlled authorized payout.

If a gate fails, preserve requests, hashes and durable state. Do not replace contracts, reset journals, increase budgets or weaken checks to make the status green.

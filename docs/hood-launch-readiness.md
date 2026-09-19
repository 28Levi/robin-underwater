# HOOD launch preparation — September 19, 2026

The main token has not been launched. This document supersedes historical ROBIN names and 0.1 ETH purchase amounts in older notes. Current identity is HOOD / HOOD, supply 1 billion, initial purchase 0.01 ETH from 0x9479ac7ED3A72866F63F37013F2c7Cc68936B519. X: https://x.com/HOOKHOOD. No separate website is required; the public source repository is the metadata website.

Fixed fees are 180 project basis points plus 20 platform basis points on both buys and sells. The unchanged canonical Native20 hook collects fees; an offchain operator calculates losses and sends ETH through the distributor. Eligibility uses a one-hour amount-specific holding period and a 30-minute pool TWAP at finalized chain state. Fees fund rewards; there is no guarantee of recovering losses. The operator remains trusted. The previously accepted two-wallet farming and equal-balance timing limitations remain.

## Verified repairs

- Allocation credits and token transfers now replay in log order, so a transfer inside a reward callback carries credited relief. Mixed swap settlements crossing an allocation are conservatively unsupported rather than given invented purchase attribution.
- Recipient checks are bound to actual payout calldata; unrelated transfers and incoming dust no longer cancel another recipient's prepared payment. Relevant outgoing transfers still defer it, while fee harvest can proceed independently.
- Automatic payment retries stop after three attempts per recipient. All retries together are limited to 10% of the original cumulative gas allowance, without adding to the approved total. A deferred recipient keeps its reserved ETH and can call `pay` itself.
- Finalized replay reconciles changed accounts incrementally, indexes deferred recipients from payment events, and discards deduplication IDs already covered by the finalized checkpoint. Full ledger storage and cloning still grow with holder count; this is not an unlimited-scale system.
- Source releases include the wallet guard module required by their tests.

## Evidence and migration

The local regression suite passed 97 tests before final packaging. The canonical HOOD fixture uses the approved 0.01 ETH first purchase; the callback regression verifies actual EVM execution and subsequent loss accounting. Local rehearsals use disposable keys and send no live transactions.

Ledger version 3 deliberately rejects old snapshots and changes execution-journal bindings. Do not erase existing journals or gas reservations to upgrade. Reconcile any pending signed transactions and unfinished rounds before an explicit migration; reconstruct holdings and relief from chain history. The main HOOD operator has not been activated, so it will start with a new token-specific state directory. Historical MOSSC state remains preserved.

The existing distributor at 0x62C12ae94CcbbE470CC1857261Fae9E36074Fb36 was reverified on September 19: unchanged runtime, canonical finalized deployment, correct operator, and 0.005 ETH operator funding. It does not require redeployment for these offchain repairs.

## Remaining activation sequence

Publish and deploy the repaired source. Prepare the exact HOOD graph and run Programmable's current validation/admission. Review the initial-purchase minimum and final gas estimate within the approved 0.0008 ETH token-launch gas cap. The wallet owner signs the token launch. Verify the mined/finalized token, hook, fee vault, pool and fee destinations, install the exact production configuration, run `--check`, and only then enable `--send`.

Main operator gas remains capped at 0.005 ETH cumulatively and 0.0002 ETH per transaction, with no automatic refill. Hosting and RPC budgets are unchanged. A successful software test is not a claim that production rewards are active.

# ROBINHOOK / ROBIN

ROBINHOOK is a transferable token whose project trading fees fund ETH rewards for eligible holders with remaining unrealized losses. The recovery ladder helps the deepest remaining percentage losses first; equal loss levels share relief in proportion to eligible purchase cost. Total supply is 1 billion ROBIN.

**The website is live. The token is unlaunched and rewards are inactive.** The Render backend is deployed in standby. Local tests verify the implementation; actual platform admission, the exact launch transaction, production feed delivery and a real payout remain separate verification steps.

## Launch later

Start with [the current launch guide](docs/launch-later.md). Use the exact custom ROBIN fee graph and existing fee distributor. A generic token with the same ticker does not connect to this reward service automatically. Historical HOOD and MOSS packages must not be submitted.

- Website: https://robinhook.wtf/ and https://www.robinhook.wtf/.
- Source: https://github.com/28Levi/robin-underwater. Launch preparation and Render must bind the same exact commit.
- Launch wallet: `0x9479ac7ED3A72866F63F37013F2c7Cc68936B519`.
- Existing distributor: `0x62C12ae94CcbbE470CC1857261Fae9E36074Fb36`; immutable operator `0x9C366d4E42b8f987e8398A27b3b9A02803493088`. Reverify, do not redeploy it.
- First purchase: 0.01 ETH, buyer-funded liquidity with no ETH seed principal.
- Contract fees: 170 bps project rewards + 30 bps platform on buys/sells, zero LP fee. Current platform routing charges are separate; a 2% all-in route fee is not confirmed.
- Caps: 0.0008 ETH token-launch gas; 0.0002 ETH per operator transaction and 0.005 ETH cumulative operator gas. No automatic refill.

The current integration uses Custom Launch Plan V1, response contract 1.2 and `atomic_execute_and_stamp_v2`. The old Robinhood `/custom-launches` creation path is retired. Refresh current first-party capabilities; local packages never establish platform approval.

## Build and verify

Requires Node 24 and npm:

```sh
npm ci --ignore-scripts
npm test
```

Tests compile Solidity 0.8.26, reproduce the original pinned Native20 reference bytecode, compile the separate ROBIN 30-bps hook fork and execute real Uniswap v4 PoolManager contracts on a local EVM. They cover trading fees, ledger/recovery arithmetic, transfers, payout contracts, finality, retries, durable journals, API recovery, launch manifests and wallet feed export. They do not send mainnet transactions.

For the maintained local EVM → exporter → website Worker → browser-model test, provide the website checkout and run:

```sh
# Default sibling directory: ../robinhook-site
# Or set ROBIN_SITE_CHECKOUT to its absolute path.
npm run test:integration
```

Missing site inputs fail this command; they are not silently skipped. The test uses in-memory R2, not production storage. See [integration testing](docs/integration-tests.md) and [production setup](docs/production-setup.md) for the remaining live checks.

## Current workflows

| Task | Guide |
| --- | --- |
| Prepare and pack exact source graph | [Current launch plan](docs/current-launch-plan.md) |
| Authenticated preflight and idempotent recovery | [Launch API](docs/launch-plan-api.md) |
| Build a review from an actual admitted package | [Handoff builder](docs/launch-handoff-builder.md) |
| Final browser review and proof recovery | [Wallet review](docs/launch-wallet-review.md) |
| Standby, discovery and payout activation | [Launch bootstrap](docs/launch-bootstrap.md) |
| Host configuration and recovery | [Production setup](docs/production-setup.md) |
| Finalized wallet results | [Wallet feed](docs/wallet-feed.md) |

The final launch is a user wallet action. Standby does not sign that transaction. Payout activation additionally requires the exact reviewed manifest, separate recorded consent, matching approved digest and verified finalized launch. The default handoff is manual/read-only.

## Accounting and operation

```text
current value = token balance × reference ETH/token price
uncovered loss = max(remaining purchase cost − current value − prior allocated relief, 0)
eligible basis = remaining purchase cost × mature balance / total balance
eligible loss = uncovered loss × mature balance / total balance
priority = eligible loss / eligible basis
```

The allocator solves a common remaining-loss level within the funded treasury using exact integer/rational arithmetic. Rewards round down; residue stays in the vault. Past allocated relief counts toward recovery, including reserved credit for a failed ETH recipient. Paid ETH is tracked separately from allocations and token-inventory relief.

Buys use gross ETH paid into the designated pool, excluding gas and external routing charges. Sells remove proportional basis and relief; gifts carry them to the recipient. Unknown inventory has no invented cost basis. Each new acquisition matures for one hour; the price reference uses a 30-minute historical average. Ordinary holder wallets receive ETH without staking or claiming. Contracts that reject ETH retain credit for retry to the same recipient.

The operator persists exact signed bytes before broadcast, reconciles uncertainty by the same hash, waits for canonical finality and preserves cumulative gas reservations and batch cursors. Never delete a journal to recover from uncertainty. Unexpected worker exits require reconciliation before restart.

The operator is trusted to calculate honest allocations; an audit hash does not prove losses onchain. The documented related-wallet and timing limitations remain, and the owner chose to retain the current rules. No claim is made that the economic risk was fixed. See [router and economic validation](docs/router-and-economic-validation.md).

## Limits and evidence

Matched single-pool routes and specified router-custody paths are covered. Ambiguous routes do not invent purchase cost. Local tests of copied deployed router runtime are not live platform execution or proof of every aggregator.

The wallet feed is limited to 2 MiB. Production holder capacity, archive-provider throughput and host memory must be measured; unlimited scale is not verified. Generation age and finalized-checkpoint age are checked separately, and unavailable metrics are hidden rather than fabricated.

No local test, source publication or successful standby deployment substitutes for current platform admission, the full real transaction simulation, hosted feed verification, exact deployed contract verification and an authorized real payout. See [the later-launch guide](docs/launch-later.md).

ROBINHOOK is independent of Robinhood Markets. Vendor sources retain their included licenses. The project has not received an independent contract audit.

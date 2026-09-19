# HOOD / HOOD

Current launch intent: **1 billion HOOD, 0.01 ETH initial purchase, fixed 2% buy/sell fees**, and [@HOOKHOOD](https://x.com/HOOKHOOD). HOOD is an independent project, not affiliated with Robinhood Markets. The chain name below refers to Robinhood Chain.

September 19 update: ledger version 3 replays allocations and token movements in actual log order, including ETH payment callbacks. Unrelated transfers no longer invalidate another holder's payout. Automatic retries are limited to three per recipient and 10% of the existing cumulative gas allowance. The current readiness record is [HOOD launch readiness](docs/hood-launch-readiness.md); older dated notes are historical.

**Launch implementation and production service entry point prepared. No token has been launched. Programmable admission and production activation are pending.**

**2026-09-13: the user chose to retain the original loss-weighted rewards and accept the documented two-wallet farming risk. Capped fee refunds were rejected.** The farming risk remains reproduced, not fixed. Incoming amounts age independently; incoming dust no longer cancels a payout round or reverts the entire payment batch. Equal-balance round trips after the final RPC check remain undetected. See [router and economic validation](docs/router-and-economic-validation.md). The farming test deliberately demonstrates the flaw; a green test suite does not establish launch admission or economic safety.

HOOD is a regular, transferable token with **1 billion supply** and **buyer-funded liquidity**. Project trading fees accumulate in an ETH reward vault. A background service measures holders' unrealized ETH losses and prepares proportional payments. Someone down 2 ETH receives twice as much as someone down 1 ETH; profitable holders receive none. Rewards are limited to collected fees and remaining measured losses.

Holders do not stake, register or claim. The contracts send ETH directly to ordinary wallets. The complete automatic collection/payment cycle is implemented and tested on a local EVM; the hosted service is staged but production payouts have not been activated.

## Build and verify

Requires Node 24 and npm. From this directory:

```sh
npm ci --ignore-scripts
npm test
npm run demo
npm run check:platform
```

Tests compile Solidity 0.8.26 and execute actual Uniswap v4 PoolManager contracts in a local EVM. The canonical hook build must reproduce Programmable's reviewed creation bytecode exactly. `check:platform` exits 2 while launch inputs and server admission are incomplete. These commands never sign or broadcast live transactions.

## Programmable integration

The preferred path uses the **unchanged reviewed Native20 token, hook and initializer**, with no optional module and zero LP fee. Its immutable creator-fee recipient is our separate `UnderwaterDistributor`. Anyone can call the standard fee vault's `claimCreator()` to deliver those fees to the distributor. The loss calculations run offchain; the hook collects the fees and supplies authenticated trade events.

The local integration test covers the full 1 billion issuance, locked token-side liquidity, the paid initial purchase, ordinary buys/sells, separate platform/reward fee collection, replay of trade history and an ETH reward to an underwater holder. It runs on a local chain configured as 4663; it is **not a mainnet fork, server preflight or execution through the real graph factory**.

The confirmed fee is **2% total on buys and sells: 1.80% for rewards plus 0.20% for the platform**, with zero LP fee. Programmable's published initializer supports these nonzero immutable creator fees. There is no fee setter; rates become fixed at deployment. Fee rounding is in integer wei.

Buyer-funded means **zero ETH seed principal**. Programmable still requires a paid, atomic first purchase from the launch wallet with a positive minimum token output. That purchase supplies the initial ETH reserves; later buyers supply more. A fresh platform quote and user-selected purchase/gas budgets are needed before preparing a live transaction.

The proposed launch keeps the three reviewed graph targets and uses a separately deployed reward distributor as the fee recipient. The complete request must pass authenticated preflight; local source reproduction does not establish acceptance of that exact configuration.

## Main files

- `vendor/programmable-native20/`: pinned official sources and compiler inputs.
- `scripts/compile-native20.mjs`: reproduces the reviewed hook and compiles the official token/initializer together.
- `contracts/UnderwaterDistributor.sol`: funded ETH batches, immutable trusted operator, replay protection and isolated failed receivers.
- `src/native20-adapter.mjs`: interprets authenticated Native20 fee and PoolManager events, including the initial purchase.
- `src/receipt-adapter.mjs`: identifies holders from token settlement, rather than mistaking the router for the trader.
- `src/ledger.mjs`: integer-only cost basis, transfers, partial sales, previous relief and proportional allocation.
- `src/replay.mjs`, `src/store.mjs`: finalized history replay, balance reconciliation and atomic, configuration-bound persistence.
- `src/payout-plan.mjs`, `src/worker.mjs`: repeatable preparation of unsigned funded batches.
- `src/executor.mjs`, `src/execution-journal.mjs`, `src/reward-round.mjs`: automatic fee collection, guarded payouts, durable multi-batch rounds and recovery of uncertain transactions.
- `scripts/production-operator.mjs`, `src/production-network.mjs`: production deployment verification, encrypted-keystore entry point and explicit activation. See [production setup](docs/production-setup.md).
- `launch-intent.json`: confirmed preferences and explicit missing inputs; **not** a valid Programmable submission.

`SherwoodToken.sol` and `UnderwaterHook.sol` are earlier experimental contracts retained for accounting and swap tests. They are not the preferred Programmable launch artifacts. The project folder retains its early internal working title; no Robinhood company affiliation is claimed.

## Accounting

```text
current value = token balance × reference ETH/token price
uncovered loss = max(remaining purchase cost − current value − prior allocated relief, 0)
reward = min(available fee budget, total eligible loss) × holder loss / total eligible loss
```

All calculations use ETH wei and 18-decimal HOOD units. Allocation rounds down and leaves residue in the vault. If no holder qualifies, fees remain for later distributions. Rewards reduce future eligibility once allocated, including credits reserved for failed ETH receivers. Payment retries are not counted twice.

Buys add gross ETH actually paid into the designated pool. Gas and external routing charges are excluded. Sells remove proportional purchase cost and previous relief; this tracks the remaining holding's unrealized shortfall, not lifetime realized losses. A gift carries existing basis and relief. Initial issuance and unknown incoming inventory have zero purchase basis.

Initial service settings use a 30-minute historical average price and a one-hour delay for each newly acquired amount. Mature tokens retain their age when new tokens arrive; the mature fraction of the balance determines the eligible share of the wallet's uncovered loss. Exits consume oldest inventory first for age tracking, while purchase cost and prior relief still move proportionally. Incoming transfers alone do not exclude recipients; outgoing transfers after a snapshot exclude that sender from the pending round.

## Trading coverage and limits

Matched single-pool trades work without trader setup. Direct settlement and a single linear router-custody path are decoded. Split recipients, multiple netted swaps, liquidity activity and other ambiguous routes do not establish new purchase cost. Unknown inbound tokens do not erase existing known basis. Ambiguous dust cannot quarantine a whole wallet or reset its age. Declared system/external pool addresses are excluded.

Six flows pass both with upstream Universal Router 2.1.0 and with the actual Robinhood router/Permit2 runtime bytes read from the official RPC: all four single-pool swap directions, router custody with sweep, and slippage rollback. Runtime hashes match current platform capabilities. These are local executions of copied deployed code, not mainnet transactions, full source verification or proof of every frontend route. Other aggregators, CEXs, bridges and external pools remain outside coverage. The economic test confirms that the TWAP, age gate, loss cap and honest operator do not prevent the documented two-wallet strategy.

## Operator and trust

The distributor's operator is **trusted to calculate and submit honest allocations**. Its audit hash commits to a report; it does not prove loss eligibility onchain. A malicious operator could redirect the reward treasury. It cannot mint/freeze HOOD, change the canonical hook fee or take tokens from holder wallets through these contracts.

Ordinary wallets receive ETH when a batch executes. A contract that rejects ETH keeps reserved credit, and anyone can retry payment to that same recipient. The immutable operator needs a durable production key/custody arrangement.

The separate background preparation worker is read-only. It replays finalized history, saves its ledger and prepares unsigned transactions across restarts. A changed finalized hash, inconsistent balance, corrupted snapshot, stale process lock or unfinalized previous allocation stops new preparation. Accounts with outgoing transfers since the snapshot are excluded from that cycle. Preparation freshness is checked separately from finality delay.

A separate executor signs and executes collection, payout and retry transactions. It persists signed bytes before broadcast, reconciles finality after restarts, enforces explicit gas limits and completes all batches of a round. It rechecks eligibility before later batches; at execution it accepts balances at or above the measured amount and skips lower balances without cancelling other payments. Local tests cover its transaction lifecycle. Production activation additionally requires a canonical chain anchor, historical RPC access, pinned deployment settings, operator custody and explicit gas budgets; it has not been activated. See [the operator guide](docs/payout-operator.md) and [production setup](docs/production-setup.md). Reward-service failures do not stop normal token trading.

With actual addresses in `config.local.json`, set the configured RPC environment variable and run:

```sh
npm run snapshot -- config.local.json
npm run prepare:payout -- config.local.json
npm run operator -- config.local.json --once
# Omit --once for continuous preparation. It still does not sign or broadcast.
```

Output goes to `output/operator/`. Prepared calldata expires and is not permission to spend. A leftover process lock is not automatically cleared after a crash.

## Launch status

Confirmed: **ROBINHOOD / ROBIN, 1 billion tokens, buyer-funded liquidity, 2% total buy/sell fee and a 0.1 ETH first purchase**. No separate website is needed or planned. The existing public GitHub project page supplies Programmable's website metadata link; the logo is published. The platform still requires a project X profile.

Launch wallet: `0x9479ac7ED3A72866F63F37013F2c7Cc68936B519` (checksum validated).

The gas budget remains unset. Once the official CLI has validated a prepared wallet transaction, estimate it without a key or signature:

```sh
# Set ROBIN_RPC_URL; use refreshed capabilities from the platform.
npm run estimate:gas -- official-wallet-transaction.json fresh-capabilities.json
```

This checks the RPC chain, wallet, purchase value, router runtime and expiry before calling `eth_estimateGas`. It writes `output/launch-gas-estimate.json`, including an explicit 20% gas-unit review margin, without changing the purchase or authorizing a gas budget. This estimates execution gas for the launch-router transaction only; separate distributor deployment, ongoing payout costs and any separately charged chain fees remain additional. It neither verifies platform authorization nor replaces official package validation or the final wallet fee quote.

Still needed: separate gas budgets and wallet funding; minimum token output; public metadata links and source revision; reward distributor deployment; operator custody, archival RPC and host activation; fresh quote and exact-request preflight. The latest launch-wallet readback was 0 ETH. No token package has been submitted, wallet connected or live funds moved.

The provided API key passed a read-only authenticated request (HTTP 200; no existing launches). It was not saved in the repository. Read access does not establish creation scope or launch admission.

Official evidence captured on 2026-09-12 uses profile 4.1.0 revision 2 and CLI source commit `b17e40b9ff20bb16feb857bf77451b0a590e7105`. Refresh before launch:

- https://api.programmable.market/v4/chains/4663/launch-coverage
- https://api.programmable.market/v4/chains/4663/capabilities
- https://programmable.market/.well-known/programmable.json
- https://programmable.family/agents.md

Downloaded evidence in `research/` records platform information, not permission to launch. Pinned vendor sources are covered by their included license. The reward code has not received an independent audit.

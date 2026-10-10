# ROBINHOOK / ROBIN

Current launch intent: **ROBINHOOK, ticker ROBIN, 1 billion supply, 0.01 ETH initial purchase, fixed 2% contract buy/sell fees**, and [@HOOKHOOD](https://x.com/HOOKHOOD). ROBINHOOK is an independent project, not affiliated with Robinhood Markets. The chain name below refers to Robinhood Chain.

## Current launch path

Fresh discovery on October 10 confirms that Programmable's old Robinhood `/custom-launches` endpoint is retired for new requests. Current preparation uses **Custom Launch Plan V1**, response contract **1.2**, and `atomic_execute_and_stamp_v2`. Historical `hood` and `moss` launch packages must never be submitted as the ROBIN release. The current path binds exact source, deterministic addresses, an unchanged Native20 fee hook, the existing distributor, a single Atomic launch transaction, and a separate rewards-activation decision.

The new platform policy charges **0.30% of swap output on routed open-provenance trades**, unless its documented existing-pool-fee waiver is verified. The Native20 hook itself still charges 1.80% for rewards plus 0.20% for the platform. **A 2% all-in route fee is not confirmed.** Platform fee review and actual route execution evidence must resolve this before final launch review; an unknown fee is not zero.

The distributor was freshly verified on October 10 against the configured archive RPC: exact deployed runtime, immutable operator, original finalized deployment, and zero available/reserved ETH matched. This is not a token launch or production payout test. Programmable account access, authenticated preflight, any required manual platform review, the final unsigned transaction, and the cloud activation manifest remain separate gates. No local test or source publication substitutes for them.

The prelaunch worker remains unable to sign until an exact admitted manifest, separate consent record, matching host-approved digest, and the exact finalized user launch are verified. The final launch belongs to the user's wallet; no script automatically signs that transaction.

Current launch-path regression: **168/168 backend tests pass**, including both Solidity compilations, current plan preparation, API recovery, wallet review, launch verification and the optimized exporter. The separate real local-EVM to website Worker/browser harness passes **8/8**. Evidence: `output/full-regression-final-exporter.log` and `output/wallet-feed-cross-repo-current.log`. These results do not establish platform admission or production launch readiness. The owner chose to retain the existing reward rules after reviewing the related-wallet finding.

October 10 identity update: the current launch name is ROBINHOOK and the ticker is ROBIN. The public website is https://robinhook.wtf/. The September HOOD packages and pinned source revision are historical and must be rebuilt, republished and revalidated before signing. Script and artifact paths containing `hood` retain their historical names; they do not define the current token identity. The preparation guard reads the current launch intent and rejects the old HOOD ticker. Run `node --test test/launch-intent.test.mjs` to check the current identity offline. The former logo encoding failure is resolved locally: the current 1024px hook PNG passes `decodeExactProjectImageV4` and is published at https://robinhook.wtf/assets/robinhook-token-logo.png (website version 22). This does not establish acceptance of a rebuilt launch package. Platform admission and production rewards activation are not complete.

October 10 mechanics update: ledger version 4 uses a recovery ladder. It brings the deepest remaining percentage losses toward the next level; tied positions share relief by eligible purchase cost. The recorded mechanics run passed all 104 regression tests and the separate-process local rehearsal before the ROBIN ticker update. New rehearsals use ROBIN; existing reports retain their original identities. The previous callback accounting and bounded retry repairs remain. The current readiness record is [launch readiness](docs/hood-launch-readiness.md); older dated notes are historical.

Fresh October 10 verification after the ticker and exporter updates: **131 backend tests passed, 0 failed**, including ROBIN preparation validation, rejection of stale HOOD inputs, local canonical ROBIN token identity verification and 23 exporter tests. Both local Solidity builds passed and the reviewed Native20 kernel bytecode reproduced exactly. A separate cross-repository integration harness passed **8/8 checks**, taking real local-EVM rewards through the incremental exporter, authenticated website Worker, fake R2 storage and browser view. It checks exact paid/pending ETH, dense tiers, freshness, outage/rollback handling and inactive launch gates. Evidence is saved in the ignored [compact result](output/robin-launch-readiness-final-regression.summary.json), [full build/test log](output/robin-launch-readiness-final-regression.log) and [integration log](output/wallet-feed-cross-repo-current.log). These tests used local EVM/mocked providers, no live RPC and no mainnet transactions. They did not rerun the historical separate-process rehearsal or verify production hosting/admission.

The read-only wallet exporter has configuration-bound incremental payment history, finalized receipt/pending reconciliation and separate 15-minute generation/30-minute checkpoint freshness limits. See [wallet-feed setup](docs/wallet-feed.md). No live token feed or payout sender is active. The early October 10 public-RPC readback lacked historical state; the subsequent configured archive-RPC verification described above verified the existing distributor. Deployment records and the current readiness report must be consulted for the exact published source and service status.

**Launch implementation and production service entry point prepared. No token has been launched. Programmable admission and production activation are pending.**

**The recovery ladder replaces the original proportional loss weighting.** Capped fee refunds remain out of scope. The two-wallet farming counterexample still passes under the new rule: the risk is not fixed. Incoming amounts age independently; incoming dust does not cancel a payout round or revert the entire payment batch. Equal-balance round trips after the final RPC check remain undetected. See [router and economic validation](docs/router-and-economic-validation.md). A green test suite does not establish launch admission or economic safety.

ROBINHOOK is a regular, transferable token with **1 billion supply** and **buyer-funded liquidity**. Project trading fees accumulate in an ETH reward vault. A background service measures remaining unrealized ETH losses as a percentage of eligible purchase cost. With equal entries at 60%, 30% and 10% loss, relief first brings 60% toward 30%, then the two toward 10%, then all toward zero. Rewards are limited to collected fees and remaining measured losses. A large position may still receive more ETH; the rule measures position loss, not personal wealth.

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

The contract fee is **2% on buys and sells: 1.80% for rewards plus 0.20% for the platform**, with zero LP fee. Programmable's published initializer supports these nonzero immutable creator fees. There is no fee setter; rates become fixed at deployment. Fee rounding is in integer wei. Current routed trading fees are separate and must be resolved using the current platform fee review described above.

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
- `src/wallet-feed.mjs`, `scripts/export-wallet-feed.mjs`: independent read-only finalized wallet exporter with incremental payment history, exact tiers and authenticated public-feed delivery. See [wallet-feed setup](docs/wallet-feed.md).
- `launch-intent.json`: confirmed preferences and explicit missing inputs; **not** a valid Programmable submission.

`SherwoodToken.sol` and `UnderwaterHook.sol` are earlier experimental contracts retained for accounting and swap tests. They are not the preferred Programmable launch artifacts. The project folder retains its early internal working title; no Robinhood company affiliation is claimed.

## Accounting

```text
current value = token balance × reference ETH/token price
uncovered loss = max(remaining purchase cost − current value − prior allocated relief, 0)
eligible basis = remaining purchase cost × mature balance / total balance
eligible loss = uncovered loss × mature balance / total balance
priority = eligible loss / eligible basis
reward = eligible loss − eligible basis × common remaining-loss level
```

The common level is solved by exact rational arithmetic over the deepest eligible tiers within the available budget. All calculations use ETH wei and 18-decimal ROBIN units. Allocation rounds down and leaves residue in the vault. If no holder qualifies, fees remain for later distributions. Rewards reduce future eligibility once allocated, including credits reserved for failed ETH receivers. Payment retries are not counted twice. Identically split mature positions cannot increase their combined mathematical allocation; this does not prevent broader related-wallet strategies or aggregation/rounding effects.

Each new execution round saves its calculation inputs and committed result under `recovery-reports/` in the operator state directory. `node scripts/verify-recovery-report.mjs <report.json>` independently checks the arithmetic and report commitment. It does not prove that supplied inputs are complete or authentic chain history. Reports are local operator artifacts until deliberately published; no live public report feed is active.

Buys add gross ETH actually paid into the designated pool. Gas and external routing charges are excluded. Sells remove proportional purchase cost and previous relief; this tracks the remaining holding's unrealized shortfall, not lifetime realized losses. A gift carries existing basis and relief. Initial issuance and unknown incoming inventory have zero purchase basis.

Initial service settings use a 30-minute historical average price and a one-hour delay for each newly acquired amount. Mature tokens retain their age when new tokens arrive; the mature fraction of the balance determines the eligible share of the wallet's uncovered loss. Exits consume oldest inventory first for age tracking, while purchase cost and prior relief still move proportionally. Incoming transfers alone do not exclude recipients; outgoing transfers after a snapshot exclude that sender from the pending round.

## Trading coverage and limits

Matched single-pool trades work without trader setup. Direct settlement and a single linear router-custody path are decoded. Split recipients, multiple netted swaps, liquidity activity and other ambiguous routes do not establish new purchase cost. Unknown inbound tokens do not erase existing known basis. Ambiguous dust cannot quarantine a whole wallet or reset its age. Declared system/external pool addresses are excluded.

Six flows pass both with upstream Universal Router 2.1.0 and with the actual Robinhood router/Permit2 runtime bytes read from the official RPC: all four single-pool swap directions, router custody with sweep, and slippage rollback. Runtime hashes match current platform capabilities. These are local executions of copied deployed code, not mainnet transactions, full source verification or proof of every frontend route. Other aggregators, CEXs, bridges and external pools remain outside coverage. The economic test confirms that the TWAP, age gate, loss cap and honest operator do not prevent the documented two-wallet strategy.

## Operator and trust

The distributor's operator is **trusted to calculate and submit honest allocations**. Its audit hash commits to a report; it does not prove loss eligibility onchain. A malicious operator could redirect the reward treasury. It cannot mint/freeze ROBIN, change the canonical hook fee or take tokens from holder wallets through these contracts.

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

Current intent: **ROBINHOOK / ROBIN, 1 billion tokens, buyer-funded liquidity, 2% total buy/sell fee and a 0.01 ETH first purchase**. The website metadata link is https://robinhook.wtf/; the public GitHub project remains the separate source link, and the selected X profile is https://x.com/HOOKHOOD. The current 1024px hook logo passes the platform image decoder and is published at https://robinhook.wtf/assets/robinhook-token-logo.png. Existing generated HOOD packs, signed artifacts and recorded test evidence are preserved and are not current ROBIN launch packages.

Launch wallet: `0x9479ac7ED3A72866F63F37013F2c7Cc68936B519` (checksum validated).

Recorded gas caps remain 0.0008 ETH for the token launch, 0.005 ETH cumulative operator gas and 0.0002 ETH per operator transaction, with no automatic refill. Fresh wallet balances and an estimate within these limits remain required. Once the official CLI has validated a prepared wallet transaction, estimate it without a key or signature:

```sh
# Set ROBIN_RPC_URL; use refreshed capabilities from the platform.
npm run estimate:gas -- official-wallet-transaction.json fresh-capabilities.json
```

This checks the RPC chain, wallet, purchase value, router runtime and expiry before calling `eth_estimateGas`. It writes `output/launch-gas-estimate.json`, including an explicit 20% gas-unit review margin, without changing the purchase or authorizing a gas budget. This estimates execution gas for the launch-router transaction only; separate distributor deployment, ongoing payout costs and any separately charged chain fees remain additional. It neither verifies platform authorization nor replaces official package validation or the final wallet fee quote.

Still needed: publish the current backend source and bind its exact revision; rebuild and admit the current ROBIN launch package; refresh the quote, minimum output, gas estimate and wallet funding checks; verify the existing distributor's runtime/operator through a working archive RPC; verify custody, durable hosting and deployment settings; obtain the token launch signature; verify the finalized token graph; activate the bounded operator and read-only exporter; then connect and verify real wallet results. The main token is unlaunched. No current wallet funding or production reward status is inferred from old records, and the existing distributor must not be redeployed merely because historical-state reads fail.

Historical platform evidence records a read-only authenticated request (HTTP 200; no existing launches). The credential was not saved in the repository. That earlier read access does not establish current creation scope or launch admission.

Official evidence captured on 2026-09-12 uses profile 4.1.0 revision 2 and CLI source commit `b17e40b9ff20bb16feb857bf77451b0a590e7105`. Refresh before launch:

- https://api.programmable.market/v4/chains/4663/launch-coverage
- https://api.programmable.market/v4/chains/4663/capabilities
- https://programmable.market/.well-known/programmable.json
- https://programmable.family/agents.md

Downloaded evidence in `research/` records platform information, not permission to launch. Pinned vendor sources are covered by their included license. The reward code has not received an independent audit.

# Automatic payouts: local execution and production handoff

The local executor now performs the complete cycle with actual EVM transactions: claim project fees from the canonical Native20 vault, replay finalized trades, calculate proportional loss relief, sign guarded payments, and reconcile their finalized receipts. It also retries failed ETH receivers without allocating their rewards twice.

## Run the verification

```sh
npm test
```

The integration test creates an isolated Hardhat EVM configured as chain 4663, deploys the unchanged reviewed Native20 token/hook/initializer and the reward distributor, executes ordinary trades, and runs the executor. It uses Hardhat's public test wallet. No live RPC, API key, user wallet or real ETH is involved.

For a separate local Hardhat node, fill the normal config with its deployed addresses and add an `execution` object based on `execution.example.json`. Runtime hashes must match the actual local deployments. Set the local RPC environment variable and `ROBIN_LOCAL_OPERATOR_PRIVATE_KEY` to a local test-wallet key, then run:

```sh
npm run executor:local -- config.local.json --once
# Without --once, repeat every 30 seconds until stopped or a blocking error occurs.
```

This local CLI accepts loopback RPC URLs only and requires Hardhat metadata. The separate production entry point is described in [production setup](production-setup.md); it requires explicit activation, deployment verification, operator custody and gas limits. No production operator has been activated. The user's live purchase/gas budgets are not used by these local tests.

The loop waits for sufficient finalized price history after deployment and retries preparation if the chain head changes during estimation. It does not need a manual restart for those ordinary waiting states.

## Transaction and payment lifecycle

Only one transaction is outstanding per journal. Before broadcasting, the executor persists its exact signed bytes, hash, nonce, purpose and gas reservation. A timeout can mean the node accepted the transaction; subsequent cycles reconcile that hash or rebroadcast the identical bytes. They do not sign a second payment to resolve uncertainty. A receipt must be canonical and finalized before the executor proceeds.

The gas reservation is `gasLimit × maxFeePerGas`, with a 20% gas-unit margin. Both a per-transaction cap and a lifetime journal cap are required. Reservations are never replenished automatically, including after failed transactions. These are local execution-gas limits, not estimates of all possible production chain fees.

Rewards are grouped into durable rounds. The initial round fixes each holder's proportional entitlement, and a persisted cursor advances through batches only after successful finality. A restart does not return to the first group. Later batches recheck current finalized losses and exclude recipients with outgoing transfers since the original round snapshot. An entitlement can shrink to zero if its holder recovers or sends tokens out. Incoming dust does not exclude a recipient. Skipped amounts remain in the reward vault. Incoming fees are available to subsequent rounds.

Before signing each transaction, the executor estimates gas and rejects a head change during preparation. The executor uses `distributeEligible`, which checks expiry and accepts token balances at or above the measured amount. A lower balance skips just that recipient; even an all-skipped batch is recorded without allocating funds. Only actual `RewardAllocated` events reduce future relief eligibility. The contract retains the older operator-only `distribute` and `distributeGuarded` methods for compatibility, but the executor does not use them. The operator remains trusted under every method.

Failed ETH deliveries remain reserved credits. The executor can retry them, with a configured retry interval. A retry targets the same recipient, does not create another allocation, and consumes the operator's gas budget.

## Recovery

State lives in `output/executor/`: the checksummed/configuration-bound journal, snapshot, batch reports and status. The journal contains replayable signed transactions; keep it private, out of version control, and backed up alongside the snapshot. File hashes detect corruption, not deliberate tampering by someone who controls the operator's machine.

A clean restart resumes from those files. After a hard crash, a leftover process lock requires manual reconciliation: confirm that no executor process is active, inspect the saved pending hash/nonce on the same chain, and then remove only that local lock. Never delete or reset the journal to resolve uncertainty. Never run different journals against the same operator wallet.

Ledger version 2 introduces amount-specific maturity. Version 1 ledgers cannot reconstruct historical acquisition amounts and are rejected; rebuild the snapshot by replaying chain history from deployment. The ledger version is also included in the snapshot and executor configuration fingerprint and payout audit content. Old execution journals deliberately fail the binding check: reconcile all pending transactions and allocated rounds before an explicit migration. Do not delete an old journal to bypass this check. This project has not run a production operator.

An unexplained consumed nonce, changed finalized history, changed contract runtime, mismatched configuration, corrupted journal or finalized revert stops execution. An expired unresolved transaction needs explicit nonce reconciliation. Automatic fee replacement/cancellation is not implemented.

## Still required for production

- A dedicated operator signing/custody arrangement and hosted service with durable storage, monitoring and recovery procedures.
- Approved ongoing gas funding, transaction frequency and reward/harvest thresholds. Paying rewards consumes gas as well as launching the token.
- Deployment of the updated distributor, followed by exact runtime/address binding and a production transaction policy.
- Actual Programmable/Universal Router integration tests and independent review of the contracts, indexer and execution controls.
- Economic validation of manufactured losses, price manipulation, wallet splitting and transfers.

The minimum-balance check is not complete protection against transaction ordering: a transfer out and back after the final RPC check can restore the same balance before execution, and prices can change after the snapshot. Outgoing transfers already recorded before preparation are excluded, including round trips. The reference price is still derived from the traded pool. No claim is made that these controls prove live losses or prevent reward farming.

Live deployment and gas spending remain unapproved and have not occurred.

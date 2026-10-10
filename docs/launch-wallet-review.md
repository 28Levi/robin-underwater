# ROBIN launch wallet review

The local review supports the current Programmable Custom Launch Plan response **1.2**, using one `atomic_execute_and_stamp_v2` transaction. It does not use the retired Custom Launch API or any MOSSC launch ID. The account remains the reviewed launch wallet ending `B519`; the existing distributor and operator are pinned separately.

This is an implementation of the handoff, not evidence that a live package has been approved. The official platform must first accept the exact packed request, approve manual review, prepare the Atomic wallet step and complete simulation. The full Atomic transaction must fit the approved **0.01 ETH purchase** and **0.0008 ETH maximum launch gas**. The local guards require a 20% gas-estimate margin and a 25% gas-price margin within that cap. They never increase the spending ceiling.

## Inputs

- A `robinhook.launch-bootstrap.v1` manifest validated by `src/launch-manifest.mjs`, plus its independently reviewed canonical SHA-256.
- The exact canonical packed request bytes. A trailing newline changes their identity.
- The accepted response1.2 resource, either directly or under `resource`/`data` in the saved API result.
- An explicit path for the local user-review consent. Keep that file and its `.proof.json` companion durable and private to the local operator.
- A Programmable API credential supplied through non-echoing stdin. It is held in memory and is never sent to the browser or written to disk.
- The optional `ROBIN_RPC_URL` environment setting for the independent archive RPC. Use the configured HTTPS provider, keep key-bearing paths private, and do not embed URL login credentials. Browser wallet checks continue through the selected wallet provider. The server uses the public Robinhood RPC only when this setting is absent.

The manifest binds token identity, source revision, exact plan/request/platform digests, one wallet step and nonce, calldata, expiry, executor/factory/component runtime hashes, existing distributor deployment, operator, purchase/minimum output, fee settings, launch reserve and the operator policy. `projectMetadataHash` is keccak256 of canonical JSON `plan.publication`; `fundingPlanHash` is keccak256 of canonical JSON `plan.budgets`. These are local review hashes, not substitutions for the platform's SHA-256 digests.

## Start the review

Run from the repository root, replacing every placeholder with the exact reviewed file or checksum:

```text
node scripts/serve-robin-launch-wallet.mjs --manifest PATH --manifest-sha256 sha256:HASH --request PATH --accepted-package PATH --consent-file PATH --port 8792
```

Open the printed loopback URL in the browser containing the launch wallet. Connecting the wallet performs read-only RPC checks. The final review button records the immutable local consent and opens the exact transaction in the user's wallet. The user still reviews and approves the wallet's transaction prompt. No agent or server signs it.

The manual activation mode is the default: launching does not enable automatic payouts. `after-reviewed-launch` requires the standard exact launch review to include the displayed automatic-payout policy and gas limits, producing a manifest-bound consent record. The user has directed that the current reward rules remain in place; the accepted-policy flag records that choice without asking for another separate risk approval. A manifest flag or old approval note alone does not authorize the signer. The configured watcher/host still must receive and validate the exact consent and pass every activation gate.

Contract fees are 180 bps for rewards plus 20 bps for the platform. The current open-provenance routed-trading policy may add a route fee unless its existing-pool waiver is actually verified. The review page does not claim a verified aggregate trading fee. Related-wallet loss farming and out-and-back holding-delay limitations remain documented properties of the unchanged policy; the user has chosen to proceed with those rules.

## Submission, proof and recovery

The browser records the wallet account/nonce before asking the wallet to send. An unresolved request remains locked across replacement plans or refreshed permits for that nonce. Only a definite wallet rejection clears that record; time passing is never permission to send again.

After the wallet returns a hash, the local server reads the transaction from an independent public Robinhood RPC, checks chain/anchor/runtime identity and the exact sender, target, nonce, value, calldata, gas limit and gas ceiling, then posts only that hash to the bound official step-proof endpoint. It uses the published body schema, response header1.2 and a deterministic idempotency key. The attempt journal is written before the network request. API errors are redacted and an uncertain proof response retains the original identity.

The page's **Retry platform receipt only** button reuses the existing transaction hash and never requests another wallet transaction. For a stopped/restarted review server or an expired permit, use the same invocation with an additional argument:

```text
--proof-hash 0xORIGINAL_TRANSACTION_HASH
```

This recovery mode validates the original manifest/request/consent and observed broadcast, relays only its proof and exits. It cannot open a signing page or send a transaction. Preserve the original consent path so its proof journal remains the same. The page also links to the fixed official plan-history handoff for inspection/recovery.

A recorded proof is a platform discovery hint, not finality. The launch watcher separately verifies the canonical finalized receipt, every deployment/runtime, pool/fees/operator and actual token identity before preparing or enabling any runtime configuration.

## Checks

```text
node --test test/robin-launch-wallet.test.mjs test/robin-launch-proof.test.mjs
```

The tests use inert mock packages and RPC observations: no credential, production contract, wallet, signature or broadcast is needed. They cover exact transaction binding, stale/pending review, mutation/replay guards, fresh chain state, budgets, HTTP boundaries, explicit consent, proof matching and ambiguous-response recovery.

The official proof contract was read from `https://api.programmable.market/v4/chains/4663/custom-launch-contract/openapi.json`: `POST /v4/chains/4663/custom-launch-plans/{planId}/steps/{stepId}/proofs`, with `{schemaVersion:"programmable.custom-launch-plan-step-proof.v1",transactionHash}` and a required `Idempotency-Key`. This endpoint can report the user-created transaction; it cannot sign, move funds or create a second launch.

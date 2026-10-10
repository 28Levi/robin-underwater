# ROBIN Custom Launch Plan preparation

The current launch path is Programmable Custom Launch Plan V1, using the `atomic_execute_and_stamp_v2` executor and response version `1.2`. The older `/v4/chains/4663/custom-launches` API is retired for new requests. Its historical packages, receipts and wallet pages remain recovery evidence; do not submit a new ROBIN launch through them.

On 2026-10-10 the public capabilities reported active create and preflight operations with manifest `sha256:3cd25308629f932d6a75e4a7694e6bcb67e4471fd2c1782d3b11ba5a7e3f8b61`. The observed response is a test fixture, not continuing authorization. Re-read live capabilities and `/custom-launch-credentials/me` before submitting. Preserve the credential's existing controller, scopes and chain restrictions.

## Offline builder

`src/launch-plan.mjs` compiles the unchanged Native20 kernel, token and initializer with their pinned Solidity compiler. The graph uses the existing GraphFactory at `0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd` and the current Atomic executor at `0xe21827818Fea1F14d59929CAE36a93c0B44e0aE1` as its authorized launcher. Source revision, source commitment, controller and a fresh nonce bind the namespace and deterministic addresses. The initializer still receives its call from the GraphFactory and sends the first purchase to the explicit launch wallet.

The output contains four exact source/runtime components: initializer, ROBIN token, hook and its fee-vault child. It binds the existing distributor and its operator as an external dependency. Critical completion effects cover runtime hashes, fee-vault derivation, token identity and supply, initialization, the first buyer, exact purchase value, minimum tokens received and rewards destination.

The three adjacent deployment declarations contain one identical GraphFactory call. The current Atomic contract coalesces those declarations into one project call, followed by the platform's provenance stamp. The official offline packer validates the canonical request. It does not compile on the server, approve a launch, sign a permit or produce a wallet transaction.

Example, after publishing and verifying the exact new source revision:

```sh
node scripts/prepare-robin-launch-plan.mjs \
  --source-revision EXACT_PUBLISHED_COMMIT \
  --capabilities output/current-plan-capabilities.json \
  --distributor output/distributor-deployment.verified.json \
  --out output/robin-launch-plan-release
```

The output directory must be new. It receives `plan.json`, `request.canonical.json`, `pack-report.json` and `preparation.json`. Preserve the canonical request bytes and reported idempotency key together. A changed source, nonce, parameter or request byte requires a new request identity. `--nonce` can reproduce a specific offline build; never use a new nonce to escape an unresolved submission. The builder never loads a private key or API credential and makes no network calls.

The default project-call gas limit is **7,300,000 units**. A disposable local EVM measured 5,800,261 estimated and 5,711,027 used for the exact factory project call; the selected limit rounds its 25% margin upward. The separate outer transaction ceiling is **12,000,000 units**, recorded as `totalGasLimit` and `plan.budgets.maxTotalGas`. Atomic requires enough outer gas to forward the entire project allowance under EIP-150, plus its 40,000-gas call reserve. The factory calldata alone adds approximately 405,000 intrinsic gas; the larger ceiling leaves room for envelope decoding, issuer verification, provenance writes and the wallet's fresh-estimate margin. It is a ceiling to validate, not a measured complete-transaction estimate or an instruction to spend all 12 million gas.

The approved launch gas **cost** remains **0.0008 ETH**. The complete Atomic wrapper still needs its own fresh server and wallet simulation, gas estimate and maximum-fee bound. If the returned transaction, fresh estimate or gas price cannot fit both the outer ceiling and that cost cap, signing stays blocked. `--graph-gas-limit` and `--total-gas-limit` are separate preparation parameters; changing either requires a new exact request and review.

The plan's validity interval is at most **24 hours**, matching the verified Atomic V2 contract's `MAX_ORDER_LIFETIME`. Its start allows 60 seconds for clock skew; therefore the default deadline is 23 hours 59 minutes after preparation. A fixed draft can expire during platform review. Fetch the current resource and reconcile any server-refreshed unsigned deadline against the exact plan and execution order before signing; never silently extend the locally approved request. The guide's recommendation for long-lived embedded calldata deadlines does not increase the Atomic order lifetime. The unchanged initializer has no embedded timestamp.

## Fees and remaining gates

The source retains a 1.8% project fee plus the fixed 0.2% Native20 platform fee on each buy and sell, with zero LP fee. New open-provenance plans must use `feeObligations: []`; that declaration does not remove fees implemented in the contracts.

Current Programmable-routed open-provenance trades advertise a separate 0.30% fee on gross output. Their documentation says a verified existing fee-bearing pool receives no additional route fee. **That waiver is not yet verified for the new ROBIN plan.** Read the exact preflight/review fee assessment and test the resulting route before asserting an all-in 2% fee. An unknown or unmeasured custom fee is not zero. The builder report keeps the hook fee split and this unresolved route assessment separate.

Required sequence:

1. Publish the exact current backend source and bind its commit; refresh the finalized distributor/RPC verification, capabilities and credential/controller readback.
2. POST the exact canonical bytes to `/v4/chains/4663/custom-launch-plans:preflight`. Resolve reported findings and inspect the fee assessment.
3. POST those same bytes and the reported `Idempotency-Key` to `/custom-launch-plans`, requesting `Programmable-Launch-Response-Version: 1.2`. Preserve the returned plan ID and resource. An ambiguous response requires reconciliation or exact replay, not a second launch.
4. Complete platform review if enabled. Pending, rejected or expired review cannot open signing. Approval has a 24-hour window; fetch the current resource before the final wallet handoff.
5. Require matching plan/raw-request/manifest/controller commitments, the current issuer admission and Atomic execution order, a successful full-transaction simulation, exact chain/runtime bindings and a fresh gas quote within the approved caps. The user signs the final wallet transaction.
6. Submit the transaction hash to the bound proof route and wait for canonical finalized execution, source/runtime readback and public indexing. Only then install the production token identity and activate the already bounded operator/exporter. A transaction hash alone is not launch completion.

The user retained the recovery-ladder reward policy and accepted the known related-wallet farming risk on 2026-10-10. The counterexample and equal-balance out-and-back ordering limitation remain unresolved; passing their reproduction tests does not establish economic safety. No fee-contribution cap, attribution heuristic, escrow or token/distributor change was introduced.

## Verification and provenance

`test/launch-plan.test.mjs` exercises the official packer, rejection of retired/mismatched capabilities and altered economics, and the verified GraphFactory runtime on a disposable local EVM. It checks launcher authorization, every deployed runtime, ROBIN identity, first-purchase value and minimum output, unchanged buy/sell fees, replay rejection and atomic rollback when minimum output cannot be met. The direct ethers encoding matches a fixed commitment captured from the previous official helper and the verified factory's independent commitment calculation. No unpublished workspace helper or undeclared package is needed. The local test impersonates only the Atomic caller; it does **not** claim to simulate an issuer-signed Atomic wrapper or establish production admission.

The current public manifest, packer, guide and reference are saved under `vendor/programmable-launch-plan-v1/`. `provenance.json` records URLs and byte hashes. The GraphFactory ABI, source and runtime came from Sourcify's exact match for chain 4663 and are checked against the already pinned runtime hash. No vendored Native20 source or historical signed package was changed.

Primary sources: [current plan guide](https://api.programmable.market/v4/chains/4663/custom-launch-contract/guide.md), [live capabilities](https://api.programmable.market/v4/chains/4663/custom-launch-capabilities), [manifest](https://api.programmable.market/v4/chains/4663/custom-launch-contract/manifest.json), [verified Atomic V2 source](https://sourcify.dev/server/v2/contract/4663/0xe21827818Fea1F14d59929CAE36a93c0B44e0aE1?fields=all), [agent guide](https://programmable.family/agents.md).

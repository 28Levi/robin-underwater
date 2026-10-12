# ROBIN Custom Launch Plan preparation

The current launch path is Programmable Custom Launch Plan V1, using the `atomic_execute_and_stamp_v2` executor and response version `1.2`. The older `/v4/chains/4663/custom-launches` API is retired for new requests. Its historical packages, receipts and wallet pages remain recovery evidence; do not submit a new ROBIN launch through them.

On 2026-10-10 the public capabilities reported active create and preflight operations with manifest `sha256:3cd25308629f932d6a75e4a7694e6bcb67e4471fd2c1782d3b11ba5a7e3f8b61`. The observed response is a test fixture, not continuing authorization. Re-read live capabilities and `/custom-launch-credentials/me` before submitting. Preserve the credential's existing controller, scopes and chain restrictions.

## Offline builder

### MAIN: five-wallet opening window

The requested MAIN launch now uses `launch-guard-intent.json` and the separate `robin-30-second-buy-allowlist-v1` recipe. Old unguarded MAIN packages are superseded. The new contract, `src/robinhook-launch-guard-v1/RobinhookLaunchGuardHookV1.sol`, needs a fresh platform review; it cannot be substituted into an old approved transaction.

For 30 seconds from pool initialization, these five wallets may initiate buys through the pinned canonical router:

- `0x828a661bfa21f44d4fd79dc805b8538e708b30d4`
- `0x938ff56d9e596307f5a3bdbc443052eb6c9eb36d`
- `0x61da6d6e9455373d08d8d345bce01132d3d4423c`
- `0x764263ecf27d51680b96ca3c05ff8b6880f58038`
- `0x9479ac7ed3a72866f63f37013f2c7cc68936b519`

The authenticated initializer also allows B519's existing 0.01 ETH launch purchase, with its tokens still going to B519. Everyone can buy when the block timestamp reaches the initialization timestamp plus 30 seconds. Selling is unchanged. There is no owner function to extend or restart the window or edit the five wallets.

The restriction identifies the buy initiator, not the final recipient. An allowed buyer can send purchased tokens to someone else. Token transfers and other pools are not restricted. During the opening window, arbitrary routers and spoofed hook data cannot grant permission: the hook verifies the canonical router's address, exact code hash, and authenticated caller.

Prepare the new recipe with the same fresh evidence and source revision requirements below:

```sh
node scripts/prepare-robin-guard-launch-plan.mjs \
  --source-revision EXACT_PUBLISHED_COMMIT \
  --capabilities output/current-plan-capabilities.json \
  --distributor output/distributor-deployment.verified.json \
  --out output/robin-guarded-launch-plan
```

Use `--preflight-only` only under the conditions described below. This command creates an offline request, not approval or a wallet transaction. For the eventual reviewed handoff, pass `--intent launch-guard-intent.json` to `scripts/prepare-launch-handoff.mjs`, together with the pipelined timing policy and exact worker revision. Version 5 of the manifest binds the opening window, all five buyers, B519's initial purchase and the canonical router. The launch watcher verifies them against the actual finalized launch before starting rewards.

The new hook retains the 170-bps project / 30-bps platform fee split and original fee vault. Its own runtime pin is under `vendor/robin-launch-guard-v1/`; it is not the platform's official Native30 hook recipe and does not establish a routed-fee waiver. Fresh route evidence is still required. Local EVM tests cover both buy types, all five buyers, fake routers and hook data, the 29/30-second boundary, selling, and the exact factory deployment with the initial purchase. The guarded project graph used 6,076,577 gas locally; the complete Atomic transaction still needs its own platform simulation and must fit the unchanged 0.0008 ETH gas-cost cap.

### Historical unguarded recipe

`src/launch-plan.mjs` compiles the custom ROBIN 30-bps hook fork, original token and initializer with their pinned Solidity compiler. The graph uses the existing GraphFactory at `0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd` and the current Atomic executor at `0xe21827818Fea1F14d59929CAE36a93c0B44e0aE1` as its authorized launcher. Source revision, source commitment, controller and a fresh nonce bind the namespace and deterministic addresses. The initializer still receives its call from the GraphFactory and sends the first purchase to the explicit launch wallet.

The output contains four exact source/runtime components: initializer, ROBIN token, hook and its fee-vault child. It binds the existing distributor and its operator as an external dependency. Critical completion effects cover runtime hashes, fee-vault derivation, token identity and supply, initialization, the first buyer, exact purchase value, minimum tokens received and rewards destination.

The three adjacent deployment declarations contain one identical GraphFactory call. The current Atomic contract coalesces those declarations into one project call, followed by the platform's provenance stamp. The official offline packer validates the canonical request. It does not compile on the server, approve a launch, sign a permit or produce a wallet transaction.

First refresh the shipped public distributor evidence with `npm run launch:distributor -- --out output/distributor-deployment.verified.json`. Use a new filename for each refresh; the builder rejects checks older than one hour. See [handoff inputs](launch-handoff-builder.md) for archive-RPC configuration and the manual policy example.

Example, after publishing and verifying the exact new source revision:

```sh
node scripts/prepare-robin-launch-plan.mjs \
  --source-revision EXACT_PUBLISHED_COMMIT \
  --capabilities output/current-plan-capabilities.json \
  --distributor output/distributor-deployment.verified.json \
  --out output/robin-launch-plan-release
```

The output directory must be new. It receives `plan.json`, `request.canonical.json`, `pack-report.json` and `preparation.json`. Preserve the canonical request bytes and reported idempotency key together. A changed source, nonce, parameter or request byte requires a new request identity. `--nonce` can reproduce a specific offline build; never use a new nonce to escape an unresolved submission. The builder never loads a private key or API credential and makes no network calls.

### Preparing only for preflight while create is unavailable

Default preparation still requires both `create` and `preflight` to be `active`. If the authentic current capabilities show active preflight while create is `canary`, `disabled` or `degraded`, add the standalone `--preflight-only` flag to the command above. The builder accepts those documented create states only in this explicit mode; unknown states still fail. It preserves all chain, manifest, Atomic executor, selector, address, runtime, authority, distributor and launch-economics checks. It never rewrites the supplied capability response or marks create active.

The mode produces the same exact plan and canonical request for identical inputs. `preparation.json` and the console report record the observed create and preflight states and reasons, set `preparationMode` to `preflight-only`, and label success `offline-packed-preflight-only-not-admitted-not-wallet-ready`. Platform admission, wallet readiness, signing, broadcasting and automatic rewards remain false. The official packer's independent `pack-report.json` continues to describe offline schema packing only.

Use those bytes only to request the independent platform preflight operation. A successful offline pack or server preflight is not admission and does not make a wallet transaction available. The authenticated API still independently requires active create before new submission, and all existing handoff and wallet checks remain unchanged. Re-read live capabilities and reconcile the exact request before progressing beyond preflight; do not substitute an older response that reported active create.

The default project-call gas limit is **7,300,000 units**. The prior 180/20-bps graph measured 5,800,261 estimated and 5,711,027 used on a disposable local EVM. The new 170/30-bps graph matched to the published Native30 runtime recipe measured 5,711,027 used; its exact-runtime test enforces the same 7,300,000 project ceiling. The separate outer transaction ceiling is **12,000,000 units**, recorded as `totalGasLimit` and `plan.budgets.maxTotalGas`. Atomic requires enough outer gas to forward the entire project allowance under EIP-150, plus its 40,000-gas call reserve. The factory calldata alone adds approximately 405,000 intrinsic gas; the larger ceiling leaves room for envelope decoding, issuer verification, provenance writes and the wallet's fresh-estimate margin. It is a ceiling to validate, not a measured complete-transaction estimate or an instruction to spend all 12 million gas.

The approved launch gas **cost** remains **0.0008 ETH**. The complete Atomic wrapper still needs its own fresh server and wallet simulation, gas estimate and maximum-fee bound. If the returned transaction, fresh estimate or gas price cannot fit both the outer ceiling and that cost cap, signing stays blocked. `--graph-gas-limit` and `--total-gas-limit` are separate preparation parameters; changing either requires a new exact request and review.

The plan's validity interval is at most **24 hours**, matching the verified Atomic V2 contract's `MAX_ORDER_LIFETIME`. Its start allows 60 seconds for clock skew; therefore the default deadline is 23 hours 59 minutes after preparation. A fixed draft can expire during platform review. Fetch the current resource and reconcile any server-refreshed unsigned deadline against the exact plan and execution order before signing; never silently extend the locally approved request. The guide's recommendation for long-lived embedded calldata deadlines does not increase the Atomic order lifetime. The unchanged initializer has no embedded timestamp. See [the timing evidence and remaining platform conflict](launch-review-timing.md) before changing these bounds.

## Fees and remaining gates

The custom ROBIN hook implements a 1.7% rewards fee plus a fixed 0.3% Programmable fee on each buy and sell, with zero LP fee. New open-provenance plans must use `feeObligations: []`; that declaration does not remove fees implemented in the contracts.

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

`test/launch-plan.test.mjs` exercises the official packer, rejection of retired/mismatched capabilities and altered economics, the explicit preflight-only mode and unchanged strict default, and the verified GraphFactory runtime on a disposable local EVM. It checks launcher authorization, every deployed runtime, ROBIN identity, first-purchase value and minimum output, the updated 170/30-bps buy/sell split, replay rejection and atomic rollback when minimum output cannot be met. The direct ethers encoding matches a fixed commitment captured from the previous official helper and the verified factory's independent commitment calculation. No unpublished workspace helper or undeclared package is needed. The local test impersonates only the Atomic caller; it does **not** claim to simulate an issuer-signed Atomic wrapper or establish production admission.

The current public manifest, packer, guide and reference are saved under `vendor/programmable-launch-plan-v1/`. `provenance.json` records URLs and byte hashes. The GraphFactory ABI, source and runtime came from Sourcify's exact match for chain 4663 and are checked against the already pinned runtime hash. No vendored Native20 source or historical signed package was changed. The production hook is an explicitly named project fork at `src/robinhook-fee-v1/RobinhookNativeFeeHookV1.sol`, recipe `robin-native30-no-module`; its 30-bps constant and published Native30 V2 fee profile are compiled into new exact source/runtime evidence. Compilation must reproduce the official Native30 hook and vault runtime templates and immutable offsets pinned under `vendor/programmable-native30/`. This is locally derived source matched to a published runtime recipe, not a claim that an official standalone Native30 Solidity bundle was supplied. Runtime matching is not yet a live route-fee waiver. A fee change requires a new review identity and cannot modify an already submitted request.

Primary sources: [current plan guide](https://api.programmable.market/v4/chains/4663/custom-launch-contract/guide.md), [live capabilities](https://api.programmable.market/v4/chains/4663/custom-launch-capabilities), [manifest](https://api.programmable.market/v4/chains/4663/custom-launch-contract/manifest.json), [verified Atomic V2 source](https://sourcify.dev/server/v2/contract/4663/0xe21827818Fea1F14d59929CAE36a93c0B44e0aE1?fields=all), [agent guide](https://programmable.family/agents.md).

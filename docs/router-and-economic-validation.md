# Router and economic validation — 2026-09-13

**User decision after review: retain the original loss-weighted rewards and accept the documented two-wallet farming risk. Capped fee refunds were rejected.** This does not mean the risk was fixed or that production deployment is ready. Local router compatibility passed, but testing reproduced profitable two-wallet reward farming and a separate eligibility-griefing issue. No reward rule, fee or token parameter was changed to hide these results. Nothing was deployed or broadcast on a live chain.

## Router results

The test deploys the npm-published `@uniswap/universal-router@2.1.0` artifact and runs it against the real local PoolManager and unchanged Native20 fee hook. Permit2 is the verified Ethereum runtime obtained from Sourcify, installed at its canonical address in the local EVM. Test bytecode hashes are pinned in `research/router-test-provenance.json`; the package tarball is integrity-bound in the lockfile.

Passing flows:

1. Exact-input native ETH buy.
2. Exact-output buy, with unused ETH refunded and cost basis limited to actual ETH spent.
3. Exact-input token sell using actual Permit2 allowance/transfer logic.
4. Exact-output sell using Permit2.
5. Buy routed through temporary router custody and swept to the holder.
6. An impossible minimum-output bound reverting atomically, without collecting fees or changing token balances.

The decoder identifies the actual holder, rather than assigning the position to the router. The platform fee is rounded according to the canonical kernel; the project receives the remainder of the combined fee. Independently rounding 1.8% would differ by one wei in some exact-output cases, so the assertions use the reviewed accounting and settled cashflows.

The refreshed Programmable capabilities advertise router `0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99` with runtime hash `0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5`. The current official RPC readback matches that hash, along with all eight other advertised infrastructure hashes. Tests now repeat the same six flows with those actual router and Robinhood Permit2 runtime bytes installed at their canonical addresses in the local EVM. All pass. Evidence is in `research/current/` and `output/live-runtime-compatibility.json`. This verifies copied deployed-code compatibility, not source verification, a full mainnet fork or the platform frontend's exact transaction payload.

Sources:

- [Uniswap command reference](https://developers.uniswap.org/docs/protocols/universal-router/concepts/commands)
- [Pinned Universal Router source](https://github.com/Uniswap/universal-router/tree/67553d8b067249dd7841d9d1b0eb2997b19d4bf9)
- [Pinned v4-periphery dependency](https://github.com/Uniswap/v4-periphery/tree/3779387e5d296f39df543d23524b050f89a62917)
- [Sourcify Permit2 verification](https://sourcify.dev/server/v2/contract/1/0x000000000022D473030F116dDEE9F6B43aC78BA3?fields=all)

## Confirmed economic counterexample

Two related wallets can split realized profit and unrealized loss. The service sees only the loss-bearing wallet when distributing relief. Honest calculations and ordinary swaps are sufficient; the attacker does not need control of the operator or forged observations.

The local test uses a separate honest keeper, actual hook-collected fees, the 1 billion token supply, fixed 2% buy/sell fees, the 30-minute average price and the one-hour age delay:

1. The early wallet has the normal 0.1 ETH launch purchase and makes an additional 0.9 ETH purchase. Its total early-position cost is 1 ETH.
2. An unrelated trader buys for 2 ETH and sells its position, supplying 0.07128 ETH of actual project fees. This trader has exited and is not an eligible holder.
3. A second wallet controlled by the early buyer purchases 0.1 ETH of tokens.
4. The early wallet sells its entire position, realizing about 0.008704 ETH profit and lowering the remaining wallet's token value.
5. After 3,700 seconds, the normal ledger and average-price calculation award the second wallet approximately 0.050291 ETH of relief.
6. The second wallet sells its remaining tokens. Both related wallets now have zero tokens.

Measured cashflows from the test:

| Related-wallet group | ETH |
| --- | ---: |
| Combined token purchases | 1.100000 |
| Combined sale proceeds, after trading fees | 1.056440 |
| Loss before relief and gas | -0.043560 |
| Relief received | 0.050291 |
| Profit after relief, before trading gas | 0.006731 |
| Strategy trading gas | 0.000759 |
| Profit after that trading gas | **0.005972** |

These figures exclude contract deployment and initial launch gas. They are a local counterexample, not a forecast of executable mainnet profit; production fees, other traders and ordering can differ. The problem is that the reward rule can subsidize a coordinated strategy enough to make it profitable. An hour of waiting and the average price did not remove it.

Full integer results and assumptions are regenerated in `output/economic-counterexample.json` by `test/economic-attacks.test.mjs`. The test intentionally passes when the unresolved exploit reproduces. Passing it is evidence of a problem, not a safety assertion.

## Separate eligibility griefing

Previously, an ordinary incoming transfer reset the recipient's whole-wallet acquisition timestamp. One raw token unit (10^-18 ROBIN) could make the entire holding ineligible for another hour. This ledger defect is now covered by a passing regression: receiving that unit preserves the mature holding's eligibility, with only the new amount waiting.

Ledger version 2 records amount-specific maturity buckets. Buys, ordinary gifts and ambiguous zero-basis inventory wait independently. Existing weighted-average purchase cost and credited relief are unchanged. Eligible loss is `floor(max(cost - markedValue - priorRelief, 0) × matureBalance / balance)`. Once the entire holding matures, this equals the original loss formula. Exits consume oldest age inventory first, so a purchase followed by selling older inventory cannot leave freshly bought tokens with old maturity. Transfers carry proportional cost and relief but start a new wait for only the transferred amount at the recipient. Tests cover fresh large purchases/gifts, partial and full exits, conservation, exact maturity boundaries and restart persistence.

The follow-up execution fix excludes only outgoing transfers after a snapshot. Incoming gifts no longer cancel a recipient's round. The new `distributeEligible` path accepts balances at or above the measured balance and skips lower balances individually, so one recipient cannot revert the entire batch by transferring tokens. An all-skipped batch records zero actual relief. Regression tests cover dust, skipped recipients, batch replay and actual allocation accounting. Out-and-back ordering after the final RPC read remains a limitation; this is not complete ordering or economic protection.

## Tested alternative, not adopted

Cap each recipient's total relief at the project fees that recipient actually contributed, minus previous refunds. In this specific two-wallet scenario, the losing wallet contributed 0.0018 ETH in project fees on its buy. Capping its relief there changes the group's result to approximately **-0.042519 ETH after strategy trading gas**, so the tested strategy is no longer profitable.

This is a research comparison only. It is not implemented in the reward ledger or approved as the new design, and one blocked scenario is not an economic proof. It would make ROBIN a capped fee-refund token for underwater holders, rather than unrestricted loss compensation funded by other holders' fees. The fixed 2% buy/sell fees can remain unchanged.

The user has declined that change and asked specifically to ensure outgoing transfers do not create fake losses. The current ledger already removes proportional cost and prior relief from the sender and carries them with the tokens. A receipt-replay regression now demonstrates a 90% transfer followed by a full exit: neither transfer creates a loss at unchanged prices, the sender's cost reaches zero, and a subsequent real price decline applies only to the recipient's holding. This is separate from the documented incoming-transfer age-griefing issue.

Live source verification is distinct from the completed runtime compatibility tests. Production hosting/custody, usable historical RPC, gas budgets, public metadata and exact Programmable preflight remain required. The original loss-weighted rule and its disclosed ordering/economic limitations remain in place.

## Reproduce

```sh
npm ci --ignore-scripts
npm test
# Once artifacts are compiled, only these validations:
node --test --test-concurrency=1 test/universal-router.test.mjs test/economic-attacks.test.mjs
```

The saved Permit2 evidence and pinned npm artifact allow these tests to run locally without a user API key or wallet connection.

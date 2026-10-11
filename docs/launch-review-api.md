# Read and replace an owned platform review

`scripts/robin-launch-review-api.mjs` supports only the documented `ownerRead` and `replace` operations at Programmable's fixed review-feedback endpoint. It cannot sign, broadcast, approve a review, or change submitted execution bytes. It reads the existing API credential from non-echoing standard input; never pass the credential in a command argument.

Read an owned review and its fee/timing assessment:

```text
node scripts/robin-launch-review-api.mjs ownerRead ORIGINAL_PACKAGE ORIGINAL_SUBMISSION_STATE REVIEW_STATE
```

The package directory must contain `request.canonical.json` and `pack-report.json`; submission state must contain the original `submission.json` from a successful create. Full owner-read output, including any `assessment.fees` and `assessment.timing`, is saved in `REVIEW_STATE/owner-review.json`. The helper also saves a fresh authenticated plan resource bound to the exact packed request. Review assessment fields are platform evidence; unknown or unmeasured fees are not zero.

After submitting changed contracts as a new immutable package with a new identity, explicitly replace the old review:

```text
node scripts/robin-launch-review-api.mjs replace ORIGINAL_PACKAGE ORIGINAL_SUBMISSION_STATE REVIEW_STATE NEW_PACKAGE NEW_SUBMISSION_STATE
```

Both journals must bind to the same credential/controller/chain, and both resources are freshly read and checked against their exact packed plans. The newer review must be pending, with a later submission time; the old review must be pending, rejected, or expired. This helper requires both plans to have no wallet steps; launches with any prepared or sent step need a separate reconciliation. The request uses the old resource's current revision and subject hash and the newer review's identifier. The server additionally enforces common ownership. Confirmation requires a fresh old-plan read whose `manualReview.supersededBy.launchId` identifies the new plan.

Before sending a replacement, the helper writes `replacement.json`. An ambiguous response or failed confirmation leaves that record in place. Repeating the command only re-reads owner/plan state; it does **not** send the replacement again. Preserve the record and resolve uncertain server state before any manual retry. This endpoint has no documented idempotency-key contract.

Protocol source: [Programmable Robinhood launch guide](https://api.programmable.market/v4/chains/4663/custom-launch-contract/guide.md). Current new-launch routed trades advertise 30 bps on gross output, in the output asset, rounded down once. Custom hook fees are additional unless the route verifies its existing-pool-fee waiver. A custom 30 bps platform allocation or launch approval alone does not establish that waiver; inspect owner-review fee assessment and exact-route buy/sell evidence before claiming an all-in percentage.

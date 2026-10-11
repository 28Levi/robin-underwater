# Current Programmable API preparation

`scripts/robin-launch-api.mjs` transports one exact canonical Robinhood Custom Launch Plan. It never signs, broadcasts, funds a wallet, increases a gas budget, changes launch bytes, or creates a replacement plan.

```text
node scripts/robin-launch-api.mjs credential request.canonical.json pack-report.json output/robin-platform
node scripts/robin-launch-api.mjs preflight request.canonical.json pack-report.json output/robin-platform
node scripts/robin-launch-api.mjs create request.canonical.json pack-report.json output/robin-platform
node scripts/robin-launch-api.mjs create request.canonical.json pack-report.json output/robin-platform --allow-pending-atomic-review
node scripts/robin-launch-api.mjs status request.canonical.json pack-report.json output/robin-platform
```

Each command receives the existing Programmable credential through non-echoing stdin. Do not put it in command arguments, URLs, a source file, logs, or the public release. The transport sends credentials only to `https://api.programmable.market`, rejects redirects, requests response version 1.2, and verifies chain 4663, the intended controller, scopes, current manifest, canonical request digest and pack report.

New creation requires a successful exact preflight no older than ten minutes and an active current create operation. It writes the credential/controller/request/idempotency binding before sending. If the network outcome is unknown, keep that state directory and recover with the same bytes and key. A changed credential or package cannot silently take over the existing journal. An exact ambiguous replay may recover the original request even if a later platform manifest retires new writes. After an owned plan is recorded, subsequent create/status calls read that same resource instead of creating another launch.

When the platform confirms that creation must submit a package for review before its Atomic permit can be issued, the explicit `--allow-pending-atomic-review` flag permits that narrow lifecycle state. It accepts `analysis_pending` only with exactly one finding: `PLAN_ADMISSION_PENDING`, actual `atomic_permit_pending`, axis `lifecycle`, stage `execution`, pointer `/executor`, and constraint `source_bound_pre_execution_order_then_signed_call_simulation`. `hardBlockers` must be an empty array. The saved preflight must bind the exact raw request, plan hash, manifest, controller, chain, credential identity and idempotency key. Its timestamp must be valid and not in the future, and the request's validity window must have started and remain unexpired. This lifecycle-only evidence may be older than ten minutes so the reviewed bytes can be submitted without repeatedly requesting an unavailable pre-review permit. The normal ready-preflight path retains its ten-minute limit. Current authenticated credentials and active create availability are checked again before any new creation, including this opt-in path.

After creation, poll the saved owned plan rather than rerunning preflight or posting a new package. Response artifacts include validated `headers.retryAfter` and a same-origin approved API path in `headers.location` when provided. These are metadata only; the client never follows a Location automatically. Honor Retry-After with a bounded polling budget and preserve the returned plan and review IDs. Review submission is not approval, permit issuance, a successful transaction simulation, or permission to sign.

Read `manualReview.state` and platform findings in the saved resource. Pending, rejected, expired, or changed execution is not launch-ready. The final wallet handoff requires a current approved resource, exact transaction verification and simulation, the reviewed fees and spending caps, and the user's signature. A source commit, HTTP 200, successful pack, or successful preflight alone is insufficient.

Official contract: https://api.programmable.market/v4/chains/4663/custom-launch-contract/guide.md

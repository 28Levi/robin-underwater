# Moss Circuit / MOSSC — live test handoff

## Current authorization and run — 2026-09-13 16:22 UTC

The user instructed: "ok so start now with the test. take no longer then u need" after the holding-age and finality requirements were explained. Normal automatic approval review accepted `scripts/moss-test-supervisor.mjs --until-verified`. It is running in session 1690, started at approximately 16:20:31 UTC. Do not start a second supervisor.

Latest state: waiting-for-finalized-price-history. Holdings mature at 17:06:05 UTC (19:06 Amsterdam), with finalized data also required. The process stops on a verified actual payout plus restart audit, a fault, or its absolute deadline of 18:06:05 UTC. Broadcasting is disabled automatically on exit. The unchanged remaining operator gas cap is 0.0009915324976 ETH; forwarding reservations remain debited. No payout has been verified yet. Read output/moss-operator/supervisor-status.json for fresh status and output/moss-live-payout-audit.json for successful payout evidence.

The test token is already deployed and the live buy, transfer, and sell tests passed. Token address: 0x6eee1e87095d5A21d3B77E0A70506e017dd48Ec1. No further launch signature is required. Main ROBIN and its Render worker remain inactive.

## Historical notes below — superseded where they conflict with the current run
## Latest authorization — three minutes only

**Completed:** the supervisor ran exactly 180 seconds, made six finalized-history checks, and exited successfully at 2026-09-13 16:17:39 UTC. It remained in `waiting-for-finalized-price-history`; no executor journal was created and no payout/harvest transaction was submitted. Verified after exit: broadcasting false, supervisor lock absent. No payout delivery or restart-after-payment claim has been established. Test holdings still finish maturing at 17:06:05 UTC plus the required finality delay. Do not restart without a new user instruction.

The user responded to the payout-test approval question with **"just run it for a few minutes"**. The supervisor was changed to a hard-coded 180-second maximum, with no longer-duration option, a watchdog that terminates an active child at the deadline, and automatic disabling of test broadcasting on exit. The three-hour proposal is not authorized. The normal approval review accepted the 180-second process launch. Session 34389 started at approximately 2026-09-13 16:14:39 UTC. Initial state: waiting for finalized price history. Check `output/moss-operator/supervisor-status.json` and the final process result before reporting completion. Do not restart it or extend the window without another user instruction.

## Current state — live trade tests passed, payout activation rejected by auto-review

Funding transaction `0xd3c80cd78e7850e9c5d48df055528234e4c1c82d0067d27b2a6ca5f20ac907f1` delivered exactly 0.0044 ETH from B519 to the test operator. Evidence: `output/moss-test-funding.verified.json`. Two 0.0017 ETH forwards succeeded: trader A `0xf2133c82a25c2f846ef36ed629cf8758ad6ce0f3309bac64e8f82e0c789d23be`, trader B `0x4654d8b20ee3575b110cb182abdc13dddcc94bede444371253939da3c62cd761`. `output/moss-forwarding/journal.json` records signed transactions and receipts. Gas reservation 0.0000084675024 ETH is already debited from the original 0.001 ETH operator cap; the bot's remaining cap is **0.0009915324976 ETH**. Do not reset it.

All six live trade steps succeeded: two 0.001 ETH buys, A-to-B quarter-position transfer, bounded token and Permit2 approvals, and B half-position sell. Full receipt hashes, fees and ledger positions: `output/moss-live-trade-audit.json`. Transfers preserved aggregate basis at 0.002 ETH; the sale reduced remaining aggregate basis to 0.001375 ETH. Both live token balances matched the accounting replay. Test holdings finish maturing at **2026-09-13 17:06:05 UTC (19:06 Amsterdam)**, after which finalized chain data is also required.

The existing Alchemy endpoint is stored only in owner-protected `.secrets/moss-test/rpc-url.txt`; never print it. Read-only production checks passed using it. Main Render configuration remains unchanged. The local supervisor and payout/restart audit are prepared at `scripts/moss-test-supervisor.mjs` and `scripts/audit-moss-payout-restart.mjs`. The supervisor waits for finalized price history, runs fresh bounded operator processes, stops after a successful actual payout/restart audit or after three hours, and never raises gas budgets.

**The supervisor has NOT started.** Automatic approval review rejected its process launch because it can persistently broadcast payouts for up to three hours, which the reviewer judged outside the user's bounded trade-testing authorization. Do not work around that rejection. Request explicit user approval for this concrete payout test. `deploy/moss.production.json.execution.broadcastEnabled` was reverted to **false**. No payout or fee-harvest transaction has been sent. After explicit approval, recheck current state, enable the test configuration, and launch the prepared supervisor through the normal approval path.

The original token-launch signing server is obsolete. Do not ask the user to relaunch, refund the operator, or create new wallets.

## Token deployed — 2026-09-13 15:54 UTC

User signed the replacement launch: `0x5f5c89494f71d8a3c6b0db6496d14a545cb917a36c65f91cf12929357e3bcc10`, block 62076026. Exact sender, nonce 3, 0.001 ETH value and calldata matched. All component runtimes, fee vault runtime, fixed fees, recipient, supply and minimum purchase output verified; token finality remains pending as of the check. Receipt output was 476,693.762839942643015401 MOSSC. Launch gas cost 0.00054517962564 ETH; distributor plus launch gas 0.000621632338824 ETH. Evidence: `output/moss-token-deployment.verified.json`; verifier `scripts/verify-moss-token.mjs HASH`.

Test token configuration is prepared at `deploy/moss.production.json`, broadcasting disabled. The next user action is one **0.0044 ETH** transfer on Robinhood Chain from B519 to the existing test operator `0xdfeDFfE67cbff8e27E90dbB4c9F535B888908265`, source transfer gas capped at 0.0002 ETH. Detailed plan: `output/moss-test-funding-plan.json`. After verification, forward 0.0017 ETH to each existing test trader; each has at most 0.001 ETH buy and 0.0007 ETH trading gas. The remaining operator budget is at most 0.001 ETH cumulative gas INCLUDING forwarding gas. Those forwarding costs must be reserved in the same durable spending accounting before enabling the payout bot; do not give it a fresh full 0.001 ETH after forwarding. No automatic refill. Maximum total committed test spend including observed launch costs and this source transfer gas cap is 0.006221632338824 ETH, below the approved 0.008 ETH.

No test wallet has been funded or test payout sent by the agent. Before activating the bot, verify historical RPC access, the selected swap router, source release and separate durable journal. Main ROBIN worker remains idle. The launch signing page below is now obsolete; do not ask the user to launch again.

## Current handoff — replacement authorization, 2026-09-13 15:48 UTC

The first request expired without any token transaction. The archived evidence and chain proof are in `output/moss-expired-attempt-1/`; wallet latest/pending nonce remained 3, the old token had no code and the finalized chain timestamp exceeded the signed expiry. The existing test distributor is finalized and reused. Official CLI documentation requires repack-and-submit with a fresh request nonce after expiry; all validations and server simulation ran again.

**Current launch ID:** `5df928cc-eb87-4913-9cdd-537a30b0587f`. **Expiry:** 2026-09-13 16:26:52 UTC (18:26:52 Amsterdam). User should refresh **http://127.0.0.1:8789**, connect B519 and review the token transaction. Local server session 82854 holds the API key only in memory. No wallet private key is loaded by that server. The old website handoff ID below is obsolete.

The live read-only check passed at 15:48:23 UTC: exact platform response validated, distributor runtime/canonical receipt checked, token absent, wallet nonce 3, purchase 0.001 ETH, maximum proposed gas cost 0.00084057580555 ETH below the unchanged 0.0018 ETH cap. The wallet tool repeats the fresh checks before opening any signature. Evidence: `output/moss-local-wallet-check.json`, `output/moss-replacement-wallet-pins.json`. It now reports explicit authorization expiry errors.

Current predictions: token `0x6eee1e87095d5A21d3B77E0A70506e017dd48Ec1`; hook `0xD379fA24dBB63fE397FA9FFa15711d0CADC0A0Cc`; initializer `0xDE7D6842D06A1C1878650eF6D4E1a66160a80e23`; fee vault `0x30E5BB6DEC67CdC01e1944879a4bc10D81Bef565`. Distributor remains `0x92e7fC51F2C9C04E995b66249EA4F2e9F09EaFFf`. No token transaction has been sent. Metadata, fee rates, minimum output, purchase and budgets are unchanged. Exact current calldata hash is `0xb77a2dfe7d23a953ba424fc06fd68bf7ae037a7e109195f1a31255ddaa027f81`.

The remainder records the original attempt for context; use the current handoff above.

The user approved a separate maximum **0.008 ETH** test budget and selected an unrelated test name/ticker. Initial purchase: **0.001 ETH**, minimum **471,927 MOSSC**. Fixed buy/sell fees remain 2% total (1.8% project, 0.2% platform).

Update at 2026-09-13 14:42 UTC: user deployed the test distributor in transaction `0x2fc950baf4b37c478037ed2c318442db6d6a5102b86a92b0e8f844cc0e8aa73f`. Exact creation data, runtime, address and operator verified at block 62035440; finality is pending. Gas cost was 0.000076452713184 ETH. Separate evidence is in `output/moss-distributor-deployment.verified.json`; verifier now supports `--test`. Platform status refreshed successfully and remains wallet_action_required. Refreshed launch gas cap estimate is 0.001306073055576 ETH, below 0.0018 ETH. The next step is the user's token launch signature. No token launch or test payouts have occurred.

The user selected `https://x.com/elonmusk` as test metadata. The description explicitly states that this is a technical test, that it is not affiliated with Elon Musk or X, and that the X link is not an official project account or endorsement. This link was accepted by the actual platform preflight; no ownership or affiliation is claimed.

Neutral source and icon: https://github.com/28Levi/moss-circuit-test at commit `3fe60eb0041372ead63c59f30f1d5930d1cc17a0`. The repository and wallet funding remain public; no anonymity guarantee has been made.

## Verified preparation

- All 88 regression tests passed, including explicit test-token identity checks and a 0.001 ETH local initial-buy simulation.
- `output/moss-launch-preparation.json` records the exact fee-bound local graph.
- Official CLI local validation reproduced the 659,583-byte request with SHA-256 `09d3b7b9b99bb2b1f5e2d70ab01c7fda8d543af2b1dedb3ceda3d18dbd8d773e`.
- Remote preflight: HTTP 200, `supported_with_warnings`, no blocking or missing-evidence findings. Its transaction-simulation warning was subsequently addressed by submitting the exact request for mandatory server simulation.
- Platform launch ID: `cfc09b1f-7968-4217-8b63-3460e2968e2d`. Status: `wallet_action_required`; official SDK validation accepted the simulation receipt with `passed: true` and exact wallet handoff.
- Current permit expires **2026-09-13 15:13:25 UTC**. If it expires, use the platform's supported status/recovery flow; do not silently create a new request or nonce.
- Exact token-launch gas estimate at 14:37:01 UTC: 6,526,084 units; suggested gas limit 7,831,301. At the suggested fee cap the maximum execution charge is **0.001316347722488 ETH**, below the **0.0018 ETH** token-launch cap. Re-estimate before signing.

## Required order

1. User deploys the test distributor through `http://127.0.0.1:8788` in their MetaMask/Rabby browser. The page requests **zero ETH value** and limits gas to **0.0002 ETH**, preserving 0.1086 ETH for remaining test allowances and the main project's purchase/gas. Launch-wallet nonce is pinned to **2**.
2. Verify its receipt, canonical block, exact creation/runtime hashes and immutable test operator. Distributor prediction: **0x92e7fC51F2C9C04E995b66249EA4F2e9F09EaFFf**; operator: **0xdfeDFfE67cbff8e27E90dbB4c9F535B888908265**. Use the separate `output/moss-distributor-*` evidence, never overwrite the main distributor records.
3. Only after verifying that distributor at the expected address, refresh the platform request and gas quote and hand off the token-launch signature. **Do not send the token transaction first**: it would consume the pinned nonce needed for the distributor and leave the fee-recipient address wrong.
4. Verify the deployed token, hook, vault, initializer, fee recipient and supply, then fund the separate test trader/operator wallets within the approved allocations. Install the separate test config/journal and run the real one-hour maturity, trading, payout and restart checks.

The token prediction is `0x696f432055daD85284C1b2A3c11c228Fc85Bd699`; hook `0xAc389Df33D15BcfC8d3C82a1f2B32a5eD4dce0cc`; fee vault `0x5F4e47e7ee2d730557AB08276f8a462eea2211A2`. These are predictions, not deployed contracts.

## Tooling notes

Use the bundled Node 24.19.0 executable; the default local Node 24.13.1 is below the official CLI engine range. Locked CLI dependencies were installed with lifecycle scripts disabled.

Official CLI directory synchronization is unsupported on this Windows host (`EPERM: fsync`). The actual request file was fully written before directory sync failed, and the unchanged CLI reproduced and validated its exact bytes afterward. Submission recovery uses the unchanged official idempotency logic and a byte-checked durable journal; no request key was replaced and no contract or admission checks were bypassed. The platform response was recovered through the official status validator.

No private key was uploaded for the test. The API credential was supplied through non-echoing stdin, never saved to the source repository. Test-wallet encrypted files remain in the owner-accessible private `.secrets/moss-test` directory; public addresses and restore checks are in `output/moss-wallets.public.json`.

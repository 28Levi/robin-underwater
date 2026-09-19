# MOSSC website wallet review failure

2026-09-13: the user clicked Load exact wallet review, but the website returned "Launch history is temporarily unavailable" with request ID `654b98cc-207c-469d-a3ef-4414fa61ef28`. Metadata and funding placeholders remained visible. No token signature or broadcast is reported.

The unchanged official CLI status validator subsequently returned HTTP 200, wallet_action_required, and a passed simulation for launch `cfc09b1f-7968-4217-8b63-3460e2968e2d`. Project metadata, funding plan, prepared artifact and wallet transaction are present. Controller matches `0x9479ac7ED3A72866F63F37013F2c7Cc68936B519`.

Public website JavaScript routes the review read through `/api/developer/custom-launches/{launchId}?walletAddress={controller}&version=v4`, using the signed-in website session. The observed error text is returned from that website endpoint, rather than the local metadata validation message. The API-key status endpoint succeeds. Root cause in the website session or backend is not yet established.

The accessible Codex browser is not connected to a wallet; the user's screenshot is from their separate wallet browser. Reconnecting did not resolve the failure.

A local wallet review tool is now available through `scripts/serve-moss-launch-wallet.mjs` on loopback port 8789. It uses the unchanged official status validator on every package read, with the API credential held only in process memory. It pins the previously validated request SHA-256, exact calldata hash, transaction preimage, router, sender, network, nonce 3 and purchase value. Browser checks additionally require the verified distributor runtime and canonical receipt block, token absence, a fresh chain head, sufficient reserved budget and gas no higher than 0.0018 ETH. Cross-tab locking and durable submission records prevent automatic duplicate retries. Only the user-controlled browser wallet signs or broadcasts. There is no server signer, key export endpoint or transaction submission endpoint.

Boundary tests passed; the live check initially blocked at 14:51 UTC because current gas prices exceeded the approved ceiling. No budget was raised and no token transaction was sent. Check `output/moss-local-wallet-check.json` for any subsequent successful live read-only verification. Preserve the existing launch ID, package bytes, request key, predicted addresses and budgets. Do not redeploy the distributor or submit a duplicate launch. Check authorization expiry before another signing attempt.

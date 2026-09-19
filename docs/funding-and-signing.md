# Approved funding plan — both wallets funded

Verified on 2026-09-13 at 13:45:55 UTC: launch wallet **0.292742277496 ETH**, operator **0.005 ETH**. The extra launch-wallet balance does not increase any approved spending allowance.

Network: Robinhood Chain mainnet, chain ID 4663. Fund with native ETH on that network.

| Purpose | Approved ETH | Wallet |
| --- | ---: | --- |
| Already approved initial purchase | 0.1 | Launch wallet below |
| Combined deployment gas allowance | 0.001 | Launch wallet below |
| Initial automatic rewards gas allowance | 0.005 | Dedicated operator below |

Launch wallet: `0x9479ac7ED3A72866F63F37013F2c7Cc68936B519` — target balance **0.101 ETH**.

Dedicated operator: `0x9C366d4E42b8f987e8398A27b3b9A02803493088` — target balance **0.005 ETH**.

Total: **0.106 ETH**. The user approved the additional **0.006 ETH gas budget on 2026-09-13**. Funding transfer, bridge and withdrawal charges are separate. Do not send money to the predicted contract address; it has not been deployed.

The combined deployment allowance is split into a maximum 0.0002 ETH for the distributor and 0.0008 ETH for the token launch. The distributor's current RPC estimate is approximately 0.000077 ETH; the complete token launch cannot be priced until the final package and platform authorization are available. These limits are budgets, not estimates. If a fresh quote exceeds a cap, stop and obtain a revised decision.

The distributor creation data was executed successfully on a disposable local EVM with the intended launch-wallet address and nonce. It installed the expected immutable operator. The resulting runtime hash is in `output/distributor-simulation.json`; this is simulation evidence, not an onchain deployment.

Before any actual distributor deployment, verify chain 4663, the launch wallet's pending and latest nonces, constructor operator, bytecode hash, expected contract address, wallet balance and fresh gas estimate. The user reviews and signs the launch-wallet transaction. Check the finalized receipt, operator getter and deployed runtime before using the distributor as the fee recipient.

The bot's approved 0.005 ETH allowance is cumulative, with at most 0.0002 ETH gas reserved per transaction. It remains inactive until its production config, verified deployments, funded rewards and wallet gas are ready. Do not automatically refill its wallet or reset its budget.

The user submitted distributor deployment transaction `0xe9e909d732221c44d4bcd96b71dc72cf87df1d11cfc4143f5ac7862b0d0c379a`. Verification at 2026-09-13 13:55:27 UTC confirmed successful receipt in block 62007962, exact creation bytes, expected runtime hash and correct immutable operator. Gas cost was **0.00007528321176 ETH**, below the 0.0002 ETH distributor cap. The RPC finalized block was 61996960, so finality remains pending. See `deploy/distributor.mainnet.json`. Do not deploy it again. No token launch or reward payout has been sent.

## Local wallet signing page

Update at 2026-09-13 14:11:43 UTC: the distributor deployment is **finalized**, with the finalized chain height at 62008288. Its verified address is now the creator fee recipient in `launch-intent.json`. No additional deployment signature is needed for this distributor.

Run `node scripts/serve-distributor-wallet.mjs` from this project and open http://127.0.0.1:8787 in the browser profile containing MetaMask or Rabby. The server listens only on loopback and serves an exact allowlist of public files; it has no signer, credential access or write API.

The page checks the simulated creation hash, immutable operator, chain anchor, PoolManager code, sender, latest/pending nonce, balance and fresh gas. Both gas units and gas price have a 25% margin, and their product must stay within 0.0002 ETH while preserving 0.1008 ETH for the token purchase and token launch gas. The user must review the wallet's final fee display and not raise it above the approved ceiling.

The current draft requires launch-wallet nonce **1**, predicting **0x62C12ae94CcbbE470CC1857261Fae9E36074Fb36**. Any intervening transaction requires refreshing and simulating the draft and updating the pinned nonce before signing. The previous nonce-0 prediction is obsolete.

The page records a pending submission before opening the wallet confirmation and prevents repeat submissions after an uncertain response. A submitted transaction hash must be checked onchain, including successful finalized receipt, runtime hash and operator getter, before installing the distributor into the launch config. No token or payouts become live from this page alone.

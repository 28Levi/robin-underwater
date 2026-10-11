# Preparing the final wallet review

`prepare-launch-handoff.mjs` assembles a **review candidate**, not platform admission or user consent. Manual activation is the default. It needs the final published source revision, exact packed request/report/preparation, an actual owned `wallet_action_ready` 1.2 package, and explicit reserve/accounting/operator policy. The policy contains only `preserveLaunchBalanceWei`, `accounting`, and `execution`, using the shared launch manifest schema.

From the repository root:

```powershell
node scripts/prepare-launch-handoff.mjs --request PATH --pack-report PATH --preparation PATH --accepted-package PATH --distributor VERIFIED_RECEIPT_PATH --policy docs/launch-policy.example.json --source-revision COMMIT --out NEW_DIRECTORY
```

The command fetches current public capabilities and reads Robinhood Chain. It checks the signed Atomic envelope against the exact prepared source graph, predicts all four components, verifies the existing distributor, then calls and estimates the complete admitted transaction without state overrides. The separate project-call allowance and overall transaction budget must match preparation; the outer transaction must have room above the project allowance. The full current estimate plus the existing wallet margin must still fit that transaction and the 0.0008 ETH cost cap. It reads no credentials and has no transaction sender. A failing or ambiguous package, call, code pin, nonce, finality, expiry or budget stops output.

The distributor argument selects verified public receipt evidence for the existing rewards contract, the same input used for `launch:prepare`. A checkout does not contain operational `deploy/` files; no default receipt path is assumed. The historical immutable evidence is published in [robin-distributor.public.json](robin-distributor.public.json). Its old `checkedAt` is intentional: it must be refreshed against the chain before launch preparation, which rejects evidence older than one hour. Never update that timestamp by hand. The handoff command checks its exact deployment, runtime and operator again on chain.

Refresh the public evidence with this read-only command, then pass the resulting file as `--distributor` to both preparation and handoff:

```text
node scripts/refresh-robin-distributor.mjs --out output/distributor-current.json
```

Choose a new output filename on subsequent runs. This checks the original creation transaction and receipt, chain anchor, historical and finalized runtime, canonical blocks, operator and current finality. It neither deploys another distributor nor loads any wallet/API credential. A public RPC without the required historical state will fail closed.

Set `ROBIN_RPC_URL` in the local process environment to the configured HTTPS archive provider before running refresh or handoff. API-key paths are allowed; embedded URL username/password and fragments are rejected. Keep that setting out of command history and source control. With no setting, the commands use the public Robinhood RPC, which may not serve the historical state required here. CLI failures use coarse messages and do not echo provider errors or endpoint secrets. The wallet review server uses the same optional archive setting for its independent transaction-proof checks; browser wallet checks still use the user's wallet provider.

[launch-policy.example.json](launch-policy.example.json) supplies the complete current policy shape. It is a review draft: 0.001 ETH retained in the launch wallet, 0.00001 ETH minimum harvest and reward batch, a 0.005 ETH cumulative operator gas ceiling and a 0.0002 ETH per-transaction ceiling. The reserve and thresholds are preparation defaults for final wallet review; the example is not consent or authorization to send funds. The current policy uses five-minute holding eligibility, scheduled 15-minute payout rounds, 30-minute price averaging and a 30-minute finality limit. It requires an explicit worker source revision and creates a v3 manifest. Using the example does not request automatic activation. See [reward timing](reward-timing.md).

Choose the payout mode **before the exact launch is reviewed and signed**. For automatic payouts after the verified launch, add `--activation after-reviewed-launch` to the handoff command. This only binds the proposed automatic policy into the manifest. It does not activate an operator or generate consent. The final wallet review must display and record that exact automatic policy and gas budget; the host must receive the matching consent, approved manifest digest and service configuration, and independently verify the finalized launch. All existing startup gates remain mandatory.

Omit the option or use `--activation manual` to keep automatic payouts disabled. An already admitted manual manifest cannot be changed to automatic with a host flag or by editing its JSON: its hash and durable state are immutable. A separate post-launch manual-to-automatic activation workflow is not implemented. Use the explicit automatic candidate before launch if automatic rewards are the intended outcome.

The new directory contains `manifest.json`, `report.json`, and public `chain-facts.json`. It does not produce a consent file or activate a watcher, regardless of the proposed mode. Pass the manifest and reported hash to the existing wallet review server, which checks current conditions again before the user's wallet confirmation.

Current verification is fixture-only. Tests use the real local compiled project graph inside a deliberately mock platform wrapper. They do **not** prove platform issuance, admission, or live full-Atomic simulation. Those remain required from the real accepted package and public chain before preparing a real review candidate. The original request/preparation and the accepted package must be preserved unchanged.

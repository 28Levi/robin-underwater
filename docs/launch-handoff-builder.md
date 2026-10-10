# Preparing the final wallet review

`prepare-launch-handoff.mjs` assembles a **manual review candidate**, not platform admission or user consent. It needs the final published source revision, exact packed request/report/preparation, an actual owned `wallet_action_ready` 1.2 package, and explicit reserve/accounting/operator policy. The policy contains only `preserveLaunchBalanceWei`, `accounting`, and `execution`, using the shared launch manifest schema.

From the repository root:

```powershell
node scripts/prepare-launch-handoff.mjs --request PATH --pack-report PATH --preparation PATH --accepted-package PATH --policy PATH --source-revision COMMIT --out NEW_DIRECTORY
```

The command fetches current public capabilities and reads Robinhood Chain. It checks the signed Atomic envelope against the exact prepared source graph, predicts all four components, verifies the existing distributor, then calls and estimates the complete admitted transaction without state overrides. The separate project-call allowance and overall transaction budget must match preparation; the outer transaction must have room above the project allowance. The full current estimate plus the existing wallet margin must still fit that transaction and the 0.0008 ETH cost cap. It reads no credentials and has no transaction sender. A failing or ambiguous package, call, code pin, nonce, finality, expiry or budget stops output.

The new directory contains `manifest.json`, `report.json`, and public `chain-facts.json`. Its activation mode is always `manual`; it does not produce a consent file or activate a watcher. Pass the manifest and reported hash to the existing wallet review server, which checks current conditions again before the user's wallet confirmation.

Current verification is fixture-only. Tests use the real local compiled project graph inside a deliberately mock platform wrapper. They do **not** prove platform issuance, admission, or live full-Atomic simulation. Those remain required from the real accepted package and public chain before preparing a real review candidate. The original request/preparation and the accepted package must be preserved unchanged.

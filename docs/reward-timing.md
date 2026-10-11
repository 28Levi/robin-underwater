# Reward timing

The current prelaunch ROBIN policy is a 300-second holding requirement and 900-second payout rounds. The user requested these settings on 11 October 2026. The immutable contract source and fee split remain unchanged.

Each acquisition matures independently after five minutes. Ordinary transfers carry tracked purchase cost and previous relief, with a new five-minute wait for the received amount. Existing mature holdings retain their age. The deepest-percentage-loss allocation policy, 30-minute finalized price average, minimum aggregate harvest and batch amounts, and gas caps remain unchanged.

The verified launch block timestamp anchors the schedule. The first interval is due 15 minutes after launch, then every 15 minutes. The initial 30-minute price history must still accumulate before a payment can be calculated. Empty or underfunded intervals retain the treasury for future rounds. Downtime does not create a queue of backdated payouts.

A due interval collects accrued project fees, waits for the collection to finalize, calculates a reward round, and processes its batches. Transactions remain serialized and finalized. Up to 100 recipients fit in a batch, reduced when required by the existing gas cap; all batches in one round can continue without another 15-minute wait. A durable schedule records the active interval, collection phase, round identity, and next due time. Restarting retains these fields, the pending transaction, and cumulative gas reservations.

Thirty-second polling continues so transactions can be reconciled promptly; it is not the payment schedule. Deferred payment retries keep their separate existing rules and can occur between new payout rounds. Treasury funding, minimum batch size, transaction costs, finality, and successful operation still determine actual delivery.

The version 3 local launch manifest binds the 300/900 policy and the exact worker source revision. Historical v1/v2 manifests and their recorded consent remain unchanged. A previous review or host acknowledgement does not authorize the new manifest. Production remains inactive until the exact launch and matching activation evidence verify. Existing operator journals are never deleted or reset to change a policy.

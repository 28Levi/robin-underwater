ROBINHOOK project runtime pin

runtime-pin.json records locally reviewed Solidity and solc 0.8.26 output for
RobinhookLaunchGuardHookV1. src/launch-guard-runtime.mjs pins the exact file and
source SHA256, creation bytecode, normalized runtime, and named immutable spans.
The original fee vault must still match the pinned upstream native30 vault.

This is a project artifact. It is not Programmable's official native30 recipe,
platform admission, a fee waiver, an independent audit, or proof of live execution.
The modified hook does not match the official native30 normalized hook runtime.
Routed fees and any recognition must be checked against fresh platform evidence.

The first 30 seconds restrict the initiating buyer through the authenticated
initializer or pinned canonical router to the five configured wallets. This
does not restrict token transfers, final sweep recipients, or other pools.
Public buys open at initialization timestamp + 30 seconds. Sell behavior and
the hook's 170bps project / 30bps platform fee split remain source-pinned.

Changing the Solidity requires deliberate review and regeneration of both this
artifact and its hardcoded pin. Never regenerate merely to bypass a failure.

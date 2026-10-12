// MAIN-only launch policy requested by the user. The fifth wallet was added
// explicitly so the existing controller can keep its initial launch purchase.
export const LAUNCH_GUARD_RECIPE = 'robin-30-second-buy-allowlist-v1';
export const EARLY_BUY_SECONDS = 30;
export const EARLY_BUY_ROUTER = '0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99';
export const EARLY_BUY_ROUTER_CODE_HASH = '0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5';
export const EARLY_BUYERS = Object.freeze([
  '0x828a661bfa21f44d4fd79dc805b8538e708b30d4',
  '0x938ff56d9e596307f5a3bdbc443052eb6c9eb36d',
  '0x61da6d6e9455373d08d8d345bce01132d3d4423c',
  '0x764263ecf27d51680b96ca3c05ff8b6880f58038',
  '0x9479ac7ed3a72866f63f37013f2c7cc68936b519',
]);

export function assertLaunchGuardIntent(intent) {
  const guard = intent?.launchGuard;
  if (intent?.hookRecipe !== LAUNCH_GUARD_RECIPE || guard?.windowSeconds !== EARLY_BUY_SECONDS
      || !Array.isArray(guard.allowedBuyers) || guard.allowedBuyers.length !== EARLY_BUYERS.length
      || guard.allowedBuyers.some((address, index) => typeof address !== 'string'
        || address.toLowerCase() !== EARLY_BUYERS[index])) {
    throw Error('Exact requested five-wallet, 30-second launch policy required');
  }
  if (typeof intent.initialBuyRecipient !== 'string'
      || intent.initialBuyRecipient.toLowerCase() !== EARLY_BUYERS[4]
      || intent.launchWallet?.toLowerCase() !== EARLY_BUYERS[4]) {
    throw Error('Keep the approved initial purchase with the B519 launch wallet');
  }
  return {windowSeconds: EARLY_BUY_SECONDS, allowedBuyers: [...EARLY_BUYERS],
    initialBuyRecipient: intent.initialBuyRecipient.toLowerCase(),
    router: EARLY_BUY_ROUTER, routerCodeHash: EARLY_BUY_ROUTER_CODE_HASH};
}

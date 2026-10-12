const warmups = new WeakMap();
const validHeader = block => block && Number.isSafeInteger(block.number) && block.number >= 0
 && Number.isSafeInteger(block.timestamp) && block.timestamp > 0 && /^0x[0-9a-fA-F]{64}$/.test(block.hash);

/** Only a newly launched pool can lack a complete finalized price window normally.
 * This never substitutes latest-chain time for finalized accounting time.
 */
export function requireInitialPriceWindow(deployment, finalized, c, now = Math.floor(Date.now() / 1000)) {
 if (!validHeader(deployment) || !validHeader(finalized) || deployment.number !== c.deploymentBlock
  || deployment.number > finalized.number || deployment.timestamp > finalized.timestamp
  || !Number.isSafeInteger(c.twapWindowSeconds) || c.twapWindowSeconds <= 0)
  throw Error('Invalid initial finalized price-window anchors');
 const readyAt = deployment.timestamp + c.twapWindowSeconds;
 if (!Number.isSafeInteger(readyAt)) throw Error('Invalid initial finalized price-window anchors');
 if (finalized.timestamp < readyAt) {
  const maxLag=c.maxFinalityLagSeconds ?? 7200;
  if(!Number.isSafeInteger(now)||now<finalized.timestamp||!Number.isSafeInteger(maxLag)||maxLag<=0)
   throw Error('Invalid initial finalized price-window clock');
  if(now-finalized.timestamp>maxLag)throw Error('Finality is stalled');
  const error = new Error('Initial finalized price window is warming up');
  warmups.set(error, {state: 'waiting', code: 'INITIAL_PRICE_WINDOW_WARMUP',
   reason: 'Waiting for the first complete finalized price window',
   finalizedTimestamp: finalized.timestamp, priceWindowReadyAt: readyAt});
  throw error;
 }
}

export const initialPriceWindowStatus = error => warmups.get(error);

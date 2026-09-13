const Q192=1n<<192n;
/** Arithmetic time-weighted ETH/token price from official-pool observations.
 * Native currency0 / 18-decimal token currency1 only. Needs observation at/before window start.
 * TWAP resists a single instantaneous spike; it does NOT make a thin pool manipulation-proof.
 */
export function twap(observations,start,end) {
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start)throw Error('Invalid TWAP interval');
  let previous=-1,price=null,cursor=start,sum=0n;
  for(const o of observations) {
    if(!Number.isSafeInteger(o.time)||o.time<previous)throw Error('Unsorted observations');previous=o.time;
    const sqrt=BigInt(o.sqrtPriceX96);if(sqrt<=0n)throw Error('Invalid sqrt price');
    const p=Q192*10n**18n/(sqrt*sqrt);if(p===0n)throw Error('Price below precision');
    if(o.time<=start){price=p;continue;}
    if(o.time>end)break;
    if(price===null)throw Error('Missing window history');
    sum+=price*BigInt(o.time-cursor);cursor=o.time;price=p;
  }
  if(price===null)throw Error('Missing window history');
  sum+=price*BigInt(end-cursor);
  return {priceWeiPerToken:sum/BigInt(end-start),observedAt:end,windowSeconds:end-start};
}

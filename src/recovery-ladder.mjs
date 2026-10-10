/** Exact rational water filling. Loss and basis are in ETH wei.
 * Find a common remaining-loss/basis level for the deepest positions.
 * Round each payment down independently; residual wei stay in the treasury.
 * This pure module is also used by the illustrative website simulator.
 */
export const RECOVERY_POLICY = 'deepest-percentage-first-v1';
export function allocateRecoveryLadder(positions, budgetWei) {
  const budget=BigInt(budgetWei);
  if(budget<0n)throw Error('Negative budget');
  const seen=new Set();
  const ranked=positions.map(p=>{
    const loss=BigInt(p.loss),basis=BigInt(p.basis);
    if(!p.account||seen.has(p.account)||basis<=0n||loss<=0n||loss>basis)throw Error('Invalid recovery position');
    seen.add(p.account);return {...p,loss,basis};
  }).sort((a,b)=>{
    const difference=a.loss*b.basis-b.loss*a.basis;
    return difference>0n?-1:difference<0n?1:a.account.localeCompare(b.account);
  });
  const totalLoss=ranked.reduce((n,p)=>n+p.loss,0n),distributable=budget<totalLoss?budget:totalLoss;
  if(!ranked.length||!distributable)return {policy:RECOVERY_POLICY,totalLoss,allocated:0n,carryForward:budget,allocations:[],targetLossRatio:null};
  let activeLoss=0n,activeBasis=0n,count=0;
  for(const p of ranked){
    // Adding the next tier is justified only if funding reaches its ratio.
    if(count && (activeLoss-distributable)*p.basis>p.loss*activeBasis)break;
    activeLoss+=p.loss;activeBasis+=p.basis;count++;
  }
  const numerator=activeLoss-distributable;
  const allocations=ranked.slice(0,count).map(p=>({...p,
    amount:(p.loss*activeBasis-p.basis*numerator)/activeBasis
  })).filter(p=>p.amount>0n).sort((a,b)=>a.account.localeCompare(b.account));
  const allocated=allocations.reduce((n,p)=>n+p.amount,0n);
  return {policy:RECOVERY_POLICY,totalLoss,allocated,carryForward:budget-allocated,allocations,
    targetLossRatio:{numerator,denominator:activeBasis}};
}

// Pure validation shared by launch preparation and offline regression checks.
// Passing this guard does not establish platform admission or authorize a transaction.
export function assertRobinLaunchIntent(plan) {
  if (plan?.name !== 'ROBINHOOK' || plan?.symbol !== 'ROBIN'
    || plan.initialBuyWei !== '10000000000000000' || plan.supply !== '1000000000'
    || plan.minimumTokensOutApproval?.approved !== true || plan.x !== 'https://x.com/HOOKHOOD') {
    throw Error('Approved ROBINHOOK / ROBIN intent required');
  }
  return plan;
}

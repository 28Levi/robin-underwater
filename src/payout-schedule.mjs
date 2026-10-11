const positive=x=>Number.isSafeInteger(x)&&x>0;
const clock=x=>{if(!Number.isSafeInteger(x)||x<0)throw Error('Invalid payout schedule clock');};

export function payoutSchedulePolicy(c){
 const interval=c.execution?.payoutIntervalSeconds;
 if(interval===undefined)return null;
 if(!positive(interval)||!positive(c.payoutStartTimestamp)||!Number.isSafeInteger(c.payoutStartTimestamp+interval))
  throw Error('Invalid payout interval or launch timestamp');
 return {intervalSeconds:interval,anchorTimestamp:c.payoutStartTimestamp};
}
export function validatePayoutSchedule(schedule){
 if(schedule===undefined)return;
 if(!schedule||schedule.version!==1||!positive(schedule.intervalSeconds)||!positive(schedule.anchorTimestamp)
  ||!Number.isSafeInteger(schedule.nextDueAt)||schedule.nextDueAt<schedule.anchorTimestamp+schedule.intervalSeconds
  ||(schedule.nextDueAt-schedule.anchorTimestamp)%schedule.intervalSeconds!==0)
  throw Error('Invalid durable payout schedule');
 if(schedule.active!==null){const a=schedule.active;
  if(!a||!['harvest','allocation'].includes(a.phase)||!Number.isSafeInteger(a.dueAt)||a.dueAt<schedule.nextDueAt
   ||(a.dueAt-schedule.anchorTimestamp)%schedule.intervalSeconds!==0||!Number.isSafeInteger(a.startedAt)||a.startedAt<a.dueAt
   ||(a.roundId!==null&&!/^0x[0-9a-f]{64}$/.test(a.roundId))||(a.phase==='harvest'&&a.roundId!==null))
   throw Error('Invalid active payout interval');
 }
}
/** Mutations are synchronous; executor persists each transition before signing. */
export function openPayoutCycle(state,policy,now){
 if(!policy)return false;clock(now);
 if(state.schedule===undefined){
  if(state.round||state.pending)throw Error('Cannot attach a schedule to an existing execution round');
  state.schedule={version:1,...policy,nextDueAt:policy.anchorTimestamp+policy.intervalSeconds,active:null,lastCompleted:null};
 }
 validatePayoutSchedule(state.schedule);const s=state.schedule;
 if(s.intervalSeconds!==policy.intervalSeconds||s.anchorTimestamp!==policy.anchorTimestamp)throw Error('Payout schedule policy changed');
 if(state.round&&(!s.active||s.active.phase!=='allocation'||s.active.roundId!==state.round.id))throw Error('Reward round has no matching scheduled interval');
 if(!s.active&&now>=s.nextDueAt){
  // Missed windows collapse into one current cycle, never a catch-up queue.
  const dueAt=s.anchorTimestamp+Math.floor((now-s.anchorTimestamp)/s.intervalSeconds)*s.intervalSeconds;
  s.active={dueAt,startedAt:now,phase:'harvest',roundId:null};
 }
 return s.active!==null;
}
export function completeScheduledHarvest(state){
 if(state.schedule===undefined)return;
 validatePayoutSchedule(state.schedule);
 if(state.schedule.active?.phase!=='harvest')throw Error('Harvest has no matching scheduled interval');
 state.schedule.active.phase='allocation';
}
export function bindScheduledRound(state){
 if(state.schedule===undefined)return;
 const a=state.schedule.active;
 if(a?.phase!=='allocation'||!state.round||a.roundId!==null)throw Error('Cannot attach reward round to payout interval');
 a.roundId=state.round.id;
}
export function finishPayoutCycle(state,now){
 if(state.schedule===undefined)return;clock(now);validatePayoutSchedule(state.schedule);
 const s=state.schedule,a=s.active;
 if(a?.phase!=='allocation'||state.round||state.pending)throw Error('Cannot complete an unresolved scheduled payout');
 const next=s.anchorTimestamp+(Math.floor((Math.max(now,a.dueAt)-s.anchorTimestamp)/s.intervalSeconds)+1)*s.intervalSeconds;
 if(!Number.isSafeInteger(next))throw Error('Payout schedule overflow');
 s.lastCompleted={dueAt:a.dueAt,completedAt:now,roundId:a.roundId,outcome:a.roundId?'round-completed':'no-eligible-funded-round'};
 s.nextDueAt=next;s.active=null;
}

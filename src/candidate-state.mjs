import {transferInterface,rewardInterface} from './replay.mjs';
import {address} from './ledger.mjs';
import {payoutInterface} from './payout-plan.mjs';

/** A new empty block does not invalidate a prepared payment. Preserve the anchored
 * state and conservatively defer payouts if token inventory or reward allocations changed.
 * The contract's expiry and minimum-balance checks cover the remaining signing window.
 */
export async function verifyCandidateState(provider,c,candidate,head,phase){
 if(!head || !Number.isSafeInteger(candidate.headNumber) || head.number<candidate.headNumber)
  throw Error('Prepared state was reorganized; reconciliation required');
 if(head.hash===candidate.headHash && head.number===candidate.headNumber)return;
 if((await provider.getBlock(candidate.headNumber))?.hash!==candidate.headHash)
  throw Error('Prepared state was reorganized; reconciliation required');
 if(candidate.kind==='payout'){
  // Derive recipients from the actual transaction, never an unbound side list.
  const payout=payoutInterface.decodeFunctionData('distributeEligible',candidate.data);
  if(address(payout[2])!==address(c.token))throw Error('Candidate token mismatch');
  const recipients=new Set(payout[4].map(address));
  for(let from=candidate.headNumber+1;from<=head.number;from+=1000){
   const range={fromBlock:from,toBlock:Math.min(from+999,head.number)};
   const [transfers,rewards]=await Promise.all([
    provider.getLogs({...range,address:c.token,topics:[transferInterface.getEvent('Transfer').topicHash]}),
    provider.getLogs({...range,address:c.distributor,topics:[rewardInterface.getEvent('BatchRecorded').topicHash]})]);
   const inventoryChanged=transfers.some(log=>{const p=transferInterface.parseLog(log);return p.args.value>0n&&p.args.from!==p.args.to&&recipients.has(address(p.args.from));});
   if(inventoryChanged||rewards.length)throw Error(`Head changed during ${phase}; rebuild next cycle`);
  }
 }
 if((await provider.getBlock(head.number))?.hash!==head.hash)
  throw Error('Prepared state was reorganized; reconciliation required');
}

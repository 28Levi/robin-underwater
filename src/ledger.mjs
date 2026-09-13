import {createHash} from 'node:crypto';

export const ZERO = '0x0000000000000000000000000000000000000000';
export const LEDGER_VERSION = 2;
const positive = x => { x=BigInt(x); if(x<=0n) throw Error('Expected positive amount'); return x; };
export const address = a => {if(!/^0x[0-9a-fA-F]{40}$/.test(a))throw Error('Invalid address');return a.toLowerCase();};
const empty = () => ({balance:0n,cost:0n,relief:0n,lastAcquired:0,quarantined:false,ageLots:[]});
const min = (a,b)=>a<b?a:b;

/** ETH-denominated unrealized shortfall, NOT personal wealth or tax P&L.
 * Whole-wallet weighted average basis; transfers carry basis and credited relief.
 * Unknown acquisitions carry zero basis, so cannot create imaginary losses.
 */
export class LossLedger {
  constructor({minimumAgeSeconds=3600,maxOracleAgeSeconds=300}={}) {
    if(!Number.isSafeInteger(minimumAgeSeconds)||minimumAgeSeconds<0)throw Error('Invalid minimum age');
    this.accounts=new Map();this.seen=new Set();this.minimumAgeSeconds=minimumAgeSeconds;
    this.maxOracleAgeSeconds=maxOracleAgeSeconds;this.checkpoint=null;
  }
  get(a) {a=address(a);if(!this.accounts.has(a))this.accounts.set(a,empty());return this.accounts.get(a);}
  apply(event) {
    if(!event.id || this.seen.has(event.id)) throw Error('Missing or duplicate event id');
    if(!Number.isSafeInteger(event.time)||event.time<0)throw Error('Invalid timestamp');
    const amount=positive(event.amount);
    if(event.type==='buy') {
      const cost=positive(event.costWei);
      this.receive(event.account,amount,event.time,{cost,relief:0n,quarantined:false});
    } else if(event.type==='sell') {
      this.remove(event.account,amount);
    } else if(event.type==='transfer') {
      const from=address(event.from),to=address(event.to);
      if(from===to) {if(this.get(from).balance<amount)throw Error('Insufficient tracked balance');}
      else {
        const part=from===ZERO?{cost:0n,relief:0n,quarantined:false}:this.remove(from,amount);
        if(to!==ZERO)this.receive(to,amount,event.time,part);
      }
    } else throw Error('Unknown event type');
    this.seen.add(event.id);
  }
  /** New inventory waits independently. Consolidate expired lots to bound historical storage. */
  receive(account,amount,time,{cost=0n,relief=0n,quarantined=false}={}) {
    amount=positive(amount);
    const unlockAt=time+this.minimumAgeSeconds;
    if(!Number.isSafeInteger(time)||time<0||!Number.isSafeInteger(unlockAt))throw Error('Invalid timestamp');
    const a=this.get(account),lots=new Map();
    for(const lot of a.ageLots){const key=lot.unlockAt<=time?0:lot.unlockAt;lots.set(key,(lots.get(key)??0n)+lot.amount);}
    const key=unlockAt<=time?0:unlockAt;lots.set(key,(lots.get(key)??0n)+amount);
    a.ageLots=[...lots].sort(([x],[y])=>x-y).map(([unlockAt,amount])=>({unlockAt,amount}));
    a.balance+=amount;a.cost+=cost;a.relief+=relief;a.lastAcquired=time;a.quarantined ||= quarantined;
  }
  remove(account,amount) {
    amount=positive(amount);
    const a=this.get(account);if(amount>a.balance)throw Error('Insufficient tracked balance');
    const cost=a.cost*amount/a.balance,relief=a.relief*amount/a.balance;
    // Consume the oldest inventory first: selling old tokens cannot age replacement purchases.
    let remaining=amount;
    a.ageLots=a.ageLots.flatMap(lot=>{const taken=min(remaining,lot.amount);remaining-=taken;
      return lot.amount>taken?[{...lot,amount:lot.amount-taken}]:[];});
    a.balance-=amount;a.cost-=cost;a.relief-=relief;
    return {cost,relief,quarantined:a.quarantined};
  }
  quarantine(account) { this.get(account).quarantined=true; }
  shortfalls({priceWeiPerToken,observedAt,now}) {
    const price=positive(priceWeiPerToken);
    if(!Number.isSafeInteger(observedAt)||!Number.isSafeInteger(now)||now<observedAt
      ||now-observedAt>this.maxOracleAgeSeconds)throw Error('Stale or future price');
    return [...this.accounts].sort(([a],[b])=>a.localeCompare(b)).flatMap(([account,a])=>{
      if(a.quarantined||a.balance===0n)return [];
      const mature=a.ageLots.reduce((sum,lot)=>sum+(lot.unlockAt<=now?lot.amount:0n),0n);
      const value=a.balance*price/10n**18n;
      const covered=value+a.relief;
      const loss=a.cost>covered?(a.cost-covered)*mature/a.balance:0n;
      return loss>0n?[{account,loss}]:[];
    });
  }
  plan(budgetWei,oracle) {
    const budget=BigInt(budgetWei);if(budget<0n)throw Error('Negative budget');
    const weights=this.shortfalls(oracle),totalLoss=weights.reduce((n,w)=>n+w.loss,0n);
    const distributable=min(budget,totalLoss);
    // Round DOWN. Remainder stays in the vault; never overpay to exhaust the pot.
    const allocations=totalLoss===0n?[]:weights.map(w=>({...w,amount:distributable*w.loss/totalLoss})).filter(w=>w.amount>0n);
    const allocated=allocations.reduce((n,a)=>n+a.amount,0n);
    const content={schemaVersion:'robin.loss-allocation.v2',ledgerVersion:LEDGER_VERSION,checkpoint:this.checkpoint,oracle,
      budgetWei:budget,totalLoss,allocated,carryForward:budget-allocated,allocations};
    const json=stringify(content);
    return {...content,auditHash:'0x'+createHash('sha256').update(json).digest('hex')};
  }
  /** Call only after the batch receipt confirms allocation (including reserved deferred payments).
   * Recording a planned but unsubmitted batch would underpay; replay would double credit.
   */
  acknowledge(batchId,allocations) {
    const id='reward:'+batchId;if(this.seen.has(id))throw Error('Duplicate reward batch');
    for(const a of allocations)positive(a.amount);
    for(const a of allocations)this.get(a.account).relief+=BigInt(a.amount);
    this.seen.add(id);
  }
  serialize() {return stringify({version:LEDGER_VERSION,minimumAgeSeconds:this.minimumAgeSeconds,
    maxOracleAgeSeconds:this.maxOracleAgeSeconds,checkpoint:this.checkpoint,seen:[...this.seen],accounts:[...this.accounts]});}
  static restore(json) {
    const d=JSON.parse(json);if(d.version!==LEDGER_VERSION)throw Error('Unsupported ledger; replay chain history with current accounting');
    const l=new LossLedger(d);l.checkpoint=d.checkpoint;l.seen=new Set(d.seen);
    l.accounts=new Map(d.accounts.map(([a,p])=>{
      const account={...p,balance:BigInt(p.balance),cost:BigInt(p.cost),relief:BigInt(p.relief),
        ageLots:p.ageLots.map(lot=>({unlockAt:lot.unlockAt,amount:BigInt(lot.amount)}))};
      if(account.balance<0n||account.cost<0n||account.relief<0n||account.ageLots.some((lot,i)=>
        !Number.isSafeInteger(lot.unlockAt)||lot.unlockAt<0||lot.amount<=0n||(i>0&&lot.unlockAt<=account.ageLots[i-1].unlockAt))
        ||account.ageLots.reduce((sum,lot)=>sum+lot.amount,0n)!==account.balance)throw Error('Invalid ledger age inventory');
      return [address(a),account];
    }));return l;
  }
}
export function stringify(value) {return JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);}

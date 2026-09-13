import {Interface} from 'ethers';
import {address,ZERO} from './ledger.mjs';
const erc20=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export const hookInterface=new Interface([
 'event TradeObserved(bytes32 indexed poolId,address indexed router,bool buy,uint256 tokens,uint256 grossNative,uint256 feeNative,uint160 sqrtPriceX96,int24 tick)',
 'event PriceObserved(bytes32 indexed poolId,uint160 sqrtPriceX96,int24 tick)'
]);

/** Handles ONE official-pool swap per transaction with a single linear token settlement path.
 * Handles direct user settlement and router custody forwarded to the final recipient.
 * Split routes, multiple swaps, liquidity changes and other ambiguous flows return unsupported.
 * The caller must quarantine/reconcile affected holders before allocating rewards.
 */
export function decodeReceipt(receipt,{token,hook,poolManager,poolId,time,excludedAddresses=[]}) {
  const transfers=[],trades=[];
  for(const log of receipt.logs) {
    if(address(log.address)===address(token)) {
      try {const p=erc20.parseLog(log);if(p)transfers.push({from:address(p.args.from),to:address(p.args.to),amount:p.args.value,index:log.index??log.logIndex});}catch{}
    }
    if(address(log.address)===address(hook)) {
      try {const p=hookInterface.parseLog(log);if(p?.name==='TradeObserved')trades.push(p.args);}catch{}
    }
  }
  const id=receipt.hash??receipt.transactionHash;
  const failed=reason=>({supported:false,reason,affected:[...new Set(transfers.flatMap(t=>[t.from,t.to]))].filter(a=>a!==ZERO),transfers,events:[]});
  if(Number(receipt.status)!==1)return {supported:true,events:[],transfers:[],affected:[]};
  if(!id)throw Error('Receipt missing transaction hash');
  if(trades.length===0) {
    const excluded=new Set([address(poolManager),...excludedAddresses.map(address)]);
    if(transfers.some(t=>excluded.has(t.from)||excluded.has(t.to)))return failed('Unknown pool/liquidity transfer');
    return {supported:true,events:transfers.filter(t=>t.amount>0n).map(t=>({id:`${id}:${t.index}`,time,type:'transfer',...t})),transfers};
  }
  if(trades.length!==1)return failed('Multiple swaps require trace attribution');
  const trade=trades[0];if(trade.poolId.toLowerCase()!==poolId.toLowerCase())return failed('Wrong pool');
  const remaining=transfers.filter(t=>t.amount>0n);
  if(!remaining.length||remaining.some(t=>t.amount!==trade.tokens))return failed('Split/netted token settlement');
  const manager=address(poolManager),visited=new Set([manager]);let cursor=manager;
  while(remaining.length) {
    const candidates=remaining.filter(t=>trade.buy?t.from===cursor:t.to===cursor);
    if(candidates.length!==1)return failed('Ambiguous token path');
    const edge=candidates[0];cursor=trade.buy?edge.to:edge.from;
    if(cursor===ZERO||visited.has(cursor))return failed('Cyclic or zero-address settlement');
    visited.add(cursor);remaining.splice(remaining.indexOf(edge),1);
  }
  if(excludedAddresses.map(address).includes(cursor))return failed('Settlement ends at excluded contract');
  return {supported:true,transfers,events:[{id:`${id}:swap`,time,type:trade.buy?'buy':'sell',
    account:cursor,amount:trade.tokens,...(trade.buy?{costWei:trade.grossNative}:{})}]};
}

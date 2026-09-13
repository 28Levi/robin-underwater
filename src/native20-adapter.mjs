import {Interface} from 'ethers';
import {address} from './ledger.mjs';
import {hookInterface} from './receipt-adapter.mjs';
export const native20Interface=new Interface([
 'event NativeFeesAccrued(bytes32 indexed poolId,address indexed sender,bool isBuy,uint256 grossNative,uint256 platformFee,uint256 creatorFee)'
]);
export const poolInterface=new Interface([
 'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
 'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)'
]);
const initInterface=new Interface(['event TokenInventorySeeded(address indexed token,address indexed hook,uint128 lockedLiquidity,uint256 tokenAmount)',
 'event InitialBuyExecuted(address indexed buyer,address indexed token,uint256 grossNativeWei,uint256 tokensOut)']);
const transferInterface=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);

/** Normalize verified-origin Native20 + PoolManager logs into the accounting adapter's event shape.
 * No RPC caller address assumptions. Does not modify the actual onchain events or kernel.
 */
export function normalizeNative20Receipt(receipt,c) {
 const fees=[],swaps=[],prices=[],seed=[],initialBuys=[];
 for(const log of receipt.logs){
  const origin=address(log.address);
  if(origin===address(c.hook)){try{const p=native20Interface.parseLog(log);if(p&&p.args.poolId.toLowerCase()===c.poolId)fees.push(p.args);}catch{}}
  if(origin===address(c.poolManager)){try{
   const p=poolInterface.parseLog(log);if(p?.args.id.toLowerCase()!==c.poolId)continue;
   if(p.name==='Swap')swaps.push(p.args);else if(p.name==='Initialize')prices.push(p.args);
  }catch{}}
  if(c.initializer&&origin===address(c.initializer)){try{
   const p=initInterface.parseLog(log);if(p?.name==='TokenInventorySeeded')seed.push(p.args);
   if(p?.name==='InitialBuyExecuted')initialBuys.push(p.args);
  }catch{}}
 }
 const observations=[...prices,...swaps].map(x=>({sqrtPriceX96:x.sqrtPriceX96,tick:x.tick}));
 // Synthetic observation is only used internally; exact native cost comes from canonical fee events.
 const synthetic=[];
 if(fees.length===1&&swaps.length===1){
  const f=fees[0],s=swaps[0],buy=s.amount0<0n&&s.amount1>0n;
  if(f.isBuy!==buy||(!buy&&!(s.amount0>0n&&s.amount1<0n)))throw Error('Native20 swap direction mismatch');
  const tokens=s.amount1<0n?-s.amount1:s.amount1;
  synthetic.push({address:c.hook,index:0,...hookInterface.encodeEventLog(hookInterface.getEvent('TradeObserved'),
   [f.poolId,f.sender,buy,tokens,f.grossNative,f.platformFee+f.creatorFee,s.sqrtPriceX96,s.tick])});
  // The launch's seed transfer is not a second user trade. Exempt only its exact authenticated event-bound inventory.
  const seedAmount=seed.length===1&&initialBuys.length===1
   &&address(seed[0].token)===address(c.token)&&address(seed[0].hook)===address(c.hook)
   &&address(initialBuys[0].token)===address(c.token)&&initialBuys[0].tokensOut===tokens
   &&initialBuys[0].grossNativeWei===f.grossNative&&buy?seed[0].tokenAmount:null;
  const logs=receipt.logs.filter(log=>{
   if(seedAmount!==null&&address(log.address)===address(c.token)){
    try{const p=transferInterface.parseLog(log);if(p&&address(p.args.from)===address(c.initializer)
     &&address(p.args.to)===address(c.poolManager)&&p.args.value===seedAmount)return false;}catch{}
   }
   return true;
  });
  return {receipt:{...receipt,hash:receipt.hash??receipt.transactionHash,status:receipt.status,logs:[...logs,...synthetic]},observations};
 }
 if(fees.length||swaps.length){
  // Force multi-swap exclusion even when transfers happen to resemble an ordinary gift.
  for(let i=0;i<2;i++)synthetic.push({address:c.hook,index:i,...hookInterface.encodeEventLog(hookInterface.getEvent('TradeObserved'),
   [c.poolId,c.hook,true,1n,1n,0n,1n<<96n,0])});
 }
 return {receipt:{...receipt,hash:receipt.hash??receipt.transactionHash,status:receipt.status,logs:[...receipt.logs,...synthetic]},observations};
}

import {AbiCoder,Contract,ZeroAddress,keccak256} from 'ethers';
import {address} from './ledger.mjs';

// Published atomic root deployment; current RPC must agree with this historical chain identity.
export const ROBINHOOD_ANCHOR={blockNumber:50469365,blockHash:'0x6f3331471a5b96a23b951116be75f74a3cedf1c5f95f7d07d7f0e23f7b8493f0'};
export const POOL_MANAGER='0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const POOL_MANAGER_HASH='0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626';

export async function verifyProductionNetwork(provider,c,{now=Math.floor(Date.now()/1000)}={}){
 if(c.chainId!==4663||(await provider.getNetwork()).chainId!==4663n)throw Error('Wrong production chain');
 if(address(c.poolManager)!==address(POOL_MANAGER))throw Error('Wrong canonical PoolManager');
 const [anchor,head,finalized,code]=await Promise.all([provider.getBlock(ROBINHOOD_ANCHOR.blockNumber),provider.getBlock('latest'),
  provider.getBlock('finalized'),provider.getCode(POOL_MANAGER)]);
 if(anchor?.hash!==ROBINHOOD_ANCHOR.blockHash)throw Error('Production chain anchor mismatch');
 if(!head||!finalized||finalized.number<ROBINHOOD_ANCHOR.blockNumber||finalized.number>head.number
  ||head.timestamp>now+30||now-head.timestamp>300||now-finalized.timestamp>(c.maxFinalityLagSeconds??7200))throw Error('Production finality or clock is stale');
 if(keccak256(code)!==POOL_MANAGER_HASH)throw Error('Canonical PoolManager runtime changed');
 // Historical state is required by replay. A latest-only RPC cannot run this service.
 if(keccak256(await provider.getCode(POOL_MANAGER,finalized.number))!==POOL_MANAGER_HASH)throw Error('Finalized historical state unavailable');
 return {head,finalized};
}

export async function verifyProductionToken(provider,c){
 if(typeof c.name!=='string'||!c.name.trim()||typeof c.symbol!=='string'||!c.symbol.trim())
  throw Error('Missing explicit production token identity');
 const hook=new Contract(c.hook,['function creatorBuyFeeBps() view returns(uint16)','function creatorSellFeeBps() view returns(uint16)',
  'function PLATFORM_FEE_BPS() view returns(uint16)','function lpFee() view returns(uint24)','function module() view returns(address)',
  'function initialized() view returns(bool)','function token() view returns(address)','function initializer() view returns(address)',
  'function poolManager() view returns(address)','function tickSpacing() view returns(int24)'],provider);
 const token=new Contract(c.token,['function name() view returns(string)','function symbol() view returns(string)','function totalSupply() view returns(uint256)'],provider);
 const [buy,sell,platform,lp,module,initialized,hookToken,initializer,manager,spacing,name,symbol,supply]=await Promise.all([
  hook.creatorBuyFeeBps(),hook.creatorSellFeeBps(),hook.PLATFORM_FEE_BPS(),hook.lpFee(),hook.module(),hook.initialized(),hook.token(),
  hook.initializer(),hook.poolManager(),hook.tickSpacing(),token.name(),token.symbol(),token.totalSupply()]);
 const poolId=keccak256(AbiCoder.defaultAbiCoder().encode(['address','address','uint24','int24','address'],[ZeroAddress,c.token,0,60,c.hook]));
 if(buy!==180n||sell!==180n||platform!==20n||lp!==0n||module!==ZeroAddress||!initialized||address(hookToken)!==address(c.token)
  ||address(initializer)!==address(c.initializer)||address(manager)!==address(c.poolManager)||spacing!==60n||name!==c.name||symbol!==c.symbol
  ||supply!==10n**27n||poolId!==c.poolId)throw Error('Production deployment differs from configured token identity or fixed fee settings');
}

export {CHAIN_ID,LAUNCH_WALLET,ANCHOR,MANAGER,MANAGER_HASH} from './guards.mjs';
import {CHAIN_ID,LAUNCH_WALLET,ANCHOR,MANAGER_HASH} from './guards.mjs';
export const LAUNCH_ID='5df928cc-eb87-4913-9cdd-537a30b0587f';
export const DATA_HASH='0xb77a2dfe7d23a953ba424fc06fd68bf7ae037a7e109195f1a31255ddaa027f81';
export const PREIMAGE='sha256:b27c93bf5371fd2e2beb9efab03f580c8e770bcef6287b74dbbc3b0b51b25fdc';
export const REQUEST_HASH='sha256:fb1ebe9c90918e03983b96846f8a1e8c519273737707ffb14485114737c20013';
export const ROUTER='0x34965F2A2ee9254522232C32F02056E92BE0C98a';
export const ROUTER_HASH='0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388';
export const DISTRIBUTOR='0x92e7fC51F2C9C04E995b66249EA4F2e9F09EaFFf';
export const DISTRIBUTOR_HASH='0x0dbc35dec4a4ce90deee57f62d80f42bc9d1cbc8b78e903bbb00f417c80b38de';
export const TOKEN='0x6eee1e87095d5A21d3B77E0A70506e017dd48Ec1';
export const GAS_CAP=1800000000000000n, VALUE=1000000000000000n;
// Remaining test allocations plus the main launch's 0.1008 ETH budget.
export const PRESERVED_BALANCE=105800000000000000n;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const hex=n=>'0x'+n.toString(16);
export function validateLaunchPackage(pkg,ethers,now=Date.now()){
 const t=pkg?.transaction;
 if(!t||pkg.launchId!==LAUNCH_ID||pkg.rawRequestSha256!==REQUEST_HASH||pkg.simulationPassed!==true||pkg.status!=='wallet_action_required'||
  t.transactionPreimageHash!==PREIMAGE||ethers.keccak256(t.calldata)!==DATA_HASH||!same(t.from,LAUNCH_WALLET)||!same(t.to,ROUTER)||
  t.chainId!=='4663'||t.apiVersion!=='v4'||BigInt(t.valueWei)!==VALUE||t.routerRuntimeCodeHash!==ROUTER_HASH||
  pkg.metadata?.token?.name!=='Moss Circuit'||pkg.metadata?.token?.symbol!=='MOSSC')throw Error('Launch differs from the exact reviewed MOSSC request.');
 const age=now-Date.parse(pkg.checkedAt),remaining=Date.parse(t.expiresAt)-now;
 if(!Number.isFinite(age)||age< -30000||age>60000)throw Error('Fresh platform validation is required.');
 if(!Number.isFinite(remaining)||remaining<90000)throw Error('Launch authorization is expiring. Ask Codex to refresh it; do not sign.');
}
export function boundedLaunchTransaction(pkg,state,ethers,now=Date.now()){
 validateLaunchPackage(pkg,ethers,now);
 if(!same(state.account,LAUNCH_WALLET)||state.chainId!==CHAIN_ID)throw Error('Connect launch wallet B519 on Robinhood Chain.');
 if(state.anchor?.hash!==ANCHOR.hash||ethers.keccak256(state.managerCode)!==MANAGER_HASH||ethers.keccak256(state.routerCode)!==ROUTER_HASH)
  throw Error('Chain or router identity differs.');
 if(ethers.keccak256(state.distributorCode)!==DISTRIBUTOR_HASH||state.distributorBlock?.hash!==pkg.distributorBlockHash)
  throw Error('Verified rewards contract is missing or its receipt is no longer canonical.');
 if(state.tokenCode!=='0x')throw Error('The test token already exists. Do not submit again.');
 if(BigInt(state.latestNonce)!==3n||BigInt(state.pendingNonce)!==3n)throw Error('Wallet nonce changed or a transaction is pending. Ask Codex to check before retrying.');
 const timestamp=Number(BigInt(state.head.timestamp))*1000;
 if(timestamp>now+30000||now-timestamp>300000)throw Error('Wallet RPC is stale.');
 const gas=(BigInt(state.gasEstimate)*120n+99n)/100n,price=(BigInt(state.gasPrice)*125n+99n)/100n;
 const maximumCost=gas*price;
 if(gas<=0n||price<=0n||maximumCost>GAS_CAP)throw Error('Gas exceeds the approved 0.0018 ETH cap.');
 if(BigInt(state.balance)<PRESERVED_BALANCE+VALUE+maximumCost)throw Error('Insufficient balance while preserving remaining approved budgets.');
 return {transaction:{from:LAUNCH_WALLET,to:ROUTER,chainId:CHAIN_ID,data:pkg.transaction.calldata,value:hex(VALUE),nonce:'0x3',gas:hex(gas),gasPrice:hex(price)},maximumCost};
}

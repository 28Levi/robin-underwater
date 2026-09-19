import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as ethers from 'ethers';
import {boundedLaunchTransaction,validateLaunchPackage,LAUNCH_WALLET,ANCHOR,MANAGER_HASH,ROUTER_HASH,DISTRIBUTOR_HASH,VALUE,GAS_CAP,PRESERVED_BALANCE} from '../signing-ui/moss-launch-guards.mjs';
// This reviewed package is local evidence, not a portable repository fixture.
const evidence='output/moss-platform-submission.json';
test('exact MOSSC wallet boundaries reject unsafe changes',{skip:!fs.existsSync(evidence)},()=>{
 const r=JSON.parse(fs.readFileSync(evidence)).resource;
 const now=Date.parse(r.walletTransaction.expiresAt)-600000;
 const pkg={launchId:r.launchId,status:r.status,rawRequestSha256:r.rawRequestSha256,simulationPassed:true,checkedAt:new Date(now).toISOString(),
  transaction:r.walletTransaction,metadata:r.projectMetadata,distributorBlockHash:'0xblock'};
 const hashMap={manager:MANAGER_HASH,router:ROUTER_HASH,distributor:DISTRIBUTOR_HASH};
 const crypto={...ethers,keccak256:v=>hashMap[v]??ethers.keccak256(v)};
 const state={account:LAUNCH_WALLET,chainId:'0x1237',anchor:ANCHOR,head:{timestamp:'0x'+Math.floor(now/1000).toString(16)},
  managerCode:'manager',routerCode:'router',distributorCode:'distributor',distributorBlock:{hash:'0xblock'},tokenCode:'0x',
  latestNonce:'0x3',pendingNonce:'0x3',balance:'300000000000000000',gasPrice:'83284000',gasEstimate:'6526084'};
 validateLaunchPackage(pkg,ethers,now);
 const good=boundedLaunchTransaction(pkg,state,crypto,now);
 assert.equal(BigInt(good.transaction.value),VALUE);assert.equal(good.transaction.data,r.walletTransaction.calldata);
 assert.ok(good.maximumCost<=GAS_CAP);assert.equal(good.transaction.nonce,'0x3');
 for(const change of [{pendingNonce:'0x4'},{latestNonce:'0x4'},{tokenCode:'0x01'},{distributorCode:'0x'},{routerCode:'0x'},
  {chainId:'0x1'},{account:ethers.ZeroAddress},{gasPrice:'1000000000'},{distributorBlock:{hash:'0xother'}},
  {balance:(PRESERVED_BALANCE+VALUE+good.maximumCost-1n).toString()},{head:{timestamp:'0x0'}}])
  assert.throws(()=>boundedLaunchTransaction(pkg,{...state,...change},crypto,now));
 for(const change of [{simulationPassed:false},{status:'failed'},{checkedAt:new Date(now-61000).toISOString()},
  {transaction:{...pkg.transaction,valueWei:'100000000000000000'}},{transaction:{...pkg.transaction,calldata:pkg.transaction.calldata+'00'}},
  {transaction:{...pkg.transaction,expiresAt:new Date(now+30000).toISOString()}},{metadata:{token:{name:'ROBINHOOD',symbol:'ROBIN'}}}])
  assert.throws(()=>validateLaunchPackage({...pkg,...change},ethers,now));
});

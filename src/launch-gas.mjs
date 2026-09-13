import {getAddress,keccak256} from 'ethers';

const uint = value => {
 if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))throw Error('Invalid decimal wei amount');
 return BigInt(value);
};

/** Read-only estimate for a walletTransaction exported by the official CLI.
 * This is an additional cost check, not a replacement for CLI validation/admission.
 * No signer, API credential, budget mutation or transaction submission is used.
 */
export async function estimateLaunchGas(provider,intent,transaction,capabilities,{now=Date.now()}={}){
 if(intent.chainId!==4663||(await provider.getNetwork()).chainId!==4663n)throw Error('Wrong launch chain');
 if(transaction.chainId!=='4663'||transaction.apiVersion!=='v4')throw Error('Wrong transaction chain/version');
 if(getAddress(transaction.from)!==getAddress(intent.launchWallet))throw Error('Wrong launch wallet');
 const router=capabilities?.chainDeployment?.contracts?.programmableLaunchStampRouter;
 if(!router||getAddress(transaction.to)!==getAddress(router.address))throw Error('Wrong launch router');
 const value=uint(transaction.valueWei),purchase=uint(intent.initialBuyWei),cap=uint(intent.maxLaunchValueWei);
 if(value!==purchase||value>cap)throw Error('Transaction differs from the confirmed purchase budget');
 if(typeof transaction.calldata!=='string'||!/^0xe5f6b8cd(?:[0-9a-f]{2})+$/.test(transaction.calldata))throw Error('Invalid launch calldata');
 const deadline=Date.parse(transaction.expiresAt);
 if(!Number.isFinite(deadline)||deadline<=now)throw Error('Launch transaction expired');
 const code=await provider.getCode(router.address);
 if(code==='0x'||keccak256(code)!==router.runtimeCodeHash)throw Error('Launch router code does not match capabilities');
 const request={from:transaction.from,to:transaction.to,value,data:transaction.calldata};
 const [gasUnits,fees,block]=await Promise.all([provider.estimateGas(request),provider.getFeeData(),provider.getBlock('latest')]);
 if(gasUnits<=0n||!block)throw Error('Gas estimate unavailable');
 const feeCap=fees.maxFeePerGas??fees.gasPrice;
 if(feeCap===null||feeCap<=0n)throw Error('Gas price unavailable');
 // An explicit review margin, not a user-approved spending allowance.
 const suggestedGasLimit=(gasUnits*120n+99n)/100n;
 const executionGasCostCap=suggestedGasLimit*feeCap;
 const approved=intent.maxGasCostWei===null?null:uint(intent.maxGasCostWei);
 return {schemaVersion:'robin.read-only-launch-gas.v1',chainId:4663,launchWallet:intent.launchWallet,
  transactionDataHash:keccak256(transaction.calldata),router:router.address,
  observedBlock:{number:block.number,hash:block.hash},generatedAt:new Date(now).toISOString(),
  refreshAfter:new Date(Math.min(deadline,now+60_000)).toISOString(),
  purchaseWei:value,estimatedGasUnits:gasUnits,suggestedGasLimit,gasLimitMarginPercent:20,
  suggestedMaxFeePerGasWei:feeCap,suggestedMaxPriorityFeePerGasWei:fees.maxPriorityFeePerGas??null,
  executionGasCostAtSuggestedCapWei:executionGasCostCap,
  approvedGasBudgetWei:approved,executionEstimateWithinApprovedBudget:approved===null?null:executionGasCostCap<=approved,
  scope:'This launch-router transaction only; separate distributor deployment, later reward transactions and any separately charged chain fees are excluded.',
  status:'estimate-only; validate the official package and review final wallet fees before signing',
  authorizationVerified:false,signing:false,broadcast:false};
}

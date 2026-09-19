export const CHAIN_ID = '0x1237';
export const LAUNCH_WALLET = '0x9479ac7ED3A72866F63F37013F2c7Cc68936B519';
export const OPERATOR = '0x9C366d4E42b8f987e8398A27b3b9A02803493088';
export const CREATION_HASH = '0xd4f942c982a3a81e0549c8a5d0c38c0358e5b20ff2b49bc43836a50953ebfcb0';
export const GAS_CAP = 200000000000000n;
export const PRESERVED_BALANCE = 100800000000000000n;
export const ANCHOR = {number: '0x'+(50469365).toString(16), hash:'0x6f3331471a5b96a23b951116be75f74a3cedf1c5f95f7d07d7f0e23f7b8493f0'};
export const MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const MANAGER_HASH = '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626';
const same=(a,b)=>typeof a==='string' && typeof b==='string' && a.toLowerCase()===b.toLowerCase();
const hex=n=>'0x'+n.toString(16);

export function validateDraft(draft, simulation, ethers) {
  const t=draft.transaction;
  if(!draft.budgetApproved || BigInt(draft.approvedGasBudgetWei)!==GAS_CAP ||
    !same(draft.operator,OPERATOR) || !same(t.from,LAUNCH_WALLET) || t.chainId!==CHAIN_ID ||
    t.to!==undefined || BigInt(t.value)!==0n || t.nonce!=='0x1' ||
    ethers.keccak256(t.data)!==CREATION_HASH || draft.creationBytecodeHash!==CREATION_HASH ||
    !simulation.passed || !simulation.localEvmOnly || simulation.exactCreationDataHash!==CREATION_HASH ||
    !same(simulation.operator,OPERATOR) || !same(simulation.predictedAddress,draft.predictedAddress) ||
    !same(ethers.getCreateAddress({from:t.from,nonce:BigInt(t.nonce)}),draft.predictedAddress))
    throw Error('Deployment package does not match the reviewed and simulated contract.');
}

export function boundedTransaction(draft, state, ethers, now=Math.floor(Date.now()/1000)) {
  if(!same(state.account,LAUNCH_WALLET)) throw Error('Connect the launch wallet shown on this page.');
  if(state.chainId!==CHAIN_ID || state.anchor?.hash!==ANCHOR.hash ||
    ethers.keccak256(state.managerCode)!==MANAGER_HASH) throw Error('Robinhood Chain identity check failed.');
  const timestamp=Number(BigInt(state.head.timestamp));
  if(timestamp>now+30 || now-timestamp>300) throw Error('Wallet RPC has a stale block or incorrect clock.');
  if(BigInt(state.latestNonce)!==BigInt(draft.transaction.nonce) || BigInt(state.pendingNonce)!==BigInt(draft.transaction.nonce))
    throw Error('Wallet nonce changed or another transaction is pending. Ask Codex to refresh the deployment.');
  if(state.deployedCode!=='0x') throw Error('A contract already exists at this address. Do not deploy again.');
  const gas=(BigInt(state.gasEstimate)*125n+99n)/100n;
  const price=(BigInt(state.gasPrice)*125n+99n)/100n;
  const maximumCost=gas*price;
  if(gas<=0n || price<=0n || maximumCost>GAS_CAP) throw Error('Fresh gas quote exceeds the approved 0.0002 ETH cap.');
  if(BigInt(state.balance)<PRESERVED_BALANCE+maximumCost) throw Error('Insufficient balance while preserving 0.1 ETH for the purchase and 0.0008 ETH for launch gas.');
  return {transaction:{from:LAUNCH_WALLET,data:draft.transaction.data,value:'0x0',chainId:CHAIN_ID,
    nonce:draft.transaction.nonce,gas:hex(gas),gasPrice:hex(price)},maximumCost};
}

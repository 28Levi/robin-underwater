import {CHAIN_ID, ANCHOR, MANAGER, validateReviewManifest, validateLaunchPackage,
  boundedLaunchTransaction, launchSubmissionKey} from '/signing-ui/robin-launch-guards.mjs';
import {requestConnectionStep} from '/signing-ui/wallet-connection.mjs';
import {effectiveWorkerSourceRevision} from '/src/launch-manifest.mjs';

const ethers = window.ethers, $ = id => document.getElementById(id);
const status = text => { $('status').textContent = text; };
const wallets = [];
let session, manifest, pkg, provider, ready = false, busy = false, walletRevision = 0;
let reviewRecorded = false, hostReady = false, hostReadyExpiresAt = 0, checkingHost = false;
let connectionAttempt = 0, connectionAbort = null, connectionPending = false;
const automatic = () => manifest?.activation.mode === 'after-reviewed-launch';
const storageKey = () => launchSubmissionKey(manifest);
const saved = () => manifest ? localStorage.getItem(storageKey()) : null;
const submitted = () => { try { const record = JSON.parse(saved()); return record?.manifestSha256 === session?.manifestSha256 && /^0x[0-9a-f]{64}$/.test(record?.hash) ? record : null; } catch { return null; } };
function updateControls() {
  $('connect').disabled = busy || !session || !wallets.length;
  $('wallet').disabled = busy;
  $('cancel-connect').hidden = !connectionPending;
  $('review').disabled = !ready || busy;
  $('record-review').disabled = !ready || busy || !$('review').checked || reviewRecorded || !!saved();
  $('launch').disabled = !ready || busy || !$('review').checked || !reviewRecorded || !hostReady || Date.now() >= hostReadyExpiresAt || !!saved();
  $('retry-proof').hidden = !session || !submitted() || submitted().proofRecorded === true;
  $('retry-proof').disabled = busy;
}
function invalidate() {
  walletRevision++; ready = false; hostReady = false; $('review').checked = false;
  updateControls(); if (!busy) status('Wallet selection changed. Connect and check again.');
}
async function checkHostReadiness() {
  if (!session || checkingHost) return;
  checkingHost = true;
  try {
    const response = await fetch('/readiness.json', {cache: 'no-store'}), result = await response.json();
    if (!response.ok || result.manifestSha256 !== session.manifestSha256) throw Error('Readiness unavailable');
    reviewRecorded = result.reviewRecorded === true;
    hostReady = result.hostReady === true && Date.parse(result.expiresAt) > Date.now();
    hostReadyExpiresAt = hostReady ? Date.parse(result.expiresAt) : 0;
    $('host-status').textContent = hostReady ? 'Your review is recorded and the rewards host is ready. You can open the launch in your wallet.'
      : reviewRecorded ? 'Your review is recorded. Waiting for the rewards host to receive and verify it. Your wallet has not been opened.'
      : 'Confirm your review first. Your wallet opens only after the rewards host is ready.';
  } catch { hostReady = false; hostReadyExpiresAt = 0; $('host-status').textContent = 'Rewards-host readiness is unavailable. Wallet launch stays disabled.'; }
  finally { checkingHost = false; updateControls(); }
}
function addWallet(name, candidate) {
  if (!candidate?.request || wallets.some(wallet => wallet.provider === candidate)) return;
  const selected = $('wallet').value;
  wallets.push({name: String(name).slice(0, 80), provider: candidate});
  $('wallet').replaceChildren(...wallets.map((wallet, i) => new Option(wallet.name, String(i))));
  if (selected) $('wallet').value = selected;
  updateControls();
}
window.addEventListener('eip6963:announceProvider', event => addWallet(event.detail?.info?.name ?? 'Browser wallet', event.detail?.provider));
window.dispatchEvent(new Event('eip6963:requestProvider'));
setTimeout(() => {
  if (!wallets.length && window.ethereum) for (const candidate of window.ethereum.providers ?? [window.ethereum]) {
    addWallet(candidate.isRabby ? 'Rabby' : candidate.isMetaMask ? 'MetaMask' : 'Browser wallet', candidate);
  }
  if (!wallets.length) $('wallet').replaceChildren(new Option('No browser wallet detected', ''));
}, 600);

function details(id, entries) {
  $(id).replaceChildren(...entries.flatMap(([label, value]) => {
    const term = document.createElement('dt'), description = document.createElement('dd');
    term.textContent = label; description.textContent = value; return [term, description];
  }));
}
function showPackage() {
  const {transaction: t, components: c, execution: e, accounting: a} = manifest;
  const pipelined = e.confirmationMode === 'pipelined-finalized-v1';
  const publication = pkg.resource.plan.publication;
  details('details', [
    ['Network', 'Robinhood Chain · 4663'], ['Launch wallet', t.from],
    ['Initial purchase', `${ethers.formatEther(t.valueWei)} ETH`],
    ['Minimum received', `${ethers.formatUnits(manifest.minimumTokensOut, 18)} ROBIN`],
    ['Total supply', '1,000,000,000 ROBIN'],
    ['Contract buy / sell fees', '2% each: 1.7% for rewards + 0.3% Programmable. Trading-route fees require their separate quote.'],
    ['Maximum launch gas', `${ethers.formatEther(manifest.maxLaunchGasWei)} ETH`],
    ['Wallet reserve preserved', `${ethers.formatEther(manifest.preserveLaunchBalanceWei)} ETH`],
    ['Authorization expires', new Date(t.expiresAt).toLocaleString()], ['Wallet nonce', t.nonce],
    ['Atomic launch executor', t.to], ['Graph deployer', manifest.infrastructure.graphDeployer.address], ['Expected token', c.token.address], ['Expected hook', c.hook.address],
    ['Expected initializer', c.initializer.address], ['Expected fee vault', c.feeVault.address],
    ['Existing rewards contract', c.distributor.address], ['Operator wallet', manifest.operator],
    ['Platform fee recipient', manifest.platformRecipient],
  ]);
  $('description').textContent = publication.description ?? '';
  $('links').replaceChildren(...(publication.links ?? []).map(uri => { const p = document.createElement('p'); p.textContent = uri; return p; }));
  $('manifest-hash').textContent = session.manifestSha256;
  $('source-revision').textContent = manifest.sourceRevision;
  $('worker-source-revision').textContent = effectiveWorkerSourceRevision(manifest);
  $('platform-history').href = `https://programmable.market/developers/api-keys?view=history&chainId=4663&launchId=${encodeURIComponent(manifest.planId)}`;
  $('platform-history').hidden = false;
  $('automation-notice').textContent = automatic()
    ? 'After the exact launch is finalized and independently verified, the configured operator may send reward payments and spend its separate gas budget below. Your explicit review is required. No automatic refills are authorized.'
    : 'Automatic payouts remain disabled. The watcher may verify the launch and prepare the configuration; enabling the operator requires a separate reviewed activation.';
  details('automation-details', [
    ['Operator total gas budget', `${ethers.formatEther(e.maxTotalGasWei)} ETH; no automatic refills`],
    ['Operator per-transaction gas ceiling', `${ethers.formatEther(e.maxGasPerTransactionWei)} ETH`],
    ['Minimum treasury harvest', `${ethers.formatEther(e.minimumHarvestWei)} ETH`],
    ['Minimum reward batch', `${ethers.formatEther(e.minimumBatchWei)} ETH`],
    ['Holding requirement', pipelined ? `${a.minimumAgeSeconds / 60} minutes of finalized history; blockchain confirmation adds a delay (about 15–20 minutes in the live test)`
      : `${a.minimumAgeSeconds / 60} minutes`], ['Price averaging window', `${a.twapWindowSeconds / 60} minutes`],
    ['Payout interval', e.payoutIntervalSeconds === undefined ? 'No scheduled interval in this historical policy'
      : pipelined ? `Target every ${e.payoutIntervalSeconds / 60} minutes after initial warmup; eligible, funded batches only. Exact arrival and finality times are not guaranteed.`
      : `${e.payoutIntervalSeconds / 60} minutes from the finalized launch timestamp; eligible, funded batches only`],
    ...(pipelined ? [
      ['First payout', 'Requires 30 minutes of finalized price history: approximately 45–50 minutes after launch at the finality delay observed in the live test; funding and eligibility still apply.'],
      ['Confirmation policy', 'Use finalized history and finalized funds. Track payments awaiting finality and reserve their rewards before preparing another batch.'],
      ['Transactions awaiting finality', `Maximum ${e.maxInflightTransactions}; reaching this limit pauses new transactions until confirmations catch up`],
    ] : []),
    ['Retry interval', `${e.retryIntervalSeconds / 60} minutes`],
    ['Excluded addresses', a.excludedAddresses.length ? a.excludedAddresses.join(', ') : 'None'],
  ]);
  $('review-label').textContent = `I reviewed ROBINHOOK / ROBIN, the ${ethers.formatEther(t.valueWei)} ETH purchase, ${ethers.formatEther(manifest.maxLaunchGasWei)} ETH launch gas ceiling, addresses, contract and worker revisions, and ${automatic() ? 'automatic payout policy' : 'manual payout activation'} above.`;
}
async function loadPackage() {
  const response = await fetch('/package.json', {cache: 'no-store'}), result = await response.json();
  if (!response.ok) throw Error(result.error ?? 'Fresh platform validation unavailable.');
  validateLaunchPackage(result, manifest, session.manifestSha256, ethers);
  pkg = result; showPackage(); return pkg;
}
async function recordProof(hash) {
  status(`Transaction submitted:\n${hash}\nVerifying it on an independent RPC and recording its platform receipt. No further wallet transaction is sent.`);
  const response = await fetch('/launch-proof', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Robin-Review-Token': session.reviewToken},
    body: JSON.stringify({manifestSha256: session.manifestSha256, transactionHash: hash})});
  const result = await response.json();
  if (!response.ok || result.status !== 'proof-recorded' || result.transactionHash !== hash) throw Error(result.error ?? 'Platform receipt remains unconfirmed. Retry only its receipt.');
  const record = submitted();
  if (record?.hash !== hash) throw Error('Submission record changed. Reconcile the original transaction.');
  localStorage.setItem(storageKey(), JSON.stringify({...record, proofRecorded: true}));
  status(`Launch submitted and platform receipt recorded:\n${hash}\nThe watcher must still independently verify finality and all deployment details.${automatic() ? ' Automatic payouts remain subject to the reviewed activation gates.' : ' Automatic payouts remain disabled.'}`);
}
async function freshTransaction() {
  const selected = provider, revision = walletRevision;
  const rpc = (method, params = []) => selected.request({method, params});
  await loadPackage();
  const t = manifest.transaction, c = manifest.components;
  const operatorInterface = new ethers.Interface(['function operator() view returns (address)']);
  const [accounts, chainId, anchor, head, finalized, managerCode, routerCode, factoryCode, senderCode, distributorCode, distributorBlock,
    watchBlock, operatorResult, latestNonce, pendingNonce, balance, operatorBalance, gasPrice, codes] = await Promise.all([
    rpc('eth_accounts'), rpc('eth_chainId'), rpc('eth_getBlockByNumber', [ANCHOR.number, false]),
    rpc('eth_getBlockByNumber', ['latest', false]), rpc('eth_getBlockByNumber', ['finalized', false]),
    rpc('eth_getCode', [MANAGER, 'latest']), rpc('eth_getCode', [t.to, 'latest']), rpc('eth_getCode', [manifest.infrastructure.graphDeployer.address, 'latest']), rpc('eth_getCode', [t.from, 'latest']),
    rpc('eth_getCode', [c.distributor.address, 'latest']),
    rpc('eth_getBlockByNumber', [ethers.toQuantity(manifest.distributorDeployment.blockNumber), false]),
    rpc('eth_getBlockByNumber', [ethers.toQuantity(manifest.watchFrom.blockNumber), false]),
    rpc('eth_call', [{to: c.distributor.address, data: operatorInterface.encodeFunctionData('operator')}, 'latest']),
    rpc('eth_getTransactionCount', [t.from, 'latest']), rpc('eth_getTransactionCount', [t.from, 'pending']),
    rpc('eth_getBalance', [t.from, 'pending']), rpc('eth_getBalance', [manifest.operator, 'pending']), rpc('eth_gasPrice'),
    Promise.all(['token', 'hook', 'initializer', 'feeVault'].map(name => rpc('eth_getCode', [c[name].address, 'latest']))),
  ]);
  const gasEstimate = await rpc('eth_estimateGas', [{from: t.from, to: t.to, data: pkg.resource.steps[0].transaction.data,
    value: ethers.toQuantity(t.valueWei), nonce: ethers.toQuantity(t.nonce)}]);
  if (provider !== selected || revision !== walletRevision) throw Error('Wallet changed during checks. Connect and check again.');
  const result = boundedLaunchTransaction(pkg, manifest, session.manifestSha256, {
    account: accounts[0], chainId, anchor, head, finalized, managerCode, routerCode, factoryCode, senderCode, distributorCode,
    distributorBlock, watchBlock, distributorOperator: operatorInterface.decodeFunctionResult('operator', operatorResult)[0],
    latestNonce, pendingNonce, balance, operatorBalance, gasPrice, gasEstimate,
    componentCodes: Object.fromEntries(['token', 'hook', 'initializer', 'feeVault'].map((name, i) => [name, codes[i]])),
  }, ethers);
  $('quote').textContent = `${ethers.formatEther(result.maximumCost)} ETH (includes a 25% gas-price margin)`;
  return result;
}
$('wallet').addEventListener('change', invalidate);
$('review').addEventListener('change', updateControls);
window.addEventListener('storage', event => {
  if (manifest && event.key === storageKey()) { invalidate(); status('Another tab updated this wallet nonce. Reconcile its submission before retrying.'); }
});
$('connect').addEventListener('click', async () => {
  const attempt = ++connectionAttempt, controller = new AbortController();
  connectionAbort = controller; connectionPending = true;
  ready = false; busy = true; $('review').checked = false; updateControls();
  try {
    provider?.removeListener?.('accountsChanged', invalidate); provider?.removeListener?.('chainChanged', invalidate);
    const chosen = wallets[Number($('wallet').value)]; provider = chosen?.provider;
    if (!provider) throw Error('Select an available browser wallet.');
    const selected = provider;
    const step = async (method, params) => {
      const result = await requestConnectionStep(selected, method, params, {signal: controller.signal});
      if (attempt !== connectionAttempt) throw Object.assign(Error('Connection cancelled'), {code: 'WALLET_CONNECTION_CANCELLED'});
      return result;
    };
    status(`Approve the connection in ${chosen.name}. If its prompt does not open in Codex, open this same page in your normal wallet browser. You can cancel this wait below.`);
    await step('eth_requestAccounts');
    if (await step('eth_chainId') !== CHAIN_ID) {
      status(`Approve the switch to Robinhood Chain in ${chosen.name}.`);
      try { await step('wallet_switchEthereumChain', [{chainId: CHAIN_ID}]); }
      catch (error) {
        if (error.code !== 4902) throw error;
        status(`Approve adding Robinhood Chain in ${chosen.name}, then approve switching to it.`);
        await step('wallet_addEthereumChain', [{chainId: CHAIN_ID, chainName: 'Robinhood Chain',
          nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18}, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com']}]);
        await step('wallet_switchEthereumChain', [{chainId: CHAIN_ID}]);
      }
    }
    provider.on?.('accountsChanged', invalidate); provider.on?.('chainChanged', invalidate);
    status('Checking the current approved plan, deployed contracts, finality, nonce and gas budget…');
    await freshTransaction();
    if (attempt !== connectionAttempt) return;
    ready = true; await checkHostReadiness();
    if (attempt !== connectionAttempt) return;
    status(saved() ? `A submission is already recorded for this wallet nonce. Reconcile it before retrying.\n${saved()}`
      : 'Checks passed. Review the details and check the review box to open the exact transaction in your wallet.');
  } catch (error) {
    if (attempt !== connectionAttempt) return;
    if (error.code === 'WALLET_CONNECTION_TIMEOUT') {
      walletRevision++; status('The wallet has not answered yet. Open this same page in your normal wallet browser if the prompt does not open in Codex. Approve or dismiss any pending request in your extension before connecting again.');
    } else if (error.code === 'WALLET_CONNECTION_CANCELLED') status('Connection wait cancelled. Dismiss any pending request in your wallet before reconnecting.');
    else if (error.code === -32002) status('Your wallet already has a pending connection request. Open the extension to approve or dismiss it, then connect again.');
    else status(error.message ?? 'Wallet check failed.');
  }
  finally { if (attempt === connectionAttempt) { connectionPending = false; connectionAbort = null; busy = false; updateControls(); } }
});
$('cancel-connect').addEventListener('click', () => {
  if (!connectionPending) return;
  connectionAttempt++; walletRevision++; connectionAbort?.abort(); connectionAbort = null;
  connectionPending = false; busy = false; ready = false; $('review').checked = false; updateControls();
  status('Connection wait cancelled. Dismiss any pending request in your wallet before reconnecting. No launch request was sent.');
});
$('record-review').addEventListener('click', async () => {
  if (busy || !ready || !$('review').checked || reviewRecorded || saved()) return;
  busy = true; updateControls();
  try {
    await freshTransaction();
    const response = await fetch('/review', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Robin-Review-Token': session.reviewToken},
      body: JSON.stringify({manifestSha256: session.manifestSha256, reviewAccepted: true,
        automationAccepted: automatic(), economicRiskAccepted: automatic()})});
    const recorded = await response.json();
    if (!response.ok || recorded.status !== 'review-recorded' || recorded.manifestSha256 !== session.manifestSha256) throw Error('The exact launch review could not be recorded.');
    reviewRecorded = true; status('Review recorded. The wallet step will become available after the rewards host confirms this exact review.');
    await checkHostReadiness();
  } catch (error) { status(error.message ?? 'Review could not be recorded.'); }
  finally { busy = false; updateControls(); }
});
$('launch').addEventListener('click', async () => {
  if (busy || !ready || !$('review').checked || !reviewRecorded || !hostReady || Date.now() >= hostReadyExpiresAt || saved()) return;
  busy = true; ready = false; updateControls(); let sendStarted = false;
  try {
    if (!navigator.locks) throw Error('Use an up-to-date browser with transaction locking support.');
    await navigator.locks.request(storageKey(), {ifAvailable: true}, async lock => {
      if (!lock) throw Error('Another tab is preparing this wallet nonce.');
      const selected = provider, revision = walletRevision, {transaction} = await freshTransaction();
      if (saved()) throw Error('A submission is already recorded. Reconcile it before retrying.');
      const response = await fetch('/signing-ready', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Robin-Review-Token': session.reviewToken},
        body: JSON.stringify({manifestSha256: session.manifestSha256})});
      const recorded = await response.json();
      if (!response.ok || recorded.status !== 'signing-ready' || recorded.manifestSha256 !== session.manifestSha256
        || Date.parse(recorded.expiresAt) <= Date.now()) throw Error('The rewards host is not ready for this exact review. No wallet action opened.');
      validateLaunchPackage(pkg, manifest, session.manifestSha256, ethers);
      const accounts = await selected.request({method: 'eth_accounts'});
      if (provider !== selected || revision !== walletRevision || accounts[0]?.toLowerCase() !== manifest.transaction.from.toLowerCase()
        || await selected.request({method: 'eth_chainId'}) !== CHAIN_ID) throw Error('Wallet changed during final checks.');
      validateLaunchPackage(pkg, manifest, session.manifestSha256, ethers);
      if (Date.parse(recorded.expiresAt) <= Date.now()) throw Error('Rewards-host acknowledgement expired during wallet checks. Refresh readiness before signing.');
      if (saved()) throw Error('Another submission is recorded for this wallet nonce.');
      localStorage.setItem(storageKey(), JSON.stringify({state: 'awaiting-wallet-response', manifestSha256: session.manifestSha256,
        planId: manifest.planId, nonce: manifest.transaction.nonce, at: new Date().toISOString()}));
      sendStarted = true;
      status(`Review in your wallet: ${ethers.formatEther(manifest.transaction.valueWei)} ETH purchase; launch gas no higher than ${ethers.formatEther(manifest.maxLaunchGasWei)} ETH. Only you can approve this transaction.`);
      let hash = await selected.request({method: 'eth_sendTransaction', params: [transaction]});
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Wallet returned no valid transaction hash.');
      hash = hash.toLowerCase();
      localStorage.setItem(storageKey(), JSON.stringify({state: 'submitted', manifestSha256: session.manifestSha256,
        planId: manifest.planId, nonce: manifest.transaction.nonce, hash, at: new Date().toISOString()}));
      await recordProof(hash);
    });
  } catch (error) {
    if (sendStarted && error.code === 4001) {
      localStorage.removeItem(storageKey()); status('You declined the wallet request. Connect and check again before retrying.');
    } else status(`${error.message ?? 'Launch request failed.'}${sendStarted ? '\nThe submission may be uncertain. Do not retry until the original wallet nonce is reconciled.' : ''}`);
  } finally { busy = false; updateControls(); }
});
$('retry-proof').addEventListener('click', async () => {
  const record = submitted(); if (busy || !record) return;
  busy = true; updateControls();
  try { await recordProof(record.hash); }
  catch (error) { status(`${error.message}\nOriginal transaction: ${record.hash}\nDo not launch again. This button retries only the existing platform receipt.`); }
  finally { busy = false; updateControls(); }
});

try {
  const response = await fetch('/session.json', {cache: 'no-store'});
  if (!response.ok) throw Error('The local reviewed session is unavailable.');
  session = await response.json(); manifest = session.manifest;
  validateReviewManifest(manifest, session.manifestSha256, ethers);
  pkg = {resource: {plan: {publication: session.publication}}}; showPackage();
  await loadPackage(); await checkHostReadiness(); updateControls();
  status(saved() ? `Existing submission record. Reconcile before retrying.\n${saved()}`
    : 'Ready. Connect the displayed launch wallet to check the exact transaction.');
} catch (error) {
  ready = false;
  if (!submitted()) session = null;
  updateControls(); status(`${error.message ?? 'Reviewed handoff unavailable.'}${submitted() ? '\nAn existing transaction is recorded. Retry only its platform receipt; do not launch again.' : ''}`);
}
setInterval(() => {
  if (hostReady && Date.now() >= hostReadyExpiresAt) { hostReady = false; updateControls(); }
  if (ready && Date.parse(manifest.transaction.expiresAt) - Date.now() < 90000) {
    ready = false; updateControls(); status('Authorization is about to expire. Prepare a fresh reviewed handoff; do not sign.');
  }
}, 1000);
setInterval(() => { if (!busy && !saved()) checkHostReadiness(); }, 3000);

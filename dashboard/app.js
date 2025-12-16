/**
 * ASDF Dashboard - Full Testing Dashboard
 * Zero dependencies, vanilla JavaScript
 */

// ============================================================
// CONFIGURATION
// ============================================================

function getBaseUrls() {
  const hostname = window.location.hostname;

  // GitHub Codespaces detection
  if (hostname.includes('.app.github.dev')) {
    const codespaceName = hostname.replace(/-\d+\.app\.github\.dev$/, '');
    return {
      api: `https://${codespaceName}-3030.app.github.dev`,
      ws: `wss://${codespaceName}-3031.app.github.dev`,
    };
  }

  // Local development
  return {
    api: 'http://localhost:3030',
    ws: 'ws://localhost:3031',
  };
}

const BASE_URLS = getBaseUrls();

const CONFIG = {
  devnet: {
    api: BASE_URLS.api,
    ws: BASE_URLS.ws,
    solscan: 'https://solscan.io',
    solscanSuffix: '?cluster=devnet',
  },
  mainnet: {
    api: BASE_URLS.api,
    ws: BASE_URLS.ws,
    solscan: 'https://solscan.io',
    solscanSuffix: '',
  }
};

// Root token symbols (to identify in UI)
const ROOT_SYMBOLS = ['TROOT', 'FROOT', '$ASDF', 'ASDF'];

// ============================================================
// STATE
// ============================================================

let currentNetwork = localStorage.getItem('asdf-network') || 'devnet';
let ws = null;
let reconnectAttempts = 0;
let refreshInterval = null;
let currentPendingSol = 0;

// ============================================================
// DOM CACHE
// ============================================================

const $ = (id) => document.getElementById(id);

const DOM = {};

function cacheDom() {
  DOM.networkSelect = $('network-select');
  DOM.connectionStatus = $('connection-status');
  DOM.daemonHealthBadge = $('daemon-health-badge');
  DOM.daemonUptime = $('daemon-uptime');
  DOM.pollCount = $('poll-count');
  DOM.errorRate = $('error-rate');
  DOM.lastPoll = $('last-poll');
  DOM.btnRefresh = $('btn-refresh');
  DOM.btnFlush = $('btn-flush');
  DOM.actionResult = $('action-result');
  DOM.totalPendingSol = $('total-pending-sol');
  DOM.tokensCount = $('tokens-count');
  DOM.totalLamports = $('total-lamports');
  DOM.treasuryBalance = $('treasury-balance');
  DOM.rebateBalance = $('rebate-balance');
  DOM.rebatesCount = $('rebates-count');
  DOM.rebateRecipients = $('rebate-recipients');
  DOM.tokenList = $('token-list');
  DOM.burnsList = $('burns-list');
  // Hero elements
  DOM.totalBurned = $('total-burned');
  DOM.burns24h = $('burns-24h');
  DOM.burns1h = $('burns-1h');
  DOM.burnsCount = $('burns-count');
  DOM.wsIndicator = $('ws-indicator');
  DOM.wsStatusText = $('ws-status-text');
  DOM.apiUrl = $('api-url');
  DOM.wsUrl = $('ws-url');
  DOM.flushModal = $('flush-modal');
  DOM.modalPending = $('modal-pending');
  DOM.btnCancelFlush = $('btn-cancel-flush');
  DOM.btnConfirmFlush = $('btn-confirm-flush');
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  setupEventListeners();
  updateUrlDisplay();
  startDashboard();
});

function setupEventListeners() {
  DOM.networkSelect.value = currentNetwork;
  DOM.networkSelect.addEventListener('change', (e) => {
    currentNetwork = e.target.value;
    localStorage.setItem('asdf-network', currentNetwork);
    reconnectWebSocket();
    fetchAllData();
  });

  DOM.btnRefresh.addEventListener('click', () => {
    DOM.btnRefresh.disabled = true;
    fetchAllData().finally(() => {
      DOM.btnRefresh.disabled = false;
    });
  });

  DOM.btnFlush.addEventListener('click', () => {
    DOM.modalPending.textContent = `${currentPendingSol.toFixed(6)} SOL`;
    DOM.flushModal.classList.remove('hidden');
  });

  DOM.btnCancelFlush.addEventListener('click', () => {
    DOM.flushModal.classList.add('hidden');
  });

  DOM.btnConfirmFlush.addEventListener('click', () => {
    DOM.flushModal.classList.add('hidden');
    executeFlush();
  });
}

function updateUrlDisplay() {
  const config = CONFIG[currentNetwork];
  DOM.apiUrl.textContent = config.api;
  DOM.wsUrl.textContent = config.ws;
}

function startDashboard() {
  connectWebSocket();
  fetchAllData();
  refreshInterval = setInterval(fetchAllData, 10000);
}

// ============================================================
// API CALLS
// ============================================================

async function fetchJSON(endpoint) {
  try {
    const response = await fetch(`${CONFIG[currentNetwork].api}${endpoint}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`API error ${endpoint}:`, error.message);
    return null;
  }
}

async function postJSON(endpoint, data = {}) {
  try {
    const response = await fetch(`${CONFIG[currentNetwork].api}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return await response.json();
  } catch (error) {
    console.error(`API POST error ${endpoint}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function fetchAllData() {
  updateConnectionStatus(true);
  await Promise.all([
    fetchHealth(),
    fetchFees(),
    fetchTreasury(),
    fetchRebatePool(),
    fetchBurns(),
  ]);
}

async function fetchHealth() {
  const data = await fetchJSON('/health');
  if (!data) {
    DOM.daemonHealthBadge.textContent = 'OFFLINE';
    DOM.daemonHealthBadge.className = 'badge badge-danger';
    updateConnectionStatus(false);
    return;
  }

  // Status badge
  const status = data.status;
  DOM.daemonHealthBadge.textContent = status.toUpperCase();
  DOM.daemonHealthBadge.className = `badge badge-${status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'danger'}`;

  // Parse uptime from details
  if (data.details?.daemon_running) {
    const match = data.details.daemon_running.match(/Uptime: (\d+)s/);
    if (match) {
      DOM.daemonUptime.textContent = formatDuration(parseInt(match[1]) * 1000);
    }
  }
}

async function fetchFees() {
  const data = await fetchJSON('/fees');
  if (!data) return;

  // Totals
  currentPendingSol = data.totals.pendingSOL;
  DOM.totalPendingSol.textContent = currentPendingSol.toFixed(6);
  DOM.tokensCount.textContent = data.totals.tokenCount;
  DOM.totalLamports.textContent = formatNumber(data.totals.pendingLamports);

  // Daemon stats
  DOM.pollCount.textContent = data.daemon.pollCount;
  DOM.errorRate.textContent = `${(data.daemon.errorRate * 100).toFixed(1)}%`;
  DOM.lastPoll.textContent = formatTimeAgo(data.daemon.lastPollMs);

  // Token list
  renderTokenList(data.tokens);
}

async function fetchTreasury() {
  const data = await fetchJSON('/treasury');
  if (!data) return;

  if (data.treasury?.initialized) {
    DOM.treasuryBalance.textContent = `${data.treasury.balance.sol.toFixed(4)} SOL`;
  } else {
    DOM.treasuryBalance.textContent = 'Not init';
  }
}

async function fetchRebatePool() {
  const data = await fetchJSON('/rebate-pool');
  if (!data || data.error) {
    DOM.rebateBalance.textContent = 'Error';
    return;
  }

  DOM.rebateBalance.textContent = `${data.balance.sol.toFixed(4)} SOL`;

  if (data.stats) {
    DOM.rebatesCount.textContent = data.stats.rebatesCount;
    DOM.rebateRecipients.textContent = data.stats.uniqueRecipients;
  } else {
    DOM.rebatesCount.textContent = '0';
    DOM.rebateRecipients.textContent = '0';
  }
}

async function fetchBurns() {
  const data = await fetchJSON('/burns?limit=20');
  if (!data) return;

  const burns = data.recentBurns || [];

  // Update Hero stats
  if (DOM.burnsCount) {
    DOM.burnsCount.textContent = data.totalBurns || 0;
  }

  // Calculate burns in last hour and 24 hours
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  const oneDayAgo = now - (24 * 60 * 60 * 1000);

  let burns1h = 0;
  let burns24h = 0;
  let totalBurned = 0;

  burns.forEach(burn => {
    const amount = burn.amount || 0;
    totalBurned += amount;
    if (burn.timestamp >= oneHourAgo) burns1h += amount;
    if (burn.timestamp >= oneDayAgo) burns24h += amount;
  });

  if (DOM.totalBurned) {
    DOM.totalBurned.textContent = formatNumber(totalBurned);
  }
  if (DOM.burns24h) {
    DOM.burns24h.textContent = formatNumber(burns24h);
  }
  if (DOM.burns1h) {
    DOM.burns1h.textContent = formatNumber(burns1h);
  }

  renderBurnsList(burns);
}

async function executeFlush() {
  DOM.btnFlush.disabled = true;
  showActionResult('Flushing...', 'pending');

  const result = await postJSON('/flush');

  if (result.success) {
    showActionResult(`Flush complete! ${result.tokensUpdated || 0} tokens updated.`, 'success');
    setTimeout(fetchAllData, 2000);
  } else {
    showActionResult(`Flush failed: ${result.error}`, 'error');
  }

  DOM.btnFlush.disabled = false;
}

// ============================================================
// RENDERING
// ============================================================

function renderTokenList(tokens) {
  // Update token count in header
  const countEl = $('token-list-count');
  if (countEl) countEl.textContent = tokens?.length || 0;

  if (!tokens || tokens.length === 0) {
    DOM.tokenList.innerHTML = '<div class="empty-state">No tokens</div>';
    return;
  }

  const config = CONFIG[currentNetwork];
  const html = tokens.map(token => {
    const isRoot = token.isRoot || ROOT_SYMBOLS.includes(token.symbol);
    const hasFees = token.pendingLamports > 0;
    const mintShort = `${token.mint.slice(0, 4)}...${token.mint.slice(-4)}`;
    const solscanUrl = `${config.solscan}/account/${token.mint}${config.solscanSuffix}`;
    // Use name if available, otherwise show symbol
    const displayName = token.name || token.symbol;

    return `
      <div class="token-item ${hasFees ? 'has-fees' : ''} ${isRoot ? 'is-root' : ''}">
        <div class="token-info">
          <div class="token-symbol ${isRoot ? 'root' : ''}">${token.symbol}</div>
          <a href="${solscanUrl}" target="_blank" class="token-mint" title="${token.mint}">${mintShort}</a>
        </div>
        <div class="token-name" title="${displayName}">${displayName}</div>
        <div class="token-fees">
          <div class="token-fees-value">${token.pendingSOL.toFixed(6)}</div>
          <div class="token-fees-label">SOL pending</div>
        </div>
      </div>
    `;
  }).join('');

  DOM.tokenList.innerHTML = html;
}

function renderBurnsList(burns) {
  if (!burns || burns.length === 0) {
    DOM.burnsList.innerHTML = '<div class="empty-state">No burns recorded yet</div>';
    return;
  }

  const config = CONFIG[currentNetwork];
  const html = burns.map(burn => {
    const timeAgo = burn.timestamp ? formatTimeAgo(Date.now() - burn.timestamp) : '--';
    const amount = formatNumber(burn.amount || 0);
    // Use txSignature (from API) or signature (fallback)
    const sig = burn.txSignature || burn.signature;
    const txUrl = sig ? `${config.solscan}/tx/${sig}${config.solscanSuffix}` : null;
    const symbol = burn.tokenSymbol || burn.symbol || 'tokens';

    return `
      <div class="burn-item">
        <span class="burn-time">${timeAgo}</span>
        <span class="burn-amount">🔥 ${amount} ${symbol}</span>
        ${txUrl ? `<a href="${txUrl}" target="_blank" class="burn-link">Solscan →</a>` : ''}
      </div>
    `;
  }).join('');

  DOM.burnsList.innerHTML = html;
}

function showActionResult(message, type) {
  DOM.actionResult.textContent = message;
  DOM.actionResult.className = `action-result ${type}`;
  DOM.actionResult.classList.remove('hidden');

  if (type !== 'pending') {
    setTimeout(() => {
      DOM.actionResult.classList.add('hidden');
    }, 5000);
  }
}

// ============================================================
// WEBSOCKET
// ============================================================

function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  const wsUrl = CONFIG[currentNetwork].ws;

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    console.error('WebSocket creation failed:', e);
    updateWsStatus(false);
    return;
  }

  ws.onopen = () => {
    console.log('WebSocket connected');
    reconnectAttempts = 0;
    updateWsStatus(true);
    ws.send(JSON.stringify({ action: 'subscribe', channel: 'all' }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch (e) {
      console.error('WS message parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    updateWsStatus(false);
    scheduleReconnect();
  };

  ws.onerror = (error) => {
    console.error('WebSocket error');
    updateWsStatus(false);
  };
}

function handleWsMessage(data) {
  switch (data.type) {
    case 'welcome':
      if (data.currentState) {
        updateFromWs(data.currentState);
      }
      break;
    case 'fees':
      updateFromWs(data);
      break;
  }
}

function updateFromWs(data) {
  if (data.totals) {
    currentPendingSol = data.totals.pendingSOL;
    DOM.totalPendingSol.textContent = currentPendingSol.toFixed(6);
    DOM.tokensCount.textContent = data.totals.tokenCount;
    DOM.totalLamports.textContent = formatNumber(data.totals.pendingLamports);
  }
  if (data.daemon) {
    DOM.pollCount.textContent = data.daemon.pollCount;
    DOM.lastPoll.textContent = formatTimeAgo(data.daemon.lastPollMs);
  }
  if (data.tokens) {
    renderTokenList(data.tokens);
  }
}

function scheduleReconnect() {
  if (reconnectAttempts >= 10) return;
  const delay = 1000 * Math.pow(2, reconnectAttempts);
  reconnectAttempts++;
  setTimeout(connectWebSocket, delay);
}

function reconnectWebSocket() {
  reconnectAttempts = 0;
  updateUrlDisplay();
  connectWebSocket();
}

function updateWsStatus(connected) {
  DOM.wsIndicator.className = `ws-dot ${connected ? 'connected' : 'disconnected'}`;
  DOM.wsStatusText.textContent = `WebSocket: ${connected ? 'Connected' : 'Disconnected'}`;
}

function updateConnectionStatus(connected) {
  DOM.connectionStatus.textContent = connected ? '● Connected' : '● Disconnected';
  DOM.connectionStatus.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
}

// ============================================================
// UTILITIES
// ============================================================

function formatNumber(num) {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatTimeAgo(ms) {
  if (!ms || ms < 0) return '--';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Heartbeat
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'ping' }));
  }
}, 30000);

// ============================================================
// REAL CONTROL PANEL - Execute actual scripts on devnet
// ============================================================

// Control Panel State
let devnetTokens = [];
let selectedToken = null;
let workflowRunning = false;

// Cache control panel DOM elements
function cacheControlPanelDom() {
  DOM.testPanel = $('test-panel');
  DOM.btnToggleTest = $('btn-toggle-test');
  DOM.testLog = $('test-log');
  DOM.ctrlTokenSelect = $('ctrl-token-select');
  DOM.ctrlWalletBalance = $('ctrl-wallet-balance');
  DOM.ctrlVaultBalance = $('ctrl-vault-balance');
  DOM.ctrlFeesVault = $('ctrl-fees-vault');
  DOM.ctrlFeesStatus = $('ctrl-fees-status');
  DOM.workflowProgress = $('workflow-progress');
  DOM.workflowProgressText = $('workflow-progress-text');
}

// Setup control panel event listeners
function setupControlPanelListeners() {
  // Toggle panel
  DOM.btnToggleTest?.addEventListener('click', toggleTestPanel);

  // Token selection
  $('btn-refresh-tokens')?.addEventListener('click', loadDevnetTokens);
  DOM.ctrlTokenSelect?.addEventListener('change', onTokenSelected);

  // Volume controls
  $('btn-gen-volume')?.addEventListener('click', generateVolume);
  $('btn-sell')?.addEventListener('click', sellTokens);

  // Cycle controls
  $('btn-sync-fees')?.addEventListener('click', syncFees);
  $('btn-cycle')?.addEventListener('click', executeCycle);
  $('btn-check-fees')?.addEventListener('click', checkFees);

  // Create Token
  $('btn-create-token')?.addEventListener('click', createToken);

  // E2E Workflow
  $('btn-run-workflow')?.addEventListener('click', runRealWorkflow);
}

// Initialize control panel
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    cacheControlPanelDom();
    setupControlPanelListeners();
    loadDevnetTokens();
    loadWalletBalance();
  }, 100);
});

// ============================================================
// CONTROL PANEL UTILITIES
// ============================================================

function toggleTestPanel() {
  const isCollapsed = DOM.testPanel?.classList.toggle('collapsed');
  if (DOM.btnToggleTest) {
    DOM.btnToggleTest.textContent = isCollapsed ? 'Expand' : 'Collapse';
  }
}

function testLog(message, type = 'info') {
  if (!DOM.testLog) return;
  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `test-log-entry ${type}`;
  entry.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${message}`;
  DOM.testLog.appendChild(entry);
  DOM.testLog.scrollTop = DOM.testLog.scrollHeight;

  // Keep only last 100 entries
  while (DOM.testLog.children.length > 100) {
    DOM.testLog.removeChild(DOM.testLog.firstChild);
  }
}

function updateWorkflowStep(step, status, statusText = null) {
  const stepEl = document.querySelector(`.workflow-step[data-step="${step}"]`);
  if (!stepEl) return;

  stepEl.classList.remove('active', 'completed', 'error');
  if (status === 'active') stepEl.classList.add('active');
  if (status === 'completed') stepEl.classList.add('completed');
  if (status === 'error') stepEl.classList.add('error');

  const statusEl = stepEl.querySelector('.workflow-step-status');
  if (statusEl && statusText) {
    statusEl.textContent = statusText;
  }
}

function resetWorkflowSteps() {
  for (let i = 1; i <= 4; i++) {
    updateWorkflowStep(i, 'pending', 'pending');
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// REAL TOKEN & WALLET OPERATIONS
// ============================================================

async function loadDevnetTokens() {
  testLog('Loading devnet tokens...');
  try {
    const result = await fetchJSON('/control/tokens');
    if (result.success) {
      devnetTokens = result.tokens || [];
      updateDevnetTokenSelect();
      testLog(`Loaded ${devnetTokens.length} devnet tokens`, 'success');
    } else {
      testLog(`Failed to load tokens: ${result.error}`, 'error');
    }
  } catch (e) {
    testLog(`Error loading tokens: ${e.message}`, 'error');
  }
}

function updateDevnetTokenSelect() {
  if (!DOM.ctrlTokenSelect) return;
  DOM.ctrlTokenSelect.innerHTML = '<option value="">Select token...</option>';
  devnetTokens.forEach(t => {
    const option = document.createElement('option');
    // Use _file if available, otherwise use mint address
    option.value = t._file || t.mint || `${t.symbol.toLowerCase()}.json`;
    // Store mint in dataset for direct access
    option.dataset.mint = t.mint || '';
    option.dataset.fromDaemon = t._fromDaemon ? 'true' : 'false';
    const mintShort = t.mint ? `${t.mint.slice(0, 4)}...` : '';
    option.textContent = `${t.symbol} ${t.isRoot ? '(ROOT)' : ''} - ${t.name || mintShort}`;
    DOM.ctrlTokenSelect.appendChild(option);
  });
}

function onTokenSelected() {
  const tokenFile = DOM.ctrlTokenSelect?.value;
  if (!tokenFile) {
    selectedToken = null;
    return;
  }
  selectedToken = devnetTokens.find(t => t._file === tokenFile);
  testLog(`Selected: ${selectedToken?.symbol || tokenFile}`);
  checkFees();
}

async function loadWalletBalance() {
  try {
    const result = await fetchJSON('/control/wallet');
    if (result.success && DOM.ctrlWalletBalance) {
      DOM.ctrlWalletBalance.textContent = `${result.wallet.balance.toFixed(4)} SOL`;
    }
  } catch (e) {
    console.error('Failed to load wallet:', e);
  }
}

// ============================================================
// REAL SCRIPT OPERATIONS
// ============================================================

async function createToken() {
  const nameInput = $('create-token-name');
  const symbolInput = $('create-token-symbol');
  const isRootCheckbox = $('create-token-root');
  const mayhemCheckbox = $('create-token-mayhem');
  const createBtn = $('btn-create-token');
  const resultDiv = $('create-token-result');
  const successDiv = $('create-result-success');
  const errorDiv = $('create-result-error');
  const successText = $('create-result-text');
  const errorText = $('create-error-text');

  const name = nameInput?.value?.trim();
  const symbol = symbolInput?.value?.trim()?.toUpperCase();
  const isRoot = isRootCheckbox?.checked || false;
  const mayhemMode = mayhemCheckbox?.checked || false;

  // Validation
  if (!name && !mayhemMode) {
    testLog('Token name required (or enable Mayhem Mode)', 'warning');
    return;
  }
  if (!symbol && !mayhemMode) {
    testLog('Token symbol required (or enable Mayhem Mode)', 'warning');
    return;
  }

  // Generate random name/symbol in mayhem mode
  let tokenName = name;
  let tokenSymbol = symbol;
  if (mayhemMode) {
    const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
    tokenName = tokenName || `Mayhem ${randomStr}`;
    tokenSymbol = tokenSymbol || randomStr;
  }

  testLog(`Creating token: ${tokenName} (${tokenSymbol})${isRoot ? ' [ROOT]' : ''}${mayhemMode ? ' [MAYHEM]' : ''}...`, 'info');

  // Disable button
  if (createBtn) createBtn.disabled = true;

  // Hide previous results
  resultDiv?.classList.remove('hidden');
  successDiv?.classList.add('hidden');
  errorDiv?.classList.add('hidden');

  try {
    const result = await postJSON('/control/create-token', {
      name: tokenName,
      symbol: tokenSymbol,
      isRoot,
      mayhemMode,
    });

    if (result.success) {
      testLog(`Token created successfully!`, 'success');
      testLog(`Mint: ${result.token?.mint || 'Unknown'}`, 'success');

      // Show success
      if (successDiv && successText) {
        successText.textContent = `${tokenSymbol} created! Mint: ${(result.token?.mint || '').slice(0, 8)}...`;
        successDiv.classList.remove('hidden');
      }

      // Clear inputs
      if (nameInput) nameInput.value = '';
      if (symbolInput) symbolInput.value = '';
      if (isRootCheckbox) isRootCheckbox.checked = false;
      if (mayhemCheckbox) mayhemCheckbox.checked = false;

      // Refresh token list
      await loadDevnetTokens();
    } else {
      testLog(`Token creation failed: ${result.error || 'Unknown error'}`, 'error');

      // Show error
      if (errorDiv && errorText) {
        errorText.textContent = result.error || 'Token creation failed';
        errorDiv.classList.remove('hidden');
      }
    }
  } catch (e) {
    testLog(`Error: ${e.message}`, 'error');
    if (errorDiv && errorText) {
      errorText.textContent = e.message;
      errorDiv.classList.remove('hidden');
    }
  } finally {
    if (createBtn) createBtn.disabled = false;
  }
}

async function generateVolume() {
  const tokenFile = DOM.ctrlTokenSelect?.value;
  if (!tokenFile) {
    testLog('Please select a token first', 'warning');
    return;
  }

  const numBuys = parseInt($('ctrl-buy-rounds')?.value || '2');
  const buyAmount = parseFloat($('ctrl-buy-amount')?.value || '0.5');

  testLog(`Generating volume: ${numBuys}x ${buyAmount} SOL buys...`, 'info');
  disableControls(true);

  try {
    const result = await postJSON('/control/volume', {
      tokenFile,
      numBuys,
      buyAmount,
    });

    if (result.success) {
      testLog('Volume generation complete!', 'success');
      // Parse output for details
      const matches = result.output?.match(/Successful buys: (\d+)/);
      if (matches) {
        testLog(`Successful buys: ${matches[1]}`, 'success');
      }
    } else {
      testLog(`Volume generation failed: ${result.error || 'Unknown error'}`, 'error');
    }
  } catch (e) {
    testLog(`Error: ${e.message}`, 'error');
  } finally {
    disableControls(false);
    loadWalletBalance();
    checkFees();
  }
}

async function sellTokens() {
  const tokenFile = DOM.ctrlTokenSelect?.value;
  if (!tokenFile) {
    testLog('Please select a token first', 'warning');
    return;
  }

  testLog('Selling tokens...', 'info');
  disableControls(true);

  try {
    const result = await postJSON('/control/sell', { tokenFile });

    if (result.success) {
      testLog('Sell complete!', 'success');
    } else {
      testLog(`Sell failed: ${result.error || 'Unknown error'}`, 'error');
    }
  } catch (e) {
    testLog(`Error: ${e.message}`, 'error');
  } finally {
    disableControls(false);
    loadWalletBalance();
    checkFees();
  }
}

async function syncFees() {
  const tokenFile = DOM.ctrlTokenSelect?.value;

  testLog('Syncing fees...', 'info');
  disableControls(true);

  try {
    const result = await postJSON('/control/sync-fees', {
      tokenFile,
      network: 'devnet',
    });

    if (result.success) {
      testLog('Fees synced successfully!', 'success');
      // Update cycle info
      const cycleInfo = document.getElementById('cycle-info');
      if (cycleInfo) {
        cycleInfo.innerHTML = '<span class="cycle-info-text" style="color: var(--success);">Fees synced. Ready for burn cycle.</span>';
      }
    } else {
      testLog(`Sync failed: ${result.error || 'Unknown error'}`, 'error');
    }
  } catch (e) {
    testLog(`Error: ${e.message}`, 'error');
  } finally {
    disableControls(false);
    checkFees();
    fetchAllData();
  }
}

async function executeCycle() {
  const tokenFile = DOM.ctrlTokenSelect?.value;
  if (!tokenFile) {
    testLog('Please select a token first', 'warning');
    return;
  }

  testLog('Executing burn cycle...', 'info');
  disableControls(true);

  try {
    const result = await postJSON('/control/cycle', {
      tokenFile,
      network: 'devnet',
    });

    if (result.success) {
      testLog('Burn cycle complete!', 'success');
      // Parse output for burn details
      if (result.output) {
        const burnMatch = result.output.match(/Burned: ([\d,]+)/);
        if (burnMatch) {
          testLog(`Tokens burned: ${burnMatch[1]}`, 'success');
        }
      }
    } else {
      testLog(`Cycle failed: ${result.error || 'Unknown error'}`, 'error');
    }
  } catch (e) {
    testLog(`Error: ${e.message}`, 'error');
  } finally {
    disableControls(false);
    loadWalletBalance();
    checkFees();
    fetchAllData();
  }
}

async function checkFees() {
  if (!selectedToken) return;

  try {
    const result = await fetchJSON(`/control/fees?creator=${selectedToken.creator}`);

    if (result.success) {
      if (DOM.ctrlFeesVault) {
        DOM.ctrlFeesVault.textContent = `${result.creatorVault.balance.toFixed(6)} SOL`;
      }
      if (DOM.ctrlVaultBalance) {
        DOM.ctrlVaultBalance.textContent = `${result.total.toFixed(6)} SOL`;
      }
      if (DOM.ctrlFeesStatus) {
        const statusColors = {
          excellent: 'var(--success)',
          good: 'var(--success)',
          low: 'var(--warning)',
          insufficient: 'var(--danger)',
        };
        DOM.ctrlFeesStatus.textContent = result.status.toUpperCase();
        DOM.ctrlFeesStatus.style.color = statusColors[result.status] || 'inherit';
      }
    }
  } catch (e) {
    console.error('Failed to check fees:', e);
  }
}

function disableControls(disabled) {
  const buttons = [
    'btn-gen-volume', 'btn-sell', 'btn-cycle',
    'btn-run-workflow', 'btn-check-fees'
  ];
  buttons.forEach(id => {
    const btn = $(id);
    if (btn) btn.disabled = disabled;
  });
}

// ============================================================
// REAL E2E WORKFLOW
// ============================================================

async function runRealWorkflow() {
  const tokenFile = DOM.ctrlTokenSelect?.value;
  if (!tokenFile) {
    testLog('Please select a token first', 'warning');
    return;
  }

  if (workflowRunning) {
    testLog('Workflow already running', 'warning');
    return;
  }

  workflowRunning = true;
  disableControls(true);
  DOM.workflowProgress?.classList.remove('hidden');
  resetWorkflowSteps();

  const cycles = parseInt($('ctrl-buy-rounds')?.value || '2');
  const solPerCycle = parseFloat($('ctrl-buy-amount')?.value || '0.5');

  testLog(`Starting E2E workflow on ${selectedToken?.symbol || tokenFile}...`, 'info');

  try {
    // Step 1: Generate Volume (buy+sell cycles)
    updateWorkflowStep(1, 'active', 'trading...');
    DOM.workflowProgressText.textContent = 'Generating volume...';
    testLog(`Step 1: ${cycles} cycles x ${solPerCycle} SOL (buy+sell)...`);

    const volumeResult = await postJSON('/control/volume', {
      tokenFile,
      numBuys: cycles,
      buyAmount: solPerCycle,
    });

    if (!volumeResult.success) {
      throw new Error(`Volume failed: ${volumeResult.error}`);
    }
    updateWorkflowStep(1, 'completed', 'done');
    testLog('Step 1 complete: Volume generated', 'success');

    // Step 2: Wait for fee detection
    updateWorkflowStep(2, 'active', 'waiting...');
    DOM.workflowProgressText.textContent = 'Waiting for fee detection...';
    testLog('Step 2: Waiting 5s for daemon...');

    for (let i = 5; i > 0; i--) {
      updateWorkflowStep(2, 'active', `${i}s...`);
      await sleep(1000);
    }
    await checkFees();
    updateWorkflowStep(2, 'completed', 'done');
    testLog('Step 2 complete: Fees detected', 'success');

    // Step 3: Execute burn cycle
    updateWorkflowStep(3, 'active', 'burning...');
    DOM.workflowProgressText.textContent = 'Executing burn cycle...';
    testLog('Step 3: Executing burn cycle...');

    const cycleResult = await postJSON('/control/cycle', {
      tokenFile,
      network: 'devnet',
    });

    if (cycleResult.success) {
      updateWorkflowStep(3, 'completed', 'done');
      testLog('Step 3 complete: Burn executed!', 'success');
    } else {
      updateWorkflowStep(3, 'error', 'failed');
      testLog(`Step 3 failed: ${cycleResult.error}`, 'error');
    }

    testLog('========================================', 'success');
    testLog('E2E COMPLETE! 🔥', 'success');
    testLog('========================================', 'success');

  } catch (e) {
    testLog(`Workflow error: ${e.message}`, 'error');
  } finally {
    workflowRunning = false;
    disableControls(false);
    DOM.workflowProgress?.classList.add('hidden');
    loadWalletBalance();
    checkFees();
    fetchAllData();
  }
}

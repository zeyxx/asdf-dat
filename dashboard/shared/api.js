/**
 * ASDF API Client
 * Wrapper for all API calls to the daemon
 */

const API = {
  // ============================================================
  // CORE FETCH
  // ============================================================

  async fetch(endpoint, options = {}) {
    const config = window.ASDF_CONFIG.getConfig();
    const url = `${config.api}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API error [${endpoint}]:`, error.message);
      throw error;
    }
  },

  async post(endpoint, data = {}) {
    return this.fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // ============================================================
  // DASHBOARD ENDPOINTS (read-only)
  // ============================================================

  async getHealth() {
    return this.fetch('/health');
  },

  async getFees() {
    return this.fetch('/fees');
  },

  async getTokens() {
    return this.fetch('/tokens');
  },

  async getBurns(limit = 20) {
    return this.fetch(`/burns?limit=${limit}`);
  },

  async getTreasury() {
    return this.fetch('/treasury');
  },

  async getRebatePool() {
    return this.fetch('/rebate-pool');
  },

  async getCycleStatus() {
    return this.fetch('/cycle/status');
  },

  // ============================================================
  // ADMIN ENDPOINTS (write)
  // ============================================================

  async flush() {
    return this.post('/flush');
  },

  async triggerCycle() {
    return this.post('/cycle');
  },

  // ============================================================
  // CONTROL PANEL ENDPOINTS
  // ============================================================

  async getDevnetTokens() {
    return this.fetch('/control/tokens');
  },

  async getWalletBalance() {
    return this.fetch('/control/wallet');
  },

  async getCreatorFees(creator, rootMint) {
    let url = `/control/fees?creator=${creator}`;
    if (rootMint) url += `&rootMint=${rootMint}`;
    return this.fetch(url);
  },

  async generateVolume(tokenFile, rounds = 2, solPerBuy = 0.5) {
    return this.post('/control/volume', {
      tokenFile,
      rounds,
      solPerBuy,
    });
  },

  async sellTokens(tokenFile) {
    return this.post('/control/sell', { tokenFile });
  },

  async executeCycle(tokenFile, network = 'devnet') {
    return this.post('/control/cycle', { tokenFile, network });
  },

  async createToken(name, symbol, isRoot = false) {
    return this.post('/control/create-token', { name, symbol, isRoot });
  },

  async initTokenStats(tokenFile) {
    return this.post('/control/init-token-stats', { tokenFile });
  },

  async setRootToken(tokenFile) {
    return this.post('/control/set-root-token', { tokenFile });
  },

  async syncFees(tokenFile, network = 'devnet') {
    return this.post('/control/sync-fees', { tokenFile, network });
  },

  async runWorkflow(tokenFile, cycles = 1, solPerCycle = 1) {
    return this.post('/control/workflow', { tokenFile, cycles, solPerCycle });
  },
};

// Export
window.ASDF_API = API;

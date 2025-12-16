/**
 * ASDF Dashboard Configuration
 * Auto-detects Codespaces vs local environment
 */

function getBaseUrls() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  // GitHub Codespaces detection
  if (hostname.includes('.app.github.dev')) {
    // Format: CODESPACE_NAME-PORT.app.github.dev
    // Extract base name by removing the port suffix
    const match = hostname.match(/^(.+)-(\d+)\.app\.github\.dev$/);
    if (match) {
      const codespaceName = match[1];
      const urls = {
        api: `https://${codespaceName}-3030.app.github.dev`,
        ws: `wss://${codespaceName}-3031.app.github.dev`,
      };
      console.log('[Config] Codespaces detected:', { hostname, codespaceName, urls });
      return urls;
    }
  }

  // Local development
  const urls = {
    api: 'http://localhost:3030',
    ws: 'ws://localhost:3031',
  };
  console.log('[Config] Local mode:', urls);
  return urls;
}

const BASE_URLS = getBaseUrls();

const CONFIG = {
  devnet: {
    api: BASE_URLS.api,
    ws: BASE_URLS.ws,
    solscan: 'https://solscan.io',
    solscanSuffix: '?cluster=devnet',
    name: 'Devnet',
  },
  mainnet: {
    api: BASE_URLS.api,
    ws: BASE_URLS.ws,
    solscan: 'https://solscan.io',
    solscanSuffix: '',
    name: 'Mainnet',
  }
};

// Polling intervals (ms)
const INTERVALS = {
  health: 10000,      // 10s
  fees: 5000,         // 5s
  burns: 30000,       // 30s
  treasury: 30000,    // 30s
};

// Get current network from localStorage or default to devnet
function getCurrentNetwork() {
  return localStorage.getItem('asdf-network') || 'devnet';
}

function setCurrentNetwork(network) {
  localStorage.setItem('asdf-network', network);
}

function getConfig() {
  return CONFIG[getCurrentNetwork()];
}

// Export for use in other modules
window.ASDF_CONFIG = {
  CONFIG,
  INTERVALS,
  getCurrentNetwork,
  setCurrentNetwork,
  getConfig,
  getBaseUrls,
};

/**
 * ASDF Dashboard Utilities
 * Formatters, helpers, and common functions
 */

const Utils = {
  // ============================================================
  // NUMBER FORMATTING
  // ============================================================

  formatSOL(lamports, decimals = 6) {
    if (lamports === null || lamports === undefined) return '--';
    const sol = Number(lamports) / 1e9;
    return sol.toFixed(decimals);
  },

  formatTokens(amount, decimals = 0) {
    if (amount === null || amount === undefined) return '--';
    const num = Number(amount);
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(decimals);
  },

  formatLamports(lamports) {
    if (lamports === null || lamports === undefined) return '--';
    return Number(lamports).toLocaleString();
  },

  formatPercent(value, decimals = 2) {
    if (value === null || value === undefined) return '--';
    return `${(Number(value) * 100).toFixed(decimals)}%`;
  },

  // ============================================================
  // TIME FORMATTING
  // ============================================================

  formatUptime(ms) {
    if (!ms) return '--';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  },

  formatTimeAgo(timestamp) {
    if (!timestamp) return '--';
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    if (seconds > 0) return `${seconds}s ago`;
    return 'just now';
  },

  formatTimestamp(timestamp) {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    return date.toLocaleString();
  },

  // ============================================================
  // ADDRESS FORMATTING
  // ============================================================

  shortenAddress(address, chars = 4) {
    if (!address) return '--';
    if (address.length <= chars * 2 + 3) return address;
    return `${address.slice(0, chars)}...${address.slice(-chars)}`;
  },

  // ============================================================
  // SOLSCAN LINKS
  // ============================================================

  getSolscanTxUrl(signature) {
    const config = window.ASDF_CONFIG.getConfig();
    return `${config.solscan}/tx/${signature}${config.solscanSuffix}`;
  },

  getSolscanAccountUrl(address) {
    const config = window.ASDF_CONFIG.getConfig();
    return `${config.solscan}/account/${address}${config.solscanSuffix}`;
  },

  getSolscanTokenUrl(mint) {
    const config = window.ASDF_CONFIG.getConfig();
    return `${config.solscan}/token/${mint}${config.solscanSuffix}`;
  },

  // ============================================================
  // DOM HELPERS
  // ============================================================

  $(id) {
    return document.getElementById(id);
  },

  $$(selector) {
    return document.querySelectorAll(selector);
  },

  createElement(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'className') {
        el.className = value;
      } else if (key === 'textContent') {
        el.textContent = value;
      } else if (key === 'innerHTML') {
        el.innerHTML = value;
      } else if (key.startsWith('on')) {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        el.setAttribute(key, value);
      }
    });
    children.forEach(child => {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else if (child) {
        el.appendChild(child);
      }
    });
    return el;
  },

  // ============================================================
  // STATE HELPERS
  // ============================================================

  debounce(fn, delay) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  },

  throttle(fn, limit) {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        fn(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  // ============================================================
  // STATUS HELPERS
  // ============================================================

  getHealthBadge(status) {
    const badges = {
      healthy: { text: 'HEALTHY', class: 'badge-success' },
      degraded: { text: 'DEGRADED', class: 'badge-warning' },
      unhealthy: { text: 'OFFLINE', class: 'badge-danger' },
    };
    return badges[status] || badges.unhealthy;
  },

  getStatusDot(isConnected) {
    return isConnected ? '🟢' : '🔴';
  },
};

// Export
window.ASDF_UTILS = Utils;

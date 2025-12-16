/**
 * ASDF WebSocket Client
 * Real-time updates from daemon
 */

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 2000;
    this.listeners = new Map();
    this.isConnected = false;
  }

  connect() {
    const config = window.ASDF_CONFIG.getConfig();
    console.log('[WS] Attempting connection to:', config.ws);

    try {
      this.ws = new WebSocket(config.ws);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this.isConnected = false;
        this.emit('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        console.error('[WS] ReadyState:', this.ws?.readyState);
        console.error('[WS] URL was:', config.ws);
        this.emit('error', error);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('[WS] Parse error:', error);
        }
      };
    } catch (error) {
      console.error('[WS] Connection failed:', error);
      this.scheduleReconnect();
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  reconnect() {
    this.disconnect();
    this.connect();
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

    console.log(`[WS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, delay);
  }

  handleMessage(data) {
    const { type, ...payload } = data;

    switch (type) {
      case 'welcome':
        console.log('[WS] Welcome:', payload);
        break;

      case 'fees':
        this.emit('fees', payload.data);
        break;

      case 'burn':
        this.emit('burn', payload.data);
        break;

      case 'cycle_start':
        this.emit('cycle_start', payload.data);
        break;

      case 'cycle_complete':
        this.emit('cycle_complete', payload.data);
        break;

      case 'token_discovered':
        this.emit('token_discovered', payload.data);
        break;

      case 'error':
        console.error('[WS] Server error:', payload);
        this.emit('server_error', payload);
        break;

      default:
        console.log('[WS] Unknown message:', type, payload);
    }
  }

  // Event emitter pattern
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    }
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(data);
        } catch (error) {
          console.error(`[WS] Listener error for ${event}:`, error);
        }
      });
    }
  }

  getStatus() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// Singleton instance
window.ASDF_WS = new WebSocketClient();

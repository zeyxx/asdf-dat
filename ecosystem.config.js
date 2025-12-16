/**
 * PM2 Ecosystem Configuration for ASDF Burn Engine
 *
 * Production deployment configuration with auto-restart, logging, and monitoring.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save                    # Save process list
 *   pm2 startup                 # Generate startup script
 *   pm2 logs asdf-daemon        # View logs
 *   pm2 monit                   # Real-time monitoring
 *
 * Health check: http://localhost:3030/health
 */

module.exports = {
  apps: [
    {
      // Main daemon - fee tracking and auto-cycle execution
      name: 'asdf-daemon',
      script: 'npm',
      args: 'run daemon -- --creator $CREATOR --network $NETWORK --helius-key $HELIUS_API_KEY',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',

      // Environment variables
      env_production: {
        NODE_ENV: 'production',
        NETWORK: 'mainnet',
      },
      env_devnet: {
        NODE_ENV: 'development',
        NETWORK: 'devnet',
      },

      // Restart strategy
      min_uptime: '30s',              // Minimum uptime before considering stable
      max_restarts: 10,                // Max restarts within 1 minute
      restart_delay: 5000,             // 5 seconds between restarts
      kill_timeout: 30000,             // 30 seconds for graceful shutdown

      // Logging
      error_file: './logs/daemon-error.log',
      out_file: './logs/daemon-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Additional options
      listen_timeout: 10000,           // Wait 10s for app to be ready
      shutdown_with_message: true,
    },
  ],
};

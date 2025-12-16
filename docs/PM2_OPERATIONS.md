# PM2 Operations Guide

Production deployment guide for ASDF Burn Engine using PM2 process manager.

## Prerequisites

### 1. Install PM2 Globally
```bash
npm install -g pm2
```

### 2. Configure Environment
```bash
# Copy template
cp .env.template .env

# Edit .env with your values
nano .env

# Required variables:
# - CREATOR: Your creator wallet public key
# - HELIUS_API_KEY: Helius RPC API key (mainnet)
# - Network-specific wallet files present
```

### 3. Compile TypeScript
```bash
npm run build
```

## Quick Start

### Start Daemon (Devnet)
```bash
./scripts/ops/pm2-start.sh devnet
```

### Start Daemon (Mainnet)
```bash
./scripts/ops/pm2-start.sh mainnet
```

### Check Status
```bash
./scripts/ops/pm2-status.sh
```

### View Logs
```bash
./scripts/ops/pm2-logs.sh
```

### Stop Daemon
```bash
./scripts/ops/pm2-stop.sh
```

## Manual PM2 Commands

### Process Management
```bash
# Start
pm2 start ecosystem.config.js --env devnet
pm2 start ecosystem.config.js --env production  # mainnet

# Stop
pm2 stop asdf-daemon

# Restart
pm2 restart asdf-daemon

# Delete (remove from PM2)
pm2 delete asdf-daemon

# View all processes
pm2 list
```

### Logs
```bash
# Stream live logs
pm2 logs asdf-daemon

# Last 100 lines
pm2 logs asdf-daemon --lines 100

# No streaming (exit after showing logs)
pm2 logs asdf-daemon --lines 50 --nostream

# Error logs only
pm2 logs asdf-daemon --err

# Clear logs
pm2 flush asdf-daemon
```

### Monitoring
```bash
# Real-time monitoring dashboard
pm2 monit

# Process details
pm2 show asdf-daemon

# Process status
pm2 status
```

### Save Process List
```bash
# Save current process list (survives reboots)
pm2 save

# Delete saved process list
pm2 delete all
pm2 save
```

## Auto-Start on System Boot

### Generate Startup Script
```bash
# Generate system-specific startup script
pm2 startup

# This will output a command like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

# Run the output command with sudo
```

### Verify Auto-Start
```bash
# Save current processes
pm2 save

# Reboot and check
sudo reboot

# After reboot
pm2 list  # Should show asdf-daemon
```

### Remove Auto-Start
```bash
pm2 unstartup
```

## Health Checks

### HTTP Health Endpoint
```bash
# Check daemon health
curl http://localhost:3030/health

# Expected response (healthy):
{
  "status": "healthy",
  "uptime": 123456,
  "network": "devnet",
  "tokens": 3,
  "rpc": {
    "connected": true,
    "latencyMs": 45,
    "errorRate": 0.001
  }
}

# Unhealthy returns 503 status code
```

### WebSocket Connection
```bash
# Check WebSocket
wscat -c ws://localhost:3031

# Should connect successfully
```

### PM2 Health
```bash
# Check if process is running
pm2 ping asdf-daemon

# Resource usage
pm2 show asdf-daemon | grep -E "(cpu|memory|uptime|restarts)"
```

## Restart Strategies

### Graceful Restart
```bash
# Waits for current operations to complete (30s timeout)
pm2 restart asdf-daemon
```

### Force Restart
```bash
# Immediate kill and restart
pm2 restart asdf-daemon --force
```

### Kill-9 Test (Auto-Restart)
```bash
# Find PID
pm2 show asdf-daemon | grep pid

# Kill
kill -9 <PID>

# PM2 will auto-restart within 5 seconds
pm2 logs asdf-daemon --lines 20
```

## Log Management

### Log Files Location
```
./logs/daemon-error.log  # Error logs
./logs/daemon-out.log    # Standard output logs
```

### Log Rotation (Manual)
```bash
# Rotate logs
pm2 flush asdf-daemon

# Backup old logs
tar -czf logs-backup-$(date +%Y%m%d).tar.gz logs/
rm logs/*.log
```

### Log Rotation (Automated)
```bash
# Install PM2 log rotation module
pm2 install pm2-logrotate

# Configure
pm2 set pm2-logrotate:max_size 100M        # Rotate at 100MB
pm2 set pm2-logrotate:retain 7             # Keep 7 days
pm2 set pm2-logrotate:compress true        # Compress old logs
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
```

## Troubleshooting

### Daemon Won't Start
```bash
# Check environment
cat .env | grep -E "CREATOR|HELIUS"

# Check wallet file
ls -la devnet-wallet.json mainnet-wallet.json

# Check TypeScript compilation
npm run build

# Check PM2 logs
pm2 logs asdf-daemon --lines 50 --err

# Start in verbose mode (edit ecosystem.config.js)
# Add: args: '... --verbose'
```

### High Memory Usage
```bash
# Check current memory
pm2 show asdf-daemon | grep memory

# Restart if needed (clears memory)
pm2 restart asdf-daemon

# Adjust max_memory_restart in ecosystem.config.js
# Default: 1G
```

### High Restart Count
```bash
# Check restart count
pm2 status

# View error logs
pm2 logs asdf-daemon --err --lines 100

# Common causes:
# - Missing environment variables
# - Invalid RPC endpoint
# - Insufficient wallet balance
# - Network connectivity issues
```

### RPC Connection Issues
```bash
# Check RPC health
curl http://localhost:3030/health

# Test RPC directly
curl https://api.devnet.solana.com -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Check failover endpoints in logs
pm2 logs asdf-daemon | grep "RPC"
```

## Production Best Practices

### 1. Environment Separation
```bash
# Use different state files per environment
# devnet: .asdf-state.json (default)
# mainnet: .asdf-state-mainnet.json

# Set via CLI:
npx asdf-dat --state-file .asdf-state-mainnet.json ...
```

### 2. Monitoring
```bash
# Set up external monitoring
# - Health endpoint: http://localhost:3030/health
# - Check every 60 seconds
# - Alert if status != "healthy" for >5 minutes
```

### 3. Backup State
```bash
# Backup daemon state daily
cp .asdf-state.json .asdf-state.backup-$(date +%Y%m%d).json

# Automate with cron
echo "0 2 * * * cd /path/to/asdf-dat && cp .asdf-state.json .asdf-state.backup-\$(date +\%Y\%m\%d).json" | crontab -
```

### 4. Update Procedure
```bash
# 1. Pull latest code
git pull

# 2. Rebuild
npm run build

# 3. Graceful restart
pm2 restart asdf-daemon

# 4. Verify health
sleep 10
curl http://localhost:3030/health
```

### 5. Emergency Stop
```bash
# If daemon is misbehaving
pm2 stop asdf-daemon

# If unresponsive
pm2 kill  # Stops PM2 daemon and all processes

# Restart PM2
pm2 resurrect  # Restore saved process list
```

## Metrics & Analytics

### PM2 Built-in Metrics
```bash
# View metrics
pm2 show asdf-daemon

# Key metrics:
# - uptime
# - restarts
# - CPU %
# - Memory usage
# - Event loop latency
```

### Export Metrics
```bash
# PM2 Plus (paid service)
# https://pm2.io

# Or use custom metrics exporter
# See: src/observability/metrics-exporter.ts
```

## Configuration Reference

### ecosystem.config.js Options
```javascript
{
  name: 'asdf-daemon',           // Process name
  script: 'npm',                 // Command to run
  args: 'run daemon ...',        // Arguments
  instances: 1,                  // Number of instances
  autorestart: true,             // Auto-restart on crash
  watch: false,                  // File watching (dev only)
  max_memory_restart: '1G',      // Restart if memory exceeds
  min_uptime: '30s',             // Minimum uptime to consider stable
  max_restarts: 10,              // Max restarts in 1 minute
  restart_delay: 5000,           // Delay between restarts (ms)
  kill_timeout: 30000,           // Graceful shutdown timeout (ms)
  error_file: './logs/...',      // Error log path
  out_file: './logs/...',        // Output log path
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
}
```

---

**Production Deployment Checklist:**
- [ ] PM2 installed globally
- [ ] Environment variables configured (.env)
- [ ] Wallet files present and funded
- [ ] TypeScript compiled (npm run build)
- [ ] Startup script configured (pm2 startup)
- [ ] Process list saved (pm2 save)
- [ ] Health endpoint responding (curl :3030/health)
- [ ] Logs rotating (pm2 install pm2-logrotate)
- [ ] External monitoring configured
- [ ] State backup automated
- [ ] Update procedure documented

**Emergency Contacts:**
- GitHub Issues: https://github.com/[your-repo]/issues
- Discord: [your-discord-link]

---

*Keep daemon alive. Always.* 🔥

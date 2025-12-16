# ASDF Burn Engine Operational Runbook

Comprehensive operations guide for production deployment and incident response.

---

## Quick Reference

| Component | Port | Health Check |
|-----------|------|--------------|
| HTTP API | 3030 | `curl http://localhost:3030/health` |
| WebSocket | 3031 | `wscat -c ws://localhost:3031` |
| Dashboard | 3030 | `http://localhost:3030` |
| Admin Panel | 3030 | `http://localhost:3030/admin.html` |

**Emergency Contact:** GitHub Issues or Discord

---

## Health Checks

### 1. Daemon Status
```bash
# Quick status
pm2 status asdf-daemon

# Detailed info
pm2 show asdf-daemon

# Health endpoint
curl http://localhost:3030/health
```

**Expected Response (Healthy):**
```json
{
  "status": "healthy",
  "uptime": 86400000,
  "network": "mainnet",
  "tokens": 5,
  "lastPoll": 3000,
  "rpc": {
    "connected": true,
    "latencyMs": 45,
    "errorRate": 0.001,
    "circuitBreakerOpen": false
  },
  "tokensMonitored": 5,
  "pollCount": 1234
}
```

**Unhealthy Response (503):**
```json
{
  "status": "unhealthy",
  "reason": "Stale poll",
  "lastPoll": 150000
}
```

### 2. RPC Health
```bash
# Test primary RPC
curl https://api.mainnet-beta.solana.com -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Expected: {"jsonrpc":"2.0","result":"ok","id":1}

# Test with Solana CLI
solana epoch-info --url https://api.mainnet-beta.solana.com
```

**Expected:** Response < 2s

### 3. On-Chain State
```bash
# Check DATState
npm run check-state -- --network mainnet

# Check token stats
npm run check-fees -- --network mainnet
```

**Expected:**
- `is_active: true`
- `emergency_pause: false`
- Root token configured
- Token stats initialized

### 4. Fee Tracking
```bash
# Check pending fees via API
curl http://localhost:3030/fees

# Check on-chain
npm run check-fees -- --network mainnet
```

**Expected:**
- Fees accumulating
- `lastTxDetectedTimestamp` recent (< 5 minutes stale is normal)

### 5. System Resources
```bash
# Memory usage
pm2 show asdf-daemon | grep memory

# CPU usage
pm2 show asdf-daemon | grep cpu

# Disk space
df -h

# Log size
du -sh logs/
```

**Thresholds:**
- Memory: < 1GB (restart at 1GB per config)
- CPU: < 50% average
- Disk: > 10GB free
- Logs: < 1GB total

---

## Common Issues

### Issue 1: Daemon Stopped

**Symptoms:**
- Health check fails (connection refused)
- PM2 status shows "stopped" or "errored"
- No new logs

**Diagnosis:**
```bash
# Check PM2 status
pm2 status asdf-daemon

# View error logs
pm2 logs asdf-daemon --err --lines 50

# Check system logs
journalctl -u pm2-$(whoami) --since "10 minutes ago"
```

**Common Causes:**
- Uncaught exception
- Out of memory (check max_memory_restart)
- Missing environment variable
- RPC connection failure (all endpoints down)
- Wallet file permissions

**Solution:**
```bash
# Restart daemon
pm2 restart asdf-daemon

# If persists, check config
cat .env | grep -E "CREATOR|HELIUS|WALLET"

# If still failing, delete and recreate
pm2 delete asdf-daemon
pm2 start ecosystem.config.js --env production

# Check logs immediately after restart
pm2 logs asdf-daemon --lines 20
```

**Prevention:**
- Ensure environment variables set
- Keep wallet files with correct permissions (600)
- Monitor memory usage
- Configure multiple RPC endpoints

---

### Issue 2: Transaction Stuck

**Symptoms:**
- Pending transaction > 2 minutes
- Logs show "Waiting for confirmation..."
- Cycle appears frozen

**Diagnosis:**
```bash
# Get signature from logs
pm2 logs asdf-daemon | grep "signature:" | tail -1

# Check transaction status
solana confirm <SIGNATURE> --url https://api.mainnet-beta.solana.com

# Check on Solana Explorer
# https://explorer.solana.com/tx/<SIGNATURE>
```

**Common Causes:**
- Network congestion
- Insufficient priority fee
- Transaction expired (block height exceeded)
- RPC not returning confirmation

**Solution:**
```bash
# Wait: Confirmation retries active (up to 90s)
# Check after 2 minutes:

# If still pending - check explorer
open https://explorer.solana.com/tx/<SIGNATURE>

# If tx succeeded but daemon didn't detect:
# - Check RPC health
# - Restart daemon (will recover from state)

# If tx failed:
# - Check error in explorer
# - Daemon will retry next cycle
# - Check wallet balance if "InsufficientFunds"
```

**Prevention:**
- Use dynamic priority fees (already implemented)
- Monitor network congestion
- Ensure adequate SOL balance in wallet

---

### Issue 3: RPC Rate Limited

**Symptoms:**
- 429 errors in logs
- "Rate limit exceeded" messages
- Slow response times

**Diagnosis:**
```bash
# Count rate limit errors
grep "429" logs/daemon-error.log | wc -l

# Check RPC health from dashboard
curl http://localhost:3030/health | jq '.rpc'

# Test RPC directly
time curl $HELIUS_RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}'
```

**Common Causes:**
- Exceeded RPC plan limits
- Single endpoint overloaded
- DDoS/bot traffic

**Solution:**
```bash
# Automatic: Daemon will failover to next RPC
# Check failover status
pm2 logs asdf-daemon | grep -i "failover"

# Manual: Add more RPC endpoints
# Edit .env:
RPC_FALLBACK_URL=https://your-backup-rpc.com
RPC_BACKUP_1=https://another-rpc.com

# Restart daemon
pm2 restart asdf-daemon
```

**Prevention:**
- Configure multiple RPC providers
- Upgrade RPC plan if needed
- Monitor request rates

---

### Issue 4: High Error Rate

**Symptoms:**
- Error rate > 10% (from health check)
- Repeated failures in logs
- Circuit breaker opening

**Diagnosis:**
```bash
# Check error rate
curl http://localhost:3030/health | jq '.rpc.errorRate'

# View recent errors
pm2 logs asdf-daemon --err --lines 100

# Check error patterns
grep -E "(Error|Failed)" logs/daemon-error.log | tail -20
```

**Common Causes:**
- RPC instability
- Network issues
- Program errors (rare)
- Slippage exceeded

**Solution:**
```bash
# If RPC errors: Add fallback RPCs (see Issue 3)

# If slippage errors:
# - Normal for volatile tokens
# - Daemon will retry next cycle
# - Consider increasing slippage tolerance (contact admin)

# If program errors:
# - Check program not paused: npm run check-state
# - Verify wallet is admin
# - Check on-chain state

# Circuit breaker open:
# - Automatic: Will try half-open after 30s
# - Manual reset: pm2 restart asdf-daemon
```

**Prevention:**
- Multi-RPC setup
- Monitor error patterns
- Keep program code updated

---

### Issue 5: Insufficient Funds

**Symptoms:**
- "InsufficientFunds" error in logs
- Cycle execution fails
- Root treasury empty (rare)

**Diagnosis:**
```bash
# Check wallet balance
solana balance $(cat mainnet-wallet.json | jq -r '.publicKey') \
  --url https://api.mainnet-beta.solana.com

# Check root treasury
curl http://localhost:3030/treasury

# Check fees pending
curl http://localhost:3030/fees
```

**Common Causes:**
- Wallet SOL too low (< 0.19 SOL)
- Root treasury empty (shouldn't happen - 44.8% auto-fills)
- Rent-exempt minimum changed

**Solution:**
```bash
# If wallet low:
solana transfer <WALLET_PUBKEY> 1 \
  --from <FUNDING_SOURCE> \
  --url https://api.mainnet-beta.solana.com

# If root treasury empty (investigate):
# 1. Check last cycle logs
npm run check-fees -- --network mainnet

# 2. Verify fee split (should be 5520 bps = 55.2%)
npm run check-state -- --network mainnet | grep fee_split

# 3. Check if secondaries executed cycles
curl http://localhost:3030/tokens | jq '.tokens[] | {symbol, cyclesExecuted}'

# 4. Emergency: Admin can manually fund treasury (rare)
```

**Prevention:**
- Monitor wallet balance (alert < 0.5 SOL)
- Daemon checks operational buffer before cycles
- Root treasury auto-fills from secondaries

---

### Issue 6: Daemon Consuming High Memory

**Symptoms:**
- Memory > 800MB
- Frequent restarts due to memory limit
- Slow performance

**Diagnosis:**
```bash
# Check current memory
pm2 show asdf-daemon | grep memory

# Memory trend
pm2 monit  # Real-time monitoring
```

**Common Causes:**
- Memory leak (rare)
- Large state accumulation
- Too many tokens tracked

**Solution:**
```bash
# Immediate: Restart daemon (clears memory)
pm2 restart asdf-daemon

# Verify memory after restart
sleep 30
pm2 show asdf-daemon | grep memory

# If memory still high:
# - Check number of tokens: curl localhost:3030/tokens
# - Review state file size: ls -lh .asdf-state.json

# Adjust restart threshold if needed (ecosystem.config.js):
max_memory_restart: '1.5G'  # Increase if necessary
```

**Prevention:**
- Monitor memory trends
- Regular restarts (weekly)
- State cleanup (automatic)

---

### Issue 7: Stale Fee Detection

**Symptoms:**
- `lastTxDetectedTimestamp` > 10 minutes old
- Fees not increasing
- No new transactions detected

**Diagnosis:**
```bash
# Check last detected TX
curl http://localhost:3030/health | jq '.lastTxDetectedTimestamp'

# Convert to readable time
echo "Last TX: $(date -d @$(( $(curl -s localhost:3030/health | jq '.lastTxDetectedTimestamp') / 1000 )))"

# Check if tokens have recent activity
curl http://localhost:3030/tokens | jq '.tokens[] | {symbol, lastCycleTimestamp}'
```

**Common Causes:**
- No trading activity (normal for slow tokens)
- RPC not returning new transactions
- Bonding curve migrated to AMM

**Solution:**
```bash
# If no trading activity: Normal, wait for trades

# If RPC issue:
pm2 restart asdf-daemon  # Fresh RPC connection

# If bonding curve migrated:
# Daemon auto-detects AMM after migration
# Check token pool type:
curl localhost:3030/tokens | jq '.tokens[] | {symbol, poolType}'
```

**Prevention:**
- Normal behavior for low-volume tokens
- Monitor overall fee trends
- Multiple RPC endpoints ensure detection

---

## Emergency Procedures

### Emergency Pause

**When to Use:**
- Critical bug discovered in program
- Unexpected behavior (mass failures)
- Security incident
- Coordinated admin action required

**Procedure:**
```bash
# 1. Stop daemon immediately
pm2 stop asdf-daemon

# 2. Set emergency_pause on-chain (requires admin)
# Contact program admin or use admin script if available

# 3. Verify pause active
npm run check-state -- --network mainnet
# Expected: emergency_pause: true

# 4. Document incident
# Create incident report: docs/incidents/YYYY-MM-DD-description.md

# 5. Investigate offline
# Review logs, analyze issue, prepare fix

# 6. Resume (after fix deployed):
pm2 restart asdf-daemon
```

**Post-Incident:**
- Root cause analysis
- Update runbook if new issue
- Deploy preventative measures

---

### Rollback Procedure

**When to Use:**
- New deployment causing issues
- Code regression discovered
- Need to revert to stable version

**Procedure:**
```bash
# 1. Stop daemon
pm2 stop asdf-daemon

# 2. Backup current state
cp .asdf-state.json .asdf-state-backup-$(date +%Y%m%d-%H%M%S).json

# 3. Rollback code
git log --oneline -5  # Find last good commit
git checkout <LAST_GOOD_COMMIT>

# 4. Rebuild
npm run build

# 5. Restart daemon
pm2 restart asdf-daemon

# 6. Verify health
sleep 10
curl http://localhost:3030/health

# 7. Monitor for 15 minutes
pm2 logs asdf-daemon
```

---

### Disaster Recovery

**Scenario: Complete System Failure**

**Recovery Steps:**
```bash
# 1. Fresh VM/server with same environment

# 2. Install dependencies
npm install -g pm2
git clone <REPO>
cd asdf-dat
npm install

# 3. Restore environment
cp backups/.env .env
cp backups/mainnet-wallet.json mainnet-wallet.json

# 4. Restore state (if available)
cp backups/.asdf-state.json .asdf-state.json

# 5. Build and start
npm run build
pm2 start ecosystem.config.js --env production
pm2 save

# 6. Verify recovery
curl http://localhost:3030/health
pm2 logs asdf-daemon --lines 50
```

**Backup Checklist (Daily):**
- [ ] `.env` file
- [ ] Wallet files
- [ ] `.asdf-state.json`
- [ ] PM2 ecosystem config
- [ ] Recent logs (last 24h)

---

## Monitoring

### Key Metrics

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Daemon Uptime | 99.9% | < 99% | < 95% |
| Error Rate | < 1% | 1-5% | > 5% |
| Confirmation Time | < 30s | 30-60s | > 60s |
| Memory Usage | < 800MB | 800MB-1GB | > 1GB |
| RPC Latency | < 100ms | 100-500ms | > 500ms |
| Fees Flushed | Trending up | Flat | Decreasing |

### Dashboard Monitoring

**Access Dashboard:**
```
http://localhost:3030
```

**Key Panels:**
- **Daemon Status**: Uptime, health, last poll
- **Token Stats**: Per-token fees, burns, cycles
- **Root Treasury**: Balance, 44.8% accumulation
- **Recent Activity**: Latest transactions
- **Error Log**: Recent failures

**Admin Panel:**
```
http://localhost:3030/admin.html
```

**Admin Functions:**
- Manual cycle trigger
- Force state sync
- View detailed metrics
- Emergency controls (if configured)

### Log Monitoring

**Patterns to Watch:**
```bash
# Error spikes
grep -c "Error" logs/daemon-error.log

# Rate limit events
grep -c "429" logs/daemon-error.log

# Confirmation timeouts
grep -c "timeout" logs/daemon-error.log

# Circuit breaker events
grep -c "Circuit breaker" logs/daemon-out.log
```

**Alerting Rules:**
- Error rate > 5% for 5 minutes
- Daemon down for > 5 minutes
- Memory > 900MB
- RPC latency > 500ms for 10 minutes
- No fees detected for > 1 hour (on active tokens)

---

## Routine Maintenance

### Daily Tasks
```bash
# Check daemon status
pm2 status asdf-daemon
curl http://localhost:3030/health

# Check logs for errors
pm2 logs asdf-daemon --err --lines 50 --nostream

# Verify fees accumulating
curl http://localhost:3030/fees | jq '.totalPending'

# Check wallet balance
solana balance $(cat mainnet-wallet.json | jq -r '.publicKey')
```

### Weekly Tasks
```bash
# Graceful restart (clears memory)
pm2 restart asdf-daemon

# Archive logs
tar -czf logs-archive-$(date +%Y%m%d).tar.gz logs/
mkdir -p backups/logs
mv logs-archive-*.tar.gz backups/logs/

# Backup state
cp .asdf-state.json backups/.asdf-state-$(date +%Y%m%d).json

# Clean old backups (keep 30 days)
find backups/ -type f -mtime +30 -delete

# Update system packages
sudo apt update && sudo apt upgrade -y  # Ubuntu/Debian
```

### Monthly Tasks
```bash
# Review error trends
grep "Error" logs/daemon-error.log | \
  cut -d' ' -f5- | sort | uniq -c | sort -rn | head -10

# Audit on-chain state
npm run check-state -- --network mainnet
npm run check-fees -- --network mainnet

# Review security updates
git fetch origin
git log HEAD..origin/main --oneline

# Update dependencies (carefully)
npm outdated
# Review and update as needed

# Performance review
pm2 show asdf-daemon | grep -E "(uptime|restarts|memory)"
```

---

## Performance Tuning

### Optimize RPC Configuration
```bash
# Add multiple providers for redundancy
# .env:
HELIUS_API_KEY=your_key
QUICKNODE_RPC=https://your-quicknode-endpoint
TRITON_RPC=https://your-triton-endpoint
RPC_FALLBACK_URL=https://api.mainnet-beta.solana.com

# Restart to apply
pm2 restart asdf-daemon
```

### Adjust Compute Budget
```typescript
// If transactions failing with compute exceeded
// Contact admin to adjust in cycle executor config
```

### Memory Optimization
```bash
# If memory creeps up over time:
# Increase max_memory_restart in ecosystem.config.js
max_memory_restart: '1.5G'

# Or schedule periodic restarts (weekly)
echo "0 2 * * 0 pm2 restart asdf-daemon" | crontab -
```

---

## Security

### Access Control
- Wallet files: `chmod 600 mainnet-wallet.json`
- .env file: `chmod 600 .env`
- Logs: `chmod 700 logs/`
- State: `chmod 600 .asdf-state.json`

### Audit Trail
```bash
# Track all admin actions
pm2 logs asdf-daemon | grep -i "admin"

# Monitor cycle executions
curl localhost:3030/burns | jq '.recentBurns[] | {timestamp, amount, signature}'
```

### Secrets Management
- Never commit wallet files
- Rotate RPC keys quarterly
- Use environment variables only
- Backup securely (encrypted storage)

---

## Contact & Escalation

### Self-Service
1. Check this runbook
2. Review dashboard: http://localhost:3030
3. Check logs: `pm2 logs asdf-daemon`

### Escalation Path
1. **Level 1:** GitHub Issues (non-urgent)
2. **Level 2:** Discord (urgent questions)
3. **Level 3:** Emergency contact (critical failures)

### Incident Reporting
- Create issue with label `incident`
- Include logs, timeline, impact
- Propose resolution or ask for help

---

**Last Updated:** Sprint 3 completion
**Version:** 1.0
**Maintainer:** ASDF Team

*Stay calm. This is fine.* 🔥🐕

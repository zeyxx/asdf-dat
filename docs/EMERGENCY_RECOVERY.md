# ASDF-DAT Emergency Recovery Procedures

This document outlines procedures for recovering from various failure scenarios in the ASDF-DAT ecosystem.

## Quick Reference

| Scenario | Command |
|----------|---------|
| Daemon lock stuck | `rm .daemon-lock.json` |
| State file corrupted | `rm .daemon-state.json` (will start fresh) |
| Cycle stuck | Check `.daemon-lock.json` age, delete if stale |
| All else fails | See "Full Reset" below |

---

## 1. Daemon Lock Issues

### Symptom
```
❌ Cannot start: Another daemon instance is already running
   PID: 12345
   Started: 2025-01-01T00:00:00.000Z
```

### Diagnosis
```bash
# Check if process is actually running
ps aux | grep monitor-ecosystem-fees

# Check lock file
cat .daemon-lock.json
```

### Recovery

**If process is NOT running (stale lock):**
```bash
rm .daemon-lock.json
npx ts-node scripts/monitor-ecosystem-fees.ts --network mainnet
```

**If process IS running but unresponsive:**
```bash
# Kill the process
kill -9 <PID>

# Wait for lock to auto-cleanup or remove manually
sleep 5
rm -f .daemon-lock.json

# Restart daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network mainnet
```

---

## 2. State File Corruption

### Symptom
```
⚠️ .daemon-state.json: checksum mismatch (corrupted state)
```

### Diagnosis
```bash
# Check state file
cat .daemon-state.json | jq .

# Check backup
cat .daemon-state.backup.json | jq .
```

### Recovery

**Option A: Restore from backup (preferred)**
```bash
cp .daemon-state.backup.json .daemon-state.json
```

**Option B: Start fresh (loses last processed signatures)**
```bash
rm .daemon-state.json .daemon-state.backup.json
# Daemon will re-process recent transactions (safe due to deduplication)
```

---

## 3. Cycle Execution Stuck

### Symptom
- Cycle started but didn't complete
- pending_fees not resetting
- Error in logs about "cycle in progress"

### Diagnosis
```bash
# Check on-chain TokenStats
npx ts-node scripts/check-current-stats.ts --network mainnet

# Check daemon health
curl http://localhost:3030/health

# Check if cycle is locked
cat .execution-lock.json 2>/dev/null || echo "No lock file"
```

### Recovery

**Step 1: Kill any stuck processes**
```bash
pkill -f "execute-ecosystem-cycle"
pkill -f "monitor-ecosystem-fees"
```

**Step 2: Clear locks**
```bash
rm -f .daemon-lock.json .execution-lock.json
```

**Step 3: Verify on-chain state**
```bash
npx ts-node scripts/check-current-stats.ts --network mainnet
```

**Step 4: Restart daemon and retry cycle**
```bash
# Start daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network mainnet &

# Wait for sync
sleep 30

# Retry cycle
npx ts-node scripts/execute-ecosystem-cycle.ts <token-config>.json --network mainnet
```

---

## 4. Pending Fees Lost / Not Updating

### Symptom
- Trading activity visible on-chain
- pending_fees stuck at 0 or old value
- Daemon shows no fee captures

### Diagnosis
```bash
# Check daemon logs
tail -100 ./logs/asdf-daemon-mainnet.log

# Check RPC connectivity
curl -s https://api.mainnet-beta.solana.com -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq

# Check token stats
npx ts-node scripts/check-current-stats.ts --network mainnet
```

### Recovery

**Step 1: Force flush daemon**
```bash
curl -X POST http://localhost:3030/flush -H "X-Daemon-Key: YOUR_API_KEY"
```

**Step 2: If flush fails, restart daemon with fresh state**
```bash
pkill -f "monitor-ecosystem-fees"
rm .daemon-state.json
npx ts-node scripts/monitor-ecosystem-fees.ts --network mainnet
```

**Step 3: Wait for re-sync (may take 1-2 minutes)**
```bash
watch -n 5 'curl -s http://localhost:3030/status | jq'
```

---

## 5. Transaction Simulation Failures

### Symptom
```
Simulation failed at BUY instruction (finalize skipped to preserve pending_fees)
```

### Diagnosis
This is **expected behavior** - the system protected your pending_fees by aborting before finalize.

Common causes:
- Slippage too high
- Insufficient liquidity
- RPC congestion

### Recovery

**Step 1: Wait and retry**
```bash
# Wait 60 seconds for cooldown
sleep 60

# Retry cycle
npx ts-node scripts/execute-ecosystem-cycle.ts <token-config>.json --network mainnet
```

**Step 2: If persistent, check token liquidity**
```bash
# Check bonding curve state on Pump.fun or explorer
# If liquidity is very low, consider skipping that token
```

---

## 6. Full Reset Procedure

Use this only if all other recovery attempts fail.

```bash
# 1. Stop all processes
pkill -f "monitor-ecosystem-fees"
pkill -f "execute-ecosystem-cycle"

# 2. Clear all state files
rm -f .daemon-state.json .daemon-state.backup.json
rm -f .daemon-lock.json .execution-lock.json

# 3. Verify on-chain state (read-only)
npx ts-node scripts/check-current-stats.ts --network mainnet

# 4. Start fresh daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network mainnet > daemon.log 2>&1 &

# 5. Wait for initial sync
sleep 60

# 6. Verify daemon health
curl http://localhost:3030/ready

# 7. If ready, execute cycle
npx ts-node scripts/execute-ecosystem-cycle.ts <token-config>.json --network mainnet
```

---

## 7. Monitoring Commands

### Health Checks
```bash
# Basic status
curl http://localhost:3030/status

# Detailed health
curl http://localhost:3030/health

# Kubernetes-style probes
curl http://localhost:3030/ready
curl http://localhost:3030/live

# Metrics
curl http://localhost:3030/metrics
```

### Log Analysis
```bash
# Recent daemon logs
tail -f ./logs/asdf-daemon-mainnet.log

# Search for errors
grep -i "error\|fail" ./logs/asdf-daemon-mainnet.log

# Count fee captures
grep "💰" ./logs/asdf-daemon-mainnet.log | wc -l
```

---

## 8. Contact & Escalation

If issues persist after following these procedures:

1. **Collect diagnostics:**
   ```bash
   npx ts-node scripts/check-current-stats.ts --network mainnet > diagnostics.txt
   curl http://localhost:3030/stats >> diagnostics.txt
   tail -500 ./logs/asdf-daemon-mainnet.log >> diagnostics.txt
   ```

2. **Check GitHub issues** for known problems

3. **Open new issue** with diagnostics attached

---

## Appendix: File Locations

| File | Purpose | Safe to delete? |
|------|---------|-----------------|
| `.daemon-state.json` | Last processed signatures | Yes (will re-process) |
| `.daemon-state.backup.json` | Backup of state | Yes |
| `.daemon-lock.json` | Daemon instance lock | Yes (if process dead) |
| `.execution-lock.json` | Cycle execution lock | Yes (if no cycle running) |
| `./logs/*.log` | Application logs | Yes (for space) |

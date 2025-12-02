# ASDF-DAT Operations Guide

Runbooks, monitoring, and troubleshooting procedures for operating the DAT ecosystem.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Daily Operations](#daily-operations)
3. [Monitoring](#monitoring)
4. [Incident Response](#incident-response)
5. [Maintenance](#maintenance)
6. [Dry-Run Mode](#dry-run-mode)
7. [Troubleshooting](#troubleshooting)

---

## System Overview

### Components

| Component | Type | Purpose | Uptime Target |
|-----------|------|---------|---------------|
| Fee Daemon | Off-chain | Tracks fees, updates chain | 24/7 |
| Orchestrator | Off-chain | Executes cycles | On-demand |
| Smart Contract | On-chain | Executes buyback & burn | Always available |

### Health Indicators

| Indicator | Healthy | Warning | Critical |
|-----------|---------|---------|----------|
| Daemon Running | Yes | Restarting | Down > 5min |
| Consecutive Failures | 0-2 | 3-4 | 5+ (auto-pause) |
| Pending Fees Synced | < 30s old | < 5min old | > 5min stale |
| Wallet Balance | > 0.1 SOL | > 0.01 SOL | < 0.01 SOL |

---

## Daily Operations

### Starting the System

```bash
# 1. Verify wallet has sufficient SOL
solana balance devnet-wallet.json --url devnet

# 2. Check DAT state
npx ts-node scripts/check-dat-state.ts --network devnet

# 3. Start fee daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &

# 4. Verify daemon is running
curl http://localhost:3030/health
```

### Running a Cycle

```bash
# 1. Check pending fees
npx ts-node scripts/check-current-stats.ts --network devnet

# 2. Verify minimum thresholds met (0.006 SOL per token)
# If not, generate volume first

# 3. Execute cycle
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet

# 4. Verify results
npx ts-node scripts/check-current-stats.ts --network devnet
```

### Generating Volume (Testing)

```bash
# Buy + Sell creates fees in both directions
# 2 rounds of 0.5 SOL = ~0.006 SOL fees per token

for round in 1 2; do
  echo "Round $round: Buying..."
  npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 1 0.5

  echo "Round $round: Selling..."
  npx ts-node scripts/sell-spl-tokens-simple.ts devnet-tokens/01-froot.json

  sleep 5
done

# Wait for daemon sync
sleep 30
```

### Stopping the System

```bash
# 1. Stop daemon gracefully
pkill -SIGTERM -f "monitor-ecosystem-fees"

# 2. Verify stopped
ps aux | grep monitor-ecosystem-fees

# 3. (Optional) Clean up lock file
rm -f .daemon-lock.json
```

---

## Monitoring

### Daemon API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Basic health check |
| `/ready` | GET | Kubernetes readiness |
| `/live` | GET | Kubernetes liveness |
| `/status` | GET | Daemon status |
| `/stats` | GET | Detailed statistics |
| `/metrics` | GET | Prometheus metrics |
| `/flush` | POST | Force flush pending fees |

### Health Check Script

```bash
#!/bin/bash
# health-check.sh

DAEMON_URL="http://localhost:3030"

# Check daemon
if curl -s "$DAEMON_URL/health" | grep -q "ok"; then
  echo "✅ Daemon: Healthy"
else
  echo "❌ Daemon: Down"
  exit 1
fi

# Check pending fees age
LAST_UPDATE=$(curl -s "$DAEMON_URL/stats" | jq -r '.lastUpdate')
NOW=$(date +%s)
AGE=$((NOW - $(date -d "$LAST_UPDATE" +%s)))

if [ $AGE -lt 300 ]; then
  echo "✅ Sync: Recent ($AGE seconds)"
else
  echo "⚠️ Sync: Stale ($AGE seconds)"
fi

# Check consecutive failures
FAILURES=$(npx ts-node scripts/check-dat-state.ts --network devnet 2>/dev/null | grep "Consecutive Failures" | awk '{print $NF}')
if [ "$FAILURES" -lt 3 ]; then
  echo "✅ Failures: $FAILURES"
else
  echo "⚠️ Failures: $FAILURES (warning threshold)"
fi
```

### Prometheus Metrics

```bash
# View metrics
curl http://localhost:3030/metrics

# Example metrics:
# dat_pending_fees_total{token="DATSPL"} 5000000
# dat_cycles_executed_total 15
# dat_daemon_uptime_seconds 3600
# dat_last_sync_timestamp 1701388800
```

### Alerting (Discord)

Set environment variables for alerts:

```bash
export ALERT_ENABLED=true
export WEBHOOK_URL="https://discord.com/api/webhooks/..."
export WEBHOOK_TYPE="discord"
```

---

## Incident Response

### Auto-Pause Triggered (5+ Failures)

**Symptoms:**
- System reports `DATNotActive`
- `consecutive_failures >= 5`

**Response:**

```bash
# 1. Check what failed
npx ts-node scripts/check-dat-state.ts --network devnet

# 2. Review recent transactions
# Look for error codes in transaction logs

# 3. Identify root cause
# Common: Insufficient SOL, RPC issues, slippage exceeded

# 4. Fix root cause

# 5. Resume system
npx ts-node scripts/resume.ts --network devnet  # (if script exists)
# OR
# Manual resume via instruction

# 6. Monitor next few cycles
```

### Daemon Down

**Symptoms:**
- `/health` not responding
- Fees not being attributed

**Response:**

```bash
# 1. Check if process exists
ps aux | grep monitor-ecosystem-fees

# 2. Check for lock file
cat .daemon-lock.json

# 3. Remove stale lock if needed
rm -f .daemon-lock.json

# 4. Check state file integrity
cat .daemon-state.json | jq .

# 5. Restart daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &

# 6. Verify recovery
curl http://localhost:3030/health
```

### Fees Not Attributed

**Symptoms:**
- Trading happening but pending_fees not increasing

**Response:**

```bash
# 1. Verify daemon is polling
curl http://localhost:3030/stats

# 2. Check last processed signatures
cat .daemon-state.json | jq '.lastSignatures'

# 3. Verify bonding curve address in config
cat devnet-tokens/01-froot.json | jq '.bondingCurve'

# 4. Force flush
curl -X POST http://localhost:3030/flush

# 5. If still not working, restart daemon
```

### Cycle Execution Failed

**Symptoms:**
- Transaction failed or reverted
- Tokens not burned

**Response:**

```bash
# 1. Get error details from transaction
# Check Solscan/Explorer for the failed TX

# 2. Common errors:
# - InsufficientFees: Need more trading volume
# - CycleTooSoon: Wait 60 seconds
# - SlippageExceeded: Pool volatility issue

# 3. For insufficient fees:
npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 2 0.5
sleep 30

# 4. Retry cycle
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet
```

---

## Maintenance

### Adding New Token

```bash
# 1. Create config file
cat > devnet-tokens/XX-newtoken.json << 'EOF'
{
  "mint": "NEW_TOKEN_MINT",
  "bondingCurve": "BC_ADDRESS",
  "creator": "CREATOR_ADDRESS",
  "name": "New Token",
  "symbol": "NEW",
  "isRoot": false,
  "poolType": "bonding_curve",
  "tokenProgram": "SPL",
  "network": "devnet"
}
EOF

# 2. Initialize on-chain stats
npx ts-node scripts/init-token-stats.ts devnet-tokens/XX-newtoken.json --network devnet

# 3. Restart daemon (auto-detects new tokens)
pkill -f monitor-ecosystem-fees
sleep 2
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &

# 4. Generate initial volume
npx ts-node scripts/generate-volume.ts devnet-tokens/XX-newtoken.json 2 0.5
```

### Backup Procedures

```bash
# Backup daemon state
cp .daemon-state.json .daemon-state.json.backup

# Backup token configs
tar -czf token-configs-backup.tar.gz devnet-tokens/ mainnet-tokens/

# Backup wallet (NEVER commit to git!)
# Store securely offline
```

### Wallet Management

```bash
# Check balance
solana balance devnet-wallet.json --url devnet

# Fund if low
solana airdrop 2 $(solana-keygen pubkey devnet-wallet.json) --url devnet

# For mainnet: transfer from external wallet
# NEVER store mainnet private keys in plain text
```

### Log Rotation

```bash
# If running with output redirect
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet > daemon.log 2>&1 &

# Rotate logs weekly
mv daemon.log daemon.log.$(date +%Y%m%d)
gzip daemon.log.*
```

---

## Dry-Run Mode

The orchestrator supports `--dry-run` mode to preview cycle execution without making any on-chain changes.

### Usage

```bash
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet --dry-run
```

### JSON Output Schema

Reports are saved to `reports/dry-run-{timestamp}.json`:

```typescript
interface DryRunReport {
  timestamp: string;                              // ISO timestamp
  network: 'devnet' | 'mainnet';
  status: 'READY' | 'INSUFFICIENT_FEES' | 'COOLDOWN_ACTIVE' | 'NO_TOKENS';

  ecosystem: {
    totalPendingFees: number;      // lamports
    totalPendingFeesSOL: string;   // formatted (e.g., "0.0567 SOL")
    tokensTotal: number;           // Total tokens in ecosystem
    tokensEligible: number;        // Tokens meeting threshold
    tokensDeferred: number;        // Tokens below threshold
  };

  tokens: Array<{
    symbol: string;                // e.g., "DATSPL"
    mint: string;                  // Base58 pubkey
    isRoot: boolean;
    pendingFees: number;           // lamports
    pendingFeesSOL: string;        // formatted
    allocation: number;            // Proportional allocation (lamports)
    allocationSOL: string;
    willProcess: boolean;          // True if meets threshold
    deferReason?: string;          // Reason if deferred
  }>;

  thresholds: {
    minAllocationSecondary: number;
    minAllocationSecondarySOL: string;
    minAllocationRoot: number;
    minAllocationRootSOL: string;
  };

  costs: {
    estimatedTxFeesPerToken: number;
    estimatedTxFeesPerTokenSOL: string;
    totalEstimatedCost: number;
    totalEstimatedCostSOL: string;
  };

  warnings: string[];              // e.g., ["Token X below threshold"]
  recommendations: string[];       // e.g., ["Generate more volume for X"]
}
```

### Example Output

```json
{
  "timestamp": "2025-01-15T14:30:00.000Z",
  "network": "devnet",
  "status": "READY",
  "ecosystem": {
    "totalPendingFees": 25000000,
    "totalPendingFeesSOL": "0.025 SOL",
    "tokensTotal": 3,
    "tokensEligible": 2,
    "tokensDeferred": 1
  },
  "tokens": [
    {
      "symbol": "DATSPL",
      "mint": "ABC...",
      "isRoot": true,
      "pendingFees": 10000000,
      "pendingFeesSOL": "0.01 SOL",
      "allocation": 10000000,
      "allocationSOL": "0.01 SOL",
      "willProcess": true
    }
  ],
  "thresholds": {
    "minAllocationSecondary": 5690000,
    "minAllocationSecondarySOL": "0.00569 SOL",
    "minAllocationRoot": 2000000,
    "minAllocationRootSOL": "0.002 SOL"
  },
  "costs": {
    "estimatedTxFeesPerToken": 7000000,
    "estimatedTxFeesPerTokenSOL": "0.007 SOL",
    "totalEstimatedCost": 14000000,
    "totalEstimatedCostSOL": "0.014 SOL"
  },
  "warnings": ["DATM below minimum threshold"],
  "recommendations": ["Generate 0.5 SOL more volume for DATM"]
}
```

### Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| `READY` | All conditions met | Safe to execute cycle |
| `INSUFFICIENT_FEES` | Fees below threshold | Generate more volume |
| `COOLDOWN_ACTIVE` | Too soon since last cycle | Wait 60+ seconds |
| `NO_TOKENS` | No tokens found | Check token configs |

---

## Troubleshooting

### Error: "Daemon lock exists"

```bash
# Check if daemon is actually running
ps aux | grep monitor-ecosystem-fees

# If not running, remove stale lock
rm -f .daemon-lock.json

# Restart daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &
```

### Error: "State file corrupted"

```bash
# Check state file
cat .daemon-state.json

# If corrupted, restore from backup
cp .daemon-state.json.backup .daemon-state.json

# If no backup, daemon will start fresh (may lose some unsynced fees)
rm .daemon-state.json
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &
```

### Error: "Insufficient fees"

Need more trading volume before cycle can execute.

```bash
# Calculate required volume
# To get 0.006 SOL fees with ~0.3% creator fee:
# Volume needed = 0.006 / 0.003 = 2 SOL

# Generate volume
npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 2 0.5
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-tokens/01-froot.json

# Wait for daemon sync
sleep 30

# Check pending fees
npx ts-node scripts/check-current-stats.ts --network devnet
```

### Error: "Cycle too soon"

Must wait 60 seconds between cycles.

```bash
# Check last cycle timestamp
npx ts-node scripts/check-dat-state.ts --network devnet | grep "Last Cycle"

# Wait and retry
sleep 60
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet
```

### Error: "Invalid root treasury"

Root token not configured properly.

```bash
# Check current root token
npx ts-node scripts/check-dat-state.ts --network devnet | grep "Root Token"

# Set root token if needed
npx ts-node scripts/set-root-token.ts devnet-tokens/01-froot.json --network devnet
```

### Error: "RPC rate limited"

Too many requests to RPC provider.

```bash
# Solutions:
# 1. Use Helius API key (recommended)
export HELIUS_API_KEY="your-api-key"

# 2. Reduce daemon polling frequency
# Edit UPDATE_INTERVAL in scripts/monitor-ecosystem-fees.ts

# 3. Add fallback RPC
export RPC_FALLBACK_URL="https://api.devnet.solana.com"
```

### High Slippage / Trade Failed

Pool volatility too high for configured slippage.

```bash
# Current slippage is 5% (500 bps)
# Options:
# 1. Wait for pool to stabilize
# 2. Use smaller buy amounts
# 3. (Admin) Adjust slippage temporarily

# Check pool liquidity before trade
npx ts-node scripts/check-pool-liquidity.ts devnet-tokens/01-froot.json --network devnet
```

---

## Quick Reference

### Essential Commands

```bash
# Start daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &

# Stop daemon
pkill -f monitor-ecosystem-fees

# Check status
curl http://localhost:3030/health
npx ts-node scripts/check-dat-state.ts --network devnet
npx ts-node scripts/check-current-stats.ts --network devnet

# Execute cycle
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet

# Generate volume
npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 2 0.5

# Force flush
curl -X POST http://localhost:3030/flush
```

### Key Thresholds

| Threshold | Value | Description |
|-----------|-------|-------------|
| Min fees per token | 0.006 SOL | Minimum to execute cycle |
| Min cycle interval | 60 seconds | Cooldown between cycles |
| Auto-pause trigger | 5 failures | System pauses automatically |
| Max fees per cycle | 1 SOL | Single cycle cap |

### Important Files

| File | Purpose |
|------|---------|
| `.daemon-state.json` | Daemon persistence |
| `.daemon-lock.json` | Single instance lock |
| `devnet-wallet.json` | Devnet admin wallet |
| `mainnet-wallet.json` | Mainnet admin wallet |
| `devnet-tokens/*.json` | Token configurations |

---

*For technical details, see [Architecture](ARCHITECTURE.md).*
*For integration help, see [Developer Guide](DEVELOPER_GUIDE.md).*

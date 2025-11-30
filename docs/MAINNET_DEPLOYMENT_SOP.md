# Mainnet Deployment Standard Operating Procedure

This document outlines the complete process for deploying the ASDF-DAT ecosystem to mainnet.

## Pre-Deployment Checklist

### 1. Security Verification

- [ ] Run security audit script: `npx ts-node scripts/test-security-features.ts`
- [ ] Verify all private keys are in `.env` (not committed)
- [ ] Check `.gitignore` covers all sensitive files
- [ ] Review program for vulnerabilities (OWASP top 10)
- [ ] Verify admin key is secured with hardware wallet

### 2. Configuration Validation

```bash
# Validate all mainnet token configs
npx ts-node scripts/validate-tokens.ts mainnet-tokens/

# Expected output:
# - All configs valid
# - Exactly one root token
# - Same creator across all tokens
# - Correct network: mainnet
```

### 3. Environment Setup

Create `.env` file with mainnet configuration:

```bash
# Copy example and configure
cp .env.example .env

# Required variables:
SOLANA_RPC_MAINNET=https://api.mainnet-beta.solana.com
HELIUS_API_KEY=your_api_key  # For reliable RPC
MAINNET_WALLET_PATH=/path/to/mainnet-wallet.json
```

---

## Deployment Steps

### Phase 1: Program Deployment

```bash
# 1. Build program
anchor build

# 2. Deploy to mainnet
anchor deploy --provider.cluster mainnet

# 3. Verify deployment
solana program show ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui
```

### Phase 2: Initialize DAT State

```bash
# Initialize global DAT state
npx ts-node scripts/init-dat-state.ts --network mainnet

# Verify initialization
npx ts-node scripts/check-dat-state.ts --network mainnet
```

### Phase 3: Create Tokens on Pump.fun

For each token in the ecosystem:

1. **Create token on pump.fun**
   - Use the same creator wallet for ALL tokens
   - Record the mint address and bonding curve address

2. **Create token config file**
   ```bash
   # Example: mainnet-tokens/01-root.json
   {
     "mint": "<MINT_ADDRESS>",
     "creator": "<CREATOR_ADDRESS>",
     "bondingCurve": "<BC_ADDRESS>",
     "name": "ASDF",
     "symbol": "ASDF",
     "isRoot": true,
     "poolType": "bonding_curve",
     "network": "mainnet",
     "tokenProgram": "SPL"
   }
   ```

3. **Validate config**
   ```bash
   npx ts-node scripts/validate-tokens.ts mainnet-tokens/<file>.json
   ```

### Phase 4: Initialize Token Stats

```bash
# Initialize TokenStats for each token
for f in mainnet-tokens/*.json; do
  npx ts-node scripts/init-token-stats.ts "$f" --network mainnet
done

# Verify
npx ts-node scripts/check-current-stats.ts --network mainnet
```

### Phase 5: Set Root Token

```bash
# Set the root token for the ecosystem
npx ts-node scripts/set-root-token.ts mainnet-tokens/01-root.json --network mainnet
```

### Phase 6: Start Daemon

```bash
# Start fee monitor daemon
pm2 start scripts/monitor-ecosystem-fees.ts --name "asdf-daemon-mainnet" \
  --interpreter="npx" --interpreter-args="ts-node" \
  -- --network mainnet

# Verify daemon is running
pm2 status asdf-daemon-mainnet
curl http://localhost:3030/health
```

---

## Operational Procedures

### Running Ecosystem Cycles

```bash
# Check current fees
npx ts-node scripts/check-current-stats.ts --network mainnet

# Execute cycle (requires sufficient pending fees)
npx ts-node scripts/execute-ecosystem-cycle.ts mainnet-tokens/01-root.json --network mainnet
```

### Monitoring

```bash
# Health check
curl http://localhost:3030/health

# Prometheus metrics
curl http://localhost:3030/metrics

# Detailed stats
curl http://localhost:3030/stats
```

### Emergency Procedures

#### Pause Operations

```bash
# Pause all operations
npx ts-node scripts/emergency-pause.ts --network mainnet

# Resume operations
npx ts-node scripts/emergency-resume.ts --network mainnet
```

#### Recover from Daemon Crash

```bash
# Check for stale lock
cat .daemon-lock.json

# Force start if lock is stale (daemon not running)
rm .daemon-lock.json
pm2 restart asdf-daemon-mainnet

# Verify recovery
curl http://localhost:3030/status
```

#### State Corruption Recovery

The daemon automatically tries backup file if main state is corrupted:
1. `.daemon-state.json` - Main state file
2. `.daemon-state.backup.json` - Automatic backup

If both are corrupted:
```bash
# Stop daemon
pm2 stop asdf-daemon-mainnet

# Remove corrupted state (will start fresh)
rm .daemon-state.json .daemon-state.backup.json

# Restart daemon
pm2 restart asdf-daemon-mainnet
```

---

## Post-Deployment Verification

### 1. Verify All Accounts

```bash
# Check DAT state
npx ts-node scripts/check-dat-state.ts --network mainnet

# Check all token stats
npx ts-node scripts/check-current-stats.ts --network mainnet
```

### 2. Test Small Cycle

1. Generate small volume on ONE secondary token
2. Wait for daemon to detect fees (~30s)
3. Execute cycle
4. Verify:
   - Secondary token burned
   - Root token burned (44.8% share)
   - `pending_fees` reset to 0

### 3. Monitor for 24 Hours

- Check daemon logs for errors
- Verify fee attribution accuracy
- Monitor cycle execution success rate

---

## Rollback Procedure

If critical issues are discovered:

1. **Stop all operations**
   ```bash
   pm2 stop asdf-daemon-mainnet
   npx ts-node scripts/emergency-pause.ts --network mainnet
   ```

2. **Analyze logs**
   ```bash
   pm2 logs asdf-daemon-mainnet --lines 1000
   ```

3. **If program issue**: Cannot rollback deployed program
   - Deploy fix to new program ID
   - Migrate state

4. **If config issue**:
   ```bash
   # Fix configs and redeploy
   npx ts-node scripts/validate-tokens.ts mainnet-tokens/
   # Then re-initialize affected accounts
   ```

---

## Contact

For emergencies, contact:
- [Team contact information]

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-30 | Initial SOP |

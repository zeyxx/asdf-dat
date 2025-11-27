# Devnet Testing Procedure

Complete guide for testing the ASDF-DAT ecosystem on Solana devnet.

## Prerequisites

- Devnet wallet with SOL: `devnet-wallet.json`
- Token configs: `devnet-token-spl.json`, `devnet-token-secondary.json`, `devnet-token-mayhem.json`
- Daemon and scripts compiled

## Quick Reference

```bash
# 1. Start daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet > /tmp/daemon-output.txt 2>&1 &

# 2. Generate volume (buys)
npx ts-node scripts/generate-volume.ts <token-config.json> <num_buys> <sol_per_buy>

# 3. Sell tokens
npx ts-node scripts/sell-spl-tokens-simple.ts <token-config.json>
npx ts-node scripts/sell-mayhem-tokens.ts  # For DATM

# 4. Check daemon detections
grep -E "(💰|Flushed)" /tmp/daemon-output.txt

# 5. Check on-chain pending fees
npx ts-node scripts/check-current-stats.ts devnet-token-spl.json

# 6. Execute cycle
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json
```

---

## Complete Testing Procedure

### Step 1: Start the Fee Monitor Daemon

The daemon v2 uses balance polling to detect creator fees from PumpFun trades.

```bash
# Clean start
rm -f /tmp/daemon-output.txt
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet > /tmp/daemon-output.txt 2>&1 &

# Wait for initialization
sleep 8

# Verify daemon is running
grep -E "(Monitor started|Loaded)" /tmp/daemon-output.txt
```

Expected output:
```
✅ Loaded 3 tokens:
   • DAT SPL Test (DATSPL)
   • DAT Secondary Test (DATS2)
   • DAT Mayhem Test (DATM)
[...] ✅ Monitor started successfully
```

### Step 2: Generate Volume (Buy + Sell Cycles)

**IMPORTANT**: To accumulate meaningful creator fees, perform BOTH buys AND sells. Buy/sell cycles generate more fees than buys alone.

#### Minimum Requirements
- **Minimum 0.006 SOL per token** for meaningful cycle testing
- Each trade generates ~0.05-0.95% creator fee (dynamic based on market cap)

#### Buy Tokens

```bash
# DATSPL (root) - 3 buys @ 0.003 SOL each
npx ts-node scripts/generate-volume.ts devnet-token-spl.json 3 0.003

# DATS2 (secondary) - 3 buys @ 0.003 SOL each
npx ts-node scripts/generate-volume.ts devnet-token-secondary.json 3 0.003

# DATM (secondary) - 3 buys @ 0.003 SOL each
npx ts-node scripts/generate-volume.ts devnet-token-mayhem.json 3 0.003
```

#### Sell Tokens (Massive Sells for More Fees)

Selling generates larger fees because you're selling accumulated tokens:

```bash
# Sell DATSPL tokens
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-spl.json

# Sell DATS2 tokens
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-secondary.json

# Sell DATM tokens (uses mayhem mode)
npx ts-node scripts/sell-mayhem-tokens.ts
```

### Step 3: Monitor Fee Detection

The daemon polls every ~10 seconds and detects balance changes in the creator vault.

```bash
# Watch fee detections in real-time
tail -f /tmp/daemon-output.txt | grep -E "(💰|Flushed)"

# Or check accumulated detections
grep -E "(💰|✅.*Flushed)" /tmp/daemon-output.txt
```

Expected output:
```
[...] 💰 DATSPL: +0.052485 SOL (pending: 0.052485 SOL)
[...] 💰 DATS2: +0.004032 SOL (pending: 0.004032 SOL)
[...] ✅ DATSPL: Flushed 0.052485 SOL to on-chain
[...] ✅ DATS2: Flushed 0.004032 SOL to on-chain
```

### Step 4: Verify On-Chain Pending Fees

Before executing a cycle, verify fees are recorded on-chain:

```bash
npx ts-node scripts/check-current-stats.ts devnet-token-spl.json
```

Look for `Pending Fees` in the output:
```
   Pending Fees: 52484661 lamports (0.052484661 SOL)  # DATSPL
   Pending Fees: 4284307 lamports (0.004284307 SOL)   # DATS2
   Pending Fees: 3611293 lamports (0.003611293 SOL)   # DATM
```

### Step 5: Execute Ecosystem Cycle

The cycle orchestrator handles:
1. Query pending fees from all tokens
2. Proportional distribution for secondaries
3. Execute secondary cycles (collect → buy → finalize → burn)
4. Execute root cycle (collect → buy → burn)

```bash
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json
```

#### Minimum Thresholds
- **Shared vault minimum**: 0.0055 SOL (tokens below this are deferred)
- **Per-token minimum**: ~0.00569 SOL allocation

If secondaries are deferred, generate more volume and retry.

### Step 6: Verify Cycle Results

Check transactions on Solana Explorer:
```bash
# Get recent transactions
solana transaction-history <ADMIN_WALLET> --limit 5 --url devnet
```

Each cycle transaction contains:
- `compute_budget` - Set compute units
- `collect_fees` - Drain creator vault to dat_authority
- `execute_buy` / `execute_buy_secondary` - Buy tokens on PumpFun
- `finalize_cycle` - (secondaries only) Split 44.8% to root treasury
- `burn` - Permanently destroy purchased tokens

---

## Fee Split Mechanics

### Secondary Tokens
```
Creator Fee → 55.2% buyback (own token) + 44.8% root treasury
```

### Root Token
```
Creator Fee → 100% buyback (own token)
+ Collects from root_treasury (44.8% from all secondaries)
```

---

## Useful Commands

### Check Balances
```bash
# SOL balance
solana balance --url devnet

# Token balances
spl-token accounts --url devnet
```

### Check Creator Vault
```bash
npx ts-node scripts/check-creator-vault.ts
```

### Check DAT State
```bash
npx ts-node scripts/check-dat-state.ts
```

### Kill Daemon
```bash
pkill -f "monitor-ecosystem-fees"
```

---

## Troubleshooting

### "Shared vault < minimum" (Secondaries Deferred)
- Generate more volume (buy + sell cycles)
- Minimum ~0.006 SOL per token needed

### Daemon Not Detecting Fees
- Ensure daemon is running: `ps aux | grep monitor`
- Check daemon output for errors: `cat /tmp/daemon-output.txt`
- Verify bonding curves are active (not migrated to AMM)

### Transaction Failed
- Check SOL balance for gas fees
- Verify token accounts exist
- Check program logs in explorer

---

## Example Full Test Session

```bash
# 1. Clean start
pkill -f "ts-node" 2>/dev/null
rm -f /tmp/daemon-output.txt

# 2. Start daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet > /tmp/daemon-output.txt 2>&1 &
sleep 8

# 3. Generate volume on all tokens
for token in devnet-token-spl.json devnet-token-secondary.json devnet-token-mayhem.json; do
  echo "--- Buying $token ---"
  npx ts-node scripts/generate-volume.ts "$token" 3 0.003
done

# 4. Massive sells for bigger fees
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-spl.json
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-secondary.json
npx ts-node scripts/sell-mayhem-tokens.ts

# 5. Wait for daemon to detect and flush
sleep 30
grep -E "(💰|Flushed)" /tmp/daemon-output.txt | tail -20

# 6. Check on-chain
npx ts-node scripts/check-current-stats.ts devnet-token-spl.json | grep "Pending"

# 7. Execute cycle
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json

# 8. Verify transactions
solana transaction-history EG7MiZWRcfWNZR4Z54G6azsGKwu9QzZePNzHE4TVdXR5 --limit 5 --url devnet
```

---

## Key Addresses (Devnet)

| Entity | Address |
|--------|---------|
| Admin Wallet | `EG7MiZWRcfWNZR4Z54G6azsGKwu9QzZePNzHE4TVdXR5` |
| Program ID | `ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui` |
| DATSPL Mint | `rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr` |
| DATS2 Mint | `4bnfKBjKFJd5xiweNKMN1bBzETtegHdHe26Ej24DGUMK` |
| DATM Mint | `3X4LdmUBx5jTweHFtCN1xewrKv5gFue4CiesdgEAT3CJ` |
| Shared Creator Vault | `4BEvx1tdnfuvZLAL3H6Y4VM2AWMS3bkxu9koKbuwzPvv` |

---

*Last updated: 2025-11-27*

# ASDF-DAT E2E Test Procedure - Technical Report

**Version**: 1.0 (Devnet v4)
**Last Updated**: 2025-11-30
**Status**: Validated on Devnet

---

## Executive Summary

This document describes the complete end-to-end testing procedure for the ASDF-DAT ecosystem. It serves as a technical reference for mainnet deployment and future testing iterations.

### Test Results (v4)

| Token | Type | Burned | Buybacks | Status |
|-------|------|--------|----------|--------|
| DATSPL | Root (SPL) | 9,294,012.75M | 1 | ✅ |
| DATS2 | Secondary (SPL) | 954,284.87M | 1 | ✅ |
| DATM | Secondary (Token2022) | 494,724.75M | 1 | ✅ |

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Phase 1: Environment Verification](#2-phase-1-environment-verification)
3. [Phase 2: Token Creation](#3-phase-2-token-creation)
4. [Phase 3: On-Chain Initialization](#4-phase-3-on-chain-initialization)
5. [Phase 4: Volume Generation](#5-phase-4-volume-generation)
6. [Phase 5: Cycle Execution](#6-phase-5-cycle-execution)
7. [Phase 6: Verification](#7-phase-6-verification)
8. [Lessons Learned](#8-lessons-learned)
9. [Troubleshooting](#9-troubleshooting)
10. [Mainnet Checklist](#10-mainnet-checklist)

---

## 1. Prerequisites

### Required Accounts

| Account | Purpose | Minimum Balance |
|---------|---------|-----------------|
| Admin Wallet | Signs all transactions | 10+ SOL |
| DAT Authority PDA | Receives collected fees | 0.5+ SOL |

### Key Addresses (Devnet)

```
Program ID:     ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui
DAT Authority:  84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68
Admin Wallet:   EG7MiZWRcfWNZR4Z54G6azsGKwu9QzZePNzHE4TVdXR5
```

### Environment Variables

```bash
# .env file
HELIUS_API_KEY=<your-helius-api-key>
```

### Critical Thresholds

| Threshold | Value | Description |
|-----------|-------|-------------|
| MIN_FEES_FOR_SPLIT | 0.0055 SOL | Minimum fees per token to execute cycle |
| MIN_ALLOCATION_SECONDARY | 0.00569 SOL | Minimum allocation after proportional split |
| MIN_CYCLE_INTERVAL | 60s | Minimum time between cycles (bypassed in TESTING_MODE) |

---

## 2. Phase 1: Environment Verification

### Commands

```bash
# Check wallet balance
solana balance devnet-wallet.json --url devnet

# Verify program deployment
solana program show ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui --url devnet

# Check DAT Authority balance
solana balance 84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68 --url devnet
```

### Expected Results

- Admin wallet: 10+ SOL
- Program: Deployed and executable
- DAT Authority: 0.5+ SOL (fund if needed)

### Fund DAT Authority (if needed)

```bash
solana transfer 84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68 1.0 \
  --url devnet \
  --keypair devnet-wallet.json
```

---

## 3. Phase 2: Token Creation

### Token Architecture

```
ROOT TOKEN (DATSPL - SPL)
├── 100% of its own creator fees
└── 44.8% of all secondary token fees

SECONDARY TOKENS
├── DATS2 (SPL) - 55.2% of its fees
└── DATM (Token2022/Mayhem) - 55.2% of its fees
```

### Creation Commands

```bash
# 1. Root Token (SPL)
npx ts-node scripts/create-token-spl.ts
# Output: devnet-token-spl.json

# 2. Secondary Token (SPL)
npx ts-node scripts/create-secondary-spl-token.ts
# Output: devnet-token-secondary.json

# 3. Mayhem Token (Token2022)
npx ts-node scripts/create-mayhem-token.ts
# Output: devnet-token-mayhem.json
```

### Post-Creation: Update Config Files

Add the following fields to each JSON config:

**devnet-token-spl.json:**
```json
{
  "isRoot": true,
  "tokenProgram": "SPL",
  "poolType": "bonding_curve"
}
```

**devnet-token-secondary.json:**
```json
{
  "isRoot": false,
  "tokenProgram": "SPL",
  "poolType": "bonding_curve"
}
```

**devnet-token-mayhem.json:**
```json
{
  "isRoot": false,
  "mayhemMode": true,
  "tokenProgram": "Token2022",
  "poolType": "bonding_curve"
}
```

### Verification

All tokens must have:
- `creator` = DAT Authority PDA (`84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68`)
- Valid `bondingCurve` address
- Correct `tokenProgram` field

---

## 4. Phase 3: On-Chain Initialization

### 4.1 Initialize TokenStats (All Tokens)

```bash
npx ts-node scripts/init-token-stats.ts devnet-token-spl.json
npx ts-node scripts/init-token-stats.ts devnet-token-secondary.json
npx ts-node scripts/init-token-stats.ts devnet-token-mayhem.json
```

### 4.2 Set Root Token

```bash
npx ts-node scripts/set-root-token.ts devnet-token-spl.json
```

### 4.3 Initialize Pool Accounts

```bash
# SPL Tokens
npx ts-node scripts/init-spl-pool-accounts.ts devnet-token-spl.json
npx ts-node scripts/init-spl-pool-accounts.ts devnet-token-secondary.json

# Token2022 (different script!)
npx ts-node scripts/init-mayhem-pool-accounts.ts devnet-token-mayhem.json
```

### 4.4 Create ATA for DAT Authority (Token2022 ONLY)

> **CRITICAL**: This step was discovered in v3 testing. Without it, `ExecuteBuySecondary` fails with `AccountNotInitialized` error on `dat_asdf_account`.

```bash
# Get mint from config
DATM_MINT=$(cat devnet-token-mayhem.json | jq -r '.mint')
DAT_AUTH="84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68"

# Create ATA for DAT Authority to receive Token2022 tokens
spl-token create-account $DATM_MINT \
  --owner $DAT_AUTH \
  --url devnet \
  --fee-payer devnet-wallet.json
```

### Initialization Checklist

| Account | Command | Required For |
|---------|---------|--------------|
| TokenStats (per token) | `init-token-stats.ts` | All tokens |
| Root Token Config | `set-root-token.ts` | Root only |
| Pool Account SPL | `init-spl-pool-accounts.ts` | SPL tokens |
| Pool Account Token2022 | `init-mayhem-pool-accounts.ts` | Token2022 |
| **ATA DAT Authority** | `spl-token create-account` | **Token2022 ONLY** |

---

## 5. Phase 4: Volume Generation

### Start Fee Monitor Daemon

```bash
# Kill any existing daemon
pkill -f "monitor-ecosystem-fees" 2>/dev/null || true

# Start fresh daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &

# Wait for initialization
sleep 15
```

### Volume Generation Strategy

**Goal**: Accumulate minimum 0.006 SOL fees per token

**Fee Calculation**:
- Creator fee on devnet BC: ~0.2% (varies by market cap)
- 1 SOL buy generates: ~0.002 SOL fees
- Need: ~3 SOL volume per token minimum

**Optimized Approach**: Buy + Sell cycles (both generate fees)

```bash
# Round 1 - BUYS (1 SOL each)
npx ts-node scripts/generate-volume.ts devnet-token-spl.json 1 1.0
npx ts-node scripts/generate-volume.ts devnet-token-secondary.json 1 1.0
npx ts-node scripts/generate-volume.ts devnet-token-mayhem.json 1 1.0

# Round 1 - SELLS
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-spl.json
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-secondary.json
npx ts-node scripts/sell-mayhem-tokens.ts  # May fail with Overflow - see troubleshooting

# Round 2 - BUYS (1 SOL each)
npx ts-node scripts/generate-volume.ts devnet-token-spl.json 1 1.0
npx ts-node scripts/generate-volume.ts devnet-token-secondary.json 1 1.0
npx ts-node scripts/generate-volume.ts devnet-token-mayhem.json 1 1.0

# Round 2 - SELLS
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-spl.json
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-secondary.json
```

### Wait for Daemon Sync

```bash
# Wait for daemon to detect and flush fees
sleep 30

# Verify pending fees
npx ts-node scripts/check-current-stats.ts --network devnet
```

### Expected Output

```
✅ DATSPL:
   ⏳ Pending Fees: >5500000 lamports (>0.0055 SOL)

✅ DATS2:
   ⏳ Pending Fees: >5500000 lamports (>0.0055 SOL)

✅ DATM:
   ⏳ Pending Fees: >5500000 lamports (>0.0055 SOL)
```

**If any token is below 0.0055 SOL**, generate more volume for that token.

---

## 6. Phase 5: Cycle Execution

### Execute Full Ecosystem Cycle

```bash
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json --network devnet
```

### Expected Flow

1. **Pre-flight Check**: Verifies all secondary tokens have pending fees
2. **Step 1**: Queries pending fees from all TokenStats
3. **Step 2**: Executes secondary token cycles (N+1 pattern)
   - First token: Collects from shared vault + buys + finalizes + burns
   - Other tokens: Uses remaining datAuthority balance
4. **Step 3**: Executes root token cycle
   - Collects from root creator vault + root treasury
   - Buys + burns

### Success Criteria

```
🔄 Cycle Results:
──────────────────────────────────────────────────────────
Token        Status         Allocated
──────────────────────────────────────────────────────────
DATM         ✅ Success      0.019928
DATS2        ✅ Success      0.019820
DATSPL       ✅ Success      N/A
──────────────────────────────────────────────────────────

✅ All cycles executed successfully!
```

---

## 7. Phase 6: Verification

### Check Final Stats

```bash
npx ts-node scripts/check-current-stats.ts --network devnet
```

### Success Criteria

| Token | total_burned | total_buybacks |
|-------|--------------|----------------|
| DATSPL | > 0 | ≥ 1 |
| DATS2 | > 0 | ≥ 1 |
| DATM | > 0 | ≥ 1 |

### v4 Results

```
✅ DATSPL:
   🔥 Total Burned: 9,294,012.75M tokens
   🔄 Total Buybacks: 1

✅ DATS2:
   🔥 Total Burned: 954,284.87M tokens
   🔄 Total Buybacks: 1

✅ DATM:
   🔥 Total Burned: 494,724.75M tokens
   🔄 Total Buybacks: 1
```

---

## 8. Lessons Learned

### v3 → v4 Improvements

| Issue | Root Cause | Solution |
|-------|------------|----------|
| `AccountNotInitialized` on `dat_asdf_account` | ATA for DAT Authority missing for Token2022 | Added Phase 3.4: Create ATA explicitly |
| Hardcoded mints in check-current-stats.ts | Script didn't read from config files | Updated script to read JSON configs |
| `CycleTooSoon` errors | TESTING_MODE = false | Rebuild program with `--features testing` |

### Key Insights

1. **Token2022 requires explicit ATA creation** for the DAT Authority PDA
2. **Daemon must be running BEFORE volume generation** to capture fees
3. **Daemon state persists** in `.daemon-state.json` - allows crash recovery
4. **Sell overflow on Mayhem tokens** - bonding curve can't handle full token sell; buys still work
5. **Minimum 0.006 SOL fees per token** required for cycle execution

---

## 9. Troubleshooting

### Error: `AccountNotInitialized` on `dat_asdf_account`

**Cause**: Missing ATA for DAT Authority (Token2022 tokens only)

**Solution**:
```bash
spl-token create-account <MINT> --owner <DAT_AUTH> --url devnet --fee-payer devnet-wallet.json
```

### Error: `Overflow` on sell

**Cause**: Pump.fun bonding curve math overflow when selling large amounts

**Solution**:
- Sells are not required for fee generation (buys generate fees too)
- Skip failing sells and continue with test
- For production: sell smaller amounts in batches

### Error: `CycleTooSoon`

**Cause**: MIN_CYCLE_INTERVAL (60s) not elapsed

**Solution**:
- Wait 60+ seconds between cycles
- For testing: Use program built with `--features testing`

### Error: `Insufficient fees`

**Cause**: pending_fees < MIN_FEES_FOR_SPLIT (0.0055 SOL)

**Solution**:
```bash
# Generate more volume
npx ts-node scripts/generate-volume.ts <token-config.json> 2 1.0
sleep 30  # Wait for daemon sync
```

### Daemon Not Detecting Fees

**Cause**: Daemon not running during trades, or different signature state

**Solution**:
1. Kill all daemon processes: `pkill -f "monitor-ecosystem-fees"`
2. Delete state file: `rm .daemon-state.json`
3. Restart daemon: `npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &`
4. Re-generate volume

---

## 10. Mainnet Checklist

### Pre-Deployment

- [ ] Program deployed to mainnet (without TESTING_MODE)
- [ ] Mainnet wallet funded (50+ SOL recommended)
- [ ] DAT Authority PDA funded (5+ SOL)
- [ ] Helius mainnet RPC configured
- [ ] All token configs updated with mainnet addresses

### Token Creation

- [ ] Root token created (SPL)
- [ ] All secondary tokens created
- [ ] Config files have correct flags (`isRoot`, `tokenProgram`, `poolType`)

### Initialization

- [ ] TokenStats initialized for ALL tokens
- [ ] Root token configured via `set-root-token.ts`
- [ ] Pool accounts initialized (SPL and Token2022 scripts)
- [ ] **ATA created for DAT Authority for each Token2022 token**

### Daemon

- [ ] Daemon running on reliable infrastructure
- [ ] State persistence configured (`.daemon-state.json`)
- [ ] Monitoring/alerting in place

### Cycle Execution

- [ ] Verify MIN_CYCLE_INTERVAL (60s production)
- [ ] Verify all tokens have pending_fees > 0.0055 SOL
- [ ] Execute cycle during low-activity period (gas optimization)

---

## Appendix: Token Configs (v4 Test)

### devnet-token-spl.json
```json
{
  "mint": "9Gs59vJFFZWfZ72j7BNiTyzUPovH5oMVtTjGnrATECMG",
  "bondingCurve": "DJjzewWZSTt3mhqkQgSE46Qs2qG25wRN1z2CyQAGGq85",
  "creator": "84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68",
  "isRoot": true,
  "tokenProgram": "SPL",
  "poolType": "bonding_curve"
}
```

### devnet-token-secondary.json
```json
{
  "mint": "HUREV29Rya3wvgwADVfNAYUjD1bJC4deLq4pRJGQB8zf",
  "bondingCurve": "FivDsQ1ymWegPV6bTFY71SxvGs5JFSsADMFMbP2zyo6N",
  "creator": "84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68",
  "isRoot": false,
  "tokenProgram": "SPL",
  "poolType": "bonding_curve"
}
```

### devnet-token-mayhem.json
```json
{
  "mint": "3AaRdBWEzwYR142dSNh7dxkJ88jraxn6dbxVHVtLH3LC",
  "bondingCurve": "36hH2yXcJsXpPNwqoX3XfBRWrxfnd9qjFN1cyoq3gXnM",
  "creator": "84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68",
  "isRoot": false,
  "mayhemMode": true,
  "tokenProgram": "Token2022",
  "poolType": "bonding_curve"
}
```

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-30 | Initial version from v4 devnet test |

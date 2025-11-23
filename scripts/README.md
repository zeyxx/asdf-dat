# Scripts Guide

This directory contains all operational scripts for the ASDF DAT project.

**Total scripts**: 15 (reduced from 37)
**Cleanup date**: 2025-11-23
**Scripts removed**: 22 obsolete/duplicate scripts

---

## 📁 Script Categories

### 🚀 Core Production Scripts

#### Token Creation
- **`create-token-mayhem.ts`** - Create Mayhem Mode token (Devnet)
  - Creates Token2022 token via DAT program
  - 2B token supply (1B + 1B for AI agent)
  - Outputs: `devnet-token-mayhem.json`

- **`launch-mayhem-token.ts`** - Launch Mayhem token (Mainnet)
  - Production script with metadata upload to NFT.Storage
  - Requires: `NFT_STORAGE_API_KEY` environment variable
  - Full setup with image, description, socials
  - **USE THIS FOR MAINNET LAUNCH**

#### Pool Initialization
- **`init-mayhem-pool-accounts.ts`** - Initialize pool accounts
  - Creates pool Token2022 account
  - Creates pool WSOL account
  - Required after token creation

### ✅ Testing Scripts

- **`test-mayhem-full-cycle.ts`** ⭐ - Test complete cycle (1 TX)
  - Executes: collect_fees → execute_buy → burn_and_update
  - Single transaction execution
  - **PRIMARY TEST SCRIPT**
  - Status: ✅ 11+ successful cycles on devnet

- **`test-mayhem-cycle.ts`** - Test cycle (3 steps)
  - Step-by-step cycle execution
  - Useful for debugging specific steps
  - Status: ✅ Functional

### 📊 Monitoring & Debug

- **`check-dat-state.ts`** - Display DAT state & statistics
  - Shows total burned tokens (with decimals)
  - Shows total SOL collected
  - Shows number of buybacks
  - Admin and config info

- **`read-cycle-events.ts`** ⭐ - Read transaction events
  - Parses `CycleCompleted` events
  - Displays amounts with proper decimals
  - Usage: `npx ts-node scripts/read-cycle-events.ts <TX_SIGNATURE>`

- **`check-creator-vault.ts`** - Check creator vault balance
  - Verifies fees accumulated
  - Useful before running cycle

- **`check-token-balance.ts`** - Check token balances
  - Generic balance checker
  - Supports Token2022

### 🔧 Utilities

- **`validate-mayhem-readiness.ts`** - Pre-launch validation
  - Checks all requirements before mainnet launch
  - Validates configuration
  - Checks balances

- **`devnet-status.ts`** - Devnet environment status
  - Check devnet accounts
  - Verify setup

- **`devnet-full-setup.ts`** - Complete devnet setup
  - One-command setup for devnet testing

### 🛠️ Admin Scripts

- **`transfer-admin.ts`** - Transfer DAT admin role
  - Emergency admin transfer
  - Use with caution

- **`transfer-program-authority.ts`** - Transfer program authority
  - Program upgrade authority transfer
  - Use with caution

- **`update-dat-config.ts`** - Update DAT configuration
  - Modify DAT parameters
  - Admin only

---

## 🎯 Standard Workflows

### Workflow 1: Devnet Testing (Current Token)

Using existing token with accumulated fees:

```bash
# 1. Check DAT state
npx ts-node scripts/check-dat-state.ts

# 2. Check creator vault has fees
npx ts-node scripts/check-creator-vault.ts

# 3. Run full cycle test
npx ts-node scripts/test-mayhem-full-cycle.ts

# 4. Read events (optional)
npx ts-node scripts/read-cycle-events.ts <TX_SIGNATURE>
```

**Token used**: `6KAzir6ZApHcAsjDXsfoA9LXjNYtEanyrNkBgenajBVU`

### Workflow 2: Devnet Testing (New Token)

Create and test a new token:

```bash
# 1. Create new Mayhem token
npx ts-node scripts/create-token-mayhem.ts

# 2. Initialize pool accounts
npx ts-node scripts/init-mayhem-pool-accounts.ts

# 3. Wait for fees to accumulate
# Note: On devnet, AI agent doesn't trade
# Use existing token or wait for manual trades

# 4. Run full cycle test
npx ts-node scripts/test-mayhem-full-cycle.ts

# 5. Check results
npx ts-node scripts/check-dat-state.ts
```

### Workflow 3: Mainnet Launch (Production)

**Prerequisites**:
- NFT.Storage API key
- Token image (PNG/JPG)
- Mainnet wallet with SOL
- Set `TESTING_MODE = false` in `programs/asdf-dat/src/lib.rs`
- Deploy program to mainnet

```bash
# 1. Set environment
export NFT_STORAGE_API_KEY="your-key-here"

# 2. Validate readiness
npx ts-node scripts/validate-mayhem-readiness.ts

# 3. Launch token (PRODUCTION)
npx ts-node scripts/launch-mayhem-token.ts

# 4. Initialize pool accounts
npx ts-node scripts/init-mayhem-pool-accounts.ts

# 5. Wait 24 hours for AI agent trading

# 6. Monitor and execute cycles as needed
npx ts-node scripts/check-creator-vault.ts
npx ts-node scripts/test-mayhem-full-cycle.ts
```

---

## 📝 Key Files

### Configuration Files
- `devnet-wallet.json` - Devnet admin wallet
- `devnet-token-mayhem.json` - Current/latest Mayhem token info
- `devnet-token-mayhem-working.json` - Reference working token

### Output Files
Scripts create these files:
- Token creation → `devnet-token-mayhem.json`
- Launch script → Token info JSON with full metadata

---

## ✅ Validated Features

### Devnet Testing (✅ Complete)
- ✅ Token creation (Token2022)
- ✅ Pool initialization
- ✅ Fee collection from creator vault
- ✅ Token buyback (PumpFun integration)
- ✅ Token burn (token_interface)
- ✅ Full cycle in single transaction
- ✅ Decimal formatting (logs & events)
- ✅ Event reading with proper decimals
- ✅ 11+ successful cycles

### Testing Coverage
- **Devnet**: ~92% complete
- **Mainnet**: Requires live testing
- **AI Agent**: Untested (mainnet only)

---

## 🚨 Important Notes

### Devnet Limitations
- AI agent doesn't trade on devnet
- Newly created tokens not immediately tradable on PumpFun devnet
- Use existing working token for reliable tests

### Mainnet Requirements
- `TESTING_MODE` must be `false` in Rust code
- NFT.Storage API key required
- Real SOL required
- AI agent will trade for 24 hours
- Monitor creator vault for fee accumulation

### Safety
- Always test on devnet first
- Verify all PDAs before mainnet
- Keep admin keys secure
- Monitor transactions
- Have emergency pause plan

---

## 📊 Statistics

### Cleanup Summary
- **Before**: 37 scripts
- **After**: 15 scripts
- **Removed**: 22 scripts (59% reduction)
- **Categories removed**:
  - SPL token scripts (non-functional on devnet)
  - Failed buy scripts
  - Obsolete init scripts
  - One-time debug scripts
  - Ponctual setup scripts

### Scripts Deleted
See `SCRIPTS-AUDIT.md` for full list of removed scripts and reasons.

---

## 🔗 Related Documentation

- [Mayhem Mode Testing Status](../docs/MAYHEM-MODE-TESTING-STATUS.md)
- [Mayhem Mode Launch Guide (EN)](../MAYHEM-MODE-LAUNCH-GUIDE-EN.md)
- [Mayhem Mode Launch Guide (FR)](../MAYHEM-MODE-LAUNCH-GUIDE.md)
- [Scripts Audit Report](../SCRIPTS-AUDIT.md)

---

## 💡 Tips

### Debugging
1. Use `check-dat-state.ts` to see current stats
2. Use `check-creator-vault.ts` to verify fees
3. Use `read-cycle-events.ts` to analyze transactions
4. Use `test-mayhem-cycle.ts` for step-by-step debugging

### Testing
1. Always check DAT state before and after cycles
2. Read events to verify amounts are correct
3. Use working token (`6KAzir...`) for reliable devnet tests
4. Test with small amounts first on mainnet

### Production
1. Validate with `validate-mayhem-readiness.ts` first
2. Use `launch-mayhem-token.ts` for complete setup
3. Monitor creator vault during AI trading period
4. Execute cycles when profitable

---

**Last updated**: 2025-11-23
**Status**: ✅ Production ready (devnet validated)

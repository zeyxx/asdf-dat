# ASDF-DAT Developer Guide

Everything you need to integrate, extend, or operate the DAT ecosystem.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Account Structures](#account-structures)
3. [PDA Derivation](#pda-derivation)
4. [Fee Attribution System](#fee-attribution-system)
5. [Cycle Execution](#cycle-execution)
6. [Token Configuration](#token-configuration)
7. [Error Handling](#error-handling)
8. [Security](#security)
9. [Testing](#testing)

---

## Getting Started

### Prerequisites

```bash
# Node.js 18+
node --version  # v18.0.0+

# Solana CLI
solana --version  # 1.18+

# Anchor (for contract development)
anchor --version  # 0.31.1
```

### Installation

```bash
git clone https://github.com/asdfDAT/asdf-dat.git
cd asdf-dat
npm install
```

### Environment Setup

Create appropriate wallet files:

```bash
# Devnet (test wallet)
solana-keygen new -o devnet-wallet.json

# Fund it
solana airdrop 2 $(solana-keygen pubkey devnet-wallet.json) --url devnet

# Mainnet (real wallet - BE CAREFUL)
# Use existing wallet or create new with proper backup
```

### First Run (Devnet)

```bash
# 1. Check DAT state exists
npx ts-node scripts/check-dat-state.ts --network devnet

# 2. Start daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &

# 3. Generate test volume
npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 2 0.5

# 4. Wait and execute cycle
sleep 30
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet
```

---

## Account Structures

### DATState

Global configuration account. One per deployment.

```typescript
interface DATState {
  admin: PublicKey;                    // Current admin
  asdfMint: PublicKey;                 // Legacy field
  rootTokenMint: PublicKey | null;     // Designated root token
  feeSplitBps: number;                 // 5520 = 55.2% to secondary
  isActive: boolean;                   // Execution enabled
  emergencyPause: boolean;             // Emergency stop
  lastCycleTimestamp: BN;              // Unix timestamp
  minCycleInterval: BN;                // 60 seconds default
  maxFeesPerCycle: BN;                 // 1 SOL cap
  slippageBps: number;                 // 500 = 5%
  totalBurned: BN;                     // Global burn counter
  totalSolCollected: BN;               // Global SOL counter
  totalBuybacks: number;               // Cycle counter
  failedCycles: number;                // Failure counter
  consecutiveFailures: number;         // Auto-pause trigger
  datAuthorityBump: number;            // PDA bump
  pendingBurnAmount: BN;               // Tokens queued for burn
  pendingAdmin: PublicKey | null;      // Two-step transfer
  pendingFeeSplit: number | null;      // Timelocked change
  adminOperationCooldown: BN;          // 3600 seconds default
}
```

### TokenStats

Per-token tracking. One per ecosystem token.

```typescript
interface TokenStats {
  mint: PublicKey;                     // Token mint
  totalBurned: BN;                     // Tokens burned
  totalSolCollected: BN;               // SOL collected
  totalSolUsed: BN;                    // SOL spent on buybacks
  totalSolSentToRoot: BN;              // 44.8% sent to root
  totalSolReceivedFromOthers: BN;      // Root: received from secondaries
  totalBuybacks: BN;                   // Cycle count
  isRootToken: boolean;                // Root flag
  pendingFeesLamports: BN;             // Fees pending distribution
  lastFeeUpdateTimestamp: BN;          // Last daemon update
  cyclesParticipated: BN;              // Participation counter
}
```

### ValidatorState (Optional)

For trustless fee validation.

```typescript
interface ValidatorState {
  mint: PublicKey;                     // Token being tracked
  bondingCurve: PublicKey;             // Associated bonding curve
  lastValidatedSlot: BN;               // Prevents double-counting
  totalValidatedLamports: BN;          // Cumulative validated
  feeRateBps: number;                  // Expected fee rate
}
```

---

## PDA Derivation

All PDAs use the program ID: `ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui`

### JavaScript/TypeScript

```typescript
import { PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');

// DAT State
const [datState] = PublicKey.findProgramAddressSync(
  [Buffer.from('dat_v3')],
  PROGRAM_ID
);

// DAT Authority (signer for CPIs)
const [datAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from('auth_v3')],
  PROGRAM_ID
);

// Token Stats (per token)
const [tokenStats] = PublicKey.findProgramAddressSync(
  [Buffer.from('token_stats_v1'), mint.toBuffer()],
  PROGRAM_ID
);

// Root Treasury
const [rootTreasury] = PublicKey.findProgramAddressSync(
  [Buffer.from('root_treasury'), rootMint.toBuffer()],
  PROGRAM_ID
);

// Validator State (optional)
const [validatorState] = PublicKey.findProgramAddressSync(
  [Buffer.from('validator_v1'), mint.toBuffer(), bondingCurve.toBuffer()],
  PROGRAM_ID
);
```

### Rust (On-Chain)

```rust
// DAT State
let (dat_state, _) = Pubkey::find_program_address(
    &[b"dat_v3"],
    program_id
);

// Token Stats
let (token_stats, _) = Pubkey::find_program_address(
    &[b"token_stats_v1", mint.as_ref()],
    program_id
);

// Root Treasury
let (root_treasury, _) = Pubkey::find_program_address(
    &[b"root_treasury", root_mint.as_ref()],
    program_id
);
```

---

## Fee Attribution System

### The Problem

All tokens from the same creator share ONE vault on Pump.fun:

```
Token A Trade → Creator Vault (shared)
Token B Trade → Creator Vault (shared)

Vault balance = X SOL
Which token generated how much? Unknown.
```

### The Solution

Balance polling with transaction attribution:

```typescript
// Simplified daemon logic
for (const token of tokens) {
  // 1. Get bonding curve for THIS token (unique)
  const bc = token.bondingCurve;

  // 2. Fetch recent transactions for this BC
  const txs = await connection.getSignaturesForAddress(bc);

  // 3. For each new transaction
  for (const tx of txs) {
    // 4. Extract vault balance change
    const details = await connection.getTransaction(tx.signature);
    const vaultChange = details.meta.postBalances[vaultIndex]
                      - details.meta.preBalances[vaultIndex];

    // 5. Attribute to THIS token (we polled its BC)
    if (vaultChange > 0) {
      await updatePendingFees(token.mint, vaultChange);
    }
  }
}
```

### Why This Works

- Each token has a UNIQUE bonding curve/AMM pool
- Transactions to that pool can only be for THAT token
- Vault balance change in those transactions → that token's fees

---

## Cycle Execution

### Fee Allocation Formula

```typescript
// Total fees available
const totalFees = await getCreatorVaultBalance();

// Get all token pending fees
const pendingFees = await Promise.all(
  tokens.map(t => getTokenStatsPendingFees(t.mint))
);

// Calculate proportional allocation
const totalPending = pendingFees.reduce((a, b) => a + b, 0);

for (let i = 0; i < tokens.length; i++) {
  const proportion = pendingFees[i] / totalPending;
  const allocation = Math.floor(totalFees * proportion);

  // Execute cycle for this token with allocation
  await executeCycle(tokens[i], allocation);
}
```

### Fee Split Calculation

```typescript
const FEE_SPLIT_BPS = 5520; // 55.2%

// For secondary tokens
const totalAllocation = 10_000_000; // 0.01 SOL
const keepForBuyback = (totalAllocation * FEE_SPLIT_BPS) / 10000;
// keepForBuyback = 5,520,000 lamports (55.2%)

const sendToRoot = totalAllocation - keepForBuyback;
// sendToRoot = 4,480,000 lamports (44.8%)

// Actual buy amount (after rent reserves)
const ATA_RENT_RESERVE = 2_100_000;
const buyAmount = keepForBuyback - ATA_RENT_RESERVE;
// buyAmount = 3,420,000 lamports
```

### Minimum Thresholds

```typescript
// Minimum allocation for secondary to execute
const MIN_ALLOCATION_SECONDARY = Math.ceil(
  (RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + ATA_RENT_RESERVE + MINIMUM_BUY_AMOUNT)
  / 0.552  // SECONDARY_KEEP_RATIO
);
// ≈ 5,690,000 lamports (0.00569 SOL)

// Add TX fee reserve
const TX_FEE_RESERVE = 7_000_000;
const TOTAL_COST_PER_TOKEN = MIN_ALLOCATION_SECONDARY + TX_FEE_RESERVE;
// ≈ 12,690,000 lamports (0.0127 SOL per token)
```

---

## Token Configuration

### Config File Format

```json
{
  "mint": "9Gs59vJFFZWfZ72j7BNiTyzUPovH5oMVtTjGnrATECMG",
  "bondingCurve": "DJjzewWZSTt3mhqkQgSE46Qs2qG25wRN1z2CyQAGGq85",
  "creator": "84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68",
  "name": "DAT Token",
  "symbol": "DATSPL",
  "isRoot": true,
  "poolType": "bonding_curve",
  "tokenProgram": "SPL",
  "network": "devnet"
}
```

### Key Fields

| Field | Required | Description |
|-------|----------|-------------|
| `mint` | Yes | Token mint address |
| `bondingCurve` | Yes (BC) | Bonding curve PDA |
| `pool` | Yes (AMM) | PumpSwap pool address |
| `creator` | Yes | Creator wallet (DAT authority) |
| `isRoot` | Yes | true for root token |
| `poolType` | Yes | `bonding_curve` or `pumpswap_amm` |
| `tokenProgram` | Yes | `SPL` or `Token2022` |

### Adding New Tokens

```bash
# 1. Create config file
cat > devnet-tokens/99-newtoken.json << 'EOF'
{
  "mint": "NEW_MINT_ADDRESS",
  "bondingCurve": "BC_ADDRESS",
  ...
}
EOF

# 2. Initialize TokenStats on-chain
npx ts-node scripts/init-token-stats.ts devnet-tokens/99-newtoken.json --network devnet

# 3. Restart daemon (auto-detects new tokens)
pkill -f monitor-ecosystem-fees
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &
```

---

## Error Handling

### Common Errors

| Error | Code | Cause | Solution |
|-------|------|-------|----------|
| `DATNotActive` | 6000 | is_active=false or emergency_pause | Check state, resume if paused |
| `InsufficientFees` | 6001 | Below MIN_FEES_FOR_SPLIT | Generate more volume |
| `CycleTooSoon` | 6003 | < 60s since last cycle | Wait for cooldown |
| `InvalidRootToken` | 6008 | Root token not configured | Run set_root_token |
| `InvalidRootTreasury` | 6009 | PDA mismatch | Check root token mint |

### Error Recovery

```typescript
try {
  await executeCycle(token, allocation);
} catch (error) {
  if (error.message.includes('InsufficientFees')) {
    console.log('Not enough fees accumulated. Need more trading volume.');
    // Wait and retry later
  } else if (error.message.includes('CycleTooSoon')) {
    const waitTime = MIN_CYCLE_INTERVAL - timeSinceLastCycle;
    console.log(`Waiting ${waitTime}s for cooldown...`);
    await sleep(waitTime * 1000);
    // Retry
  } else {
    // Record failure on-chain
    await recordFailure(errorCode);
    throw error;
  }
}
```

---

## Security

### Admin Operations

```typescript
// Two-step admin transfer
// Step 1: Current admin proposes
await program.methods.proposeAdminTransfer(newAdmin)
  .accounts({ datState, admin: currentAdmin })
  .rpc();

// Step 2: New admin accepts
await program.methods.acceptAdminTransfer()
  .accounts({ datState, proposedAdmin: newAdmin })
  .rpc();
```

### Fee Split Changes

```typescript
// Small changes (≤ 5%) - instant
await program.methods.updateFeeSplit(5520 + 200) // +2%
  .accounts({ datState, admin })
  .rpc();

// Large changes (> 5%) - timelocked
await program.methods.proposeFeeSplit(7000) // 70%
  .accounts({ datState, admin })
  .rpc();

// Wait for cooldown (1 hour default)
await sleep(3600 * 1000);

await program.methods.executeFeeSplit()
  .accounts({ datState, admin })
  .rpc();
```

### Emergency Procedures

```typescript
// Pause everything
await program.methods.emergencyPause()
  .accounts({ datState, admin })
  .rpc();

// Resume when safe
await program.methods.resume()
  .accounts({ datState, admin })
  .rpc();
```

### Best Practices

1. **Never share wallet files** - Use hardware wallets for mainnet
2. **Test on devnet first** - Always validate changes before mainnet
3. **Monitor consecutive failures** - Auto-pause at 5 triggers investigation
4. **Verify PDAs** - Always derive and compare, never trust input
5. **Check balances before operations** - Ensure sufficient SOL for rent + fees

---

## Testing

### Unit Tests (Devnet)

```bash
# Full ecosystem test
npx ts-node scripts/complete-ecosystem-validation.ts --network devnet
```

### Manual Testing Workflow

```bash
# 1. Check initial state
npx ts-node scripts/check-current-stats.ts --network devnet

# 2. Generate volume (buy + sell for maximum fees)
for i in {1..2}; do
  npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 1 0.5
  npx ts-node scripts/sell-spl-tokens-simple.ts devnet-tokens/01-froot.json
  sleep 5
done

# 3. Wait for daemon sync
sleep 30

# 4. Check pending fees
npx ts-node scripts/check-current-stats.ts --network devnet

# 5. Execute cycle
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet

# 6. Verify results
npx ts-node scripts/check-current-stats.ts --network devnet
```

### Minimum Volume for Testing

To reach 0.006 SOL fees (minimum for cycle execution) with ~0.3% creator fee:

```
Required volume = 0.006 / 0.003 = 2 SOL per token
Approach: 2 rounds of 0.5 SOL buy + sell = ~0.006 SOL fees
```

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `execute-ecosystem-cycle.ts` | Main orchestrator |
| `monitor-ecosystem-fees.ts` | Fee daemon |
| `generate-volume.ts` | Buy tokens |
| `sell-spl-tokens-simple.ts` | Sell SPL tokens |
| `check-current-stats.ts` | View TokenStats |
| `check-dat-state.ts` | View DATState |
| `check-fees.ts` | View vault balances |
| `init-dat-state.ts` | Initialize DAT |
| `init-token-stats.ts` | Initialize TokenStats |
| `set-root-token.ts` | Configure root token |
| `validate-tokens.ts` | Validate configs |

---

*For full instruction documentation, see [API Reference](API_REFERENCE.md).*
*For operational procedures, see [Operations](OPERATIONS.md).*

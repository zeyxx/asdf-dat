# ASDF-DAT Glossary

Technical terminology and definitions for the ASDF-DAT protocol.

---

## Core Concepts

### DAT (Decentralized Autonomous Treasury)
On-chain protocol that automates fee collection and buyback/burn cycles for pump.fun tokens. DAT creates economic alignment between tokens through automatic fee capture and redistribution.

### Root Token
The central token of the DAT ecosystem. In Phase 1, this is $asdfasdfa (also referred to as $ASDF in formal documentation).
- **Phase 1**: Receives 44.8% of all secondary token fees
- **Phase 2**: Receives 5.52% of ALL integrated DAT fees across the ecosystem

### Secondary Token
A token connected to a DAT ecosystem that:
- Benefits from automated buyback/burn on its own trading fees
- Contributes a portion of fees to the root token treasury

### CCM (Creator Capital Markets)
The broader pump.fun ecosystem where creators launch tokens. ASDF-DAT provides sustainability infrastructure for CCM tokens.

---

## Economic Mechanics

### Buyback
The process of using collected SOL fees to purchase tokens from the open market (bonding curve or AMM). Creates buy pressure and reduces circulating supply.

### Burn
Permanently destroying tokens by transferring them to an inaccessible address. Combined with buyback, this creates deflationary pressure.

### Cycle
One complete execution of the DAT mechanism:
1. Collect fees from creator vault
2. Execute buyback on the market
3. Burn purchased tokens
4. Update on-chain statistics

### Fee Split
The percentage distribution of collected fees between parties:
- **Phase 1**: 55.2% secondary / 44.8% root
- **Phase 2**: Configurable per DAT, with 5.52% protocol fee to root

### Creator Fee
Dynamic fee charged by pump.fun on all trades. Percentage varies by market cap:
- Low market cap (~$88K): up to 0.95%
- High market cap (>$20M): down to 0.05%

---

## Technical Terms

### PDA (Program Derived Address)
Deterministic Solana addresses controlled by the program. Used for:
- `dat_v3`: Global DAT state
- `auth_v3`: DAT authority (holds SOL between operations)
- `token_stats_v1`: Per-token statistics
- `root_treasury`: Accumulated fees for root token buyback

### Creator Vault
Pump.fun account where creator fees accumulate. All tokens from the same creator share a single vault.

### Bonding Curve
Pre-migration pump.fun pricing mechanism. Program ID: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`

### PumpSwap AMM
Post-migration pump.fun automated market maker. Program ID: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`

### Token-2022
Solana's extended token program with additional features (transfer hooks, metadata, etc.). Used for "Mayhem Mode" tokens.

---

## System Components

### Fee Monitor Daemon
Background process that:
- Polls bonding curves/AMMs for transactions
- Attributes fees to specific tokens (shared vault problem)
- Updates on-chain `pending_fees` via `update_pending_fees` instruction

### Ecosystem Orchestrator
Main execution script (`execute-ecosystem-cycle.ts`) that:
- Reads pending fees from all tokens
- Calculates proportional allocation
- Executes batched buyback/burn cycles
- Handles the N+1 pattern for efficiency

### DAT State
Global on-chain configuration account containing:
- Admin pubkey
- Root token mint
- Fee split basis points
- Active/pause flags

### Token Stats
Per-token on-chain account tracking:
- Total tokens burned
- Total SOL collected
- Pending fees (awaiting next cycle)
- Root token flag

---

## Phase-Specific Terms

### Phase 1: Validation
Current phase focused on proving the DAT mechanism works with a single ecosystem ($asdfasdfa + secondary tokens). Uses 55.2%/44.8% split.

### Phase 2: Universal Infrastructure
Future phase where DAT becomes permissionless infrastructure for any pump.fun token. Each integrated DAT sends 5.52% to $asdfasdfa as protocol fee.

### Protocol Fee (Phase 2)
The 5.52% of all collected fees that each integrated DAT sends to the root token ($asdfasdfa). This makes $asdfasdfa an "index fund" of the entire DAT ecosystem.

### Index Fund Effect
As more DATs integrate, $asdfasdfa holders gain exposure to the entire ecosystem's trading activity without needing to hold individual tokens.

---

## Constants (from lib.rs)

| Constant | Value | Description |
|----------|-------|-------------|
| `MIN_FEES_TO_CLAIM` | 0.01 SOL | Minimum fees required for cycle |
| `MAX_FEES_PER_CYCLE` | 1 SOL | Maximum fees processed per cycle |
| `MIN_CYCLE_INTERVAL` | 60 seconds | Minimum time between cycles |
| `INITIAL_SLIPPAGE_BPS` | 500 (5%) | Default slippage tolerance |
| `fee_split_bps` | 5520 | Phase 1 split (55.2% secondary) |

---

## Abbreviations

| Abbrev | Full Term |
|--------|-----------|
| DAT | Decentralized Autonomous Treasury |
| CCM | Creator Capital Markets |
| PDA | Program Derived Address |
| BPS | Basis Points (1 BPS = 0.01%) |
| AMM | Automated Market Maker |
| SOL | Solana native token |
| TX | Transaction |
| ATA | Associated Token Account |

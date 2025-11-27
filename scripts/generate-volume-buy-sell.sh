#!/bin/bash

###############################################################################
# GENERATE VOLUME WITH BUY + SELL CYCLES
# Maximizes fees while recovering capital
###############################################################################

set -e

echo "💹 VOLUME GENERATION - BUY & SELL CYCLES"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Configuration
NUM_CYCLES=30      # 30 buy+sell cycles per token (INCREASED for rent fix, adjusted for balance)
BUY_AMOUNT=0.1     # 0.1 SOL per buy (INCREASED for rent fix)

# Fee structure (approximate):
# - Buy fee: 1% of volume
# - Sell fee: 1% of volume
# Per cycle: 0.1 SOL * 2% = 0.002 SOL fees
# Per token: 30 cycles * 0.002 = 0.06 SOL fees
# Total: 0.18 SOL fees across 3 tokens (enough for secondary token rent!)
# Min required for secondary: 0.0055 SOL - we generate 0.06 SOL ✅

echo "💡 SMART STRATEGY: Buy then Sell"
echo ""
echo "  Cycles per token: $NUM_CYCLES"
echo "  Amount per buy: $BUY_AMOUNT SOL"
echo "  Expected fees per cycle: ~0.002 SOL"
echo "  Expected fees per token: ~0.06 SOL"
echo "  Expected TOTAL fees: ~0.18 SOL"
echo ""
echo "  Capital required: ~3 SOL max (recovered after each sell!)"
echo "  Wallet balance: $(solana balance devnet-wallet.json --url devnet | awk '{print $1}') SOL"
echo ""
echo "  🎯 Target: Generate enough fees (0.0055+ SOL) for secondary token cycles"
echo "  ✅ Each token will generate 0.06 SOL (10x the minimum!)"
echo ""

read -p "▶️  Start volume generation? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled"
    exit 1
fi

echo ""
echo "🚀 Starting volume generation with buy+sell cycles..."
echo ""

# Function to execute buy+sell cycles
execute_cycles() {
    local TOKEN_FILE=$1
    local TOKEN_NAME=$2
    local BUY_SCRIPT=$3
    local SELL_SCRIPT=$4
    local COUNT=$5

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📈 $TOKEN_NAME - $COUNT buy+sell cycles"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    local SUCCESS=0
    local FAILED=0

    for i in $(seq 1 $COUNT); do
        local PERCENT=$((i * 100 / COUNT))
        local FILLED=$((PERCENT / 2))
        local PROGRESS=$(printf "%-50s" "$(printf '#%.0s' $(seq 1 $FILLED))")

        echo -ne "\r  [$PROGRESS] $PERCENT% ($i/$COUNT) "

        # BUY
        if npx ts-node "$BUY_SCRIPT" "$TOKEN_FILE" > /tmp/buy_${i}.log 2>&1; then
            sleep 1

            # SELL (sell all tokens we just bought)
            if npx ts-node "$SELL_SCRIPT" "$TOKEN_FILE" > /tmp/sell_${i}.log 2>&1; then
                SUCCESS=$((SUCCESS + 1))
            else
                FAILED=$((FAILED + 1))
            fi
        else
            FAILED=$((FAILED + 1))
        fi

        sleep 1
    done

    echo ""
    echo ""
    echo "  Results: ✅ $SUCCESS cycles, ❌ $FAILED failed"
    echo ""
}

# Check initial state
echo "📊 Initial State:"
npx ts-node -e "
import { Connection, PublicKey } from '@solana/web3.js';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const creator = new PublicKey('4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd');
const rootMint = new PublicKey('rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr');

const [vault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
const [treasury] = PublicKey.findProgramAddressSync([Buffer.from('root_treasury'), rootMint.toBuffer()], PROGRAM_ID);

Promise.all([conn.getBalance(vault), conn.getBalance(treasury)]).then(([v, t]) => {
  console.log('   Creator Vault: ' + (v/1e9).toFixed(6) + ' SOL');
  console.log('   Root Treasury: ' + (t/1e9).toFixed(6) + ' SOL');
  console.log('   Total: ' + ((v+t)/1e9).toFixed(6) + ' SOL');
});
"
echo ""

# Execute cycles on all tokens
execute_cycles "devnet-token-secondary.json" "DATS2 (Secondary)" \
    "scripts/buy-spl-tokens-simple.ts" "scripts/sell-spl-tokens-simple.ts" $NUM_CYCLES

execute_cycles "devnet-token-mayhem.json" "DATM (Mayhem)" \
    "scripts/buy-mayhem-tokens.ts" "scripts/sell-mayhem-tokens.ts" $NUM_CYCLES

execute_cycles "devnet-token-spl.json" "DATSPL (Root)" \
    "scripts/buy-spl-tokens-simple.ts" "scripts/sell-spl-tokens-simple.ts" $NUM_CYCLES

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ VOLUME GENERATION COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check final state
echo "📊 Final State:"
npx ts-node -e "
import { Connection, PublicKey } from '@solana/web3.js';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const creator = new PublicKey('4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd');
const rootMint = new PublicKey('rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr');

const [vault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
const [treasury] = PublicKey.findProgramAddressSync([Buffer.from('root_treasury'), rootMint.toBuffer()], PROGRAM_ID);

Promise.all([conn.getBalance(vault), conn.getBalance(treasury)]).then(([v, t]) => {
  const total = (v+t)/1e9;
  console.log('   Creator Vault: ' + (v/1e9).toFixed(6) + ' SOL');
  console.log('   Root Treasury: ' + (t/1e9).toFixed(6) + ' SOL');
  console.log('   Total Available: ' + total.toFixed(6) + ' SOL');
  console.log('');
  if (total >= 0.02) {
    console.log('   ✅ EXCELLENT! Sufficient fees for all cycles!');
  } else if (total >= 0.01) {
    console.log('   ✅ GOOD! Sufficient fees for cycles!');
  } else {
    console.log('   ⚠️  May need more volume');
  }
});
"

echo ""
echo "🎯 Ready to execute full ecosystem test!"
echo "   Run: bash scripts/manual-ecosystem-test.sh"
echo ""

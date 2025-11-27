#!/bin/bash

###############################################################################
# ULTRA-MASSIVE LIQUIDITY GENERATION
# Generates SUBSTANTIAL fees for complete ecosystem testing
###############################################################################

set -e

echo "💎 ULTRA-MASSIVE LIQUIDITY GENERATION"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Configuration - MUCH LARGER
NUM_PURCHASES=50  # 50 purchases per token
BUY_AMOUNT=0.1    # 0.1 SOL per purchase
                   # Per token: 50 * 0.1 = 5 SOL volume
                   # Fees: 5 SOL * 0.25% = ~0.0125 SOL per token
                   # Total fees across 3 tokens: ~0.0375 SOL

echo "⚠️  AGGRESSIVE CONFIGURATION ⚠️"
echo ""
echo "  Purchases per token: $NUM_PURCHASES"
echo "  Amount per purchase: $BUY_AMOUNT SOL"
echo "  Volume per token: $((NUM_PURCHASES * 10 / 10)).0 SOL"
echo "  Expected fees per token: ~0.0125 SOL"
echo "  Expected total fees: ~0.0375 SOL"
echo ""
echo "  TOTAL COST: ~$((NUM_PURCHASES * 3 / 10)).0 SOL"
echo ""

read -p "⚠️  This will spend ~15 SOL total. Continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled"
    exit 1
fi

echo ""
echo "🚀 Starting ULTRA-MASSIVE liquidity generation..."
echo "   This will take ~$(((NUM_PURCHASES * 3 * 2) / 60)) minutes (with 2s delays)"
echo ""

# Function to execute purchases with progress bar
execute_purchases() {
    local TOKEN_FILE=$1
    local TOKEN_NAME=$2
    local SCRIPT=$3
    local COUNT=$4

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📈 $TOKEN_NAME - $COUNT purchases"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    local SUCCESS=0
    local FAILED=0
    local PROGRESS_BAR=""

    for i in $(seq 1 $COUNT); do
        # Progress bar
        local PERCENT=$((i * 100 / COUNT))
        local FILLED=$((PERCENT / 2))
        PROGRESS_BAR=$(printf "%-50s" "$(printf '#%.0s' $(seq 1 $FILLED))")

        echo -ne "\r  [$PROGRESS_BAR] $PERCENT% ($i/$COUNT) "

        if npx ts-node "$SCRIPT" "$TOKEN_FILE" > /tmp/buy_output_${i}.log 2>&1; then
            SUCCESS=$((SUCCESS + 1))
        else
            FAILED=$((FAILED + 1))
        fi

        # Small delay
        sleep 2
    done

    echo ""
    echo ""
    echo "  Results: ✅ $SUCCESS successful, ❌ $FAILED failed"
    echo ""
}

# Check wallet balance
echo "💰 Checking wallet balance..."
BALANCE=$(solana balance devnet-wallet.json --url devnet | awk '{print $1}')
echo "   Current balance: $BALANCE SOL"
REQUIRED=$((NUM_PURCHASES * 3 / 10 + 1))
echo "   Required: ~$REQUIRED SOL"

if (( $(echo "$BALANCE < $REQUIRED" | bc -l) )); then
    echo ""
    echo "❌ Insufficient balance!"
    echo "   You need at least $REQUIRED SOL but have $BALANCE SOL"
    echo "   Get more devnet SOL with: solana airdrop 10 --url devnet"
    exit 1
fi

echo ""

# Check initial fees
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

# Execute purchases on all tokens
execute_purchases "devnet-token-secondary.json" "DATS2 (Secondary SPL)" "scripts/buy-spl-tokens-simple.ts" $NUM_PURCHASES
execute_purchases "devnet-token-mayhem.json" "DATM (Mayhem Token2022)" "scripts/buy-mayhem-tokens.ts" $NUM_PURCHASES
execute_purchases "devnet-token-spl.json" "DATSPL (Root SPL)" "scripts/buy-spl-tokens-simple.ts" $NUM_PURCHASES

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ ULTRA-MASSIVE LIQUIDITY GENERATION COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check final fees
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
  if (total >= 0.01) {
    console.log('   ✅ SUFFICIENT FEES for all cycles!');
  } else {
    console.log('   ⚠️  May need more fees (recommended: 0.01+ SOL)');
  }
});
"

echo ""
echo "🎯 Ready to execute cycles with SUBSTANTIAL fees!"
echo "   Run: bash scripts/manual-ecosystem-test.sh"
echo ""

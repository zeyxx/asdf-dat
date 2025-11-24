#!/bin/bash

###############################################################################
# MASSIVE LIQUIDITY GENERATION
# Generates substantial fees by making many token purchases
###############################################################################

set -e

echo "🌊 MASSIVE LIQUIDITY GENERATION"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Configuration
NUM_PURCHASES=25  # 25 purchases per token
BUY_AMOUNT=0.1    # 0.1 SOL per purchase = ~0.0025 SOL fees per purchase
                   # Total: 25 * 0.0025 = ~0.0625 SOL fees per token
                   # Grand Total: ~0.1875 SOL fees across all 3 tokens

echo "Configuration:"
echo "  Purchases per token: $NUM_PURCHASES"
echo "  Amount per purchase: $BUY_AMOUNT SOL"
echo "  Expected fees per token: ~0.0625 SOL"
echo "  Expected total fees: ~0.1875 SOL"
echo ""

read -p "⚠️  This will spend ~$((NUM_PURCHASES * 3)) * $BUY_AMOUNT = ~7.5 SOL. Continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled"
    exit 1
fi

echo ""
echo "🚀 Starting massive liquidity generation..."
echo ""

# Function to execute purchases with progress
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

    for i in $(seq 1 $COUNT); do
        echo -n "  [$i/$COUNT] Purchasing... "

        if npx ts-node "$SCRIPT" "$TOKEN_FILE" > /tmp/buy_output.log 2>&1; then
            SUCCESS=$((SUCCESS + 1))
            echo "✅"
        else
            FAILED=$((FAILED + 1))
            echo "❌"
        fi

        # Small delay between purchases
        sleep 1
    done

    echo ""
    echo "  Results: ✅ $SUCCESS successful, ❌ $FAILED failed"
    echo ""
}

# Check initial fees
echo "📊 Checking initial fees..."
npx ts-node -e "
import { Connection, PublicKey } from '@solana/web3.js';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const creator = new PublicKey('4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd');
const [vault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
conn.getBalance(vault).then(bal => {
  console.log('Initial Creator Vault: ' + (bal/1e9).toFixed(6) + ' SOL');
});
"
echo ""

# Execute purchases on all tokens
execute_purchases "devnet-token-secondary.json" "DATS2 (Secondary SPL)" "scripts/buy-spl-tokens-simple.ts" $NUM_PURCHASES
execute_purchases "devnet-token-mayhem.json" "DATM (Mayhem Token2022)" "scripts/buy-mayhem-tokens.ts" $NUM_PURCHASES
execute_purchases "devnet-token-spl.json" "DATSPL (Root SPL)" "scripts/buy-spl-tokens-simple.ts" $NUM_PURCHASES

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ LIQUIDITY GENERATION COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check final fees
echo "📊 Checking final fees..."
npx ts-node -e "
import { Connection, PublicKey } from '@solana/web3.js';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');
const creator = new PublicKey('4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd');
const rootMint = new PublicKey('rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr');

const [vault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
const [treasury] = PublicKey.findProgramAddressSync([Buffer.from('root_treasury'), rootMint.toBuffer()], PROGRAM_ID);

Promise.all([
  conn.getBalance(vault),
  conn.getBalance(treasury)
]).then(([vaultBal, treasuryBal]) => {
  console.log('Final Creator Vault: ' + (vaultBal/1e9).toFixed(6) + ' SOL');
  console.log('Final Root Treasury: ' + (treasuryBal/1e9).toFixed(6) + ' SOL');
  console.log('Total Available: ' + ((vaultBal + treasuryBal)/1e9).toFixed(6) + ' SOL');
});
"

echo ""
echo "🎯 Ready to execute cycles!"
echo "   Run: bash scripts/manual-ecosystem-test.sh"
echo ""

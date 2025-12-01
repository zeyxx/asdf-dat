#!/bin/bash

###############################################################################
# MANUAL ECOSYSTEM TEST
# Simple orchestrator that uses existing working scripts
###############################################################################

set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT="manual-test-report-${TIMESTAMP}.md"

echo "🚀 MANUAL ECOSYSTEM TEST - ${TIMESTAMP}"
echo "═════════════════════════════════════════════════════════"

# Create report header
cat > "$REPORT" << EOF
# 🧪 MANUAL ECOSYSTEM TEST REPORT

**Date:** $(date)
**Test ID:** ${TIMESTAMP}

---

## Test Procedure

This test validates the complete DAT ecosystem with proper fee distribution:
1. Capture initial states
2. Generate liquidity via purchases (optional, can use existing fees)
3. Execute cycles: DATS2 → DATM → DATSPL
4. Capture final states
5. Analyze fee distribution

---

EOF

echo ""
echo "📸 PHASE 1: CAPTURE INITIAL STATE"
echo "═════════════════════════════════════════════════════════"
echo ""
echo "## 📸 Initial State" >> "$REPORT"
echo "" >> "$REPORT"

# Capture initial balances
echo "Checking balances..." | tee -a "$REPORT"

npx ts-node -e "
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

async function captureState() {
  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('devnet-wallet.json', 'utf-8')))
  );

  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: 'confirmed' });
  const idl = JSON.parse(fs.readFileSync('target/idl/asdf_dat.json', 'utf-8'));
  if (idl.metadata) {
    idl.metadata.address = PROGRAM_ID.toString();
  } else {
    idl.metadata = { address: PROGRAM_ID.toString() };
  }
  const program = new Program(idl, provider);

  const creator = new PublicKey('4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd');
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  );

  const rootMint = new PublicKey('rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr');
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from('root_treasury'), rootMint.toBuffer()],
    PROGRAM_ID
  );

  const [datAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from('auth_v3')],
    PROGRAM_ID
  );

  const [vaultBal, treasuryBal, authBal] = await Promise.all([
    conn.getBalance(vault),
    conn.getBalance(treasury),
    conn.getBalance(datAuth),
  ]);

  console.log('| Account | Balance |');
  console.log('|---------|---------|');
  console.log('| Creator Vault (shared) | ' + (vaultBal/1e9).toFixed(6) + ' SOL |');
  console.log('| Root Treasury | ' + (treasuryBal/1e9).toFixed(6) + ' SOL |');
  console.log('| DAT Authority | ' + (authBal/1e9).toFixed(6) + ' SOL |');
  console.log('');
  console.log('**Total Fees Available:** ' + ((vaultBal + treasuryBal)/1e9).toFixed(6) + ' SOL');
}

captureState().catch(console.error);
" | tee -a "$REPORT"

echo ""
read -p "❓ Do you want to generate more liquidity by making purchases? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "💰 GENERATING LIQUIDITY"
    echo "═════════════════════════════════════════════════════════"
    echo "" >> "$REPORT"
    echo "## 💰 Liquidity Generation" >> "$REPORT"
    echo "" >> "$REPORT"

    echo "Making 3 purchases on DATS2..." | tee -a "$REPORT"
    for i in {1..3}; do
        echo "  Purchase $i/3..."
        npx ts-node scripts/buy-spl-tokens-simple.ts devnet-token-secondary.json 2>&1 | tail -3 || true
        sleep 2
    done

    echo ""
    echo "Making 3 purchases on DATM..." | tee -a "$REPORT"
    for i in {1..3}; do
        echo "  Purchase $i/3..."
        npx ts-node scripts/buy-mayhem-tokens.ts devnet-token-mayhem.json 2>&1 | tail -3 || true
        sleep 2
    done

    echo ""
    echo "Making 2 purchases on DATSPL..." | tee -a "$REPORT"
    for i in {1..2}; do
        echo "  Purchase $i/2..."
        npx ts-node scripts/buy-spl-tokens-simple.ts devnet-token-spl.json 2>&1 | tail -3 || true
        sleep 2
    done

    echo "✅ Liquidity generation complete" | tee -a "$REPORT"
    sleep 5
fi

echo ""
echo "🔄 PHASE 2: EXECUTE CYCLES"
echo "═════════════════════════════════════════════════════════"
echo "" >> "$REPORT"
echo "## 🔄 Cycle Executions" >> "$REPORT"
echo "" >> "$REPORT"

echo ""
echo "--- DATS2 (Secondary Token) ---"
echo "### DATS2 (Secondary Token)" >> "$REPORT"
echo "" >> "$REPORT"
npx ts-node scripts/execute-cycle-secondary.ts devnet-token-secondary.json 2>&1 | tee -a "$REPORT" || echo "❌ DATS2 cycle failed" | tee -a "$REPORT"
sleep 3

echo ""
echo "--- DATM (Mayhem/Secondary Token) ---"
echo "" >> "$REPORT"
echo "### DATM (Mayhem Token)" >> "$REPORT"
echo "" >> "$REPORT"
npx ts-node scripts/execute-cycle-secondary.ts devnet-token-mayhem.json 2>&1 | tee -a "$REPORT" || echo "❌ DATM cycle failed" | tee -a "$REPORT"
sleep 3

echo ""
echo "--- DATSPL (Root Token) ---"
echo "" >> "$REPORT"
echo "### DATSPL (Root Token)" >> "$REPORT"
echo "" >> "$REPORT"
npx ts-node scripts/execute-cycle-root.ts devnet-token-spl.json 2>&1 | tee -a "$REPORT" || echo "❌ DATSPL cycle failed" | tee -a "$REPORT"
sleep 3

echo ""
echo "📸 PHASE 3: CAPTURE FINAL STATE"
echo "═════════════════════════════════════════════════════════"
echo "" >> "$REPORT"
echo "## 📸 Final State" >> "$REPORT"
echo "" >> "$REPORT"

npx ts-node -e "
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

async function captureState() {
  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('devnet-wallet.json', 'utf-8')))
  );

  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: 'confirmed' });
  const idl = JSON.parse(fs.readFileSync('target/idl/asdf_dat.json', 'utf-8'));
  if (idl.metadata) {
    idl.metadata.address = PROGRAM_ID.toString();
  } else {
    idl.metadata = { address: PROGRAM_ID.toString() };
  }
  const program = new Program(idl, provider);

  const creator = new PublicKey('4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd');
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  );

  const rootMint = new PublicKey('rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr');
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from('root_treasury'), rootMint.toBuffer()],
    PROGRAM_ID
  );

  const [datAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from('auth_v3')],
    PROGRAM_ID
  );

  const [vaultBal, treasuryBal, authBal] = await Promise.all([
    conn.getBalance(vault),
    conn.getBalance(treasury),
    conn.getBalance(datAuth),
  ]);

  console.log('| Account | Balance |');
  console.log('|---------|---------|');
  console.log('| Creator Vault (shared) | ' + (vaultBal/1e9).toFixed(6) + ' SOL |');
  console.log('| Root Treasury | ' + (treasuryBal/1e9).toFixed(6) + ' SOL |');
  console.log('| DAT Authority | ' + (authBal/1e9).toFixed(6) + ' SOL |');
}

captureState().catch(console.error);
" | tee -a "$REPORT"

echo ""
echo "═════════════════════════════════════════════════════════"
echo "✅ TEST COMPLETE"
echo "═════════════════════════════════════════════════════════"
echo ""
echo "📄 Report saved: $REPORT"
echo ""
echo "View with: cat $REPORT"
echo ""

#!/bin/bash

#############################################################################
# COMPLETE ECOSYSTEM TEST - Execute full cycles on all 3 tokens
#
# This script:
# 1. Captures initial state
# 2. Executes cycle on DATS2 (secondary)
# 3. Executes cycle on DATSPL (root)
# 4. Executes cycle on DATM (mayhem)
# 5. Captures final state
# 6. Generates comparison report
#############################################################################

set -e  # Exit on error

RESET='\033[0m'
BOLD='\033[1m'
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
MAGENTA='\033[35m'

log() {
    echo -e "${2}${1}${RESET}"
}

section() {
    echo ""
    echo -e "${BOLD}${MAGENTA}════════════════════════════════════════════════════════════════${RESET}"
    echo -e "${BOLD}${MAGENTA}  $1${RESET}"
    echo -e "${BOLD}${MAGENTA}════════════════════════════════════════════════════════════════${RESET}"
    echo ""
}

# Create timestamp for report
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="ecosystem-test-report-${TIMESTAMP}.md"

log "🚀 COMPLETE ECOSYSTEM TEST - Starting..." "$BOLD$GREEN"
log "📅 Timestamp: $(date)" "$CYAN"
log "📄 Report will be saved to: $REPORT_FILE" "$CYAN"

# Initialize report
cat > "$REPORT_FILE" << EOF
# 🧪 COMPLETE ECOSYSTEM TEST REPORT

**Date:** $(date)
**Test ID:** ${TIMESTAMP}

---

## 📊 Test Configuration

- **Network:** Solana Devnet
- **Program ID:** ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ
- **Tokens Tested:**
  - DATSPL (Root Token - SPL)
  - DATS2 (Secondary Token - SPL)
  - DATM (Mayhem Token - Token2022)

---

EOF

#############################################################################
section "PHASE 1: CAPTURE INITIAL STATE"
#############################################################################

log "📸 Capturing initial state of all tokens..." "$CYAN"

# Function to capture token state
capture_state() {
    local TOKEN_FILE=$1
    local TOKEN_NAME=$2

    log "  → Capturing $TOKEN_NAME..." "$YELLOW"

    # Read token info
    MINT=$(cat "$TOKEN_FILE" | jq -r '.mint')
    CREATOR=$(cat "$TOKEN_FILE" | jq -r '.creator')

    # Get creator vault balance
    VAULT_BALANCE=$(solana account $(echo "$CREATOR" | xargs -I{} sh -c 'solana address-from-seed creator-vault --program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P --base {}') --url devnet 2>/dev/null | grep "Balance:" | awk '{print $2}' || echo "0")

    # Get DAT authority balance
    DAT_AUTH="4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd"
    AUTH_BALANCE=$(solana balance "$DAT_AUTH" --url devnet | awk '{print $1}')

    log "    Creator Vault: $VAULT_BALANCE SOL" "$GREEN"
    log "    DAT Authority: $AUTH_BALANCE SOL" "$GREEN"

    # Save to temp file
    echo "$TOKEN_NAME,$VAULT_BALANCE,$AUTH_BALANCE" >> "initial_state_${TIMESTAMP}.csv"
}

# Capture state for all tokens
capture_state "devnet-token-spl.json" "DATSPL"
capture_state "devnet-token-secondary.json" "DATS2"
capture_state "devnet-token-mayhem.json" "DATM"

log "✅ Initial state captured!" "$GREEN"

cat >> "$REPORT_FILE" << EOF
## 📸 Initial State

| Token | Creator Vault | DAT Authority |
|-------|---------------|---------------|
EOF

while IFS=',' read -r token vault auth; do
    echo "| $token | $vault SOL | $auth SOL |" >> "$REPORT_FILE"
done < "initial_state_${TIMESTAMP}.csv"

echo "" >> "$REPORT_FILE"

#############################################################################
section "PHASE 2: EXECUTE CYCLES"
#############################################################################

# Counter for successful cycles
SUCCESS_COUNT=0
TOTAL_TESTS=3

#############################################################################
log "🔄 [1/3] Executing cycle on DATS2 (Secondary Token)..." "$BOLD$CYAN"
#############################################################################

cat >> "$REPORT_FILE" << EOF
---

## 🔄 DATS2 (Secondary Token) - Cycle Execution

EOF

if npx ts-node scripts/execute-cycle-root.ts devnet-token-secondary.json 2>&1 | tee -a "$REPORT_FILE"; then
    log "✅ DATS2 cycle completed successfully!" "$GREEN"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo "**Result:** ✅ SUCCESS" >> "$REPORT_FILE"
else
    log "❌ DATS2 cycle failed!" "$RED"
    echo "**Result:** ❌ FAILED" >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"
sleep 3

#############################################################################
log "🔄 [2/3] Executing cycle on DATSPL (Root Token)..." "$BOLD$CYAN"
#############################################################################

cat >> "$REPORT_FILE" << EOF
---

## 🏆 DATSPL (Root Token) - Cycle Execution

EOF

if npx ts-node scripts/execute-cycle-root.ts devnet-token-spl.json 2>&1 | tee -a "$REPORT_FILE"; then
    log "✅ DATSPL cycle completed successfully!" "$GREEN"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo "**Result:** ✅ SUCCESS" >> "$REPORT_FILE"
else
    log "❌ DATSPL cycle failed!" "$RED"
    echo "**Result:** ❌ FAILED" >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"
sleep 3

#############################################################################
log "🔄 [3/3] Executing cycle on DATM (Mayhem Token)..." "$BOLD$CYAN"
#############################################################################

cat >> "$REPORT_FILE" << EOF
---

## 💥 DATM (Mayhem Token) - Cycle Execution

EOF

if npx ts-node scripts/execute-cycle-root.ts devnet-token-mayhem.json 2>&1 | tee -a "$REPORT_FILE"; then
    log "✅ DATM cycle completed successfully!" "$GREEN"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo "**Result:** ✅ SUCCESS" >> "$REPORT_FILE"
else
    log "❌ DATM cycle failed!" "$RED"
    echo "**Result:** ❌ FAILED" >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"

#############################################################################
section "PHASE 3: CAPTURE FINAL STATE"
#############################################################################

log "📸 Capturing final state of all tokens..." "$CYAN"

# Clear temp file
rm -f "final_state_${TIMESTAMP}.csv"

# Capture final state for all tokens
capture_state "devnet-token-spl.json" "DATSPL"
capture_state "devnet-token-secondary.json" "DATS2"
capture_state "devnet-token-mayhem.json" "DATM"

log "✅ Final state captured!" "$GREEN"

cat >> "$REPORT_FILE" << EOF
---

## 📸 Final State

| Token | Creator Vault | DAT Authority |
|-------|---------------|---------------|
EOF

while IFS=',' read -r token vault auth; do
    echo "| $token | $vault SOL | $auth SOL |" >> "$REPORT_FILE"
done < "final_state_${TIMESTAMP}.csv"

echo "" >> "$REPORT_FILE"

#############################################################################
section "PHASE 4: GENERATE SUMMARY"
#############################################################################

log "📊 Generating test summary..." "$CYAN"

cat >> "$REPORT_FILE" << EOF
---

## 📊 Test Summary

- **Total Tests:** $TOTAL_TESTS
- **Successful:** $SUCCESS_COUNT
- **Failed:** $((TOTAL_TESTS - SUCCESS_COUNT))
- **Success Rate:** $((SUCCESS_COUNT * 100 / TOTAL_TESTS))%

EOF

if [ $SUCCESS_COUNT -eq $TOTAL_TESTS ]; then
    log "✅ ALL TESTS PASSED! ($SUCCESS_COUNT/$TOTAL_TESTS)" "$BOLD$GREEN"
    echo "**Overall Status:** ✅ ALL TESTS PASSED" >> "$REPORT_FILE"
    EXIT_CODE=0
else
    log "⚠️  SOME TESTS FAILED ($SUCCESS_COUNT/$TOTAL_TESTS)" "$BOLD$YELLOW"
    echo "**Overall Status:** ⚠️ SOME TESTS FAILED" >> "$REPORT_FILE"
    EXIT_CODE=1
fi

echo "" >> "$REPORT_FILE"
echo "---" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "*Generated by run-complete-ecosystem-test.sh on Solana Devnet*" >> "$REPORT_FILE"

# Cleanup temp files
rm -f "initial_state_${TIMESTAMP}.csv" "final_state_${TIMESTAMP}.csv"

#############################################################################
section "TEST COMPLETE"
#############################################################################

log "📄 Full report saved to: $REPORT_FILE" "$BOLD$CYAN"
log "📋 View with: cat $REPORT_FILE" "$CYAN"
echo ""

exit $EXIT_CODE

#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# ASDF Burn Engine E2E Test Runner
# ═══════════════════════════════════════════════════════════════════════════
#
# Usage:
#   ./scripts/run-e2e-tests.sh                    # Run on devnet
#   ./scripts/run-e2e-tests.sh --network mainnet  # Run on mainnet
#   ./scripts/run-e2e-tests.sh --skip-volume      # Skip volume generation
#   ./scripts/run-e2e-tests.sh --dry-run          # Dry run (no transactions)
#
# Exit codes:
#   0 - All tests passed
#   1 - Some tests failed
#   2 - Script error
#
# "Flush. Burn. Verify. This is fine."
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Default values
NETWORK="devnet"
EXTRA_ARGS=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --network)
      NETWORK="$2"
      shift 2
      ;;
    --skip-volume)
      EXTRA_ARGS="$EXTRA_ARGS --skip-volume"
      shift
      ;;
    --dry-run)
      EXTRA_ARGS="$EXTRA_ARGS --dry-run"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--network devnet|mainnet] [--skip-volume] [--dry-run]"
      echo ""
      echo "Options:"
      echo "  --network      Network to run tests on (default: devnet)"
      echo "  --skip-volume  Skip trading volume generation"
      echo "  --dry-run      Simulate without executing transactions"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 2
      ;;
  esac
done

# Validate network
if [[ "$NETWORK" != "devnet" && "$NETWORK" != "mainnet" ]]; then
  echo -e "${RED}Invalid network: $NETWORK${NC}"
  exit 2
fi

# Header
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo -e "  ${BLUE}ASDF Burn Engine E2E Test Runner${NC}"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo -e "Network:    ${GREEN}$NETWORK${NC}"
echo -e "Project:    $PROJECT_DIR"
echo -e "Timestamp:  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Change to project directory
cd "$PROJECT_DIR"

# Check dependencies
echo -e "${BLUE}Checking dependencies...${NC}"

if ! command -v npx &> /dev/null; then
  echo -e "${RED}npx not found. Please install Node.js.${NC}"
  exit 2
fi

if [ ! -f "package.json" ]; then
  echo -e "${RED}package.json not found. Are you in the project directory?${NC}"
  exit 2
fi

# Check wallet
WALLET_FILE="${NETWORK}-wallet.json"
if [ ! -f "$WALLET_FILE" ]; then
  echo -e "${RED}Wallet file not found: $WALLET_FILE${NC}"
  exit 2
fi
echo -e "${GREEN}✓${NC} Wallet found: $WALLET_FILE"

# Check token configs
TOKENS_DIR="${NETWORK}-tokens"
if [ ! -d "$TOKENS_DIR" ]; then
  echo -e "${RED}Token configs not found: $TOKENS_DIR${NC}"
  exit 2
fi
TOKEN_COUNT=$(ls -1 "$TOKENS_DIR"/*.json 2>/dev/null | wc -l)
echo -e "${GREEN}✓${NC} Token configs: $TOKEN_COUNT files in $TOKENS_DIR"

# Check program IDL
if [ ! -f "target/idl/asdf_dat.json" ]; then
  echo -e "${YELLOW}Warning: IDL not found. Running anchor build...${NC}"
  anchor build
fi
echo -e "${GREEN}✓${NC} IDL found"

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo -e "  ${BLUE}Running E2E Tests${NC}"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Run E2E tests
set +e
npx ts-node scripts/e2e-cycle-validation.ts --network "$NETWORK" $EXTRA_ARGS
EXIT_CODE=$?
set -e

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "  ${GREEN}ALL TESTS PASSED${NC}"
else
  echo -e "  ${RED}SOME TESTS FAILED${NC}"
fi
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "Exit code: $EXIT_CODE"
echo "Reports:   $(ls -1 reports/e2e-*.md 2>/dev/null | tail -1 || echo 'None')"
echo ""

exit $EXIT_CODE

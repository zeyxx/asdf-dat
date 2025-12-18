#!/bin/bash

# ASDF DAT Monitoring Script
# Real-time monitoring and metrics for the DAT bot

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
LOG_FILE="${LOG_FILE:-./logs/dat-bot.log}"
WALLET_PATH="${WALLET_PATH:-./wallet.json}"
RPC_URL="${RPC_URL:-https://api.mainnet-beta.solana.com}"
REFRESH_INTERVAL=5  # Seconds between updates

# Fixed addresses
CTO_WALLET="vcGYZbvDid6cRUkCCqcWpBxow73TLpmY6ipmDUtrTF8"
ASDF_MINT="9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump"
PROGRAM_ID="${PROGRAM_ID:-ASDFdatBuybackBurnXXXXXXXXXXXXXXXXXXXXXXXXX}"

# Print functions
print_header() {
    clear
    echo -e "${CYAN}${BOLD}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              ASDF DAT MONITORING DASHBOARD                  ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "${BLUE}Time:${NC} $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
}

print_section() {
    echo -e "${MAGENTA}${BOLD}━━━ $1 ━━━${NC}"
}

format_number() {
    printf "%'d" $1
}

format_sol() {
    echo "$(echo "scale=4; $1 / 1000000000" | bc) SOL"
}

# Check if required commands exist
check_dependencies() {
    local missing_deps=()
    
    if ! command -v solana &> /dev/null; then
        missing_deps+=("solana")
    fi
    
    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq")
    fi
    
    if ! command -v bc &> /dev/null; then
        missing_deps+=("bc")
    fi
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo -e "${RED}Missing dependencies: ${missing_deps[*]}${NC}"
        echo "Please install missing dependencies and try again."
        exit 1
    fi
}

# Get wallet balance
get_wallet_balance() {
    if [ -f "$WALLET_PATH" ]; then
        local wallet_address=$(solana address -k "$WALLET_PATH" 2>/dev/null)
        local balance=$(solana balance "$wallet_address" --url "$RPC_URL" 2>/dev/null | cut -d' ' -f1)
        echo "$balance"
    else
        echo "0"
    fi
}

# Get creator vault balance
get_creator_vault_balance() {
    local balance=$(solana balance "$CTO_WALLET" --url "$RPC_URL" 2>/dev/null | cut -d' ' -f1)
    echo "$balance"
}

# Get program status
get_program_status() {
    # Check if program account exists
    if solana account "$PROGRAM_ID" --url "$RPC_URL" &>/dev/null; then
        echo "DEPLOYED"
    else
        echo "NOT DEPLOYED"
    fi
}

# Parse recent logs
get_recent_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -n 10 "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
            if echo "$line" | grep -q "ERROR"; then
                echo -e "${RED}$line${NC}"
            elif echo "$line" | grep -q "SUCCESS\|✅"; then
                echo -e "${GREEN}$line${NC}"
            elif echo "$line" | grep -q "WARNING"; then
                echo -e "${YELLOW}$line${NC}"
            else
                echo "$line"
            fi
        done
    else
        echo "No log file found"
    fi
}

# Get bot process status
get_bot_status() {
    if pgrep -f "dat:bot" > /dev/null; then
        echo -e "${GREEN}RUNNING${NC}"
        local pid=$(pgrep -f "dat:bot")
        echo "PID: $pid"
    else
        echo -e "${RED}STOPPED${NC}"
    fi
}

# Calculate metrics
calculate_metrics() {
    local log_content=""
    if [ -f "$LOG_FILE" ]; then
        log_content=$(cat "$LOG_FILE" 2>/dev/null)
    fi
    
    # Count successful cycles
    local success_count=$(echo "$log_content" | grep -c "Cycle completed successfully" || echo "0")
    
    # Count failed cycles
    local fail_count=$(echo "$log_content" | grep -c "Failed to execute cycle" || echo "0")
    
    # Calculate success rate
    local total=$((success_count + fail_count))
    if [ $total -gt 0 ]; then
        local success_rate=$(echo "scale=2; $success_count * 100 / $total" | bc)
        echo "Success Rate: ${success_rate}%"
    else
        echo "Success Rate: N/A"
    fi
    
    echo "Successful Cycles: $success_count"
    echo "Failed Cycles: $fail_count"
}

# Get estimated burn stats
get_burn_stats() {
    # These would be parsed from actual program data in production
    echo "Estimated Daily Burn: 135,000 ASDF"
    echo "Monthly Supply Impact: -0.4%"
    echo "Total Burned: N/A (check on-chain)"
}

# Main monitoring loop
main() {
    check_dependencies
    
    echo -e "${CYAN}Starting ASDF DAT Monitor...${NC}"
    echo "Press Ctrl+C to exit"
    sleep 2
    
    while true; do
        print_header
        
        # System Status
        print_section "SYSTEM STATUS"
        echo -e "Bot Status: $(get_bot_status)"
        echo -e "Program Status: ${BOLD}$(get_program_status)${NC}"
        echo ""
        
        # Wallet Information
        print_section "WALLET INFORMATION"
        if [ -f "$WALLET_PATH" ]; then
            echo "Wallet Address: $(solana address -k "$WALLET_PATH" 2>/dev/null)"
            echo "Wallet Balance: $(get_wallet_balance) SOL"
        else
            echo -e "${RED}Wallet not found${NC}"
        fi
        echo "Creator Vault Balance: $(get_creator_vault_balance) SOL"
        echo ""
        
        # Performance Metrics
        print_section "PERFORMANCE METRICS"
        calculate_metrics
        echo ""
        
        # Burn Statistics
        print_section "BURN STATISTICS"
        get_burn_stats
        echo ""
        
        # Recent Activity
        print_section "RECENT ACTIVITY"
        get_recent_logs
        echo ""
        
        # Network Info
        print_section "NETWORK INFO"
        echo "RPC Endpoint: $RPC_URL"
        echo "Network: Solana Mainnet"
        
        # Refresh countdown
        echo ""
        echo -e "${CYAN}Refreshing in $REFRESH_INTERVAL seconds... (Press Ctrl+C to exit)${NC}"
        
        # Check for alerts
        local wallet_balance=$(get_wallet_balance)
        if (( $(echo "$wallet_balance < 0.1" | bc -l) )); then
            echo -e "${RED}${BOLD}⚠ ALERT: Low wallet balance! Please add SOL for gas fees.${NC}"
        fi
        
        local creator_balance=$(get_creator_vault_balance)
        if (( $(echo "$creator_balance >= 0.05" | bc -l) )); then
            echo -e "${GREEN}${BOLD}✓ Creator vault has sufficient fees for cycle execution${NC}"
        fi
        
        sleep $REFRESH_INTERVAL
    done
}

# Handle script termination
trap 'echo -e "\n${CYAN}Monitor stopped.${NC}"; exit 0' INT TERM

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --interval)
            REFRESH_INTERVAL="$2"
            shift 2
            ;;
        --log)
            LOG_FILE="$2"
            shift 2
            ;;
        --rpc)
            RPC_URL="$2"
            shift 2
            ;;
        --help)
            echo "ASDF DAT Monitor"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --interval <seconds>  Set refresh interval (default: 5)"
            echo "  --log <path>         Path to log file"
            echo "  --rpc <url>          RPC endpoint URL"
            echo "  --help               Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Run the monitor
main

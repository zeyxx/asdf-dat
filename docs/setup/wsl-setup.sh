#!/bin/bash

# ========================================
# ASDF DAT - Devnet Setup Automation (WSL)
# ========================================
# Script bash pour automatiser le setup complet sur devnet
# Usage: bash devnet-wsl-setup.sh

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored messages
log_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_step() {
    echo -e "\n${CYAN}========================================${NC}"
    echo -e "${CYAN}$1${NC}"
    echo -e "${CYAN}========================================${NC}\n"
}

# Check if running in WSL
check_wsl() {
    if ! grep -qEi "(Microsoft|WSL)" /proc/version &> /dev/null; then
        log_warning "This script is optimized for WSL but will work on Linux too"
    else
        log_success "Running in WSL environment"
    fi
}

# Setup Solana environment
setup_solana() {
    log_step "[1/7] Configuring Solana for Devnet"
    
    # Add Solana to PATH if not already
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
    
    # Configure for devnet
    log_info "Setting network to devnet..."
    solana config set --url https://api.devnet.solana.com
    
    # Create or use existing devnet wallet
    if [ ! -f "./devnet-wallet.json" ]; then
        log_info "Creating new devnet wallet..."
        solana-keygen new -o devnet-wallet.json --no-bip39-passphrase
    else
        log_info "Using existing devnet wallet"
    fi
    
    # Set wallet
    solana config set --keypair ./devnet-wallet.json
    
    # Get wallet address
    WALLET_ADDRESS=$(solana address)
    log_success "Wallet address: $WALLET_ADDRESS"
    
    # Get SOL
    log_info "Requesting SOL airdrop (this may take a moment)..."
    solana airdrop 2 || log_warning "Airdrop failed, trying again..."
    sleep 5
    solana airdrop 2 || log_warning "Second airdrop failed, you may need to request manually"
    
    # Check balance
    BALANCE=$(solana balance)
    log_success "Current balance: $BALANCE"
    
    if (( $(echo "$BALANCE" | cut -d' ' -f1) < 2 )); then
        log_warning "Balance is low. You may need more SOL for deployment."
        log_info "Request more with: solana airdrop 2"
    fi
}

# Install project dependencies
install_dependencies() {
    log_step "[2/7] Installing Project Dependencies"
    
    log_info "Installing Node.js dependencies..."
    yarn install || npm install
    
    log_success "Dependencies installed"
}

# Create token on PumpFun devnet
create_token() {
    log_step "[3/7] Creating Token on PumpFun Devnet"
    
    log_info "Launching token creation script..."
    log_warning "This will create a new token on PumpFun devnet"
    
    # Run the token creation script
    if [ -f "./devnet-create-token-pumpfun-sdk.ts" ]; then
        ts-node devnet-create-token-pumpfun-sdk.ts
    else
        log_error "Token creation script not found!"
        log_info "Available scripts:"
        ls -1 devnet-*.ts
        exit 1
    fi
    
    # Verify config was created
    if [ ! -f "./devnet-config.json" ]; then
        log_error "devnet-config.json not created!"
        exit 1
    fi
    
    log_success "Token created and config saved"
    
    # Display token info
    if [ -f "./devnet-token-info.json" ]; then
        log_info "Token details:"
        cat devnet-token-info.json | jq -r '.token.mint' | xargs -I {} echo "  Mint: {}"
    fi
}

# Find bonding curve if needed
find_bonding_curve() {
    log_step "[4/7] Finding Bonding Curve Address"
    
    # Check if bonding curve is already in config
    BONDING_CURVE=$(cat devnet-config.json | jq -r '.bondingCurve // .pump.bondingCurve // .pumpfun.bondingCurve // "null"')
    
    if [ "$BONDING_CURVE" == "null" ] || [ -z "$BONDING_CURVE" ]; then
        log_info "Bonding curve not found in config, searching..."
        if [ -f "./devnet-find-bonding-curve.ts" ]; then
            ts-node devnet-find-bonding-curve.ts
        else
            log_warning "Bonding curve finder script not found"
            log_info "You may need to find it manually and update devnet-config.json"
        fi
    else
        log_success "Bonding curve found: $BONDING_CURVE"
    fi
}

# Apply configuration to code
apply_config() {
    log_step "[5/7] Applying Configuration to Code"
    
    log_info "Running configuration script..."
    ts-node devnet-apply-config.ts
    
    log_success "Configuration applied"
    
    # Verify changes
    log_info "Verifying changes in lib.rs..."
    grep -A2 "ASDF_MINT\|POOL_PUMPSWAP\|MIN_FEES_TO_CLAIM" programs/asdf-dat/src/lib.rs | head -15
}

# Build the program
build_program() {
    log_step "[6/7] Building Program"
    
    # Add cargo paths
    source $HOME/.cargo/env
    
    log_info "Building Anchor program..."
    anchor build
    
    # Get program ID
    PROGRAM_ID=$(solana address -k target/deploy/asdf_dat-keypair.json)
    log_success "Program built successfully"
    log_success "Program ID: $PROGRAM_ID"
    
    # Check if program ID needs to be updated
    CURRENT_ID=$(grep "declare_id!" programs/asdf-dat/src/lib.rs | cut -d'"' -f2)
    
    if [ "$PROGRAM_ID" != "$CURRENT_ID" ]; then
        log_warning "Program ID mismatch detected!"
        log_info "  Current in lib.rs: $CURRENT_ID"
        log_info "  Generated ID: $PROGRAM_ID"
        log_info ""
        log_warning "You need to update the Program ID:"
        log_info "1. Edit programs/asdf-dat/src/lib.rs"
        log_info "   Change: declare_id!(\"$CURRENT_ID\");"
        log_info "   To:     declare_id!(\"$PROGRAM_ID\");"
        log_info ""
        log_info "2. Edit Anchor.toml"
        log_info "   In [programs.devnet] section:"
        log_info "   Change: asdf_dat = \"$CURRENT_ID\""
        log_info "   To:     asdf_dat = \"$PROGRAM_ID\""
        log_info ""
        log_info "3. Rebuild: anchor build"
        log_info "4. Continue: bash devnet-wsl-setup.sh --skip-to-deploy"
        log_info ""
        read -p "Do you want to update automatically? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            # Update lib.rs
            sed -i "s/declare_id!(\".*\")/declare_id!(\"$PROGRAM_ID\")/" programs/asdf-dat/src/lib.rs
            log_success "Updated lib.rs"
            
            # Update Anchor.toml
            sed -i "s/asdf_dat = \".*\"/asdf_dat = \"$PROGRAM_ID\"/" Anchor.toml
            log_success "Updated Anchor.toml"
            
            # Rebuild
            log_info "Rebuilding..."
            anchor build
            log_success "Rebuild complete"
        else
            log_warning "Please update manually and run: bash devnet-wsl-setup.sh --skip-to-deploy"
            exit 0
        fi
    fi
}

# Deploy the program
deploy_program() {
    log_step "[7/7] Deploying to Devnet"
    
    log_warning "About to deploy to devnet. This will use ~2 SOL."
    read -p "Continue with deployment? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Deployment cancelled"
        exit 0
    fi
    
    log_info "Deploying program..."
    anchor deploy --provider.cluster devnet
    
    PROGRAM_ID=$(solana address -k target/deploy/asdf_dat-keypair.json)
    log_success "Program deployed successfully!"
    log_success "Program ID: $PROGRAM_ID"
    log_info "Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
}

# Initialize the protocol
initialize_protocol() {
    log_step "Initializing Protocol"
    
    if [ ! -f "./devnet-init.ts" ]; then
        log_error "Initialization script not found!"
        exit 1
    fi
    
    log_info "Running initialization..."
    ts-node devnet-init.ts
    
    log_success "Protocol initialized"
}

# Check status
check_status() {
    log_step "Checking Protocol Status"
    
    if [ ! -f "./devnet-status.ts" ]; then
        log_warning "Status script not found, skipping"
        return
    fi
    
    log_info "Fetching protocol status..."
    ts-node devnet-status.ts
}

# Display next steps
show_next_steps() {
    log_step "Setup Complete! 🎉"
    
    log_success "Your ASDF DAT protocol is now running on devnet"
    echo ""
    log_info "📋 Next Steps:"
    echo ""
    echo "1. Generate trading activity to accumulate creator fees:"
    echo "   - Go to pump.fun (devnet mode)"
    echo "   - Find your token (check devnet-config.json for mint address)"
    echo "   - Make some trades (buy/sell)"
    echo ""
    echo "2. Check accumulated fees:"
    echo "   ts-node devnet-status.ts"
    echo ""
    echo "3. Execute a test cycle (when fees >= 0.01 SOL):"
    echo "   ts-node devnet-execute-cycle.ts"
    echo ""
    echo "4. Run multiple test cycles:"
    echo "   for i in {1..5}; do"
    echo "     ts-node devnet-execute-cycle.ts"
    echo "     sleep 70"
    echo "   done"
    echo ""
    echo "5. Complete the mainnet readiness checklist:"
    echo "   cat MAINNET_READINESS.md"
    echo ""
    
    # Display important addresses
    if [ -f "./devnet-config.json" ]; then
        TOKEN_MINT=$(cat devnet-config.json | jq -r '.token.mint')
        echo "🔑 Important Addresses:"
        echo "  Token Mint: $TOKEN_MINT"
        echo "  Explorer: https://explorer.solana.com/address/$TOKEN_MINT?cluster=devnet"
        if [ -f "target/deploy/asdf_dat-keypair.json" ]; then
            PROGRAM_ID=$(solana address -k target/deploy/asdf_dat-keypair.json)
            echo "  Program: $PROGRAM_ID"
            echo "  Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
        fi
    fi
    echo ""
    log_success "Happy testing! 🚀"
}

# Main execution
main() {
    log_step "ASDF DAT - Devnet Setup (WSL)"
    
    check_wsl
    
    # Check for flags
    SKIP_TO_DEPLOY=false
    if [ "$1" == "--skip-to-deploy" ]; then
        SKIP_TO_DEPLOY=true
        log_info "Skipping to deployment step"
    fi
    
    if [ "$SKIP_TO_DEPLOY" = false ]; then
        setup_solana
        install_dependencies
        create_token
        find_bonding_curve
        apply_config
        build_program
    fi
    
    deploy_program
    initialize_protocol
    check_status
    show_next_steps
}

# Trap errors
trap 'log_error "Script failed at line $LINENO"' ERR

# Run main function
main "$@"

#!/bin/bash

# ASDF DAT Installation Script
# This script sets up the complete ASDF DAT environment

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Header
echo "================================================"
echo "       ASDF DAT Installation Script"
echo "================================================"
echo ""

# Check system requirements
print_info "Checking system requirements..."

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js v18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version must be 18 or higher. Current version: $(node -v)"
    exit 1
fi
print_success "Node.js $(node -v) detected"

# Check npm
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi
print_success "npm $(npm -v) detected"

# Check Rust
if ! command -v rustc &> /dev/null; then
    print_warning "Rust is not installed. Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
fi
print_success "Rust $(rustc --version | cut -d' ' -f2) detected"

# Check Solana CLI
if ! command -v solana &> /dev/null; then
    print_warning "Solana CLI is not installed. Installing Solana CLI..."
    sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi
print_success "Solana CLI $(solana --version | cut -d' ' -f2) detected"

# Check Anchor
if ! command -v anchor &> /dev/null; then
    print_warning "Anchor is not installed. Installing Anchor..."
    cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
    avm install 0.30.0
    avm use 0.30.0
fi
print_success "Anchor $(anchor --version | cut -d' ' -f2) detected"

echo ""
print_info "Installing project dependencies..."

# Install Node.js dependencies
print_info "Installing npm packages..."
npm install

# Build Rust program
print_info "Building Solana program..."
cargo build-bpf --manifest-path=programs/asdf-dat/Cargo.toml

# Create necessary directories
print_info "Creating project directories..."
mkdir -p logs
mkdir -p backups
mkdir -p dist

# Setup wallet if it doesn't exist
if [ ! -f "wallet.json" ]; then
    print_warning "No wallet found. Creating new wallet..."
    solana-keygen new --outfile wallet.json --no-bip39-passphrase
    print_success "New wallet created at wallet.json"
    print_warning "Please fund this wallet with SOL before running the bot"
    echo ""
    echo "Wallet address:"
    solana address -k wallet.json
else
    print_success "Existing wallet found at wallet.json"
fi

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    print_info "Creating .env file from template..."
    cp .env.example .env
    print_warning "Please update .env file with your configuration"
else
    print_success "Existing .env file found"
fi

# Build TypeScript
print_info "Compiling TypeScript..."
npm run compile

# Run tests
print_info "Running tests..."
npm test || print_warning "Some tests failed. Please review the output."

echo ""
echo "================================================"
print_success "Installation completed successfully!"
echo "================================================"
echo ""
echo "Next steps:"
echo "1. Update the .env file with your configuration"
echo "2. Fund your wallet with SOL for gas fees"
echo "3. Deploy the program: anchor deploy"
echo "4. Update PROGRAM_ID in .env with the deployed program ID"
echo "5. Initialize the DAT: npm run dat:init"
echo "6. Start the bot: npm run dat:bot"
echo ""
echo "For more information, see README.md"
echo ""

# Optional: Install PM2 for production
read -p "Do you want to install PM2 for production deployment? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "Installing PM2..."
    npm install -g pm2
    print_success "PM2 installed successfully"
    echo ""
    echo "To run with PM2:"
    echo "  pm2 start npm --name 'asdf-dat' -- run dat:bot"
    echo "  pm2 save"
    echo "  pm2 startup"
fi

print_success "Setup complete!"

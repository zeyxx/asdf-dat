#!/bin/bash
# Comprehensive build script for ASDF DAT Solana program (Linux/WSL)
# This script resolves Rust version and Cargo.lock compatibility issues

set -e  # Exit on error

echo "=== ASDF DAT Build Script (Linux) ==="
echo ""

# Step 1: Check if Rust 1.82.0 is installed
echo "Step 1: Checking Rust 1.82.0 toolchain..."
if ! rustup toolchain list | grep -q "1.82.0"; then
    echo "Installing Rust 1.82.0 toolchain (required by dependencies)..."
    rustup toolchain install 1.82.0
else
    echo "✓ Rust 1.82.0 already installed"
fi

# Step 2: Set rustup override to use 1.82.0 for this project
echo ""
echo "Step 2: Setting Rust 1.82.0 as project override..."
rustup override set 1.82.0

# Step 3: Verify Rust version
echo ""
echo "Step 3: Verifying Rust version..."
echo "  Active Rust version: $(rustc --version)"
echo "  Active Cargo version: $(cargo --version)"

# Step 4: Clean old Cargo.lock files if they exist
echo ""
echo "Step 4: Cleaning old Cargo.lock files..."
rm -f Cargo.lock && echo "  Removed root Cargo.lock" || echo "  No root Cargo.lock to remove"
rm -f programs/asdf-dat/Cargo.lock && echo "  Removed program Cargo.lock" || echo "  No program Cargo.lock to remove"

# Step 5: Generate new Cargo.lock
echo ""
echo "Step 5: Generating Cargo.lock with Cargo 1.82.0..."
echo "  Running cargo check to generate Cargo.lock..."
cargo check

# Cargo.lock is created at workspace root due to workspace configuration
if [ -f "Cargo.lock" ]; then
    echo "✓ Successfully generated Cargo.lock at workspace root"

    # Copy to program directory for cargo build-sbf
    cp Cargo.lock programs/asdf-dat/Cargo.lock
    echo "✓ Copied Cargo.lock to program directory"
else
    echo "ERROR: Cargo.lock was not created"
    exit 1
fi

# Step 5b: Check Cargo.lock version (Cargo 1.82.0 generates v3 by default)
echo ""
echo "Step 5b: Checking Cargo.lock version..."
LOCK_VERSION=$(grep -oP '^version = \K\d+' programs/asdf-dat/Cargo.lock | head -1)
echo "  Cargo.lock version: $LOCK_VERSION"

if [ "$LOCK_VERSION" = "4" ]; then
    echo "  Converting v4 to v3 for cargo build-sbf compatibility..."
    sed -i 's/^version = 4/version = 3/' programs/asdf-dat/Cargo.lock
    echo "✓ Successfully converted Cargo.lock to v3"
elif [ "$LOCK_VERSION" = "3" ]; then
    echo "✓ Cargo.lock is already v3, no conversion needed"
else
    echo "  WARNING: Unexpected Cargo.lock version: $LOCK_VERSION"
fi

# Step 6: Install Solana CLI if not already installed
echo ""
echo "Step 6: Checking Solana CLI installation..."
if command -v solana &> /dev/null; then
    SOLANA_VERSION=$(solana --version)
    echo "✓ Solana CLI already installed: $SOLANA_VERSION"
else
    echo "Installing Solana CLI..."
    sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
    echo "✓ Solana CLI installed"
fi

# Step 7: Install Anchor CLI if not already installed
echo ""
echo "Step 7: Checking Anchor CLI installation..."
if command -v anchor &> /dev/null; then
    ANCHOR_VERSION=$(anchor --version)
    echo "✓ Anchor CLI already installed: $ANCHOR_VERSION"
else
    echo "Installing Anchor CLI 0.31.1..."
    cargo install --git https://github.com/coral-xyz/anchor --tag v0.31.1 anchor-cli --locked
    echo "✓ Anchor CLI installed"
fi

# Step 8: Build the program
echo ""
echo "Step 8: Building Solana program with Anchor..."
echo ""

# Ensure we're using the correct Rust version
export RUSTUP_TOOLCHAIN=1.82.0

# Build with anchor
anchor build

echo ""
echo "=== Build completed successfully! ==="
echo ""
echo "Program artifacts are in: target/deploy/"
echo "  - asdf_dat.so (Solana program)"
echo ""
echo "Next steps:"
echo "  1. Deploy to devnet: anchor deploy --provider.cluster devnet"
echo "  2. Test with your PumpFun token: D1CETFzuFJYHH4BcBjf7Ysz8KdJSeCD4Yk5EjJhRk5QV"
echo "  3. When ready, deploy to mainnet: anchor deploy --provider.cluster mainnet"
echo ""

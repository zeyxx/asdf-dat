#!/bin/bash
set -e

echo "📦 Installing Solana..."
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "📦 Installing Anchor..."
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

echo "✅ Setup complete!"
solana --version
anchor --version

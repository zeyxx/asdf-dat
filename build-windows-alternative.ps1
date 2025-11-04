# Alternative Windows Build Script - Downgrade Dependencies Approach
# This script downgrades dependencies to be compatible with Rust 1.75.0

Write-Host "=== ASDF DAT Alternative Windows Build ===" -ForegroundColor Cyan
Write-Host "This script uses dependency downgrading to work with cargo-build-sbf's Rust 1.75.0" -ForegroundColor Yellow
Write-Host ""

# Step 1: Check Solana CLI version
Write-Host "Step 1: Checking Solana CLI version..." -ForegroundColor Yellow
$solanaVersion = solana --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Solana CLI: $solanaVersion" -ForegroundColor Green
} else {
    Write-Host "ERROR: Solana CLI not found. Please install it first." -ForegroundColor Red
    Write-Host "Run: https://docs.solana.com/cli/install-solana-cli-tools" -ForegroundColor Yellow
    exit 1
}

# Step 2: Check Anchor CLI version
Write-Host ""
Write-Host "Step 2: Checking Anchor CLI version..." -ForegroundColor Yellow
$anchorVersion = anchor --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Anchor CLI: $anchorVersion" -ForegroundColor Green
} else {
    Write-Host "ERROR: Anchor CLI not found." -ForegroundColor Red
    Write-Host "Install with: cargo install --git https://github.com/coral-xyz/anchor avm --locked" -ForegroundColor Yellow
    Write-Host "Then: avm install 0.30.1 && avm use 0.30.1" -ForegroundColor Yellow
    exit 1
}

# Step 3: Backup current Cargo.toml
Write-Host ""
Write-Host "Step 3: Creating backup of Cargo.toml..." -ForegroundColor Yellow
Copy-Item "programs/asdf-dat/Cargo.toml" "programs/asdf-dat/Cargo.toml.backup" -Force
Write-Host "Backup created: Cargo.toml.backup" -ForegroundColor Green

# Step 4: Downgrade to Anchor 0.30.1 (last version compatible with older Rust)
Write-Host ""
Write-Host "Step 4: Temporarily downgrading to Anchor 0.30.1..." -ForegroundColor Yellow

$newCargoToml = @"
[package]
name = "asdf-dat"
version = "0.1.0"
description = "ASDF DAT"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "asdf_dat"

[features]
no-entrypoint = []
no-idl = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = "0.30.1"
anchor-spl = "0.30.1"
"@

Set-Content -Path "programs/asdf-dat/Cargo.toml" -Value $newCargoToml
Write-Host "Downgraded to Anchor 0.30.1" -ForegroundColor Green

# Step 5: Clean old build artifacts
Write-Host ""
Write-Host "Step 5: Cleaning old build artifacts..." -ForegroundColor Yellow
if (Test-Path "target") {
    Remove-Item -Recurse -Force "target"
    Write-Host "Removed target directory" -ForegroundColor Green
}
if (Test-Path "Cargo.lock") {
    Remove-Item "Cargo.lock"
    Write-Host "Removed Cargo.lock" -ForegroundColor Green
}
if (Test-Path "programs/asdf-dat/Cargo.lock") {
    Remove-Item "programs/asdf-dat/Cargo.lock"
    Write-Host "Removed program Cargo.lock" -ForegroundColor Green
}

# Step 6: Try to build with Anchor 0.30.1
Write-Host ""
Write-Host "Step 6: Building with Anchor 0.30.1..." -ForegroundColor Yellow
Write-Host ""

anchor build 2>&1 | Tee-Object -Variable buildOutput | Write-Host

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=== Build SUCCESS with Anchor 0.30.1! ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "Program built: target/deploy/asdf_dat.so" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "NOTE: You're using Anchor 0.30.1 (downgraded from 0.31.1)" -ForegroundColor Yellow
    Write-Host "To restore Anchor 0.31.1:" -ForegroundColor Yellow
    Write-Host "  Copy-Item 'programs/asdf-dat/Cargo.toml.backup' 'programs/asdf-dat/Cargo.toml' -Force" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "Build failed with Anchor 0.30.1" -ForegroundColor Red
    Write-Host ""
    Write-Host "Restoring original Cargo.toml..." -ForegroundColor Yellow
    Copy-Item "programs/asdf-dat/Cargo.toml.backup" "programs/asdf-dat/Cargo.toml" -Force
    Write-Host "Restored original Cargo.toml" -ForegroundColor Green
    Write-Host ""
    Write-Host "Please try Option 2: Manual Solana CLI Update" -ForegroundColor Yellow
    Write-Host "See: build-windows-manual-update.ps1" -ForegroundColor Cyan
    exit 1
}

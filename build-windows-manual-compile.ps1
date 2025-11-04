# Manual BPF Compilation Script
# This script attempts to compile the Solana program manually without using cargo-build-sbf

Write-Host "=== ASDF DAT Manual BPF Compilation ===" -ForegroundColor Cyan
Write-Host "Bypassing cargo-build-sbf to use Rust 1.82.0 directly" -ForegroundColor Yellow
Write-Host ""

# Step 1: Ensure Rust 1.82.0 is active
Write-Host "Step 1: Setting up Rust 1.82.0..." -ForegroundColor Yellow
rustup toolchain install 1.82.0
rustup override set 1.82.0

$rustVersion = rustc --version
Write-Host "Active Rust: $rustVersion" -ForegroundColor Green

# Step 2: Add BPF target
Write-Host ""
Write-Host "Step 2: Adding sbf-solana-solana target..." -ForegroundColor Yellow
rustup target add sbf-solana-solana --toolchain 1.82.0
if ($LASTEXITCODE -ne 0) {
    Write-Host "sbf-solana-solana target not available, trying bpfel-unknown-unknown..." -ForegroundColor Yellow
    rustup target add bpfel-unknown-unknown --toolchain 1.82.0
    $target = "bpfel-unknown-unknown"
} else {
    $target = "sbf-solana-solana"
}
Write-Host "Using target: $target" -ForegroundColor Green

# Step 3: Generate Cargo.lock with Rust 1.82.0
Write-Host ""
Write-Host "Step 3: Generating Cargo.lock..." -ForegroundColor Yellow
cargo check
if ($LASTEXITCODE -ne 0) {
    Write-Host "cargo check failed" -ForegroundColor Red
    exit 1
}
Write-Host "Cargo.lock generated" -ForegroundColor Green

# Copy to program directory
if (Test-Path "Cargo.lock") {
    Copy-Item "Cargo.lock" "programs/asdf-dat/Cargo.lock" -Force
    Write-Host "Copied to program directory" -ForegroundColor Green
}

# Step 4: Compile with specific options
Write-Host ""
Write-Host "Step 4: Compiling Solana program..." -ForegroundColor Yellow
Write-Host ""

# Create target directory
New-Item -ItemType Directory -Force -Path "target\deploy" | Out-Null

# Compile with cargo rustc
Set-Location "programs\asdf-dat"

$env:RUSTFLAGS = "-C link-arg=-znostart-stop-gc"

Write-Host "Running: cargo rustc --target $target --release" -ForegroundColor Cyan
cargo rustc --target $target --release -- `
    -C panic=abort `
    -C opt-level=3

$buildResult = $LASTEXITCODE

Set-Location "..\..\"

if ($buildResult -eq 0) {
    Write-Host ""
    Write-Host "✓ Compilation successful!" -ForegroundColor Green

    # Find the compiled .so file
    $soFile = Get-ChildItem -Path "target\$target\release" -Filter "*.so" -Recurse | Select-Object -First 1

    if ($soFile) {
        Write-Host "Found compiled binary: $($soFile.FullName)" -ForegroundColor Cyan

        # Copy to deploy directory
        Copy-Item $soFile.FullName "target\deploy\asdf_dat.so" -Force
        Write-Host "Copied to: target\deploy\asdf_dat.so" -ForegroundColor Green

        Write-Host ""
        Write-Host "=== Build SUCCESS! ===" -ForegroundColor Green
        Write-Host ""
        Write-Host "Program: target\deploy\asdf_dat.so" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "To deploy:" -ForegroundColor Yellow
        Write-Host "  solana program deploy target\deploy\asdf_dat.so --url devnet" -ForegroundColor Cyan
        Write-Host ""

    } else {
        Write-Host "Warning: .so file not found in expected location" -ForegroundColor Yellow
        Write-Host "Check: target\$target\release\" -ForegroundColor Cyan
    }

} else {
    Write-Host ""
    Write-Host "✗ Compilation failed" -ForegroundColor Red
    Write-Host ""
    Write-Host "This approach requires manual BPF toolchain setup" -ForegroundColor Yellow
    Write-Host "Please try:" -ForegroundColor Yellow
    Write-Host "  1. .\build-windows-alternative.ps1 (Anchor 0.30.1)" -ForegroundColor Cyan
    Write-Host "  2. .\build-windows-manual-update.ps1 (Update Solana CLI)" -ForegroundColor Cyan
    exit 1
}

# Comprehensive build script for ASDF DAT Solana program
# This script resolves Rust version and Cargo.lock v4 compatibility issues

Write-Host "=== ASDF DAT Build Script ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if Rust 1.78.0 is installed
Write-Host "Step 1: Checking Rust 1.78.0 toolchain..." -ForegroundColor Yellow
$rustToolchains = rustup toolchain list
if ($rustToolchains -notmatch "1.78.0") {
    Write-Host "Installing Rust 1.78.0 toolchain (this generates v3 Cargo.lock files)..." -ForegroundColor Yellow
    rustup toolchain install 1.78.0
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to install Rust 1.78.0" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Rust 1.78.0 already installed" -ForegroundColor Green
}

# Step 2: Set rustup override to use 1.78.0 for this project
Write-Host ""
Write-Host "Step 2: Setting Rust 1.78.0 as project override..." -ForegroundColor Yellow
rustup override set 1.78.0
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to set rustup override" -ForegroundColor Red
    exit 1
}

# Step 3: Verify Rust version
Write-Host ""
Write-Host "Step 3: Verifying Rust version..." -ForegroundColor Yellow
$rustVersion = rustc --version
Write-Host "Active Rust version: $rustVersion" -ForegroundColor Green
$cargoVersion = cargo --version
Write-Host "Active Cargo version: $cargoVersion" -ForegroundColor Green

# Step 4: Clean old Cargo.lock files if they exist
Write-Host ""
Write-Host "Step 4: Cleaning old Cargo.lock files..." -ForegroundColor Yellow
if (Test-Path "Cargo.lock") {
    Remove-Item "Cargo.lock" -Force
    Write-Host "Removed root Cargo.lock" -ForegroundColor Green
}
if (Test-Path "programs/asdf-dat/Cargo.lock") {
    Remove-Item "programs/asdf-dat/Cargo.lock" -Force
    Write-Host "Removed program Cargo.lock" -ForegroundColor Green
}

# Step 5: Generate new Cargo.lock with v3 format
Write-Host ""
Write-Host "Step 5: Generating Cargo.lock (v3 format with Cargo 1.78.0)..." -ForegroundColor Yellow
Push-Location programs/asdf-dat
cargo check --target-dir ../../target
$checkResult = $LASTEXITCODE
Pop-Location

if ($checkResult -ne 0) {
    Write-Host "Failed to generate Cargo.lock" -ForegroundColor Red
    exit 1
}

# Verify Cargo.lock was created and check version
if (Test-Path "programs/asdf-dat/Cargo.lock") {
    $lockContent = Get-Content "programs/asdf-dat/Cargo.lock" -Raw
    if ($lockContent -match 'version = (\d+)') {
        $lockVersion = $matches[1]
        Write-Host "Generated Cargo.lock version: $lockVersion" -ForegroundColor Green

        if ($lockVersion -eq "4") {
            Write-Host "WARNING: Cargo.lock is v4. This shouldn't happen with Cargo 1.78.0!" -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host "ERROR: Cargo.lock was not generated" -ForegroundColor Red
    exit 1
}

# Step 6: Build the program
Write-Host ""
Write-Host "Step 6: Building Solana program with cargo build-sbf..." -ForegroundColor Yellow
cargo build-sbf --manifest-path=programs/asdf-dat/Cargo.toml --sbf-out-dir=target/deploy

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Build completed successfully! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Program artifacts are in: target/deploy/" -ForegroundColor Cyan

# Comprehensive build script for ASDF DAT Solana program
# This script resolves Rust version and Cargo.lock v4 compatibility issues

Write-Host "=== ASDF DAT Build Script ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if Rust 1.82.0 is installed
Write-Host "Step 1: Checking Rust 1.82.0 toolchain..." -ForegroundColor Yellow
$rustToolchains = rustup toolchain list
if ($rustToolchains -notmatch "1.82.0") {
    Write-Host "Installing Rust 1.82.0 toolchain (required by dependencies)..." -ForegroundColor Yellow
    rustup toolchain install 1.82.0
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to install Rust 1.82.0" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Rust 1.82.0 already installed" -ForegroundColor Green
}

# Step 2: Set rustup override to use 1.82.0 for this project
Write-Host ""
Write-Host "Step 2: Setting Rust 1.82.0 as project override..." -ForegroundColor Yellow
rustup override set 1.82.0
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

# Step 5: Generate new Cargo.lock (will be v4 with Cargo 1.82.0)
Write-Host ""
Write-Host "Step 5: Generating Cargo.lock with Cargo 1.82.0..." -ForegroundColor Yellow

# Change to program directory
Set-Location programs\asdf-dat

# Try cargo update which should create Cargo.lock
Write-Host "Running cargo update..." -ForegroundColor Cyan
cargo update 2>&1 | Out-Null
$updateResult = $LASTEXITCODE

if ($updateResult -ne 0) {
    Write-Host "cargo update failed with exit code $updateResult" -ForegroundColor Red
    Set-Location ..\..
    exit 1
}

# Verify Cargo.lock was created
if (Test-Path ".\Cargo.lock") {
    Write-Host "Successfully generated Cargo.lock" -ForegroundColor Green
} else {
    Write-Host "ERROR: Cargo.lock was not created in $(Get-Location)" -ForegroundColor Red
    Write-Host "Directory contents:" -ForegroundColor Yellow
    Get-ChildItem | Select-Object Name
    Set-Location ..\..
    exit 1
}

# Return to project root
Set-Location ..\..

# Step 5b: Downgrade Cargo.lock from v4 to v3 for compatibility with cargo build-sbf
Write-Host ""
Write-Host "Step 5b: Converting Cargo.lock from v4 to v3 format..." -ForegroundColor Yellow
$lockContent = Get-Content "programs/asdf-dat/Cargo.lock" -Raw
if ($lockContent -match 'version = (\d+)') {
    $lockVersion = $matches[1]
    Write-Host "Current Cargo.lock version: $lockVersion" -ForegroundColor Cyan

    if ($lockVersion -eq "4") {
        Write-Host "Converting v4 to v3 for cargo build-sbf compatibility..." -ForegroundColor Yellow
        $lockContent = $lockContent -replace 'version = 4', 'version = 3'
        Set-Content -Path "programs/asdf-dat/Cargo.lock" -Value $lockContent -NoNewline
        Write-Host "Successfully converted Cargo.lock to v3" -ForegroundColor Green
    } else {
        Write-Host "Cargo.lock is already v3, no conversion needed" -ForegroundColor Green
    }
} else {
    Write-Host "WARNING: Could not detect Cargo.lock version" -ForegroundColor Yellow
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

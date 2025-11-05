# Automatic Anchor Version Finder for Windows
# This script tries different Anchor versions until it finds one compatible with Rust 1.75.0

Write-Host "=== ASDF DAT Automatic Anchor Version Finder ===" -ForegroundColor Cyan
Write-Host "Finding the right Anchor version for Rust 1.75.0..." -ForegroundColor Yellow
Write-Host ""

# Versions to try (from newest to oldest that might work with Rust 1.75)
$anchorVersions = @("0.29.0", "0.28.0", "0.27.0", "0.26.0")

# Backup original Cargo.toml
Write-Host "Creating backup of Cargo.toml..." -ForegroundColor Yellow
Copy-Item "programs/asdf-dat/Cargo.toml" "programs/asdf-dat/Cargo.toml.original" -Force
Write-Host "Backup saved: Cargo.toml.original" -ForegroundColor Green
Write-Host ""

$success = $false

foreach ($version in $anchorVersions) {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Trying Anchor $version..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    # Create Cargo.toml with this version
    $cargoContent = @"
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
anchor-lang = "$version"
anchor-spl = "$version"
"@

    Set-Content -Path "programs/asdf-dat/Cargo.toml" -Value $cargoContent
    Write-Host "Updated Cargo.toml to use Anchor $version" -ForegroundColor Cyan

    # Clean old artifacts
    if (Test-Path "target") { Remove-Item -Recurse -Force "target" }
    if (Test-Path "Cargo.lock") { Remove-Item "Cargo.lock" }
    if (Test-Path "programs/asdf-dat/Cargo.lock") { Remove-Item "programs/asdf-dat/Cargo.lock" }

    Write-Host "Building..." -ForegroundColor Yellow
    Write-Host ""

    # Try to build
    $buildOutput = anchor build 2>&1
    $buildResult = $LASTEXITCODE

    if ($buildResult -eq 0) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "✓ SUCCESS with Anchor $version!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Program compiled: target/deploy/asdf_dat.so" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Version used: Anchor $version" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "  1. Deploy to devnet: anchor deploy --provider.cluster devnet" -ForegroundColor Cyan
        Write-Host "  2. Test with your PumpFun token" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Note: Original Cargo.toml saved as Cargo.toml.original" -ForegroundColor Yellow
        Write-Host "To restore: Copy-Item programs/asdf-dat/Cargo.toml.original programs/asdf-dat/Cargo.toml -Force" -ForegroundColor Yellow
        Write-Host ""
        $success = $true
        break
    } else {
        Write-Host ""
        Write-Host "✗ Anchor $version failed" -ForegroundColor Red

        # Check if it's still a Rust version error
        $rustVersionError = $buildOutput | Select-String "requires rustc.*or newer, while the currently active rustc version is 1.75"
        if ($rustVersionError) {
            Write-Host "  Reason: Still requires Rust > 1.75" -ForegroundColor Yellow
            Write-Host "  Trying older version..." -ForegroundColor Yellow
        } else {
            Write-Host "  Error output:" -ForegroundColor Yellow
            $buildOutput | Select-Object -Last 5 | Write-Host
        }
        Write-Host ""
    }
}

if (-not $success) {
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "All Anchor versions failed!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Restoring original Cargo.toml..." -ForegroundColor Yellow
    Copy-Item "programs/asdf-dat/Cargo.toml.original" "programs/asdf-dat/Cargo.toml" -Force
    Write-Host "Restored" -ForegroundColor Green
    Write-Host ""
    Write-Host "Le problème nécessite une mise à jour de Solana CLI." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Options restantes:" -ForegroundColor Cyan
    Write-Host "  1. Mettre à jour Solana CLI: .\build-windows-manual-update.ps1" -ForegroundColor White
    Write-Host "  2. Télécharger manuellement depuis: https://github.com/solana-labs/solana/releases" -ForegroundColor White
    Write-Host "  3. Utiliser WSL (Windows Subsystem for Linux): wsl --install" -ForegroundColor White
    Write-Host ""
    exit 1
}

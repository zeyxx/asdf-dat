# Manual Solana CLI Update Script
# This script attempts to update Solana CLI using alternative download methods

Write-Host "=== Solana CLI Manual Update ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check current Solana version
Write-Host "Step 1: Current Solana CLI version:" -ForegroundColor Yellow
$currentVersion = solana --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "$currentVersion" -ForegroundColor Cyan
} else {
    Write-Host "Solana CLI not installed" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Attempting to download latest Solana CLI..." -ForegroundColor Yellow
Write-Host ""

# Method 1: Try with Invoke-WebRequest and different TLS settings
Write-Host "Method 1: Downloading with PowerShell (TLS 1.2)..." -ForegroundColor Cyan
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$solanaUrl = "https://github.com/solana-labs/solana/releases/download/v1.18.17/solana-release-x86_64-pc-windows-msvc.tar.bz2"
$outputFile = "$env:TEMP\solana-release.tar.bz2"

try {
    Invoke-WebRequest -Uri $solanaUrl -OutFile $outputFile -UseBasicParsing
    Write-Host "✓ Download successful!" -ForegroundColor Green

    # Extract
    Write-Host ""
    Write-Host "Extracting..." -ForegroundColor Yellow

    # Check if 7-Zip is available
    $7zipPath = "C:\Program Files\7-Zip\7z.exe"
    if (Test-Path $7zipPath) {
        & $7zipPath x $outputFile -o"$env:TEMP\solana-temp" -y
        & $7zipPath x "$env:TEMP\solana-temp\solana-release.tar" -o"$env:TEMP\solana-release" -y

        Write-Host "✓ Extraction successful!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Installing Solana CLI..." -ForegroundColor Yellow

        # Move to installation directory
        $installDir = "$env:USERPROFILE\.local\share\solana\install\active_release"
        if (Test-Path $installDir) {
            Remove-Item -Recurse -Force $installDir
        }
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
        Copy-Item -Recurse "$env:TEMP\solana-release\solana-release\*" $installDir

        Write-Host "✓ Solana CLI updated!" -ForegroundColor Green
        Write-Host ""
        Write-Host "New version:" -ForegroundColor Yellow
        & "$installDir\bin\solana.exe" --version

        Write-Host ""
        Write-Host "Now run: .\build.ps1" -ForegroundColor Cyan

    } else {
        Write-Host "7-Zip not found at: $7zipPath" -ForegroundColor Yellow
        Write-Host "Please install 7-Zip to extract the archive" -ForegroundColor Yellow
        Write-Host "Download from: https://www.7-zip.org/download.html" -ForegroundColor Cyan
    }

} catch {
    Write-Host "✗ Method 1 failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""

    # Method 2: Try with version 1.18.22 (different release)
    Write-Host "Method 2: Trying alternative version (v1.18.22)..." -ForegroundColor Cyan
    $altUrl = "https://github.com/solana-labs/solana/releases/download/v1.18.22/solana-release-x86_64-pc-windows-msvc.tar.bz2"

    try {
        Invoke-WebRequest -Uri $altUrl -OutFile $outputFile -UseBasicParsing
        Write-Host "✓ Alternative version downloaded!" -ForegroundColor Green
        Write-Host "Now extract using 7-Zip as shown above" -ForegroundColor Yellow
    } catch {
        Write-Host "✗ Method 2 failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""

        # Method 3: Manual download instructions
        Write-Host "Method 3: Manual Download Required" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Please download manually from one of these links:" -ForegroundColor Cyan
        Write-Host "  1. https://github.com/solana-labs/solana/releases/latest" -ForegroundColor White
        Write-Host "  2. Look for: solana-release-x86_64-pc-windows-msvc.tar.bz2" -ForegroundColor White
        Write-Host "  3. Extract with 7-Zip to: $env:USERPROFILE\.local\share\solana\install\active_release" -ForegroundColor White
        Write-Host ""
        Write-Host "Alternative: Use Windows installer (.exe)" -ForegroundColor Yellow
        Write-Host "  Download: solana-install-init-x86_64-pc-windows-msvc.exe" -ForegroundColor White
        Write-Host "  Run it and follow instructions" -ForegroundColor White
        Write-Host ""
    }
}

Write-Host ""
Write-Host "After updating Solana CLI, run: .\build.ps1" -ForegroundColor Cyan
Write-Host ""

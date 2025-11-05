# Script de Mise à Jour Solana CLI - Version Améliorée
# Ce script télécharge et installe une version plus récente de Solana CLI

Write-Host "=== Mise à Jour Solana CLI ===" -ForegroundColor Cyan
Write-Host ""

# Vérifier la version actuelle
Write-Host "Version actuelle de Solana CLI:" -ForegroundColor Yellow
solana --version
Write-Host ""

# Définir les chemins
$installDir = "$env:USERPROFILE\.local\share\solana\install"
$tempDir = "$env:TEMP\solana-update"

Write-Host "Ce script va:" -ForegroundColor Cyan
Write-Host "  1. Télécharger Solana CLI v1.18.22" -ForegroundColor White
Write-Host "  2. L'extraire dans: $installDir" -ForegroundColor White
Write-Host "  3. Configurer le PATH" -ForegroundColor White
Write-Host ""

$continue = Read-Host "Continuer? (O/N)"
if ($continue -ne "O" -and $continue -ne "o") {
    Write-Host "Annulé" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Étape 1: Téléchargement" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Créer le répertoire temporaire
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

# Configurer TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# URL de téléchargement (version 1.18.22 - stable et compatible)
$downloadUrl = "https://github.com/solana-labs/solana/releases/download/v1.18.22/solana-release-x86_64-pc-windows-msvc.tar.bz2"
$outputFile = "$tempDir\solana-release.tar.bz2"

Write-Host "Téléchargement depuis GitHub..." -ForegroundColor Yellow
Write-Host "URL: $downloadUrl" -ForegroundColor Cyan
Write-Host ""

try {
    # Utiliser Invoke-WebRequest avec gestion d'erreur
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $outputFile -UseBasicParsing -TimeoutSec 300
    $ProgressPreference = 'Continue'

    $fileSize = (Get-Item $outputFile).Length / 1MB
    Write-Host "✓ Téléchargement réussi! ($([math]::Round($fileSize, 2)) MB)" -ForegroundColor Green
    Write-Host ""

} catch {
    Write-Host "✗ Échec du téléchargement automatique" -ForegroundColor Red
    Write-Host "Erreur: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "TÉLÉCHARGEMENT MANUEL REQUIS" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Suivez ces étapes:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Ouvrez votre navigateur et allez sur:" -ForegroundColor White
    Write-Host "   https://github.com/solana-labs/solana/releases/tag/v1.18.22" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "2. Téléchargez le fichier:" -ForegroundColor White
    Write-Host "   solana-release-x86_64-pc-windows-msvc.tar.bz2" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "3. Déplacez le fichier téléchargé vers:" -ForegroundColor White
    Write-Host "   $tempDir\" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "4. Renommez-le en:" -ForegroundColor White
    Write-Host "   solana-release.tar.bz2" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "5. Relancez ce script" -ForegroundColor White
    Write-Host ""
    Write-Host "OU utilisez l'installeur Windows directement:" -ForegroundColor Yellow
    Write-Host "   https://github.com/solana-labs/solana/releases/download/v1.18.22/solana-install-init-x86_64-pc-windows-msvc.exe" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Étape 2: Extraction" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Chercher 7-Zip
$7zipPaths = @(
    "C:\Program Files\7-Zip\7z.exe",
    "C:\Program Files (x86)\7-Zip\7z.exe",
    "$env:ProgramFiles\7-Zip\7z.exe"
)

$7zipExe = $null
foreach ($path in $7zipPaths) {
    if (Test-Path $path) {
        $7zipExe = $path
        break
    }
}

if (-not $7zipExe) {
    Write-Host "7-Zip n'est pas installé!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Téléchargez et installez 7-Zip depuis:" -ForegroundColor Yellow
    Write-Host "  https://www.7-zip.org/download.html" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Puis relancez ce script" -ForegroundColor Yellow
    exit 1
}

Write-Host "Utilisation de 7-Zip: $7zipExe" -ForegroundColor Cyan
Write-Host ""

# Extraire l'archive .tar.bz2
Write-Host "Extraction du fichier .tar.bz2..." -ForegroundColor Yellow
& $7zipExe x $outputFile -o"$tempDir" -y | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Échec de l'extraction .bz2" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Extraction .bz2 terminée" -ForegroundColor Green

# Extraire le .tar
Write-Host "Extraction du fichier .tar..." -ForegroundColor Yellow
$tarFile = "$tempDir\solana-release.tar"
& $7zipExe x $tarFile -o"$tempDir" -y | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Échec de l'extraction .tar" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Extraction .tar terminée" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Étape 3: Installation" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Trouver le dossier extrait
$extractedFolder = Get-ChildItem -Path $tempDir -Directory | Where-Object { $_.Name -like "solana-release*" } | Select-Object -First 1

if (-not $extractedFolder) {
    Write-Host "✗ Dossier extrait non trouvé" -ForegroundColor Red
    Write-Host "Contenu de $tempDir :" -ForegroundColor Yellow
    Get-ChildItem $tempDir | Format-Table Name
    exit 1
}

Write-Host "Dossier extrait trouvé: $($extractedFolder.Name)" -ForegroundColor Cyan

# Créer le répertoire d'installation
$activeRelease = "$installDir\active_release"
if (Test-Path $activeRelease) {
    Write-Host "Suppression de l'ancienne version..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $activeRelease
}

New-Item -ItemType Directory -Force -Path $activeRelease | Out-Null

# Copier les fichiers
Write-Host "Installation des fichiers..." -ForegroundColor Yellow
Copy-Item -Recurse -Force "$($extractedFolder.FullName)\*" $activeRelease

Write-Host "✓ Installation terminée" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Étape 4: Vérification" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Vérifier la nouvelle version
$newSolanaPath = "$activeRelease\bin\solana.exe"
if (Test-Path $newSolanaPath) {
    Write-Host "Nouvelle version installée:" -ForegroundColor Green
    & $newSolanaPath --version
    Write-Host ""

    # Nettoyer
    Write-Host "Nettoyage des fichiers temporaires..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $tempDir
    Write-Host "✓ Nettoyage terminé" -ForegroundColor Green
    Write-Host ""

    Write-Host "========================================" -ForegroundColor Green
    Write-Host "MISE À JOUR RÉUSSIE!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "⚠️  IMPORTANT: Fermez et rouvrez PowerShell pour utiliser la nouvelle version" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Ensuite, vous pouvez builder avec:" -ForegroundColor Cyan
    Write-Host "  .\build.ps1" -ForegroundColor White
    Write-Host ""

} else {
    Write-Host "✗ Erreur: solana.exe non trouvé après installation" -ForegroundColor Red
    exit 1
}

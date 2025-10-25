# Script to downgrade Cargo.lock from version 4 to version 3
# This fixes compatibility with older Cargo versions

$lockfilePath = ".\programs\asdf-dat\Cargo.lock"

if (Test-Path $lockfilePath) {
    Write-Host "Found Cargo.lock at: $lockfilePath"

    # Read the file
    $content = Get-Content $lockfilePath -Raw

    # Check if it's version 4
    if ($content -match 'version = 4') {
        Write-Host "Converting Cargo.lock from version 4 to version 3..."

        # Replace version 4 with version 3
        $content = $content -replace 'version = 4', 'version = 3'

        # Write back
        Set-Content -Path $lockfilePath -Value $content -NoNewline

        Write-Host "Successfully converted to version 3!"
    } else {
        Write-Host "Cargo.lock is not version 4 or already converted"
    }
} else {
    Write-Host "Cargo.lock not found at: $lockfilePath"
}

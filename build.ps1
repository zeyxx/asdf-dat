# Force Anchor to use system Rust instead of managing toolchains
$env:ANCHOR_SKIP_BUILD = $null

# Remove any Solana toolchain override
rustup override unset

# Verify Rust version
Write-Host "Using Rust version:"
rustc --version

# Build with system Rust
cargo build-sbf --manifest-path=programs/asdf-dat/Cargo.toml --sbf-out-dir=target/deploy

# Building ASDF DAT Solana Program

This document explains how to build the ASDF DAT Solana program and resolves common build issues.

## Prerequisites

- Rust (rustup installed)
- Solana CLI (v1.18.26 or higher)
- Anchor CLI (v0.31.1 or higher)

## The Problem

The ASDF DAT program uses Anchor 0.31.1, which requires Rust 1.76 or higher. However:
- Some transitive dependencies (solana-program@2.3.0, indexmap@2.12.0) require Rust 1.79+
- Rust 1.79+ generates Cargo.lock files in version 4 format
- Solana's `cargo build-sbf` tool is incompatible with Cargo.lock v4

## The Solution

Use Rust 1.79.0 with a two-step process:
1. **Generate Cargo.lock**: Use Rust 1.79.0 to satisfy all dependency requirements
2. **Convert to v3**: Automatically downgrade the Cargo.lock from v4 to v3 format
3. **Build**: Use cargo build-sbf with the compatible v3 lockfile

This approach:
- Satisfies all dependency requirements (>= 1.79.0)
- Maintains compatibility with Solana build tools (v3 lockfile)
- Is fully automated in the build script

## Quick Start

### Method 1: Using the build.ps1 Script (Recommended)

Simply run the automated build script:

```powershell
./build.ps1
```

This script will:
1. Install Rust 1.79.0 if not already installed
2. Set it as the project override
3. Clean old Cargo.lock files
4. Generate a new Cargo.lock (v4 format)
5. Convert Cargo.lock from v4 to v3 for compatibility
6. Build the Solana program

### Method 2: Manual Build

If you prefer to build manually:

```powershell
# 1. Install Rust 1.79.0
rustup toolchain install 1.79.0

# 2. Set project override
rustup override set 1.79.0

# 3. Verify version
rustc --version
# Should show: rustc 1.79.0

# 4. Clean old lockfiles
Remove-Item Cargo.lock -ErrorAction SilentlyContinue
Remove-Item programs/asdf-dat/Cargo.lock -ErrorAction SilentlyContinue

# 5. Generate new Cargo.lock
cd programs/asdf-dat
cargo check --target-dir ../../target
cd ../..

# 6. Convert Cargo.lock from v4 to v3
$lockContent = Get-Content "programs/asdf-dat/Cargo.lock" -Raw
$lockContent = $lockContent -replace 'version = 4', 'version = 3'
Set-Content -Path "programs/asdf-dat/Cargo.lock" -Value $lockContent -NoNewline

# 7. Build the program
cargo build-sbf --manifest-path=programs/asdf-dat/Cargo.toml --sbf-out-dir=target/deploy
```

## Build Output

After a successful build, you'll find the program artifacts in:
- `target/deploy/asdf_dat.so` - The compiled Solana program

## Troubleshooting

### Error: "lock file version 4 requires -Znext-lockfile-bump"

**Cause:** Cargo.lock is in v4 format and cargo build-sbf doesn't support it.

**Solution:** Run `./build.ps1` which automatically converts v4 to v3, or manually convert using:
```powershell
$content = Get-Content "programs/asdf-dat/Cargo.lock" -Raw
$content = $content -replace 'version = 4', 'version = 3'
Set-Content -Path "programs/asdf-dat/Cargo.lock" -Value $content -NoNewline
```

### Error: "rustc 1.79.0 is not supported by the following packages"

**Cause:** Newer dependency versions require a higher Rust version.

**Solution:** The build script now uses Rust 1.79.0 which satisfies all current dependencies. If you see this error with a version higher than 1.79, update the build script to use that version.

### Error: "requires rustc 1.76 or newer, while the currently active rustc version is 1.75.0-dev"

**Cause:** Solana CLI is trying to use its own obsolete Rust toolchain.

**Solution:** The build.ps1 script automatically handles this by setting the override to 1.79.0

### Error: "anchor-lang version(0.26.0) and the current CLI version(0.31.1) don't match"

**Cause:** Outdated Anchor dependencies in Cargo.toml.

**Solution:** Already fixed - Cargo.toml now uses Anchor 0.31.1

## Configuration Files

### .cargo/config.toml

Configures Cargo to use the system Rust toolchain instead of Solana's managed toolchains:

```toml
[build]
rustc = "rustc"
```

### rust-toolchain.toml

This file has been removed. We now use `rustup override` instead of a rust-toolchain.toml file to avoid conflicts with Solana's toolchain management.

### Cargo.lock

The program's Cargo.lock (in `programs/asdf-dat/`) is now committed to the repository to ensure reproducible builds. It's generated with Cargo 1.78.0 in v3 format.

## Deployment

After building successfully, you can deploy to devnet:

```bash
anchor deploy --provider.cluster devnet
```

Or to mainnet:

```bash
anchor deploy --provider.cluster mainnet
```

## Devnet Token Information

The project includes a PumpFun token on devnet for testing:

- **Token Mint:** `D1CETFzuFJYHH4BcBjf7Ysz8KdJSeCD4Yk5EjJhRk5QV`
- **Bonding Curve:** `7CVS16pQuMsDxD5bQjYnGBn5VTjWKDFKkFXAY2bu4bmg`
- **Creation TX:** `6n2Tm9Wi1B4jfNeGS9jkefUsaAyizy8Qf64gs5fy1JjjGmCqf6UKKF1A49qdM5UmHviBhukJ1mezSF1TaHqey63`

## Additional Resources

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Documentation](https://docs.solana.com/)
- [Rust Toolchain Management](https://rust-lang.github.io/rustup/overrides.html)

## Version History

- **v0.1.0** - Initial version with Anchor 0.31.1
- Rust 1.79.0 specified for dependency compatibility
- Cargo.lock v4 → v3 conversion for Solana build tools
- Automated build script with all compatibility fixes

## Need Help?

If you encounter issues not covered here:
1. Check that `rustc --version` shows 1.79.0
2. Delete Cargo.lock files and regenerate with `cargo check`
3. Verify the Cargo.lock conversion: `Select-String "version = " programs/asdf-dat/Cargo.lock`
4. Try running `rustup override set 1.79.0` again
5. Verify Solana CLI is updated: `solana --version`

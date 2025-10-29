# Build Issues and Solutions

## Current Status

The ASDF DAT Solana program **compiles successfully** with Rust 1.82.0, but **fails during the final BPF build step** due to incompatible toolchain management in Solana's build tools.

## What Works ✅

1. **Rust 1.82.0 installation** - Working
2. **Cargo.lock generation** (v3 format) - Working
3. **Cargo check/test** - Compiles successfully with no errors (except 1 deprecation warning)
4. **TypeScript integration** - PumpFun token created successfully on devnet
5. **Anchor 0.31.1 compatibility** - Code updated and compiling

## The Problem ❌

`cargo-build-sbf` and `anchor build` have **embedded toolchain management** that:
- Always looks for a rustup toolchain named "solana"
- Uninstalls any existing "solana" toolchain
- Installs its own "solana" toolchain (version 1.75.0-dev)
- Uses that toolchain, ignoring ALL configuration

### What We Tried (All Failed)

1. ✗ Environment variables (RUSTC, CARGO, RUSTUP_TOOLCHAIN, CARGO_BUILD_RUSTC, CARGO_BUILD_SBF_SKIP_TOOLCHAIN_CHECK)
2. ✗ Rustup override (`rustup override set 1.82.0`)
3. ✗ Toolchain links (`rustup toolchain link solana <path>`)
4. ✗ PATH manipulation (prepending Rust 1.82.0 bin directory)
5. ✗ .cargo/config.toml modifications
6. ✗ --arch sbfv2 flag
7. ✗ Clearing wrapper variables (RUSTC_WRAPPER, RUSTC_WORKSPACE_WRAPPER)
8. ✗ Using `anchor build` instead of `cargo build-sbf`

**None of these approaches work** because cargo-build-sbf has its own internal Rust installation and ignores all external configuration.

## Root Cause

The Solana CLI (v1.18.26) bundles an outdated cargo-build-sbf that:
- Ships with Rust 1.75.0-dev
- Has hardcoded toolchain management
- Cannot be configured to use a different Rust version

## Solutions

### Option 1: Update Solana CLI (Recommended)

Install a newer version of Solana CLI that supports Rust 1.82.0:

```powershell
# Check available versions
solana-install list

# Install newer version (if available)
solana-install init <newer-version>

# Or use latest stable
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

After updating, try the build again with `./build.ps1`.

### Option 2: Use Solana Verify Build

Use Solana's verified build system which handles toolchain management:

```bash
solana-verify build
```

This is the recommended approach for production builds anyway, as it ensures reproducible builds.

### Option 3: Manual Compilation (Advanced)

Build directly with cargo for the BPF target (requires additional setup):

```powershell
# Install BPF target
rustup target add sbfv2-solana-solana

# Build manually
cargo build --release --target sbfv2-solana-solana --manifest-path programs/asdf-dat/Cargo.toml
```

Note: This may require additional configuration and is not officially supported.

### Option 4: Use Docker

Create a Docker environment with all tools at compatible versions:

```dockerfile
FROM solanalabs/rust:1.82.0
# ... build in controlled environment
```

## Current Build Script Status

The `build.ps1` script successfully:
- ✅ Installs Rust 1.82.0
- ✅ Configures rustup override
- ✅ Generates compatible Cargo.lock (v3 format)
- ✅ Verifies code compiles with `cargo check`
- ❌ Fails at final `anchor build` step due to toolchain issues

## Token Creation Success

Despite build issues, we successfully:
- ✅ Created PumpFun token on devnet: `D1CETFzuFJYHH4BcBjf7Ysz8KdJSeCD4Yk5EjJhRk5QV`
- ✅ Initialized bonding curve: `7CVS16pQuMsDxD5bQjYnGBn5VTjWKDFKkFXAY2bu4bmg`
- ✅ Transaction: `6n2Tm9Wi1B4jfNeGS9jkefUsaAyizy8Qf64gs5fy1JjjGmCqf6UKKF1A49qdM5UmHviBhukJ1mezSF1TaHqey63`

## Next Steps

1. **Update Solana CLI** to a version that supports Rust 1.82.0
2. **Re-run build script**: `./build.ps1`
3. **If still fails**: Consider using `solana-verify build` for production
4. **Alternative**: Use CI/CD with properly configured Docker environment

## Technical Details

- **Project**: ASDF DAT (Automated Buyback and Burn System)
- **Framework**: Anchor 0.31.1
- **Rust Required**: 1.82.0 (for indexmap@2.12.0)
- **Solana CLI**: 1.18.26 (may need update)
- **Cargo.lock**: v3 format (compatible with older cargo versions)

## Files Modified

All changes have been committed to branch: `claude/prepare-mainnet-deployment-011CUKGdyUXczWdGXWmpyv79`

- ✅ `build.ps1` - Comprehensive build script with all attempted fixes
- ✅ `BUILD.md` - Build instructions and troubleshooting
- ✅ `programs/asdf-dat/Cargo.toml` - Updated to Anchor 0.31.1
- ✅ `programs/asdf-dat/src/lib.rs` - Fixed Anchor 0.31.1 compatibility
- ✅ `.cargo/config.toml` - Cargo configuration
- ✅ `.gitignore` - Allow program Cargo.lock for reproducibility

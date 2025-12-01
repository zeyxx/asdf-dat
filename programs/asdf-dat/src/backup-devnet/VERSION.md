# Devnet Smart Contract Backup

**Date:** 2025-11-25
**Version:** Devnet Production

## Configuration
- `TESTING_MODE: true`
- Program ID: `ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ`

## Features
- Multi-token ecosystem support
- Token-Agnostic architecture (SPL + Token-2022)
- Hierarchical fee distribution (55.2% / 44.8%)
- Dynamic balance-aware allocation
- Emergency pause/resume controls

## Files
- `lib.rs` - Main smart contract (2,164 LOC)
- `tests.rs` - Unit tests

## Tested Tokens
- DATSPL (Root, SPL Token)
- DATS2 (Secondary, SPL Token)
- DATM (Secondary, Token-2022/Mayhem)

## Notes
This backup represents the fully functional devnet version.
For mainnet deployment, set `TESTING_MODE = false` and use a new program keypair.

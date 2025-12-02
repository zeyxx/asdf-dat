# Contributing to ASDF-DAT

Guidelines for contributing to the ASDF-DAT codebase.

## Development Setup

```bash
# Install dependencies
npm install

# Build Anchor program
anchor build

# Run tests
cargo test --manifest-path programs/asdf-dat/Cargo.toml
npx tsc --noEmit
```

## Code Standards

### Commit Messages

Use conventional commits format:

```
type(scope): description

- Why this change matters
- What it enables
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `refactor`: Code restructure
- `test`: Test changes
- `chore`: Maintenance

**Example:**
```
feat(treasury): add threshold-based buyback trigger

- Reduces gas costs by batching small amounts
- Executes automatically when threshold met
```

### Code Style

- **Rust**: Follow Anchor conventions, use `cargo fmt`
- **TypeScript**: Use Prettier, avoid `any` types
- **Comments**: Explain WHY, not WHAT

### Testing Requirements

Before submitting:

- [ ] All existing tests pass (`cargo test`, `npx tsc --noEmit`)
- [ ] New code has test coverage
- [ ] No hardcoded secrets or test wallets
- [ ] No debug statements left

### Security Checklist

- [ ] No exposed private keys or API keys
- [ ] Input validation on all public functions
- [ ] Integer overflow protection (use `saturating_*` or `checked_*`)
- [ ] PDA derivation uses correct seeds
- [ ] Admin-only functions have proper access control

## Pull Request Process

1. Create feature branch from `main`
2. Make changes with clear commits
3. Run full test suite
4. Create PR with description and test plan
5. Address review feedback
6. Squash merge when approved

## File Structure

```
asdf-dat/
├── programs/asdf-dat/src/    # Solana program (Anchor)
├── lib/                       # Shared TypeScript libraries
├── scripts/                   # CLI scripts
├── devnet-tokens/             # Devnet token configs
├── mainnet-tokens/            # Mainnet token configs
└── docs/                      # Documentation
```

## Questions?

Open an issue or reach out to maintainers.

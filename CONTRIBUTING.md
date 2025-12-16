# Contributing to ASDF Burn Engine

Guidelines for contributing to the ASDF Burn Engine codebase.

---

## Philosophy

Before you code, understand what we're building:

> **Creation, not extraction.**
> We don't take value. We create it.
> We don't print tokens. We burn them.

### Core Principles

1. **Quality > Quantity** - One working feature beats three half-done ones
2. **Phase 2 Ready** - Every line of code should make the multi-tenant future easier
3. **Verify Everything** - "Don't trust, verify" applies to your own code too
4. **Simple > Clever** - Readable code wins over impressive abstractions

### The Mantra

```
Test. Verify. Learn. Repeat.
Never assume. Always confirm.
Phase 1 today. Phase 2 ready.
```

*Building infrastructure for Creator Capital Markets.* 🔥🐕

---

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

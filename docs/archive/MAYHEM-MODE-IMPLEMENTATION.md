# Mayhem Mode Implementation Plan

## 🎯 Objectif

Adapter le programme ASDF DAT pour créer des tokens en **Mayhem Mode** avec agent AI de trading automatique.

## 📊 Changements Techniques

### 1. Nouveaux Imports

```rust
use anchor_spl::{
    token::{self, Token, TokenAccount, Mint},
    token_2022::{self as token2022},  // ← AJOUTÉ
    associated_token::AssociatedToken,
};
```

### 2. Nouvelles Constantes

```rust
// Mayhem Program ID
pub const MAYHEM_PROGRAM: Pubkey = ...;  // MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e

// Mayhem Fee Recipient
pub const MAYHEM_FEE_RECIPIENT: Pubkey = ...;  // GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS

// Mayhem AI Agent Wallet
pub const MAYHEM_AGENT_WALLET: Pubkey = ...;  // BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s
```

### 3. Nouvelle Instruction: `create_pumpfun_token_mayhem`

**Signature:**
```rust
pub fn create_pumpfun_token_mayhem(
    ctx: Context<CreatePumpfunTokenMayhem>,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()>
```

**Différences clés:**
- Utilise `create_v2` (nouveau discriminator)
- Paramètre booléen `is_mayhem_mode = true`
- Token2022 au lieu de Token Program
- Supply: 2 milliards (au lieu de 1 milliard)

### 4. Nouveau Struct de Comptes: `CreatePumpfunTokenMayhem`

```rust
#[derive(Accounts)]
pub struct CreatePumpfunTokenMayhem<'info> {
    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: PDA from pump program
    pub mint_authority: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Bonding curve PDA (82 bytes for Mayhem Mode)
    pub bonding_curve: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Associated bonding curve token account
    pub associated_bonding_curve: AccountInfo<'info>,

    /// CHECK: Global config PDA
    pub global: AccountInfo<'info>,

    /// CHECK: Mayhem fee recipient
    pub mayhem_fee_recipient: AccountInfo<'info>,  // ← NOUVEAU

    #[account(mut)]
    /// CHECK: Token2022 metadata account
    pub metadata: AccountInfo<'info>,

    #[account(
        seeds = [DAT_AUTHORITY_SEED],
        bump = dat_state.dat_authority_bump,
        constraint = dat_authority.key() == dat_state.dat_authority
    )]
    /// CHECK: DAT Authority PDA - créateur du token
    pub dat_authority: AccountInfo<'info>,

    #[account(
        seeds = [DAT_STATE_SEED],
        bump = dat_state.bump
    )]
    pub dat_state: Account<'info, DATState>,

    pub system_program: Program<'info, System>,

    /// CHECK: Token2022 program
    pub token_2022_program: AccountInfo<'info>,  // ← CHANGÉ de token_program

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,

    /// CHECK: Event authority PDA
    pub event_authority: AccountInfo<'info>,

    /// CHECK: Mayhem program
    pub mayhem_program: AccountInfo<'info>,  // ← CHANGÉ de pump_program
}
```

### 5. Instruction Data pour `create_v2`

```rust
let mut data = Vec::new();

// Discriminator pour create_v2 (à déterminer depuis l'IDL Mayhem)
data.extend_from_slice(&[...]); // TODO: Obtenir discriminator

// Name (String)
data.extend_from_slice(&(name.len() as u32).to_le_bytes());
data.extend_from_slice(name.as_bytes());

// Symbol (String)
data.extend_from_slice(&(symbol.len() as u32).to_le_bytes());
data.extend_from_slice(symbol.as_bytes());

// URI (String)
data.extend_from_slice(&(uri.len() as u32).to_le_bytes());
data.extend_from_slice(uri.as_bytes());

// Creator (Pubkey)
data.extend_from_slice(&ctx.accounts.dat_authority.key().to_bytes());

// is_mayhem_mode (bool = 1 byte)
data.extend_from_slice(&[1u8]);  // ← NOUVEAU: true pour Mayhem Mode
```

### 6. Ordre des Comptes pour CPI

Position critique du fee recipient selon la doc:
- **Position 2** pour Bonding Curve program
- **Position 10** pour Pump Swap program

```rust
let accounts = vec![
    AccountMeta::new(ctx.accounts.mint.key(), true),            // 0
    AccountMeta::new_readonly(ctx.accounts.mint_authority.key(), false),  // 1
    AccountMeta::new(ctx.accounts.mayhem_fee_recipient.key(), false),  // 2 ← FEE RECIPIENT
    AccountMeta::new(ctx.accounts.bonding_curve.key(), false),  // 3
    AccountMeta::new(ctx.accounts.associated_bonding_curve.key(), false),  // 4
    AccountMeta::new_readonly(ctx.accounts.global.key(), false),  // 5
    AccountMeta::new(ctx.accounts.metadata.key(), false),  // 6
    AccountMeta::new(ctx.accounts.dat_authority.key(), true),  // 7
    AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),  // 8
    AccountMeta::new_readonly(ctx.accounts.token_2022_program.key(), false),  // 9
    AccountMeta::new_readonly(ctx.accounts.associated_token_program.key(), false),  // 10
    AccountMeta::new_readonly(ctx.accounts.rent.key(), false),  // 11
    AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),  // 12
    AccountMeta::new_readonly(ctx.accounts.mayhem_program.key(), false),  // 13
];
```

## 🚀 Étapes d'Implémentation

### Phase 1: Préparation (✅ FAIT)
- [x] Recherche Mayhem Mode specs
- [x] Identification des différences
- [x] Ajout imports Token2022
- [x] Ajout constantes Mayhem

### Phase 2: Code Rust
- [ ] Obtenir l'IDL de Mayhem Program pour discriminator `create_v2`
- [ ] Créer struct `CreatePumpfunTokenMayhem`
- [ ] Implémenter fonction `create_pumpfun_token_mayhem`
- [ ] Compiler et tester syntaxe

### Phase 3: Scripts TypeScript
- [ ] Créer `scripts/create-token-mayhem.ts`
- [ ] Adapter pour utiliser Token2022
- [ ] Tester sur devnet (si disponible)

### Phase 4: Tests
- [ ] Tester création token Mayhem sur devnet
- [ ] Vérifier agent AI démarre le trading
- [ ] Valider supply de 2 milliards
- [ ] Tester collect_fees avec Mayhem tokens

## ⚠️ Points d'Attention

### 1. Devnet Availability
Selon la recherche, Mayhem Mode est actuellement sur **mainnet uniquement**. Il faudra peut-être:
- Tester sur mainnet avec précaution
- Ou attendre le déploiement devnet

### 2. IDL Mayhem Program
Besoin d'obtenir:
```bash
anchor idl fetch MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e
```

### 3. Token2022 Program ID
```
TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
```

### 4. Fee Recipients
7 addresses possibles - besoin de la liste complète ou utiliser `MAYHEM_FEE_RECIPIENT` par défaut.

## 📝 Checklist de Lancement Mainnet

- [ ] Programme compilé et testé
- [ ] Constantes vérifiées (addresses, discriminators)
- [ ] Script de création testé
- [ ] DAT Authority a suffisamment de SOL
- [ ] Metadata préparée (image, description)
- [ ] Plan de communication prêt
- [ ] Monitoring en place

## 🔗 Références

- [Mayhem Mode Docs](https://pump.fun/docs/mayhem-mode)
- [PumpFun Public Docs GitHub](https://github.com/pump-fun/pump-public-docs)
- [Mayhem Mode Disclaimer](https://pump.fun/docs/mayhem-mode-disclaimer)

## ⏭️ Prochaine Étape

**Tu veux que je continue l'implémentation maintenant ?**

Options:
A. Implémenter tout le code Rust (fonction + struct)
B. D'abord obtenir l'IDL Mayhem pour le discriminator
C. Créer le script TypeScript en parallèle
D. Autre approche ?

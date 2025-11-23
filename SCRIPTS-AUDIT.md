# Scripts Audit & Cleanup

Date: 2025-11-23
Total scripts: 37

## ✅ SCRIPTS ESSENTIELS (À GARDER)

### Token Creation
- **create-token-mayhem.ts** - Crée un token Mayhem Mode (Token2022)
  - Statut: ✅ Fonctionne
  - Usage: Production

### Pool Initialization
- **init-mayhem-pool-accounts.ts** - Initialise les comptes pool pour Mayhem
  - Statut: ✅ Fonctionne
  - Usage: Nécessaire après création token

### Testing
- **test-mayhem-full-cycle.ts** - Test cycle complet en 1 TX ⭐
  - Statut: ✅ Fonctionne (11+ cycles réussis)
  - Usage: Test principal pour validation

- **test-mayhem-cycle.ts** - Test cycle en 3 étapes séparées
  - Statut: ✅ Fonctionne
  - Usage: Debug détaillé de chaque étape

### Monitoring & Debug
- **check-dat-state.ts** - Affiche l'état DAT avec stats
  - Statut: ✅ Fonctionne
  - Usage: Monitoring

- **read-cycle-events.ts** - Lit les events avec décimales ⭐
  - Statut: ✅ Fonctionne
  - Usage: Analyse post-transaction

### Validation
- **validate-mayhem-readiness.ts** - Valide pre-launch
  - Statut: ✅ Fonctionne
  - Usage: Pre-deployment checks

---

## ⚠️ SCRIPTS UTILES (À ÉVALUER)

### Wrappers/Setup
- **launch-mayhem-token.ts** - Wrapper complet token + setup
  - Statut: ❓ À vérifier
  - Décision: Vérifier si plus complet que create-token-mayhem

- **devnet-full-setup.ts** - Setup complet devnet
  - Statut: ❓ À vérifier
  - Décision: Vérifier utilité réelle

### Debug Utilities
- **check-creator-vault.ts** - Vérifie creator vault
  - Statut: ✅ Utile pour debug
  - Décision: Garder si simple, sinon fusionner avec check-dat-state

- **check-token-balance.ts** - Vérifie balances
  - Statut: ✅ Utile pour debug
  - Décision: Garder si simple

- **devnet-status.ts** - Status général devnet
  - Statut: ❓ À vérifier
  - Décision: Vérifier contenu

---

## ❌ SCRIPTS OBSOLÈTES (À SUPPRIMER)

### SPL Token (Non Fonctionnels sur Devnet)
- **create-token-via-dat.ts** - Crée token SPL
  - Raison: Tokens SPL non tradables sur PumpFun devnet
  - Créé: Aujourd'hui pour tests
  - Impact: Aucun, jamais utilisé en prod

- **init-spl-pool-accounts.ts** - Init pools SPL
  - Raison: Créé aujourd'hui, jamais testé, SPL non fonctionnel
  - Impact: Aucun

- **test-dat-full-cycle.ts** - Test cycle SPL
  - Raison: Jamais testé, SPL non fonctionnel
  - Impact: Aucun

### Scripts d'Achat (Échoués/Non Fonctionnels)
- **buy-spl-token-multiple.ts** - Achat SPL multiple
  - Raison: Créé aujourd'hui, échoue (SPL non tradable)
  - Impact: Aucun

- **buy-mayhem-official.ts** - Achat via SDK officiel
  - Raison: Dépendance @pump-fun/pump-sdk manquante
  - Impact: Jamais fonctionné

- **buy-mayhem-to-init-pool.ts** - Achat pour init pool
  - Raison: Échoue avec "AccountOwnedByWrongProgram"
  - Impact: Jamais fonctionné correctement

- **buy-token-sdk.ts** - Achat générique
  - Raison: Probablement obsolète, remplacé par scripts Mayhem
  - Impact: Inconnu, non utilisé récemment

### Init/Setup (Hardcodés/Obsolètes)
- **init-all-accounts.ts** - Init tous comptes
  - Raison: Hardcodé avec anciennes valeurs (TOKEN_MINT, BONDING_CURVE)
  - Impact: Dangereux, valeurs incorrectes

- **init-creator-vault.ts** - Init creator vault
  - Raison: Probablement obsolète, vault créé auto par PumpFun
  - Impact: Inconnu

- **init.ts** - Init générique
  - Raison: Probablement remplacé par scripts spécifiques
  - Impact: À vérifier

### Debug Ponctuels (Utilisés une fois)
- **check-bonding-curve.ts** - Check bonding curve
  - Raison: Debug ponctuel, info disponible dans check-dat-state
  - Impact: Aucun

- **check-mayhem-pdas.ts** - Check PDAs Mayhem
  - Raison: Debug ponctuel lors développement
  - Impact: Aucun

- **check-mint-auth-pda.ts** - Check mint authority
  - Raison: Debug ponctuel
  - Impact: Aucun

- **check-token-accounts.ts** - Check token accounts
  - Raison: Debug ponctuel, info disponible ailleurs
  - Impact: Aucun

### Find/Search (Debug ponctuels)
- **find-bonding-curve.ts** - Trouve bonding curve
  - Raison: Debug, info maintenant dans JSON files
  - Impact: Aucun

- **find-creator-vault.ts** - Trouve creator vault
  - Raison: Debug, derivation simple
  - Impact: Aucun

### Setup Ponctuels (Utilisés une fois)
- **fund-dat-authority.ts** - Fund DAT authority
  - Raison: Setup ponctuel, fait une fois
  - Impact: Plus nécessaire

- **fund-pool-wsol.ts** - Fund pool WSOL
  - Raison: Setup ponctuel
  - Impact: Plus nécessaire

- **setup-ata.ts** - Setup ATA générique
  - Raison: Fait par scripts spécifiques maintenant
  - Impact: Aucun

- **create-fee-recipient-ata.ts** - Crée ATA fee recipient
  - Raison: Setup ponctuel
  - Impact: Plus nécessaire

### Dev/Simulation
- **simulate-mayhem-pool-liquidity.ts** - Simule liquidité
  - Raison: Dev/testing, pas prod
  - Impact: Aucun

- **test-mayhem-burn-only.ts** - Test burn seulement
  - Raison: Test partiel, full-cycle suffit
  - Impact: Aucun

### Admin Ponctuels
- **transfer-admin.ts** - Transfer admin
  - Raison: Admin ponctuel, utilisation rare
  - Décision: Garder? Utile pour emergencies

- **transfer-program-authority.ts** - Transfer program authority
  - Raison: Admin ponctuel, utilisation rare
  - Décision: Garder? Utile pour emergencies

- **update-dat-config.ts** - Update config
  - Raison: Admin ponctuel
  - Décision: Garder? Utile pour updates

---

## 📊 STATISTIQUES

- **Total**: 37 scripts
- **À garder (essentiels)**: 7 scripts
- **À évaluer**: 5 scripts
- **À supprimer**: 25 scripts
- **Taux de nettoyage**: ~67%

---

## 🎯 PLAN D'ACTION

### Phase 1: Vérification
1. Vérifier launch-mayhem-token.ts vs create-token-mayhem.ts
2. Vérifier devnet-full-setup.ts utilité
3. Vérifier scripts admin (transfer-*, update-*)

### Phase 2: Nettoyage
1. Supprimer tous les scripts SPL (3 scripts)
2. Supprimer scripts d'achat non fonctionnels (4 scripts)
3. Supprimer scripts init obsolètes (3 scripts)
4. Supprimer scripts debug ponctuels (7 scripts)
5. Supprimer scripts find (2 scripts)
6. Supprimer scripts setup ponctuels (4 scripts)
7. Supprimer scripts dev/simulation (2 scripts)

### Phase 3: Organisation
1. Créer dossiers: core/, debug/, admin/
2. Déplacer scripts restants dans structure claire
3. Créer README.md avec workflow

---

## ✅ WORKFLOW FINAL VALIDÉ

### 1. Création Token Mayhem
```bash
npx ts-node scripts/create-token-mayhem.ts
```

### 2. Init Pool Accounts
```bash
npx ts-node scripts/init-mayhem-pool-accounts.ts
```

### 3. Attendre Fees (AI agent ou trades manuels)
*Note: Sur devnet, AI agent ne fonctionne pas, utiliser token existant*

### 4. Test Cycle Complet
```bash
npx ts-node scripts/test-mayhem-full-cycle.ts
```

### 5. Lire Events (optionnel)
```bash
npx ts-node scripts/read-cycle-events.ts <TX_SIGNATURE>
```

### 6. Check État (optionnel)
```bash
npx ts-node scripts/check-dat-state.ts
```

---

## 📝 NOTES

- Token Mayhem fonctionnel: `6KAzir6ZApHcAsjDXsfoA9LXjNYtEanyrNkBgenajBVU`
- 11+ cycles réussis sur ce token
- Cycle complet fonctionne en 1 TX (Token2022) ✅
- Format décimal corrigé dans logs et events ✅

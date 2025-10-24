# Scripts Devnet pour ASDF DAT

Ce dossier contient tous les scripts nécessaires pour tester le protocole ASDF DAT sur Solana devnet.

## 📋 Vue d'Ensemble

| Script | Description | Quand l'utiliser |
|--------|-------------|------------------|
| `devnet-setup-accounts.ts` | Crée les token accounts (ATAs) pour DAT Authority | Après déploiement, avant init |
| `devnet-init.ts` | Initialise le protocole sur devnet | Une seule fois au début |
| `devnet-status.ts` | Affiche l'état actuel du protocole | À tout moment pour monitoring |
| `devnet-execute-cycle.ts` | Exécute un cycle de buyback/burn | Quand des frais sont disponibles |

## 🚀 Ordre d'Exécution

### 1. Préparation Initiale

```bash
# Configurer Solana pour devnet
solana config set --url https://api.devnet.solana.com
solana config set --keypair ./devnet-wallet.json

# Obtenir du SOL devnet
solana airdrop 2
solana airdrop 2
```

### 2. Créer votre Token Devnet

Suivez le guide : `../PUMPFUN_DEVNET_GUIDE.md`

Vous aurez besoin de :
- Token Mint address
- Pool address
- PumpSwap program addresses

### 3. Configurer le Programme

Éditez `programs/asdf-dat/src/lib.rs` avec vos adresses devnet :

```rust
pub const ASDF_MINT: Pubkey = solana_program::pubkey!("VOTRE_TOKEN_MINT");
pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!("VOTRE_POOL");
// etc.
```

### 4. Build et Deploy

```bash
# Build
anchor build

# Mettre à jour program ID dans lib.rs et Anchor.toml
solana address -k target/deploy/asdf_dat-keypair.json

# Rebuild
anchor build

# Deploy
anchor deploy --provider.cluster devnet
```

### 5. Exécuter les Scripts dans l'Ordre

#### 5.1 Setup Token Accounts (Optionnel)

```bash
ts-node scripts/devnet-setup-accounts.ts
```

Crée les ATAs pour WSOL et ASDF appartenant au DAT Authority PDA.

**Note** : Souvent créés automatiquement, mais ce script permet de les créer à l'avance.

#### 5.2 Initialiser le Protocole

```bash
ts-node scripts/devnet-init.ts
```

**Output attendu** :
```
🚀 Initializing ASDF DAT Protocol on Devnet...
✅ Initialized successfully!

Next Steps:
1. Transfer coin_creator ownership to DAT Authority
2. Generate trading activity
```

#### 5.3 Transférer le Creator

Sur PumpFun devnet, transférez le `coin_creator` au DAT Authority (adresse affichée).

#### 5.4 Générer de l'Activité

Effectuez des swaps sur votre token pour accumuler des frais :
- Via l'interface PumpFun devnet
- Via des scripts de trading
- Minimum : atteindre le seuil de frais (0.01 SOL pour devnet)

#### 5.5 Vérifier le Statut

```bash
ts-node scripts/devnet-status.ts
```

**Output attendu** :
```
📊 ASDF DAT Protocol Status (Devnet)
================================
PROTOCOL STATE
  Is Active: ✅ Yes
  Total Burned: 0 tokens
  Total Buybacks: 0

NEXT CYCLE ELIGIBILITY
  ✅ Ready to execute first cycle
```

#### 5.6 Exécuter un Cycle

```bash
ts-node scripts/devnet-execute-cycle.ts
```

**Output attendu** :
```
🔄 Executing DAT Cycle on Devnet...
✅ Cycle executed successfully!

📊 Cycle Results:
  Cycle #: 1
  SOL Used: 0.0100 SOL
  Tokens Burned: 150000
  Rate: 15000000 tokens per SOL
```

#### 5.7 Vérifier les Résultats

```bash
ts-node scripts/devnet-status.ts
```

Vous devriez voir :
- `Total Buybacks: 1`
- `Total Burned: [nombre de tokens]`
- Métriques mises à jour

## 🔄 Workflow Quotidien de Test

### Tester un Cycle Complet

```bash
# 1. Vérifier l'état actuel
ts-node scripts/devnet-status.ts

# 2. Si éligible et frais suffisants, exécuter
ts-node scripts/devnet-execute-cycle.ts

# 3. Vérifier les résultats
ts-node scripts/devnet-status.ts
```

### Tester les Fonctions Admin

Vous pouvez également tester manuellement :

```typescript
// Pause d'urgence
await program.methods.emergencyPause().accounts({...}).rpc();

// Reprendre
await program.methods.resume().accounts({...}).rpc();

// Mettre à jour paramètres
await program.methods.updateParameters(
  new BN(20_000_000), // new min fees
  null,               // keep max fees
  null,               // keep slippage
  null                // keep interval
).accounts({...}).rpc();
```

## 📊 Monitoring et Debugging

### Vérifier les Logs de Transaction

```bash
# Via signature
solana confirm -v [SIGNATURE] --url devnet

# Ou dans le code
console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
```

### Vérifier les Comptes

```bash
# DAT State
solana account [DAT_STATE_ADDRESS] --url devnet

# Token accounts
spl-token accounts --owner [DAT_AUTHORITY] --url devnet
```

### Erreurs Communes

| Erreur | Cause | Solution |
|--------|-------|----------|
| "Account does not exist" | Pas initialisé | Run `devnet-init.ts` |
| "Insufficient fees" | Pas assez de frais | Générer plus de trades |
| "Cycle too soon" | Intervalle non écoulé | Attendre ou réduire interval |
| "Not coin creator" | Creator pas transféré | Transférer sur PumpFun |
| "Slippage exceeded" | Prix a trop bougé | Réessayer ou ajuster slippage |

## 🧪 Tests Automatisés

Pour des tests plus poussés, vous pouvez créer un script de test complet :

```typescript
// scripts/devnet-full-test.ts
async function fullTest() {
  // 1. Setup
  await setupAccounts();

  // 2. Initialize
  await initialize();

  // 3. Generate trades (automated)
  await generateTrades(10);

  // 4. Execute cycles
  for (let i = 0; i < 5; i++) {
    await executeCycle();
    await sleep(70000); // Wait 70s (devnet interval = 60s)
  }

  // 5. Verify results
  await verifyResults();
}
```

## 📝 Configuration

Tous les scripts lisent la configuration de :
- `Anchor.toml` : cluster, wallet
- Variables d'environnement : RPC custom

Pour utiliser un RPC custom :
```bash
export ANCHOR_PROVIDER_URL="https://your-rpc-devnet.com"
ts-node scripts/devnet-status.ts
```

## 🎯 Objectifs de Test sur Devnet

Avant de passer à mainnet, validez :

1. **Fonctionnalités Core** (5+ cycles)
   - [ ] Collect fees
   - [ ] Buyback tokens
   - [ ] Burn tokens
   - [ ] Update metrics

2. **Sécurité**
   - [ ] Slippage protection
   - [ ] Price impact protection
   - [ ] Rate validation
   - [ ] AM/PM limits

3. **Admin**
   - [ ] Emergency pause
   - [ ] Resume
   - [ ] Update parameters
   - [ ] Transfer admin

4. **Monitoring**
   - [ ] Events émis
   - [ ] Métriques correctes
   - [ ] Scripts fonctionnent

Voir `../MAINNET_READINESS.md` pour la checklist complète.

## 🆘 Support

Si vous rencontrez des problèmes :

1. Vérifiez les logs de transaction
2. Vérifiez l'état avec `devnet-status.ts`
3. Consultez `../DEVNET_DEPLOYMENT.md`
4. Ouvrez une issue sur GitHub

## 📚 Ressources

- **Guide de déploiement** : `../DEVNET_DEPLOYMENT.md`
- **Guide PumpFun** : `../PUMPFUN_DEVNET_GUIDE.md`
- **Checklist mainnet** : `../MAINNET_READINESS.md`
- **Solana Explorer (Devnet)** : https://explorer.solana.com/?cluster=devnet

---

**Bon testing !** 🚀

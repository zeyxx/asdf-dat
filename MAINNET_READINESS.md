# Checklist de Préparation au Déploiement Mainnet

Ce document liste toutes les vérifications à effectuer sur devnet avant le déploiement sur mainnet.

## ✅ Phase 1 : Tests Devnet Réussis

### Déploiement
- [ ] Programme compile sans warnings
- [ ] Programme se déploie sur devnet sans erreur
- [ ] Program ID correctement configuré dans Anchor.toml et lib.rs
- [ ] Taille du programme acceptable (< 200KB optimalement)

### Initialisation
- [ ] `initialize()` s'exécute avec succès
- [ ] DAT State PDA créé correctement
- [ ] DAT Authority PDA dérivé correctement
- [ ] Paramètres initiaux correctement définis
- [ ] Événement `DATInitialized` émis

### Token Accounts
- [ ] ATAs pour WSOL créés pour DAT Authority
- [ ] ATAs pour ASDF créés pour DAT Authority
- [ ] Creator vault ATA existe et est accessible
- [ ] Aucun problème de permissions sur les comptes

### Propriété Creator
- [ ] `coin_creator` transféré au DAT Authority
- [ ] Pool reconnaît DAT Authority comme creator
- [ ] Frais s'accumulent dans la creator vault

## ✅ Phase 2 : Fonctionnalités Core

### Collect Fees
- [ ] `collect_fees_step()` exécute sans erreur
- [ ] Frais correctement transférés de creator vault vers DAT WSOL account
- [ ] Montants corrects (pas de perte de tokens)
- [ ] Fonctionne avec différents montants de frais

### Buyback (Swap)
- [ ] Swap s'exécute correctement via PumpSwap
- [ ] Tokens ASDF reçus dans DAT ASDF account
- [ ] Montants respectent les calculs (constant product formula)
- [ ] Slippage protection fonctionne (rejette si > tolérance)
- [ ] Price impact protection fonctionne (rejette si > 3%)
- [ ] Rotation des protocol fee recipients fonctionne

### Burn
- [ ] Tokens brûlés correctement (supply diminue)
- [ ] Montant brûlé correspond au montant reçu du swap
- [ ] Événement `CycleCompleted` émis avec bonnes données
- [ ] DAT ASDF account balance retourne à 0

### Cycle Complet
- [ ] Au moins 5 cycles exécutés avec succès
- [ ] Métriques s'incrémentent correctement :
  - [ ] `total_burned` augmente
  - [ ] `total_sol_collected` augmente
  - [ ] `total_buybacks` s'incrémente
  - [ ] `last_cycle_timestamp` se met à jour
  - [ ] `last_cycle_sol` et `last_cycle_burned` corrects

## ✅ Phase 3 : Sécurité & Validations

### Contraintes Temporelles
- [ ] `MIN_CYCLE_INTERVAL` respecté (rejette si trop tôt)
- [ ] Système AM/PM fonctionne :
  - [ ] Maximum 1 exécution AM par jour
  - [ ] Maximum 1 exécution PM par jour
  - [ ] Impossible d'exécuter 2x dans la même période

### Contraintes Financières
- [ ] `MIN_FEES_TO_CLAIM` vérifié (rejette si insuffisant)
- [ ] `MAX_FEES_PER_CYCLE` respecté (cap le montant utilisé)
- [ ] Prix maximum 1% des réserves du pool (sécurité)
- [ ] Vérification `RateTooLow` fonctionne (protection anti-manipulation)

### Validations de Sécurité
- [ ] Slippage protection rejette les transactions avec trop de slippage
- [ ] Price impact rejette si impact > 3%
- [ ] Anti-reentrancy : timestamp mis à jour en premier
- [ ] Vérification `is_active` et `emergency_pause`
- [ ] Vérification `coin_creator` correcte
- [ ] Vérification vault initialisé

### Gestion d'Erreurs
- [ ] Erreurs appropriées retournées dans tous les cas d'échec
- [ ] Pas de panics non gérés
- [ ] `record_failure()` fonctionne correctement
- [ ] Auto-pause après 5 échecs consécutifs

## ✅ Phase 4 : Fonctions Admin

### Emergency Pause
- [ ] `emergency_pause()` fonctionne
- [ ] Bloque l'exécution des cycles après pause
- [ ] Seul l'admin peut appeler
- [ ] Événement émis correctement

### Resume
- [ ] `resume()` fonctionne
- [ ] Réactive le protocole après pause
- [ ] Reset `consecutive_failures`
- [ ] Seul l'admin peut appeler

### Update Parameters
- [ ] Peut mettre à jour `min_fees_threshold` (avec limites)
- [ ] Peut mettre à jour `max_fees_per_cycle` (avec limites)
- [ ] Peut mettre à jour `slippage_bps` (avec limites)
- [ ] Peut mettre à jour `min_cycle_interval` (avec limites)
- [ ] Rejette les valeurs hors limites
- [ ] Seul l'admin peut appeler

### Transfer Admin
- [ ] `transfer_admin()` fonctionne
- [ ] Nouveau admin peut exécuter fonctions admin
- [ ] Ancien admin ne peut plus exécuter
- [ ] Événement `AdminTransferred` émis

## ✅ Phase 5 : Monitoring & Événements

### Événements Émis
- [ ] `DATInitialized` lors de l'init
- [ ] `CycleCompleted` après chaque cycle réussi
- [ ] `CycleFailed` en cas d'échec (si record_failure appelé)
- [ ] `StatusChanged` lors de pause/resume
- [ ] `EmergencyAction` lors d'action d'urgence
- [ ] `AdminTransferred` lors de transfert admin

### Métriques Trackées
- [ ] Toutes les métriques dans DATState correctes
- [ ] Pas d'overflow sur les compteurs
- [ ] Timestamps corrects
- [ ] Prix trackés correctement

### Scripts de Monitoring
- [ ] `devnet-status.ts` fonctionne et affiche infos correctes
- [ ] Peut vérifier l'état à tout moment
- [ ] Explorer links fonctionnent

## ✅ Phase 6 : Performance & Optimisation

### Compute Units
- [ ] Cycles s'exécutent dans les limites de compute (< 1.4M CU)
- [ ] Pas de timeout de transaction
- [ ] Pas d'erreurs de stack overflow

### Coûts de Transaction
- [ ] Frais de transaction raisonnables (< 0.01 SOL)
- [ ] Pas de gaspillage de lamports

### Optimisations
- [ ] Utilisation de `saturating_*` pour éviter overflows
- [ ] Utilisation de `checked_*` où nécessaire
- [ ] Pas de calculs redondants
- [ ] Reloads minimisés

## ✅ Phase 7 : Documentation & Code

### Code Quality
- [ ] Code bien commenté
- [ ] Pas de code mort (unused)
- [ ] Pas de TODOs ou FIXMEs non résolus
- [ ] Constantes clairement nommées
- [ ] Fonctions bien structurées

### Documentation
- [ ] README.md à jour
- [ ] DEVNET_DEPLOYMENT.md complet
- [ ] PUMPFUN_DEVNET_GUIDE.md complet
- [ ] Ce fichier MAINNET_READINESS.md rempli
- [ ] Scripts commentés

### Audit de Sécurité
- [ ] Pas de hardcoded secrets
- [ ] Adresses mainnet correctes dans lib.rs
- [ ] Aucune adresse devnet restante
- [ ] PDAs correctement dérivés (seeds constants)

## ✅ Phase 8 : Préparation Mainnet

### Configuration Mainnet
- [ ] `Anchor.toml` configuré pour mainnet
- [ ] `lib.rs` contient les adresses mainnet correctes :
  - [ ] ASDF_MINT : `9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump`
  - [ ] POOL_PUMPSWAP : `DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb`
  - [ ] PUMP_SWAP_PROGRAM : `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`
  - [ ] FEE_PROGRAM : adresse correcte
- [ ] Protocol fee recipients mainnet configurés
- [ ] Paramètres mainnet restaurés :
  - [ ] MIN_FEES_TO_CLAIM : 190_000_000 (0.19 SOL)
  - [ ] MAX_FEES_PER_CYCLE : 10_000_000_000 (10 SOL)
  - [ ] MIN_CYCLE_INTERVAL : 3600 (1 heure)

### Wallet & Sécurité
- [ ] Wallet mainnet sécurisé (hardware wallet recommandé)
- [ ] Backup du wallet mainnet (seed phrase sécurisée)
- [ ] Suffisamment de SOL pour le déploiement (5-10 SOL)
- [ ] Multi-sig configuré pour l'admin (recommandé)

### RPC & Infrastructure
- [ ] RPC mainnet fiable configuré (Helius, Quicknode, etc.)
- [ ] Fallback RPC configuré
- [ ] Monitoring setup (alertes, logs)

### Plan de Déploiement
- [ ] Backup du code devnet (git tag)
- [ ] Build final testé : `anchor build`
- [ ] Program ID vérifié
- [ ] Séquence de déploiement planifiée :
  1. [ ] Deploy program
  2. [ ] Vérifier deployment
  3. [ ] Initialize protocol
  4. [ ] Vérifier initialization
  5. [ ] Coordonner avec PumpFun pour transfert creator
  6. [ ] Tester premier cycle (petit montant)
  7. [ ] Monitoring actif 24h
  8. [ ] Annonce publique

## ✅ Phase 9 : Post-Déploiement Mainnet

### Tests Initiaux
- [ ] Initialisation réussie sur mainnet
- [ ] Premier cycle test exécuté (attendre accumulation de fees)
- [ ] Vérifier les résultats du premier cycle
- [ ] Dashboard de monitoring actif

### Monitoring Continu
- [ ] Surveiller les cycles quotidiens (AM & PM)
- [ ] Vérifier les métriques régulièrement
- [ ] Alertes configurées pour échecs
- [ ] Explorer Solana suivi

### Communication
- [ ] Annonce sur Twitter (@jeanterre13)
- [ ] Annonce dans communauté $ASDFASDFA
- [ ] Documentation publique accessible
- [ ] Support disponible (GitHub issues)

## ✅ Phase 10 : Contingences

### Plan d'Urgence
- [ ] Procédure emergency_pause documentée
- [ ] Contacts admin disponibles 24/7
- [ ] Plan de rollback si nécessaire
- [ ] Communication de crise préparée

### Gestion des Problèmes
- [ ] Procédure pour bugs critiques
- [ ] Procédure pour bugs non-critiques
- [ ] Canaux de support utilisateurs
- [ ] FAQ préparée

---

## Validation Finale

**Date des tests devnet** : _______________

**Personne responsable** : _______________

**Signature/Validation** : _______________

### Résumé des Tests Devnet

```
Nombre total de cycles exécutés : _____
Total tokens brûlés (devnet) : _____
Total SOL utilisé (devnet) : _____
Taux de succès : _____%
Échecs rencontrés : _____
```

### Go/No-Go Mainnet

- [ ] ✅ **GO** - Tous les critères sont remplis, prêt pour mainnet
- [ ] ❌ **NO-GO** - Des problèmes restent à résoudre

**Raisons si NO-GO** :
- _______________________________________________
- _______________________________________________
- _______________________________________________

---

## Déploiement Mainnet Effectué

**Date de déploiement** : _______________

**Program ID Mainnet** : _______________

**Transaction d'initialisation** : _______________

**Premier cycle exécuté** : _______________

**Statut** : ✅ Succès / ❌ Problèmes

**Notes** :
_______________________________________________
_______________________________________________
_______________________________________________

---

**Important** : Ne déployez JAMAIS sur mainnet sans avoir complété et vérifié TOUTES les cases de cette checklist. Les smart contracts sont immuables une fois déployés. Mieux vaut prendre le temps de tout tester que de déployer avec des bugs.

🚀 Bon déploiement !

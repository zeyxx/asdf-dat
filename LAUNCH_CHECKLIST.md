# Launch Checklist - 19 Décembre 2025

Checklist pour la présentation vidéo ASDF Burn Engine.

---

## 🎯 Pre-Production (J-2)

### Infrastructure Devnet

- [ ] DAT State initialisé
  ```bash
  npx ts-node scripts/check-dat-state.ts --network devnet
  ```

- [ ] Wallet devnet avec SOL
  ```bash
  solana balance devnet-wallet.json --url devnet
  # Target: > 5 SOL pour les tests
  ```

- [ ] CREATOR env var configuré
  ```bash
  echo $CREATOR
  # Should output: 84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68
  ```

- [ ] Au moins 2 tokens créés et initialisés
  ```bash
  # Check devnet-tokens/root.json exists
  # Check TokenStats initialized
  npx ts-node scripts/check-fees.ts --network devnet
  ```

### Test Complet

- [ ] Run demo script end-to-end
  ```bash
  CREATOR=84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68 \
    npx ts-node scripts/demo-burn-engine.ts --network devnet
  ```

- [ ] Vérifier output visuel (couleurs, émojis, formatting)
- [ ] Timing du script: doit être < 2min30 pour la demo
- [ ] Screenshot de chaque étape pour backup
- [ ] Copier transaction signatures pour quick verification

---

## 🎥 Setup Vidéo (J-1)

### Terminal Configuration

- [ ] Font size: 16-18pt (lisible en video)
- [ ] Color scheme: Dark background, high contrast
- [ ] Terminal fullscreen (pas de distractions)
- [ ] Cursor blink: disabled
- [ ] History cleared

### Environment Setup

- [ ] Tous les scripts archivés (pas de debug-*.ts dans /scripts)
- [ ] README.md à jour avec demo section
- [ ] Git status clean (pas de uncommitted changes)
- [ ] .env configuré mais pas committé

### Recording Tools

- [ ] OBS / Screen recorder configuré
- [ ] Audio test (microphone clear)
- [ ] Backup recording device prêt
- [ ] 1080p minimum resolution

---

## 📝 Jour du Tournage

### Pre-Flight Check (30 min avant)

```bash
# 1. Check connection
solana config get

# 2. Check balance
solana balance devnet-wallet.json --url devnet

# 3. Test quick command
echo $CREATOR

# 4. Verify DAT state
npx ts-node scripts/check-dat-state.ts --network devnet

# 5. Check RPC latency
time solana epoch-info --url devnet
# Should be < 2s
```

### During Recording

1. **Intro (0-30s)**
   - Ne PAS montrer le terminal encore
   - Slides/visuals pour le problème
   - Garder l'energie

2. **Demo (30s-2:15)**
   - Terminal fullscreen
   - Lancer la commande demo
   - Commenter pendant l'exécution
   - Ne PAS interrompre le script

3. **Architecture (2:15-2:45)**
   - Split screen ou cut to slides
   - Code snippets si pertinent
   - Diagrammes simples

4. **Conclusion (2:45-3:00)**
   - Vision Phase 2
   - Call to action
   - Logo/contact info

### Fallbacks

Si le script crash ou timeout:
- [ ] Backup recording pré-fait disponible
- [ ] Screenshots de chaque étape
- [ ] Transaction signatures saved pour quick verify
- [ ] Option: Montrer des résultats pré-enregistrés

---

## 🔍 Post-Production (Après tournage)

### Editing Checklist

- [ ] Intro music fade-in
- [ ] Accélérer volume generation (x1.5 speed)
- [ ] Annotations pour concepts clés:
  - "Don't trust, verify"
  - "Optimistic burn"
  - "On-chain proof"
- [ ] Highlight transaction signatures (zoom/box)
- [ ] Add explorer screenshots (quick cuts)
- [ ] Outro avec links:
  - GitHub
  - Explorer
  - Documentation

### Quality Check

- [ ] Audio levels consistent
- [ ] No dead air > 3 seconds
- [ ] Terminal text lisible à 480p
- [ ] Total duration: 2:45-3:00
- [ ] Exporter en 1080p60

### Distribution

- [ ] Upload sur YouTube (unlisted pour review)
- [ ] Generate captions/subtitles
- [ ] Thumbnail avec 🔥🐕
- [ ] Description avec links

---

## 🎬 Script Narration (Reference)

### Intro (30s)
> "Token economics aujourd'hui : fees s'accumulent, promesses de buyback, mais jamais d'exécution. Résultat : inflation, dilution, perte de confiance. ASDF Burn Engine change ça."

### Demo Start (5s)
> "Une seule commande. Regardez."

### Step Commentary (flowing avec le script)
> "Découverte autonome... Génération de volume... Attribution des fees... Exécution atomique... Preuve on-chain."

### Architecture (30s)
> "Root token : 100% burn. Secondaries : 99% burn, 1% sustainability. 44.8% des secondaries vont au root pour le mega burn. Simple. Puissant. Sustainable."

### Conclusion (15s)
> "Phase 1 : proof of concept. Phase 2 : infrastructure universelle. Creator Capital Markets. This is fine."

---

## ✅ Final Checks (Matin du 19)

```bash
# Quick smoke test
CREATOR=84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68 \
  npx ts-node scripts/demo-burn-engine.ts --network devnet

# Should complete without errors in < 3 min
```

- [ ] Script passes full run
- [ ] Terminal setup looks good
- [ ] Narration practiced (2x minimum)
- [ ] Backup plan ready
- [ ] Energy level: ☕☕☕

---

## 🚀 Go/No-Go Criteria

**GO if:**
- ✓ Demo script runs end-to-end
- ✓ At least 1 successful burn proof on-chain
- ✓ Visual output is clean and professional
- ✓ Timing is < 3 minutes

**NO-GO if:**
- ✗ RPC consistently timing out
- ✗ Script crashes on multiple attempts
- ✗ Can't verify on-chain proofs

**Fallback:** Use pre-recorded demo + live verification on explorer.

---

*Preparation > Improvisation*
*This is fine.* 🔥🐕

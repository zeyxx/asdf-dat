# ASDF Burn Engine - Scénario Vidéo (<3 min)

Présentation pour CCM - 19 décembre 2025

---

## 🎯 Objectif

Démontrer que l'ASDF Burn Engine résout le problème de l'extraction de valeur dans les token economies via un mécanisme de burn automatique et vérifiable.

---

## 📝 Structure (2:45 total)

### 0:00 - 0:30 | **Le Problème** (30s)

**Visuel:** Graphiques de tokens qui accumulent des fees mais ne les utilisent jamais

**Narration:**
> "Dans les token economies actuelles, les creator fees s'accumulent mais ne sont jamais réinvesties. Les tokens promettent des buybacks mais ne les exécutent jamais. Résultat : inflation continue, dilution des holders, perte de confiance."

**Key message:** Extraction > Création

---

### 0:30 - 1:00 | **La Solution** (30s)

**Visuel:** Architecture diagram (simple)

```
Trading Volume → Fees Accumulate → Daemon Flushes → Tokens Burn
                                                           ↓
                                                    On-chain Proof
```

**Narration:**
> "ASDF Burn Engine inverse le paradigm : Création > Extraction. Un daemon autonome monitore les fees en temps réel, exécute des cycles de burn automatiques, et prouve chaque transaction on-chain. Pas de promesses. Des preuves."

**Key concepts:**
- Optimistic Burn Protocol
- Don't trust, verify
- Autonomous execution

---

### 1:00 - 2:15 | **Live Demo** (75s)

**Terminal en plein écran avec `demo-burn-engine.ts`**

**Commande:**
```bash
CREATOR=84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68 \
  npx ts-node scripts/demo-burn-engine.ts --network devnet
```

**Narration pendant l'exécution:**

- **Step 1 (5s):** "Le système vérifie l'état on-chain - pas de config JSON, tout est découvert automatiquement"
- **Step 2 (10s):** "Découverte autonome des tokens via getProgramAccounts - trustless"
- **Step 3 (25s):** "Génération de volume - achats ET ventes pour maximiser les fees"
- **Step 4 (10s):** "Le daemon a trackté les fees par token - attribution précise malgré le shared vault"
- **Step 5 (20s):** "Exécution du cycle : collect → buy → burn. Tout en une transaction atomique"
- **Step 6 (5s):** "Preuve on-chain vérifiable par n'importe qui"

**Highlights visuel:**
- ✓ Checkmarks verts pour chaque step
- Émojis 🔥 pour le burn
- Transaction signature à copier
- Explorer link visible

---

### 2:15 - 2:45 | **Architecture Unique** (30s)

**Visuel:** Split-screen (Code + Diagram)

**Points clés:**

1. **Token Hierarchy**
   ```
   Root Token (100% burn)
        ↓
   Secondary Tokens (99% burn, 1% dev sustainability)
   ```

2. **Fee Distribution**
   - Secondaries: 55.2% own burn + 44.8% to Root
   - Root: 100% burn (no dev fee)
   - Result: Permanent supply reduction

3. **Scalability**
   - Probabilistic O(1) selection
   - Eventually consistent
   - Phase 2 ready: Multi-tenant architecture

**Narration:**
> "L'architecture est simple mais puissante. Le root token brûle 100% de ses fees. Les secondaries gardent 55.2% pour leur propre burn et envoient 44.8% au root. Et nous prenons 1% des secondaries pour la sustainabilité - pas du root. 1% aujourd'hui = 99% burns forever."

---

### 2:45 - 3:00 | **Vision & Call to Action** (15s)

**Visuel:** Roadmap simple

**Narration:**
> "Phase 1: Single DAT, proof of concept. Phase 2 (juin 2026): Universal multi-tenant infrastructure pour Creator Capital Markets. L'optimistic burn protocol, c'est pas juste un token. C'est une nouvelle primitive économique."

**Final frame:**
```
ASDF - Optimistic Burn Protocol
Creation > Extraction

github.com/asdf-dat
This is fine. 🔥🐕
```

---

## 🎥 Tips Production

### Avant le tournage:
- [ ] Tester le script sur devnet (full run)
- [ ] Vérifier que CREATOR est set
- [ ] Avoir des tokens créés et prêts
- [ ] Terminal en fullscreen, font size 16-18pt
- [ ] Color scheme lisible (dark background)

### Pendant le tournage:
- Laisser le script rouler sans interruption
- Zoomer sur les sections importantes (signatures, proofs)
- Montrer l'explorer Solana en quick cut

### Après le tournage:
- Accélérer légèrement les parties de volume generation (x1.5)
- Ajouter des annotations pour les concepts clés
- Music: quelque chose de tech/upbeat mais pas trop intense

---

## 🔑 Messages Clés à Répéter

1. **"Don't trust, verify"** - Tout est on-chain
2. **"Creation > Extraction"** - On crée de la valeur, on n'en prend pas
3. **"This is fine"** - Confident, autonomous, sustainable
4. **"Eligibility is efficiency"** - Les thresholds régulent le système

---

## 📊 Métriques à Montrer

- Volume généré: **~4 SOL** (2 SOL per token x 2 tokens)
- Fees accumulées: **~0.012 SOL** (0.006 SOL per token)
- Tokens burned: *Montrer le supply delta*
- Transaction confirmée: **< 30 seconds**
- Proof: **Permanent on-chain record**

---

## 🚀 Bonus Points

Si temps permet (30s extra):
- Montrer le code du smart contract (lib.rs) - comment le burn est enforced
- Montrer le dashboard (si implémenté)
- Comparaison avant/après (token supply)

---

*Flush. Burn. Verify. This is fine.* 🔥🐕

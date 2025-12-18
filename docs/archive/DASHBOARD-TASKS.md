# ASDF Dashboard - Rapport de Tâches

> **Pour:** Membre équipe Dashboard
> **De:** Jean Terre / Claude
> **Date:** 1er Décembre 2025
> **Objectif:** Livrer un dashboard professionnel aligné avec la vision ASDF-DAT

---

## 1. CONTEXTE PROJET

### Vision ASDF-DAT
ASDF-DAT est une infrastructure de **Decentralized Autonomous Treasury** qui crée un alignement économique entre tokens via un mécanisme de fee capture + buyback & burn.

```
Trading sur Pump.fun → Creator Fees → Collecte → Buyback → Burn
                                         ↓
                              44.8% vers Root Token ($ASDF)
```

### Stack Technique Existante
| Composant | Technologie | Status |
|-----------|-------------|--------|
| Smart Contract | Anchor/Rust | ✅ Production-ready |
| Daemon | TypeScript/Node.js | ✅ Opérationnel |
| API Monitoring | Express (port 3030) | ✅ Disponible |
| Dashboard Legacy | HTML inline (port 3000) | ⚠️ À remplacer |

---

## 2. API DISPONIBLES (Backend Ready)

### Daemon API - Port 3030

Le daemon expose une API REST complète. **Aucun développement backend requis.**

#### Endpoints Principaux

| Endpoint | Méthode | Description | Refresh |
|----------|---------|-------------|---------|
| `/stats` | GET | Statistiques complètes JSON | Real-time |
| `/metrics` | GET | Métriques Prometheus | Real-time |
| `/health` | GET | Health check détaillé | Real-time |
| `/ready` | GET | Readiness probe (K8s) | Real-time |
| `/live` | GET | Liveness probe | Real-time |
| `/flush` | POST | Force flush des fees | Rate-limited |
| `/metrics/history/latest` | GET | Dernier snapshot | 5min |
| `/metrics/history/summary?days=7` | GET | Résumé historique | On-demand |
| `/alerting/status` | GET | État des alertes | Real-time |

#### Structure Réponse `/stats`
```typescript
{
  timestamp: string,           // ISO 8601
  daemon: {
    uptime: number,           // secondes
    totalFeesDetected: number, // lamports
    totalFeesFlushed: number,
    pollCount: number,
    flushCount: number,
    errorCount: number,
    tokensMonitored: number,
  },
  cycles: {
    totalCycles: number,
    successfulCycles: number,
    failedCycles: number,
    deferredTokens: number,
    totalTokensBurned: number,
    totalFeesCollected: number,
    successRate: string,       // "XX.XX%"
  },
  tokens: [
    {
      symbol: string,
      mint: string,
      feesCollected: number,
      tokensBurned: number,
      cyclesExecuted: number,
      pendingFees: number,
      sentToRoot: number,
    }
  ]
}
```

---

## 3. TÂCHES PRIORITAIRES

### P0 - MVP Dashboard (Semaine 1)

#### 3.1 Structure Projet
```
asdf-dashboard/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Landing/Overview
│   │   ├── layout.tsx            # Layout global
│   │   ├── dashboard/
│   │   │   └── page.tsx          # Dashboard principal
│   │   └── api/
│   │       └── proxy/route.ts    # Proxy vers daemon (CORS)
│   ├── components/
│   │   ├── ui/                   # shadcn/ui components
│   │   ├── charts/               # Graphiques (recharts)
│   │   ├── cards/                # Metric cards
│   │   └── layout/               # Header, Sidebar, Footer
│   ├── lib/
│   │   ├── api.ts                # Client API daemon
│   │   ├── types.ts              # Types TypeScript
│   │   └── utils.ts              # Helpers
│   └── hooks/
│       ├── useStats.ts           # Hook pour /stats
│       └── useHealth.ts          # Hook pour /health
├── public/
│   └── assets/                   # Logo, images
└── package.json
```

#### 3.2 Pages à Implémenter

**Page 1: Overview (`/dashboard`)**
- [ ] Header avec logo ASDF + status daemon (🟢/🔴)
- [ ] 4 cards métriques principales:
  - Total Burned (avec trend 24h)
  - SOL Collected (avec USD conversion)
  - Success Rate (%)
  - Pending Fees (accumulation)
- [ ] Chart: Burn history (7 jours, area chart)
- [ ] Liste tokens avec pending fees
- [ ] Dernière activité (5 derniers cycles)

**Page 2: Token Details (`/dashboard/token/[mint]`)**
- [ ] Stats détaillées par token
- [ ] Historique des cycles
- [ ] Fees collected vs sent to root (pie chart)
- [ ] Lien Solscan pour le mint

**Page 3: System Health (`/dashboard/health`)**
- [ ] Status daemon (uptime, errors, poll rate)
- [ ] Métriques système
- [ ] Logs récents
- [ ] Alerting status

#### 3.3 Composants Critiques

```tsx
// components/cards/MetricCard.tsx
interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;      // % change
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
  loading?: boolean;
}

// components/charts/BurnChart.tsx
interface BurnChartProps {
  data: Array<{
    timestamp: number;
    burned: number;
    symbol: string;
  }>;
  timeframe: '24h' | '7d' | '30d';
}

// components/layout/TokenRow.tsx
interface TokenRowProps {
  symbol: string;
  mint: string;
  burned: number;
  pendingFees: number;
  lastCycle: string;
  isRoot: boolean;
}
```

---

### P1 - Features Avancées (Semaine 2)

#### 3.4 Real-time Updates
- [ ] WebSocket ou polling 30s pour `/stats`
- [ ] Animations sur changement de valeurs
- [ ] Toast notifications pour nouveaux cycles

#### 3.5 Graphiques Avancés
- [ ] Stacked area chart: fees par token over time
- [ ] Pie chart: distribution des burns (root vs secondaries)
- [ ] Line chart: success rate trend

#### 3.6 Filtres & Recherche
- [ ] Filter tokens par: all / root / secondary
- [ ] Search par symbol ou mint
- [ ] Timeframe selector (24h, 7d, 30d, all)

---

### P1.5 - Wallet Connect & Admin (Semaine 2-3)

#### 3.7 Intégration Wallet Solana
- [ ] Setup `@solana/wallet-adapter-react`
- [ ] Providers: Phantom, Solflare, Backpack, Ledger
- [ ] Bouton Connect/Disconnect dans Header
- [ ] Afficher adresse tronquée + avatar (Jazzicon)
- [ ] Persistent connection (localStorage)

```tsx
// components/WalletButton.tsx
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export function WalletButton() {
  return (
    <WalletMultiButton className="!bg-asdf-primary hover:!bg-asdf-primary/80" />
  );
}

// app/providers.tsx
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';

const network = WalletAdapterNetwork.Mainnet; // ou Devnet
const endpoint = process.env.NEXT_PUBLIC_RPC_URL;

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
];

export function SolanaProviders({ children }) {
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

**Dépendances:**
```bash
npm install @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets @solana/web3.js
```

#### 3.8 Page Admin (`/dashboard/admin`)

**Accès restreint:** Uniquement pour wallet admin (vérifier contre `DATState.admin`)

**Fonctionnalités:**
- [ ] Vérification wallet = admin on-chain
- [ ] Bouton "Force Flush" (appelle `/flush`)
- [ ] Bouton "Trigger Cycle" (appelle script ou future API)
- [ ] Toggle Emergency Pause
- [ ] Update Fee Split (avec warning timelock)
- [ ] Logs des actions admin

```tsx
// components/admin/AdminGuard.tsx
import { useWallet } from '@solana/wallet-adapter-react';
import { useAdminCheck } from '@/hooks/useAdminCheck';

export function AdminGuard({ children }) {
  const { publicKey } = useWallet();
  const { isAdmin, isLoading } = useAdminCheck(publicKey);

  if (!publicKey) return <ConnectWalletPrompt />;
  if (isLoading) return <LoadingSpinner />;
  if (!isAdmin) return <AccessDenied />;

  return children;
}

// hooks/useAdminCheck.ts
export function useAdminCheck(walletPubkey: PublicKey | null) {
  return useQuery({
    queryKey: ['admin-check', walletPubkey?.toBase58()],
    queryFn: async () => {
      if (!walletPubkey) return false;
      const datState = await fetchDATState();
      return datState.admin.equals(walletPubkey);
    },
    enabled: !!walletPubkey,
  });
}
```

**Actions Admin avec confirmation:**
```tsx
// components/admin/ForceFlushButton.tsx
export function ForceFlushButton() {
  const [isConfirming, setIsConfirming] = useState(false);
  const flushMutation = useMutation({
    mutationFn: () => forceFlush(apiKey),
    onSuccess: () => toast.success('Flush completed'),
    onError: (e) => toast.error(`Flush failed: ${e.message}`),
  });

  return (
    <AlertDialog open={isConfirming} onOpenChange={setIsConfirming}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Force Flush Fees</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmer Force Flush?</AlertDialogTitle>
          <AlertDialogDescription>
            Cette action va forcer la synchronisation des pending fees on-chain.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={() => flushMutation.mutate()}>
            Confirmer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

**Sécurité Admin:**
- Vérification wallet côté client ET serveur
- Rate limiting sur actions sensibles
- Logs de toutes les actions admin
- Double confirmation pour actions destructives

---

### P2 - Polish & UX (Semaine 3-4)

#### 3.9 Responsive Design
- [ ] Mobile-first pour cards
- [ ] Collapsible sidebar
- [ ] Touch-friendly charts

#### 3.8 Dark Mode
- [ ] Theme switcher
- [ ] Consistent color palette
- [ ] Respect system preference

#### 3.9 Loading States
- [ ] Skeleton loaders
- [ ] Error boundaries
- [ ] Retry mechanisms

#### 3.10 SEO & Performance
- [ ] Meta tags dynamiques
- [ ] OG images
- [ ] Lighthouse > 90

---

## 4. STACK RECOMMANDÉE

### Framework
| Choix | Raison |
|-------|--------|
| **Next.js 14+** | App Router, RSC, excellent DX |
| **TypeScript** | Type safety, match avec backend |
| **Tailwind CSS** | Rapid prototyping, consistent |
| **shadcn/ui** | Components accessibles, customisables |

### Data Fetching
| Choix | Raison |
|-------|--------|
| **TanStack Query** | Caching, refetch, mutations |
| **SWR** (alternative) | Plus léger si pas de mutations |

### Charts
| Choix | Raison |
|-------|--------|
| **Recharts** | React-native, customisable |
| **Tremor** (alternative) | Dashboard-focused, built on Recharts |

### Déploiement
| Choix | Raison |
|-------|--------|
| **Vercel** | Zero-config pour Next.js |
| **Cloudflare Pages** (alternative) | Edge performance |

---

## 5. DESIGN GUIDELINES

### Palette Couleurs
```css
:root {
  /* Brand */
  --asdf-primary: #FF6B35;     /* Orange ASDF */
  --asdf-secondary: #1A1A2E;   /* Dark blue */

  /* Status */
  --success: #10B981;          /* Green */
  --warning: #F59E0B;          /* Amber */
  --error: #EF4444;            /* Red */
  --pending: #6366F1;          /* Indigo */

  /* Neutral */
  --background: #0F0F1A;
  --card: #1A1A2E;
  --border: #2D2D44;
  --text: #E5E5E5;
  --muted: #9CA3AF;
}
```

### Typography
- **Headings:** Inter (bold)
- **Body:** Inter (regular)
- **Mono (addresses, numbers):** JetBrains Mono

### Iconographie
- Lucide Icons (cohérent avec shadcn/ui)
- Custom icons pour crypto (SOL logo, fire pour burn)

---

## 6. INTÉGRATION API

### Client API
```typescript
// lib/api.ts
const DAEMON_URL = process.env.NEXT_PUBLIC_DAEMON_URL || 'http://localhost:3030';

export async function getStats(): Promise<DaemonStats> {
  const res = await fetch(`${DAEMON_URL}/stats`);
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export async function getHealth(): Promise<HealthStatus> {
  const res = await fetch(`${DAEMON_URL}/health`);
  if (!res.ok) throw new Error('Failed to fetch health');
  return res.json();
}

export async function forceFlush(apiKey?: string): Promise<FlushResult> {
  const res = await fetch(`${DAEMON_URL}/flush`, {
    method: 'POST',
    headers: apiKey ? { 'X-Daemon-Key': apiKey } : {},
  });
  if (!res.ok) throw new Error('Failed to flush');
  return res.json();
}
```

### Hook Example
```typescript
// hooks/useStats.ts
import { useQuery } from '@tanstack/react-query';
import { getStats } from '@/lib/api';

export function useStats(refetchInterval = 30000) {
  return useQuery({
    queryKey: ['daemon-stats'],
    queryFn: getStats,
    refetchInterval,
    staleTime: 10000,
  });
}
```

---

## 7. VARIABLES D'ENVIRONNEMENT

```env
# .env.local
NEXT_PUBLIC_DAEMON_URL=http://localhost:3030
NEXT_PUBLIC_NETWORK=devnet  # devnet | mainnet
NEXT_PUBLIC_SOLSCAN_URL=https://solscan.io

# Optional: API key for protected endpoints
DAEMON_API_KEY=your-secret-key
```

---

## 8. CHECKLIST LIVRAISON

### MVP (Go/No-Go)
- [ ] Dashboard affiche stats en temps réel
- [ ] Tous les tokens listés avec pending fees
- [ ] Chart burn history fonctionnel
- [ ] Health status visible
- [ ] Responsive (desktop + mobile)
- [ ] Error handling gracieux
- [ ] Deployed sur Vercel (staging)

### Production Ready
- [ ] Tests E2E (Playwright)
- [ ] Lighthouse > 90 (perf, a11y, SEO)
- [ ] Analytics intégré
- [ ] Error tracking (Sentry)
- [ ] Documentation utilisateur
- [ ] Custom domain configuré

---

## 9. RESSOURCES

### Documentation
- [CLAUDE.md](/workspaces/asdf-dat/CLAUDE.md) - Architecture technique complète
- [lib/monitoring.ts](/workspaces/asdf-dat/lib/monitoring.ts) - Service monitoring
- [lib/types.ts](/workspaces/asdf-dat/lib/types.ts) - Types partagés

### Endpoints de Test (Devnet)
```bash
# Daemon doit être running
curl http://localhost:3030/stats | jq
curl http://localhost:3030/health | jq
curl http://localhost:3030/metrics
```

### Contacts
- **Backend/Smart Contract:** Jean Terre
- **Questions techniques:** Claude (via ce repo)

---

## 10. TIMELINE SUGGÉRÉE

| Semaine | Livrables |
|---------|-----------|
| **S1** | Setup projet, Overview page, Metric cards, Basic chart |
| **S2** | Token details, Health page, Real-time updates, Wallet Connect |
| **S3** | Page Admin, Actions sécurisées, Logs admin |
| **S4** | Polish, Dark mode, Mobile, Tests |
| **S5** | Staging review, Fixes, Production deploy |

### Milestones Clés

| Milestone | Critère de Succès |
|-----------|-------------------|
| **M1 - MVP Public** | Dashboard read-only fonctionnel, déployé |
| **M2 - Wallet Integration** | Phantom/Solflare connecté, adresse affichée |
| **M3 - Admin Panel** | Actions admin protégées, logs fonctionnels |
| **M4 - Production** | Lighthouse 90+, tests E2E, monitoring |

---

**Note:** Le backend (daemon API) est 100% prêt. Le focus doit être sur le frontend uniquement. En cas de besoin d'endpoints supplémentaires, contacter Jean Terre.

*Bonne chance !* 🚀

/**
 * Token Discovery and Loading
 *
 * Implements priority cascade for autonomous token discovery:
 * 1. Daemon API (fastest, real-time)
 * 2. State file (daemon persistence, fallback)
 * 3. JSON files (manual configuration)
 * 4. On-chain discovery ("Don't trust, verify")
 *
 * "Don't trust, verify" architecture - all data verified on-chain
 */

import * as fs from 'fs';
import * as path from 'path';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { TokenConfig, PoolType } from './types';
import { VerifiedToken } from '../types';
import { NetworkConfig } from '../network/config';
import { log, colors } from './utils/logging';
import { formatSOL } from './utils/formatting';
import { discoverAndVerifyTokens } from '../core/token-verifier';
import { getTypedAccounts } from '../core/types';

const DAEMON_API_URL = process.env.DAEMON_API_URL || 'http://localhost:3030';
const STATE_FILE = '.asdf-state.json';
const DAT_STATE_SEED = Buffer.from('dat_v3');

/**
 * Token Loader
 *
 * Autonomous token discovery with priority cascade
 */
export class TokenLoader {
  constructor(
    private readonly programId: PublicKey,
    private readonly projectRoot: string = path.join(__dirname, '..', '..')
  ) {}

  /**
   * Load ecosystem tokens using priority cascade
   *
   * Priority:
   * 1. Daemon API (fastest)
   * 2. State file (fallback when daemon down)
   * 3. JSON files (manual config)
   * 4. On-chain discovery (final fallback)
   */
  async loadEcosystemTokens(
    connection: Connection,
    networkConfig: NetworkConfig
  ): Promise<TokenConfig[]> {
    // Try daemon API first
    const daemonTokens = await this.loadFromDaemon();
    if (daemonTokens.length > 0) {
      return daemonTokens;
    }

    // Try state file (daemon persisted state)
    log('⚠️', 'Daemon API not available, trying state file...', colors.yellow);
    const stateTokens = this.loadFromStateFile();
    if (stateTokens.length > 0) {
      return stateTokens;
    }

    // Try JSON files
    log('⚠️', 'State file not available, trying JSON files...', colors.yellow);
    try {
      const fileTokens = this.loadFromFiles(networkConfig);
      if (fileTokens.length > 0) {
        return fileTokens;
      }
    } catch {
      // Fall through to trustless discovery
    }

    // Final fallback: Trustless on-chain discovery
    log('🔍', 'No local tokens found, attempting on-chain discovery...', colors.cyan);
    return this.loadTrustless(connection, networkConfig);
  }

  /**
   * Load tokens from daemon API (http://localhost:3030/tokens)
   * Fastest method - real-time data from running daemon
   */
  async loadFromDaemon(): Promise<TokenConfig[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${DAEMON_API_URL}/tokens`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        log('⚠️', `Daemon returned ${response.status}`, colors.yellow);
        return [];
      }

      const data = (await response.json()) as {
        count: number;
        tokens: Array<{
          mint: string;
          symbol: string;
          name: string;
          isRoot: boolean;
          bondingCurve: string;
          poolType: string;
          pendingFeesLamports: number;
        }>;
      };

      if (!data.tokens || data.tokens.length === 0) {
        log('⚠️', 'Daemon has no tokens', colors.yellow);
        return [];
      }

      const tokens: TokenConfig[] = [];

      for (const t of data.tokens) {
        const poolType: PoolType =
          t.poolType === 'pumpswap_amm' ? 'pumpswap_amm' : 'bonding_curve';
        const poolIcon = poolType === 'pumpswap_amm' ? '🔄' : '📈';

        tokens.push({
          file: `daemon:${t.mint}`,
          symbol: t.symbol,
          mint: new PublicKey(t.mint),
          bondingCurve: new PublicKey(t.bondingCurve),
          creator: new PublicKey('11111111111111111111111111111111'), // Not needed from daemon
          isRoot: t.isRoot,
          isToken2022: false, // Daemon doesn't track this yet
          mayhemMode: false,
          poolType,
        });
        log('✓', `Loaded ${t.symbol} from daemon (${poolIcon} ${poolType})`, colors.green);
      }

      const rootTokens = tokens.filter((t) => t.isRoot);
      log(
        '📊',
        `Loaded ${tokens.length} tokens from daemon: ${rootTokens.length} root, ${tokens.length - rootTokens.length} secondary`,
        colors.cyan
      );

      // If no root token, mark the first one as root (for now)
      if (rootTokens.length === 0 && tokens.length > 0) {
        log('⚠️', 'No root token marked, using first token as root', colors.yellow);
        tokens[0].isRoot = true;
      }

      return tokens;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('abort')) {
        log('⚠️', `Failed to load from daemon: ${msg}`, colors.yellow);
      }
      return [];
    }
  }

  /**
   * Load tokens from daemon state file (.asdf-state.json)
   * Most reliable fallback when daemon API is not accessible
   */
  loadFromStateFile(): TokenConfig[] {
    const statePath = path.join(this.projectRoot, STATE_FILE);

    if (!fs.existsSync(statePath)) {
      log('⚠️', `State file not found: ${STATE_FILE}`, colors.yellow);
      return [];
    }

    try {
      const stateData = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

      if (!stateData.tokens || stateData.tokens.length === 0) {
        log('⚠️', 'State file has no tokens', colors.yellow);
        return [];
      }

      const tokens: TokenConfig[] = [];

      for (const t of stateData.tokens) {
        const poolType: PoolType =
          t.poolType === 'pumpswap_amm' ? 'pumpswap_amm' : 'bonding_curve';
        const poolIcon = poolType === 'pumpswap_amm' ? '🔄' : '📈';
        const pendingFees =
          typeof t.pendingFeesLamports === 'string'
            ? parseInt(t.pendingFeesLamports, 10)
            : t.pendingFeesLamports || 0;

        tokens.push({
          file: `state:${t.mint}`,
          symbol: t.symbol,
          mint: new PublicKey(t.mint),
          bondingCurve: new PublicKey(t.bondingCurve),
          creator: new PublicKey('11111111111111111111111111111111'), // Not needed from state
          isRoot: t.isRoot === true,
          isToken2022: false,
          mayhemMode: false,
          poolType,
          pendingFeesFromState: pendingFees,
        });
        const feesInfo =
          pendingFees > 0 ? ` | ${(pendingFees / 1e9).toFixed(6)} SOL pending` : '';
        log(
          '✓',
          `Loaded ${t.symbol} from state (${poolIcon} ${poolType}${feesInfo})`,
          colors.green
        );
      }

      const rootTokens = tokens.filter((t) => t.isRoot);
      log(
        '📊',
        `Loaded ${tokens.length} tokens from state: ${rootTokens.length} root, ${tokens.length - rootTokens.length} secondary`,
        colors.cyan
      );

      return tokens;
    } catch (error) {
      log(
        '⚠️',
        `Failed to load from state file: ${(error as Error).message}`,
        colors.yellow
      );
      return [];
    }
  }

  /**
   * Load tokens from JSON config files (manual configuration)
   * Legacy method - used when daemon is not available
   */
  loadFromFiles(networkConfig: NetworkConfig): TokenConfig[] {
    const tokenFiles = networkConfig.tokens;
    const tokens: TokenConfig[] = [];

    for (const file of tokenFiles) {
      const filePath = path.join(this.projectRoot, file);

      if (!fs.existsSync(filePath)) {
        log('⚠️', `Token file not found: ${file}`, colors.yellow);
        continue;
      }

      try {
        const tokenData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const poolType: PoolType =
          tokenData.poolType === 'pumpswap_amm' ? 'pumpswap_amm' : 'bonding_curve';
        const isRoot = tokenData.isRoot === true;
        const isToken2022 =
          tokenData.tokenProgram === 'Token2022' || tokenData.mayhemMode === true;

        tokens.push({
          file,
          symbol: tokenData.symbol || tokenData.name || 'UNKNOWN',
          mint: new PublicKey(tokenData.mint),
          bondingCurve: new PublicKey(tokenData.bondingCurve || tokenData.pool),
          creator: new PublicKey(tokenData.creator),
          isRoot,
          isToken2022,
          mayhemMode: tokenData.mayhemMode === true,
          poolType,
        });
        const poolIcon = poolType === 'pumpswap_amm' ? '🔄' : '📈';
        log(
          '✓',
          `Loaded ${tokenData.symbol || tokenData.name} from ${file} (${poolIcon} ${poolType})`,
          colors.green
        );
      } catch (error) {
        log(
          '❌',
          `Failed to load ${file}: ${(error as Error).message || String(error)}`,
          colors.red
        );
      }
    }

    if (tokens.length === 0) {
      throw new Error(
        'No tokens loaded. Ensure daemon is running or token config files exist.'
      );
    }

    const rootTokens = tokens.filter((t) => t.isRoot);
    if (rootTokens.length === 0) {
      throw new Error('No root token found. Ensure at least one token has "isRoot": true');
    }
    if (rootTokens.length > 1) {
      throw new Error('Multiple root tokens found. Only one root token is allowed.');
    }

    log(
      '📊',
      `Loaded ${tokens.length} tokens from files: ${rootTokens.length} root, ${tokens.length - 1} secondary`,
      colors.cyan
    );
    return tokens;
  }

  /**
   * "Don't trust, verify" - Trustless on-chain token discovery
   * Discovers tokens via getProgramAccounts and verifies all data on-chain
   * Final fallback when all other methods fail
   */
  async loadTrustless(
    connection: Connection,
    networkConfig: NetworkConfig
  ): Promise<TokenConfig[]> {
    try {
      // Get creator from DATState
      const [datStatePda] = PublicKey.findProgramAddressSync(
        [DAT_STATE_SEED],
        this.programId
      );

      // Load IDL
      const idlPath = path.join(this.projectRoot, 'target', 'idl', 'asdf_dat.json');
      if (!fs.existsSync(idlPath)) {
        log('❌', 'IDL not found, cannot perform trustless discovery', colors.red);
        return [];
      }
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

      // Create dummy provider for read-only access
      const dummyWallet = {
        publicKey: PublicKey.default,
        signTransaction: async (tx: Transaction) => tx,
        signAllTransactions: async (txs: Transaction[]) => txs,
      };
      const provider = new AnchorProvider(connection, dummyWallet as any, {});
      const program = new Program(idl, provider);

      // Fetch DATState to get admin (creator) and root token
      let creator: PublicKey;
      let rootTokenMint: PublicKey | null = null;
      try {
        const datState = await getTypedAccounts(program).datState.fetch(datStatePda);
        creator = datState.admin;
        rootTokenMint = datState.rootTokenMint;
        log(
          '✓',
          `Creator from DATState: ${creator.toBase58().slice(0, 8)}...`,
          colors.green
        );
        if (rootTokenMint) {
          log(
            '✓',
            `Root token from DATState: ${rootTokenMint.toBase58().slice(0, 8)}...`,
            colors.green
          );
        }
      } catch (error) {
        log('❌', `Failed to fetch DATState: ${(error as Error).message}`, colors.red);
        return [];
      }

      // Discover and verify tokens
      log('🔍', 'Discovering tokens on-chain...', colors.cyan);
      const verifiedTokens = await discoverAndVerifyTokens(
        connection,
        creator,
        rootTokenMint ?? undefined
      );

      if (verifiedTokens.length === 0) {
        log('⚠️', 'No tokens discovered on-chain for this creator', colors.yellow);
        return [];
      }

      // Convert VerifiedToken to TokenConfig
      const tokens: TokenConfig[] = verifiedTokens.map((vt) => ({
        file: `verified:${vt.mint}`,
        symbol: vt.symbol || vt.mint.slice(0, 4).toUpperCase(),
        mint: new PublicKey(vt.mint),
        bondingCurve: vt.bondingCurve,
        creator: vt.creator,
        isRoot: vt.isRoot,
        isToken2022: vt.tokenProgram === 'Token2022',
        mayhemMode: vt.isMayhemMode,
        poolType: vt.poolType,
        hasTokenStats: vt.hasTokenStats,
      }));

      for (const token of tokens) {
        const typeIcon = token.isToken2022 ? '🪙' : '💰';
        const poolIcon = token.poolType === 'pumpswap_amm' ? '🔄' : '📈';
        const rootIcon = token.isRoot ? '👑' : '';
        log(
          '✓',
          `Verified ${token.symbol} ${rootIcon} (${typeIcon} ${token.isToken2022 ? 'Token2022' : 'SPL'}, ${poolIcon} ${token.poolType})`,
          colors.green
        );
      }

      log(
        '📊',
        `Discovered ${tokens.length} tokens on-chain: ${tokens.filter((t) => t.isRoot).length} root, ${tokens.filter((t) => !t.isRoot).length} secondary`,
        colors.cyan
      );

      return tokens;
    } catch (error) {
      log('❌', `Trustless discovery failed: ${(error as Error).message}`, colors.red);
      return [];
    }
  }
}

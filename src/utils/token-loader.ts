/**
 * Token Loader - Single Source of Truth
 *
 * Loads tokens from daemon state or API instead of manual JSON files.
 * "Don't trust, verify" - derives/verifies data on-chain.
 *
 * Usage:
 *   const loader = new TokenLoader(connection, creator);
 *   const config = await loader.getToken(mintAddress);
 *   const allTokens = await loader.getAllTokens();
 */

import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { Connection, PublicKey } from "@solana/web3.js";
import { TokenConfig, PoolType, TokenProgramType } from "../core/types";
import { SerializedToken } from "../types";
import { createLogger } from "./logger";

const log = createLogger("token-loader");

// State file path
const DEFAULT_STATE_FILE = ".asdf-state.json";

// Daemon API default
const DEFAULT_API_URL = "http://localhost:3030";

// Pump.fun programs
const PUMP_BONDING_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_AMM_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export interface TokenLoaderConfig {
  stateFile?: string;
  apiUrl?: string;
  connection: Connection;
  creatorPubkey: PublicKey;
}

interface StateFile {
  version: number;
  tokens: SerializedToken[];
  creatorPubkey: string;
  network: "devnet" | "mainnet";
}

export class TokenLoader {
  private stateFile: string;
  private apiUrl: string;
  private connection: Connection;
  private creatorPubkey: PublicKey;

  constructor(config: TokenLoaderConfig) {
    this.stateFile = config.stateFile ?? DEFAULT_STATE_FILE;
    this.apiUrl = config.apiUrl ?? DEFAULT_API_URL;
    this.connection = config.connection;
    this.creatorPubkey = config.creatorPubkey;
  }

  /**
   * Get all tracked tokens as TokenConfig[]
   * Priority: State file → API → Discovery
   */
  async getAllTokens(): Promise<TokenConfig[]> {
    // Try state file first
    const fromState = await this.loadFromStateFile();
    if (fromState.length > 0) {
      log.info("Loaded tokens from state file", { count: fromState.length });
      return fromState;
    }

    // Try API
    const fromApi = await this.loadFromApi();
    if (fromApi.length > 0) {
      log.info("Loaded tokens from API", { count: fromApi.length });
      return fromApi;
    }

    // Last resort: discover on-chain
    log.info("No cached tokens, discovering on-chain...");
    return this.discoverTokens();
  }

  /**
   * Get a specific token by mint address
   */
  async getToken(mintAddress: string): Promise<TokenConfig | null> {
    const tokens = await this.getAllTokens();
    return tokens.find(t => t.mint === mintAddress) ?? null;
  }

  /**
   * Get root token
   */
  async getRootToken(): Promise<TokenConfig | null> {
    const tokens = await this.getAllTokens();
    return tokens.find(t => t.isRoot) ?? null;
  }

  /**
   * Get all secondary tokens (non-root)
   */
  async getSecondaryTokens(): Promise<TokenConfig[]> {
    const tokens = await this.getAllTokens();
    return tokens.filter(t => !t.isRoot);
  }

  /**
   * Load from .asdf-state.json
   */
  private async loadFromStateFile(): Promise<TokenConfig[]> {
    const filePath = path.resolve(this.stateFile);

    if (!fs.existsSync(filePath)) {
      log.debug("State file not found", { path: filePath });
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const state = JSON.parse(content) as StateFile;

      if (!state.tokens || !Array.isArray(state.tokens)) {
        log.warn("Invalid state file structure");
        return [];
      }

      // Convert SerializedToken[] to TokenConfig[]
      const configs = await Promise.all(
        state.tokens.map(t => this.serializedToConfig(t))
      );

      return configs.filter((c): c is TokenConfig => c !== null);
    } catch (error) {
      log.warn("Failed to load state file", { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Load from daemon API /tokens
   */
  private async loadFromApi(): Promise<TokenConfig[]> {
    try {
      const response = await axios.get(`${this.apiUrl}/tokens`, { timeout: 5000 });

      if (!response.data?.tokens || !Array.isArray(response.data.tokens)) {
        return [];
      }

      // API returns TrackedToken format, convert to TokenConfig
      const configs = await Promise.all(
        response.data.tokens.map((t: any) => this.apiTokenToConfig(t))
      );

      return configs.filter((c): c is TokenConfig => c !== null);
    } catch (error) {
      log.debug("API not available", { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Discover tokens on-chain by creator
   */
  private async discoverTokens(): Promise<TokenConfig[]> {
    const discovered: TokenConfig[] = [];

    try {
      // Query bonding curves by creator at offset 49
      const accounts = await this.connection.getProgramAccounts(
        PUMP_BONDING_PROGRAM,
        {
          filters: [
            {
              memcmp: {
                offset: 49,
                bytes: this.creatorPubkey.toBase58(),
              },
            },
          ],
        }
      );

      for (const { pubkey, account } of accounts) {
        try {
          // Parse mint from bonding curve data (offset 8-40)
          const mint = new PublicKey(account.data.slice(8, 40));

          // Derive and verify
          const config = await this.deriveTokenConfig(mint, pubkey);
          if (config) {
            discovered.push(config);
          }
        } catch {
          // Skip invalid accounts
        }
      }

      log.info("Discovered tokens on-chain", { count: discovered.length });
    } catch (error) {
      log.error("Token discovery failed", { error: (error as Error).message });
    }

    return discovered;
  }

  /**
   * Convert SerializedToken to TokenConfig
   * Derives missing data on-chain
   */
  private async serializedToConfig(token: SerializedToken): Promise<TokenConfig | null> {
    try {
      const mint = new PublicKey(token.mint);
      const bondingCurve = new PublicKey(token.bondingCurve);

      // Detect token program
      const tokenProgram = await this.detectTokenProgram(mint);

      // Detect pool type
      const poolType = await this.detectPoolType(bondingCurve);

      // Detect mayhem mode
      const mayhemMode = await this.detectMayhemMode(bondingCurve, poolType);

      return {
        mint: token.mint,
        bondingCurve: token.bondingCurve,
        creator: this.creatorPubkey.toBase58(),
        name: token.name,
        symbol: token.symbol,
        tokenProgram,
        poolType,
        mayhemMode,
        isRoot: token.isRoot,
      };
    } catch (error) {
      log.warn("Failed to convert token", { mint: token.mint, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Convert API token response to TokenConfig
   */
  private async apiTokenToConfig(token: any): Promise<TokenConfig | null> {
    try {
      const mint = new PublicKey(token.mint);
      const bondingCurve = token.bondingCurve
        ? new PublicKey(token.bondingCurve)
        : this.deriveBondingCurve(mint);

      // Detect token program
      const tokenProgram = await this.detectTokenProgram(mint);

      // Detect pool type
      const poolType = token.poolType ?? await this.detectPoolType(bondingCurve);

      // Detect mayhem mode
      const mayhemMode = await this.detectMayhemMode(bondingCurve, poolType);

      return {
        mint: token.mint,
        bondingCurve: bondingCurve.toBase58(),
        creator: this.creatorPubkey.toBase58(),
        name: token.name ?? token.symbol ?? "Unknown",
        symbol: token.symbol ?? "???",
        tokenProgram,
        poolType,
        mayhemMode,
        isRoot: token.isRoot ?? false,
      };
    } catch (error) {
      log.warn("Failed to convert API token", { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Derive full TokenConfig from mint
   */
  private async deriveTokenConfig(mint: PublicKey, bondingCurve?: PublicKey): Promise<TokenConfig | null> {
    try {
      const bc = bondingCurve ?? this.deriveBondingCurve(mint);

      // Detect token program
      const tokenProgram = await this.detectTokenProgram(mint);

      // Detect pool type
      const poolType = await this.detectPoolType(bc);

      // Detect mayhem mode
      const mayhemMode = await this.detectMayhemMode(bc, poolType);

      // Get metadata (symbol, name)
      const metadata = await this.getTokenMetadata(mint);

      return {
        mint: mint.toBase58(),
        bondingCurve: bc.toBase58(),
        creator: this.creatorPubkey.toBase58(),
        name: metadata.name,
        symbol: metadata.symbol,
        tokenProgram,
        poolType,
        mayhemMode,
        isRoot: false, // Can be set later
      };
    } catch (error) {
      log.warn("Failed to derive token config", { mint: mint.toBase58(), error: (error as Error).message });
      return null;
    }
  }

  /**
   * Derive bonding curve PDA
   */
  private deriveBondingCurve(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      PUMP_BONDING_PROGRAM
    )[0];
  }

  /**
   * Detect token program (SPL vs Token2022)
   */
  private async detectTokenProgram(mint: PublicKey): Promise<TokenProgramType> {
    try {
      const info = await this.connection.getAccountInfo(mint);
      if (info?.owner.equals(TOKEN_2022_PROGRAM)) {
        return "Token2022";
      }
      return "SPL";
    } catch {
      return "SPL";
    }
  }

  /**
   * Detect pool type (bonding_curve vs pumpswap_amm)
   */
  private async detectPoolType(bondingCurve: PublicKey): Promise<PoolType> {
    try {
      const info = await this.connection.getAccountInfo(bondingCurve);
      if (info && info.data.length >= 81) {
        return "bonding_curve";
      }
      return "pumpswap_amm";
    } catch {
      return "pumpswap_amm";
    }
  }

  /**
   * Detect mayhem mode from bonding curve
   */
  private async detectMayhemMode(bondingCurve: PublicKey, poolType: PoolType): Promise<boolean> {
    if (poolType !== "bonding_curve") {
      return false; // AMM doesn't have mayhem mode
    }

    try {
      const info = await this.connection.getAccountInfo(bondingCurve);
      if (info && info.data.length === 82) {
        // Last byte is mayhem flag
        return info.data[81] === 1;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get token metadata (name, symbol)
   */
  private async getTokenMetadata(mint: PublicKey): Promise<{ name: string; symbol: string }> {
    try {
      // Try Metaplex metadata
      const [metadataPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
      );

      const info = await this.connection.getAccountInfo(metadataPda);
      if (info) {
        // Parse Metaplex metadata (simplified)
        const data = info.data;
        // Name starts at offset 65, max 32 bytes
        const nameLen = data.readUInt32LE(65);
        const name = data.slice(69, 69 + Math.min(nameLen, 32)).toString("utf-8").replace(/\0/g, "").trim();
        // Symbol starts after name
        const symbolOffset = 69 + 32 + 4;
        const symbolLen = data.readUInt32LE(symbolOffset - 4);
        const symbol = data.slice(symbolOffset, symbolOffset + Math.min(symbolLen, 10)).toString("utf-8").replace(/\0/g, "").trim();

        if (name && symbol) {
          return { name, symbol };
        }
      }
    } catch {
      // Metadata fetch failed
    }

    // Fallback
    return {
      name: `Token ${mint.toBase58().slice(0, 6)}`,
      symbol: mint.toBase58().slice(0, 4).toUpperCase()
    };
  }
}

/**
 * Quick helper - load token config from state/API
 * Drop-in replacement for loadTokenConfig(filePath)
 */
export async function loadTokenFromState(
  mintOrSymbol: string,
  connection: Connection,
  creator: PublicKey | string,
  options?: { stateFile?: string; apiUrl?: string }
): Promise<TokenConfig | null> {
  const loader = new TokenLoader({
    connection,
    creatorPubkey: typeof creator === "string" ? new PublicKey(creator) : creator,
    stateFile: options?.stateFile,
    apiUrl: options?.apiUrl,
  });

  const tokens = await loader.getAllTokens();

  // Try mint address match first
  const byMint = tokens.find(t => t.mint === mintOrSymbol);
  if (byMint) return byMint;

  // Try symbol match
  const bySymbol = tokens.find(t => t.symbol.toLowerCase() === mintOrSymbol.toLowerCase());
  if (bySymbol) return bySymbol;

  return null;
}

/**
 * Load all tokens from state/API
 */
export async function loadAllTokensFromState(
  connection: Connection,
  creator: PublicKey | string,
  options?: { stateFile?: string; apiUrl?: string }
): Promise<TokenConfig[]> {
  const loader = new TokenLoader({
    connection,
    creatorPubkey: typeof creator === "string" ? new PublicKey(creator) : creator,
    stateFile: options?.stateFile,
    apiUrl: options?.apiUrl,
  });

  return loader.getAllTokens();
}

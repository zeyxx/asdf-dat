/**
 * ASDF Burn Engine State Persistence
 *
 * Atomic state save/load with backup rotation for crash recovery.
 * - Writes to temp file first, then atomic rename
 * - Keeps 3 backup versions
 * - Validates state on load
 *
 * V2 Architecture: "Don't trust, verify"
 * - V1: Stores bondingCurve, poolType, pendingFees (DEPRECATED)
 * - V2: Stores only mint + isRoot + optional metadata cache
 * - All derived data is verified on-chain at load time
 */

import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import {
  PersistedState,
  PersistedStateV2,
  StoredToken,
  FeeTrackingState,
  SerializedToken,
  TrackedToken,
  PoolType,
  STATE_VERSION,
  STATE_VERSION_V2,
  MAX_PROCESSED_SIGNATURES,
} from "../types";
import { createLogger } from "./logger";

const log = createLogger("state");

const BACKUP_COUNT = 3;

/**
 * Convert TrackedToken to serializable format
 */
export function serializeToken(token: TrackedToken): SerializedToken {
  return {
    mint: token.mint.toBase58(),
    symbol: token.symbol,
    name: token.name,
    isRoot: token.isRoot,
    bondingCurve: token.bondingCurve.toBase58(),
    poolType: token.poolType,
    pendingFeesLamports: token.pendingFeesLamports.toString(),
    totalCollectedLamports: token.totalCollectedLamports.toString(),
    totalBurnedTokens: token.totalBurnedTokens.toString(),
    lastFeeUpdateSlot: token.lastFeeUpdateSlot,
    lastBurnSignature: token.lastBurnSignature,
    discoveredAt: token.discoveredAt,
    lastUpdatedAt: token.lastUpdatedAt,
    isToken2022: token.isToken2022,
  };
}

/**
 * Convert serialized token back to TrackedToken
 */
export function deserializeToken(data: SerializedToken): TrackedToken {
  return {
    mint: new PublicKey(data.mint),
    symbol: data.symbol,
    name: data.name,
    isRoot: data.isRoot,
    bondingCurve: new PublicKey(data.bondingCurve),
    poolType: data.poolType as PoolType,
    pendingFeesLamports: BigInt(data.pendingFeesLamports),
    totalCollectedLamports: BigInt(data.totalCollectedLamports),
    totalBurnedTokens: BigInt(data.totalBurnedTokens),
    lastFeeUpdateSlot: data.lastFeeUpdateSlot,
    lastBurnSignature: data.lastBurnSignature,
    discoveredAt: data.discoveredAt,
    lastUpdatedAt: data.lastUpdatedAt,
    isToken2022: data.isToken2022,
  };
}

/**
 * Rotate backup files
 * state.json -> state.json.1 -> state.json.2 -> state.json.3 (deleted)
 */
function rotateBackups(filePath: string): void {
  // Delete oldest backup
  const oldest = `${filePath}.${BACKUP_COUNT}`;
  if (fs.existsSync(oldest)) {
    fs.unlinkSync(oldest);
  }

  // Shift backups
  for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
    const current = i === 1 ? filePath : `${filePath}.${i}`;
    const next = `${filePath}.${i + 1}`;
    if (fs.existsSync(current)) {
      fs.renameSync(current, next);
    }
  }
}

/**
 * Atomically save state to file
 * - Writes to temp file first
 * - Rotates backups
 * - Atomic rename
 */
export async function saveState(
  filePath: string,
  creatorPubkey: PublicKey,
  network: "devnet" | "mainnet",
  tokens: TrackedToken[],
  processedSignatures: Set<string>,
  lastProcessedSignature: string | undefined,
  pollCount: number,
  errorCount: number
): Promise<void> {
  const state: PersistedState = {
    version: STATE_VERSION,
    savedAt: Date.now(),
    creatorPubkey: creatorPubkey.toBase58(),
    network,
    tokens: tokens.map(serializeToken),
    processedSignatures: Array.from(processedSignatures).slice(-MAX_PROCESSED_SIGNATURES),
    lastProcessedSignature,
    pollCount,
    errorCount,
  };

  const tempFile = `${filePath}.tmp.${process.pid}`;
  const content = JSON.stringify(state, null, 2);

  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write to temp file
    fs.writeFileSync(tempFile, content, "utf-8");

    // Rotate backups before rename
    if (fs.existsSync(filePath)) {
      rotateBackups(filePath);
    }

    // Atomic rename
    fs.renameSync(tempFile, filePath);

    log.debug("State saved", {
      tokens: tokens.length,
      signatures: state.processedSignatures.length,
    });
  } catch (error) {
    // Cleanup temp file on error
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw error;
  }
}

/**
 * Load state from file with validation
 * Returns null if file doesn't exist or is invalid
 */
export async function loadState(filePath: string): Promise<{
  tokens: TrackedToken[];
  processedSignatures: Set<string>;
  lastProcessedSignature?: string;
  pollCount: number;
  errorCount: number;
  creatorPubkey: string;
  network: "devnet" | "mainnet";
} | null> {
  // Try main file first, then backups
  const filesToTry = [
    filePath,
    `${filePath}.1`,
    `${filePath}.2`,
    `${filePath}.3`,
  ];

  for (const file of filesToTry) {
    if (!fs.existsSync(file)) continue;

    try {
      const content = fs.readFileSync(file, "utf-8");
      const state = JSON.parse(content) as PersistedState;

      // Validate version
      if (state.version !== STATE_VERSION) {
        log.warn("State version mismatch, skipping", {
          file,
          expected: STATE_VERSION,
          found: state.version,
        });
        continue;
      }

      // Validate required fields
      if (!state.creatorPubkey || !state.network || !Array.isArray(state.tokens)) {
        log.warn("Invalid state structure, skipping", { file });
        continue;
      }

      // Deserialize tokens
      const tokens = state.tokens.map(deserializeToken);

      // Convert signatures array to Set
      const processedSignatures = new Set(state.processedSignatures || []);

      log.info("State loaded", {
        file: file === filePath ? "current" : `backup ${file.split(".").pop()}`,
        tokens: tokens.length,
        signatures: processedSignatures.size,
        savedAt: new Date(state.savedAt).toISOString(),
      });

      return {
        tokens,
        processedSignatures,
        lastProcessedSignature: state.lastProcessedSignature,
        pollCount: state.pollCount || 0,
        errorCount: state.errorCount || 0,
        creatorPubkey: state.creatorPubkey,
        network: state.network,
      };
    } catch (error) {
      log.warn("Failed to parse state file, trying backup", {
        file,
        error: (error as Error).message,
      });
    }
  }

  log.info("No valid state file found, starting fresh");
  return null;
}

/**
 * Check if state file exists and is recent
 */
export function hasRecentState(filePath: string, maxAgeMs: number = 3600000): boolean {
  if (!fs.existsSync(filePath)) return false;

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const state = JSON.parse(content) as PersistedState;
    const age = Date.now() - state.savedAt;
    return age < maxAgeMs;
  } catch {
    return false;
  }
}

/**
 * Delete state file and all backups
 */
export function clearState(filePath: string): void {
  const files = [filePath, `${filePath}.1`, `${filePath}.2`, `${filePath}.3`];
  for (const file of files) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
  log.info("State cleared");
}

// ============================================================================
// V2 State Persistence - "Don't trust, verify" architecture
// Stores minimum data, derives everything else on-chain
// ============================================================================

/**
 * Convert TrackedToken to minimal StoredToken format
 */
export function toStoredToken(token: TrackedToken): StoredToken {
  return {
    mint: token.mint.toBase58(),
    isRoot: token.isRoot,
    symbol: token.symbol,
    name: token.name,
  };
}

/**
 * Save state in V2 format (minimal storage)
 * Only stores: mint + isRoot + optional metadata
 * Does NOT store: bondingCurve, poolType, pendingFees (these are derived on-chain)
 */
export async function saveStateV2(
  filePath: string,
  creatorPubkey: PublicKey,
  network: "devnet" | "mainnet",
  tokens: StoredToken[],
  feeTracking: FeeTrackingState
): Promise<void> {
  const state: PersistedStateV2 = {
    version: 2,
    savedAt: Date.now(),
    creatorPubkey: creatorPubkey.toBase58(),
    network,
    tokens,
    feeTracking: {
      ...feeTracking,
      processedSignatures: feeTracking.processedSignatures.slice(-MAX_PROCESSED_SIGNATURES),
    },
  };

  const tempFile = `${filePath}.tmp.${process.pid}`;
  const content = JSON.stringify(state, null, 2);

  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write to temp file
    fs.writeFileSync(tempFile, content, "utf-8");

    // Rotate backups before rename
    if (fs.existsSync(filePath)) {
      rotateBackups(filePath);
    }

    // Atomic rename
    fs.renameSync(tempFile, filePath);

    log.debug("State V2 saved", {
      tokens: tokens.length,
      signatures: state.feeTracking.processedSignatures.length,
    });
  } catch (error) {
    // Cleanup temp file on error
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw error;
  }
}

/**
 * Load state V2 format
 * Returns minimal tokens that need on-chain verification
 */
export async function loadStateV2(filePath: string): Promise<{
  tokens: StoredToken[];
  feeTracking: FeeTrackingState;
  creatorPubkey: string;
  network: "devnet" | "mainnet";
} | null> {
  // Try main file first, then backups
  const filesToTry = [
    filePath,
    `${filePath}.1`,
    `${filePath}.2`,
    `${filePath}.3`,
  ];

  for (const file of filesToTry) {
    if (!fs.existsSync(file)) continue;

    try {
      const content = fs.readFileSync(file, "utf-8");
      const raw = JSON.parse(content);

      // Check version
      if (raw.version === 2) {
        // V2 format - direct load
        const state = raw as PersistedStateV2;

        if (!state.creatorPubkey || !state.network || !Array.isArray(state.tokens)) {
          log.warn("Invalid V2 state structure, skipping", { file });
          continue;
        }

        log.info("State V2 loaded", {
          file: file === filePath ? "current" : `backup ${file.split(".").pop()}`,
          tokens: state.tokens.length,
          signatures: state.feeTracking?.processedSignatures?.length || 0,
          savedAt: new Date(state.savedAt).toISOString(),
        });

        return {
          tokens: state.tokens,
          feeTracking: state.feeTracking || {
            processedSignatures: [],
            pollCount: 0,
            errorCount: 0,
          },
          creatorPubkey: state.creatorPubkey,
          network: state.network,
        };
      } else if (raw.version === 1 || raw.version === STATE_VERSION) {
        // V1 format - migrate to V2
        log.info("Migrating V1 state to V2 format", { file });

        const oldState = raw as PersistedState;

        // Extract minimal data from V1 tokens
        const tokens: StoredToken[] = oldState.tokens.map(t => ({
          mint: t.mint,
          isRoot: t.isRoot,
          symbol: t.symbol,
          name: t.name,
        }));

        return {
          tokens,
          feeTracking: {
            processedSignatures: oldState.processedSignatures || [],
            lastProcessedSignature: oldState.lastProcessedSignature,
            pollCount: oldState.pollCount || 0,
            errorCount: oldState.errorCount || 0,
          },
          creatorPubkey: oldState.creatorPubkey,
          network: oldState.network,
        };
      } else {
        log.warn("Unknown state version, skipping", {
          file,
          version: raw.version,
        });
        continue;
      }
    } catch (error) {
      log.warn("Failed to parse state file, trying backup", {
        file,
        error: (error as Error).message,
      });
    }
  }

  log.info("No valid state file found, starting fresh");
  return null;
}

/**
 * Migrate V1 state file to V2 format in place
 * Returns true if migration was performed
 */
export async function migrateStateV1toV2(filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const raw = JSON.parse(content);

    // Already V2?
    if (raw.version === 2) {
      log.debug("State already V2, no migration needed");
      return false;
    }

    // Not V1?
    if (raw.version !== 1 && raw.version !== STATE_VERSION) {
      log.warn("Unknown state version, cannot migrate", { version: raw.version });
      return false;
    }

    const oldState = raw as PersistedState;

    // Convert to V2
    const newState: PersistedStateV2 = {
      version: 2,
      savedAt: Date.now(),
      creatorPubkey: oldState.creatorPubkey,
      network: oldState.network,
      tokens: oldState.tokens.map(t => ({
        mint: t.mint,
        isRoot: t.isRoot,
        symbol: t.symbol,
        name: t.name,
      })),
      feeTracking: {
        processedSignatures: oldState.processedSignatures || [],
        lastProcessedSignature: oldState.lastProcessedSignature,
        pollCount: oldState.pollCount || 0,
        errorCount: oldState.errorCount || 0,
      },
    };

    // Backup old file
    const backupPath = `${filePath}.v1-backup`;
    fs.copyFileSync(filePath, backupPath);
    log.info("V1 state backed up", { backup: backupPath });

    // Write new V2 format
    fs.writeFileSync(filePath, JSON.stringify(newState, null, 2), "utf-8");

    log.info("State migrated from V1 to V2", {
      tokens: newState.tokens.length,
      droppedFields: ["bondingCurve", "poolType", "pendingFeesLamports", "totalCollectedLamports", "totalBurnedTokens"],
    });

    return true;
  } catch (error) {
    log.error("State migration failed", { error: (error as Error).message });
    return false;
  }
}

/**
 * Get state file version without full parsing
 */
export function getStateVersion(filePath: string): number | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const raw = JSON.parse(content);
    return raw.version ?? null;
  } catch {
    return null;
  }
}

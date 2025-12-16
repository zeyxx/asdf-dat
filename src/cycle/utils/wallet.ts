/**
 * Wallet Utilities for Cycle Execution
 *
 * Secure wallet loading and validation.
 */

import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';

/**
 * Load and validate wallet file
 *
 * Validates:
 * - File exists
 * - Valid JSON format
 * - Array of 64 bytes
 * - All bytes in range 0-255
 * - Valid keypair
 *
 * @throws Error with descriptive message if validation fails
 */
export function loadAndValidateWallet(walletPath: string): Keypair {
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet file not found: ${walletPath}`);
  }

  let walletData: unknown;
  try {
    const fileContent = fs.readFileSync(walletPath, 'utf-8');
    walletData = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Invalid wallet JSON: ${(error as Error).message}`);
  }

  // Validate it's an array of numbers
  if (!Array.isArray(walletData)) {
    throw new Error(
      `Invalid wallet format: Expected array of numbers, got ${typeof walletData}`
    );
  }

  // Validate array length (64 bytes for secret key)
  if (walletData.length !== 64) {
    throw new Error(
      `Invalid wallet format: Expected 64 bytes, got ${walletData.length}`
    );
  }

  // Validate all elements are numbers in valid range (0-255)
  for (let i = 0; i < walletData.length; i++) {
    const val = walletData[i];
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 255) {
      throw new Error(
        `Invalid wallet format: Element at index ${i} is not a valid byte (0-255)`
      );
    }
  }

  try {
    return Keypair.fromSecretKey(new Uint8Array(walletData));
  } catch (error) {
    throw new Error(`Invalid keypair: ${(error as Error).message}`);
  }
}

/**
 * Core module - Types, PDA utils, constants, verification
 * @module core
 */

// Constants (single source of truth)
export * from './constants';

// PDA derivation utilities
export * from './pda-utils';

// Type definitions
export * from './types';

// User pool utilities
export * from './user-pool';

// Token verification ("Don't trust, verify" architecture)
export * from './token-verifier';

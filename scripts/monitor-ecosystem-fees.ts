/**
 * DEPRECATED: This script has been replaced by the new daemon architecture.
 *
 * Use the new CLI instead:
 *   npx ts-node src/cli.ts --creator <PUBKEY> --network devnet
 *
 * Or use the npm script:
 *   npm run daemon -- --creator <PUBKEY> --network devnet
 *
 * The new architecture provides:
 * - Automatic token discovery via getProgramAccounts
 * - Root token detection from on-chain DATState
 * - Improved RPC management with failover
 * - Automatic cycle execution when thresholds are met
 * - State persistence for crash recovery
 *
 * See src/daemon.ts for implementation details.
 */

console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  DEPRECATED: monitor-ecosystem-fees.ts has been replaced             ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  Use the new CLI instead:                                            ║
║                                                                      ║
║    npx ts-node src/cli.ts --creator <PUBKEY> --network devnet        ║
║                                                                      ║
║  Or with environment variables:                                      ║
║                                                                      ║
║    export CREATOR_PUBKEY=84ddDW8...                                  ║
║    npm run daemon                                                    ║
║                                                                      ║
║  The new daemon provides automatic token discovery and cycle         ║
║  execution. See src/daemon.ts for details.                           ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`);

process.exit(1);

/**
 * ASDF DAT - Main Entry Point
 * Automated Buyback & Burn System for ASDF Token
 */

import { AsdfDATBot } from './bot';
import server from './dashboard';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Export main components
export { AsdfDATBot } from './bot';
export { server as DashboardServer } from './dashboard';

/**
 * Main execution based on command line arguments
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    
    console.log(`
╔══════════════════════════════════════════════════════╗
║              🔥 ASDF DAT System v2.0                 ║
║         Automated Buyback & Burn Protocol           ║
╚══════════════════════════════════════════════════════╝
    `);
    
    switch (command) {
        case 'all':
            // Start everything
            console.log('Starting all services...\n');
            
            // Start bot
            const bot = new AsdfDATBot();
            bot.start().catch(console.error);
            
            // Start dashboard
            const dashboardPort = process.env.DASHBOARD_PORT || 3000;
            console.log(`Dashboard: http://localhost:${dashboardPort}\n`);
            
            // Keep process alive
            process.on('SIGINT', () => {
                console.log('\nShutting down...');
                bot.stop();
                process.exit(0);
            });
            
            await new Promise(() => {}); // Keep running
            break;
            
        case 'bot':
            // Start bot only
            const botOnly = new AsdfDATBot();
            await botOnly.start();
            await new Promise(() => {});
            break;
            
        case 'dashboard':
            // Dashboard is started by importing
            console.log('Dashboard running on http://localhost:3000');
            await new Promise(() => {});
            break;
            
        case 'init':
            // Initialize on-chain
            const initBot = new AsdfDATBot();
            await initBot.initialize();
            console.log('✅ Initialization complete');
            process.exit(0);
            break;
            
        case 'stats':
            // Show statistics
            const statsBot = new AsdfDATBot();
            const stats = await statsBot.getStats();
            
            console.log('\n📊 STATISTICS\n');
            console.log('On-Chain:');
            console.log(`  Total Burned: ${stats?.onChain?.totalBurned || 0} ASDF`);
            console.log(`  Total SOL: ${(stats?.onChain?.totalSolCollected || 0) / 1e9} SOL`);
            console.log(`  Buybacks: ${stats?.onChain?.totalBuybacks || 0}`);
            console.log(`  Failed: ${stats?.onChain?.failedCycles || 0}`);
            console.log(`  Active: ${stats?.onChain?.isActive ? 'Yes' : 'No'}`);
            
            console.log('\nBot:');
            console.log(`  Next Execution: ${stats?.bot?.nextExecution || 'N/A'}`);
            console.log(`  Last Execution: ${stats?.bot?.lastExecution || 'Never'}`);
            
            process.exit(0);
            break;
            
        case 'test':
            // Test execution
            console.log('Running test execution...');
            const testBot = new AsdfDATBot();
            await testBot.executeBuyback('TEST' as any);
            process.exit(0);
            break;
            
        case 'help':
        default:
            console.log(`
Usage: npm start [command]

Commands:
  all        - Start bot and dashboard (default)
  bot        - Start bot only
  dashboard  - Start dashboard only
  init       - Initialize DAT on-chain
  stats      - Show statistics
  test       - Run test execution
  help       - Show this help

Examples:
  npm start              # Start everything
  npm start bot          # Start bot only
  npm run dat:init       # Initialize
  npm run dat:stats      # Show stats

Configuration (.env):
  PROGRAM_ID      - Deployed program ID
  WALLET_PATH     - Path to wallet JSON
  RPC_URL         - Solana RPC endpoint
  WEBHOOK_URL     - Alert webhook (optional)
  DASHBOARD_PORT  - Dashboard port (default: 3000)

For more info: https://github.com/asdf-dat
            `);
            process.exit(0);
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

// Health check endpoint for monitoring
export function healthCheck() {
    return {
        status: 'healthy',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    };
}
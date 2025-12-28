const { ethers, Wallet, WebSocketProvider, Contract, Interface, FallbackProvider, JsonRpcProvider } = require('ethers');
require('dotenv').config();

const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    // 🌐 ADD MULTIPLE ENDPOINTS IN YOUR .ENV
    WSS_PRIMARY: process.env.WSS_URL,                // Alchemy
    WSS_SECONDARY: process.env.WSS_SECONDARY_URL,    // QuickNode/Chainstack
    RPC_FALLBACK: "https://mainnet.base.org",        // Public Fallback
    
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    CBETH: "0x2Ae3F1Ec7F1F5563a3d161649c025dac7e983970",
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    MARGIN_ETH: process.env.MARGIN_ETH || "0.01" 
};

async function startHighAvailabilityTitan() {
    console.log("🛠️ INITIALIZING MULTIPOOL FALLBACK SYSTEM...");

    // 1. Setup Providers with Priorities
    const configs = [
        {
            provider: new WebSocketProvider(CONFIG.WSS_PRIMARY),
            priority: 1, // Highest priority
            weight: 2,
            stallTimeout: 1000 // If Alchemy stalls for 1s, trigger fallback
        },
        {
            provider: new WebSocketProvider(CONFIG.WSS_SECONDARY),
            priority: 2, // Secondary
            weight: 1,
            stallTimeout: 2000
        },
        {
            provider: new JsonRpcProvider(CONFIG.RPC_FALLBACK),
            priority: 3, // Last resort (HTTPS is slower but more stable)
            weight: 1
        }
    ];

    // 2. Wrap into a FallbackProvider
    const provider = new FallbackProvider(configs, CONFIG.CHAIN_ID);
    const signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);

    console.log("✅ MULTIPOOL LIVE | QUORUM ACTIVE");

    // Contracts
    const priceFeed = new Contract(CONFIG.CHAINLINK_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], provider);
    const gasOracle = new Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], provider);
    const titanIface = new Interface(["function executeTriangle(address[],uint256)"]);

    // HEARTBEAT
    provider.on("block", async (num) => {
        try {
            const [, price] = await priceFeed.latestRoundData();
            process.stdout.write(`\r⛓️ BLOCK: ${num} | ETH: $${(Number(price)/1e8).toFixed(2)} | Health: [${configs.length} Nodes] `);
        } catch (e) {}
    });

    // LISTENER (Uses the best available node)
    const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
    provider.on({ topics: [swapTopic] }, async (log) => {
        try {
            if (!log.topics.some(t => t.toLowerCase().includes(CONFIG.CBETH.toLowerCase().slice(2)))) return;

            const balance = await provider.getBalance(signer.address);
            const loanAmount = balance > ethers.parseEther("0.1") ? ethers.parseEther("100") : ethers.parseEther("25");

            const data = titanIface.encodeFunctionData("executeTriangle", [[CONFIG.WETH, CONFIG.USDC, CONFIG.CBETH, CONFIG.WETH], loanAmount]);

            // Simulation will now automatically use the "Fastest" node from the fallback list
            const [simulation, l1Fee, feeData] = await Promise.all([
                provider.call({ to: CONFIG.TARGET_CONTRACT, data, from: signer.address }).catch(() => null),
                gasOracle.getL1Fee(data).catch(() => 0n),
                provider.getFeeData()
            ]);

            if (simulation && BigInt(simulation) > (ethers.parseEther(CONFIG.MARGIN_ETH))) {
                console.log(`\n🚀 MULTIPOOL STRIKE INITIATED...`);
                await signer.sendTransaction({
                    to: CONFIG.TARGET_CONTRACT,
                    data,
                    gasLimit: 1300000n,
                    maxFeePerGas: feeData.maxFeePerGas,
                    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                    type: 2
                });
            }
        } catch (e) {}
    });

    // Cleanup on disconnect
    process.on('SIGINT', () => {
        provider.destroy();
        process.exit();
    });
}

startHighAvailabilityTitan().catch(err => {
    console.error("Critical Failure:", err.message);
    setTimeout(startHighAvailabilityTitan, 5000);
});

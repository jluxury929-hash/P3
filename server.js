const { ethers, Wallet, WebSocketProvider, Contract, Interface } = require('ethers');
require('dotenv').config();

const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WSS_URL: process.env.WSS_URL,
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    CBETH: "0x2Ae3F1Ec7F1F5563a3d161649c025dac7e983970",
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    MARGIN_ETH: process.env.MARGIN_ETH || "0.01" 
};

// 🛠️ THE SELF-HEALING WRAPPER
async function startTitan() {
    console.log("🟢 [BOOT] INITIALIZING SECURE WEBSOCKET...");
    
    let provider;
    try {
        provider = new WebSocketProvider(CONFIG.WSS_URL);
    } catch (e) {
        console.error("❌ CONNECTION FAILED. RETRYING IN 5S...");
        return setTimeout(startTitan, 5000);
    }

    const signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);
    const priceFeed = new Contract(CONFIG.CHAINLINK_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], provider);
    const gasOracle = new Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], provider);
    const titanIface = new Interface(["function executeTriangle(address[],uint256)"]);

    // HEARTBEAT & PRICE
    provider.on("block", async (num) => {
        try {
            const [, price] = await priceFeed.latestRoundData();
            const ethUSD = Number(price) / 1e8;
            process.stdout.write(`\r⛓️ BLOCK: ${num} | ETH: $${ethUSD.toFixed(2)} | Titan Active `);
        } catch (e) { /* Provider might be mid-reconnect */ }
    });

    const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");

    provider.on({ topics: [swapTopic] }, async (log) => {
        try {
            if (!log.topics.some(t => t.toLowerCase().includes(CONFIG.CBETH.toLowerCase().slice(2)))) return;

            const balance = await provider.getBalance(signer.address);
            const loanAmount = balance > ethers.parseEther("0.1") ? ethers.parseEther("100") : ethers.parseEther("25");
            const paths = [[CONFIG.WETH, CONFIG.USDC, CONFIG.CBETH, CONFIG.WETH], [CONFIG.WETH, CONFIG.CBETH, CONFIG.USDC, CONFIG.WETH]];

            for (const path of paths) {
                const data = titanIface.encodeFunctionData("executeTriangle", [path, loanAmount]);
                const [simulation, l1Fee, feeData] = await Promise.all([
                    provider.call({ to: CONFIG.TARGET_CONTRACT, data, from: signer.address }).catch(() => null),
                    gasOracle.getL1Fee(data).catch(() => 0n),
                    provider.getFeeData()
                ]);

                if (!simulation) continue;

                const gasEstimate = 1250000n; // Safe triangular estimate
                const totalCost = (gasEstimate * feeData.gasPrice) + l1Fee + (loanAmount * 9n / 10000n);
                const netProfit = BigInt(simulation) - totalCost;

                if (netProfit > ethers.parseEther(CONFIG.MARGIN_ETH)) {
                    console.log(`\n🎯 PROFIT DETECTED: ${ethers.formatEther(netProfit)} ETH`);
                    await signer.sendTransaction({
                        to: CONFIG.TARGET_CONTRACT,
                        data,
                        gasLimit: gasEstimate,
                        maxFeePerGas: feeData.maxFeePerGas,
                        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                        type: 2
                    });
                }
            }
        } catch (e) { /* Ignore failed sim */ }
    });

    // 🛡️ THE FIX: Listen to the internal websocket events correctly
    provider.on("error", (e) => {
        console.error("\n⚠️ PROVIDER ERROR:", e.message);
        reconnect();
    });

    // Alchemy/Infura often close idle connections after 60s
    const reconnect = () => {
        console.log("♻️ RECONNECTING TITAN...");
        provider.destroy(); // Cleanup old listeners
        setTimeout(startTitan, 3000);
    };

    // Keepalive ping to prevent idle timeout
    const keepAlive = setInterval(async () => {
        try { await provider.getBlockNumber(); } 
        catch (e) { 
            clearInterval(keepAlive);
            reconnect(); 
        }
    }, 30000);
}

startTitan().catch(console.error);

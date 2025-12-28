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
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", // Automatic ETH Price
    MARGIN_ETH: process.env.MARGIN_ETH || "0.01" 
};

async function startZeroMaintenanceTitan() {
    const provider = new WebSocketProvider(CONFIG.WSS_URL);
    const signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);
    
    // Contracts for Automatic Data
    const priceFeed = new Contract(CONFIG.CHAINLINK_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], provider);
    const gasOracle = new Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], provider);
    const titanIface = new Interface(["function executeTriangle(address[],uint256)"]);

    console.log("🚀 TITAN STARTING... NO MANUAL SETTINGS REQUIRED.");

    provider.on("block", async (num) => {
        const [, price] = await priceFeed.latestRoundData();
        const ethUSD = Number(price) / 1e8;
        process.stdout.write(`\r⛓️ BLOCK: ${num} | ETH: $${ethUSD.toFixed(2)} | Titan is Self-Optimizing... `);
    });

    const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");

    provider.on({ topics: [swapTopic] }, async (log) => {
        try {
            // 1. AUTO-FILTER: Only care about swaps hitting our target tokens
            if (!log.topics.some(t => t.toLowerCase().includes(CONFIG.CBETH.toLowerCase().slice(2)))) return;

            // 2. AUTO-LOAN: Scale based on current wallet capacity
            const balance = await provider.getBalance(signer.address);
            const loanAmount = balance > ethers.parseEther("0.1") ? ethers.parseEther("100") : ethers.parseEther("25");

            const paths = [
                [CONFIG.WETH, CONFIG.USDC, CONFIG.CBETH, CONFIG.WETH],
                [CONFIG.WETH, CONFIG.CBETH, CONFIG.USDC, CONFIG.WETH]
            ];

            for (const path of paths) {
                const data = titanIface.encodeFunctionData("executeTriangle", [path, loanAmount]);

                // 3. AUTO-ECONOMICS: Pre-calculate everything on-the-fly
                const [simulation, l1Fee, feeData] = await Promise.all([
                    provider.call({ to: CONFIG.TARGET_CONTRACT, data, from: signer.address }).catch(() => null),
                    gasOracle.getL1Fee(data),
                    provider.getFeeData()
                ]);

                if (!simulation) continue;

                // Automatic gas estimation with 20% safety buffer
                const gasEstimate = await provider.estimateGas({ to: CONFIG.TARGET_CONTRACT, data, from: signer.address }).catch(() => 1200000n);
                const gasCost = gasEstimate * (feeData.maxFeePerGas || feeData.gasPrice);
                
                const totalCost = gasCost + l1Fee + (loanAmount * 9n / 10000n);
                const netProfit = BigInt(simulation) - totalCost;

                if (netProfit > ethers.parseEther(CONFIG.MARGIN_ETH)) {
                    console.log(`\n🎯 PROFIT: ${ethers.formatEther(netProfit)} ETH | STRATEGIZING STRIKE...`);
                    
                    await signer.sendTransaction({
                        to: CONFIG.TARGET_CONTRACT,
                        data,
                        gasLimit: (gasEstimate * 120n) / 100n, // 20% Auto-Buffer
                        maxFeePerGas: feeData.maxFeePerGas,
                        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                        type: 2
                    });
                }
            }
        } catch (e) { /* Auto-ignore reverts */ }
    });
}

startZeroMaintenanceTitan();

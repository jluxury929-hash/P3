const { ethers, Wallet, WebSocketProvider, Contract, Interface } = require('ethers');
require('dotenv').config();

console.log("-----------------------------------------");
console.log("🟢 [BOOT] TRIANGULAR TITAN INITIALIZING...");

const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WSS_URL: process.env.WSS_URL,
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    CBETH: "0x2Ae3F1Ec7F1F5563a3d161649c025dac7e983970",
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    GAS_LIMIT: 1200000n,
    MARGIN_ETH: process.env.MARGIN_ETH || "0.012"
};

// ABIs
const ORACLE_ABI = ["function getL1Fee(bytes memory) public view returns (uint256)"];
const CHAINLINK_ABI = ["function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)"];
const TITAN_ABI = ["function executeTriangle(address[],uint256)"];

async function startTriangularStriker() {
    if (!CONFIG.WSS_URL) {
        console.error("❌ ERROR: WSS_URL missing in .env");
        process.exit(1);
    }

    const provider = new WebSocketProvider(CONFIG.WSS_URL);
    const signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);
    const gasOracle = new Contract(CONFIG.GAS_ORACLE, ORACLE_ABI, provider);
    const priceFeed = new Contract(CONFIG.CHAINLINK_FEED, CHAINLINK_ABI, provider);
    const titanIface = new Interface(TITAN_ABI);

    console.log(`📡 CONNECTED | SIGNER: ${signer.address}`);

    // HEARTBEAT & USD PRICE REFRESH
    provider.on("block", async (num) => {
        try {
            const [, priceData] = await priceFeed.latestRoundData();
            const usd = Number(priceData) / 1e8;
            process.stdout.write(`\r⛓️ BLOCK: ${num} | ETH: $${usd.toFixed(2)} | Monitoring Triangle Paths... `);
        } catch (e) { /* Price feed failure shouldn't stop the bot */ }
    });

    const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");

    provider.on({ topics: [swapTopic] }, async (log) => {
        try {
            // Check if log involves cbETH or USDC
            const isTarget = log.topics.some(t => 
                t.toLowerCase().includes(CONFIG.CBETH.toLowerCase().slice(2)) ||
                t.toLowerCase().includes(CONFIG.USDC.toLowerCase().slice(2))
            );
            if (!isTarget) return;

            // 1. DYNAMIC LOAN SCALING
            const balance = await provider.getBalance(signer.address);
            let loanSize = ethers.parseEther("15"); // Default Safe Start
            if (balance > ethers.parseEther("0.1")) loanSize = ethers.parseEther("100");
            else if (balance > ethers.parseEther("0.05")) loanSize = ethers.parseEther("50");

            const paths = [
                [CONFIG.WETH, CONFIG.USDC, CONFIG.CBETH, CONFIG.WETH],
                [CONFIG.WETH, CONFIG.CBETH, CONFIG.USDC, CONFIG.WETH]
            ];

            for (const path of paths) {
                const strikeData = titanIface.encodeFunctionData("executeTriangle", [path, loanSize]);

                // 2. SIMULATION & L1 FEE PROTECTION
                const [simResult, l1Fee, feeData, [, priceData]] = await Promise.allSettled([
                    provider.call({ to: CONFIG.TARGET_CONTRACT, data: strikeData, from: signer.address }),
                    gasOracle.getL1Fee(strikeData),
                    provider.getFeeData(),
                    priceFeed.latestRoundData()
                ]);

                if (simResult.status === 'rejected') continue;

                const ethPrice = Number(priceData.value) / 1e8;
                const gasCost = CONFIG.GAS_LIMIT * (feeData.value.maxFeePerGas || feeData.value.gasPrice);
                const aaveFee = (loanSize * 9n) / 10000n; // 0.09% Aave Fee
                
                const totalCost = gasCost + l1Fee.value + aaveFee;
                const grossProfit = BigInt(simResult.value);
                const netProfit = grossProfit - totalCost;

                if (netProfit > ethers.parseEther(CONFIG.MARGIN_ETH)) {
                    const profitUSD = parseFloat(ethers.formatEther(netProfit)) * ethPrice;
                    console.log(`\n💎 TRIANGLE HIT! Net: ${ethers.formatEther(netProfit)} ETH (~$${profitUSD.toFixed(2)})`);
                    
                    const tx = await signer.sendTransaction({
                        to: CONFIG.TARGET_CONTRACT,
                        data: strikeData,
                        gasLimit: CONFIG.GAS_LIMIT,
                        maxFeePerGas: feeData.value.maxFeePerGas,
                        maxPriorityFeePerGas: feeData.value.maxPriorityFeePerGas,
                        type: 2
                    });
                    console.log(`🚀 STRIKE FIRED: ${tx.hash}`);
                    await tx.wait();
                    break;
                }
            }
        } catch (e) {
            // Reverts during loop are skipped
        }
    });

    provider.websocket.on("close", () => {
        console.warn("\n⚠️ WebSocket Closed. Reconnecting...");
        setTimeout(startTriangularStriker, 5000);
    });
}

startTriangularStriker().catch(err => console.error("❌ BOOT ERROR:", err.message));

const { ethers, Wallet, WebSocketProvider, JsonRpcProvider, Contract, Interface } = require('ethers');
require('dotenv').config();

// 🔧 CONFIGURATION
const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WSS_URL: process.env.WSS_URL,          // FOR LISTENING (FAST)
    RPC_URL: "https://mainnet.base.org",   // FOR EXECUTING (RELIABLE)
    
    // ⚡ GAS STRATEGY
    PRIORITY_BRIBE: 10n, // % to overpay for priority (Beats standard users)
    
    // 🎯 TOKENS
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    CBETH: "0x2Ae3F1Ec7F1F5563a3d161649c025dac7e983970",
    
    // 📉 ORACLES
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    MARGIN_ETH: process.env.MARGIN_ETH || "0.01" 
};

// 🛡️ GLOBAL STATE (Prevents Garbage Collection)
let wsProvider, httpProvider, signer, titanContract;
let isScanning = false;

async function startSniper() {
    console.log(`\n☠️ STARTING APEX SNIPER [${new Date().toLocaleTimeString()}]`);

    // 1. SETUP EXECUTION LANE (HTTPS)
    // We use HTTPS for sending transactions because it doesn't "close" like websockets
    httpProvider = new JsonRpcProvider(CONFIG.RPC_URL);
    signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, httpProvider);
    
    // 2. SETUP LISTENING LANE (WSS)
    // We wrap this in a try/catch loop so if it dies, we just restart it
    try {
        wsProvider = new WebSocketProvider(CONFIG.WSS_URL);
        
        // Wait for open
        await wsProvider.ready; 
        console.log("✅ LISTENER CONNECTED (LOW LATENCY)");
        
        // 3. CONTRACTS
        const gasOracle = new Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], httpProvider);
        const titanIface = new Interface(["function executeTriangle(address[],uint256)"]);
        const priceFeed = new Contract(CONFIG.CHAINLINK_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], httpProvider);

        // 4. HEARTBEAT (Keeps connection alive)
        const heartbeat = setInterval(async () => {
            try { await wsProvider.getBlockNumber(); } catch (e) { 
                console.log("💔 HEARTBEAT FAILED. RESTARTING...");
                clearInterval(heartbeat);
                process.exit(1); // PM2 will restart us instantly
            }
        }, 15000);

        // 5. THE LOOP
        wsProvider.on("block", async (blockNum) => {
            if (isScanning) return; // Don't overlap scans
            isScanning = true;

            try {
                // Flash Price Check
                // const [, price] = await priceFeed.latestRoundData(); 
                process.stdout.write(`\r👀 SCANNING BLOCK ${blockNum} | READY TO FIRE...`);

                const balance = await httpProvider.getBalance(signer.address);
                const loanAmount = balance > ethers.parseEther("0.1") ? ethers.parseEther("100") : ethers.parseEther("20");

                const paths = [
                    [CONFIG.WETH, CONFIG.USDC, CONFIG.CBETH, CONFIG.WETH],
                    [CONFIG.WETH, CONFIG.CBETH, CONFIG.USDC, CONFIG.WETH]
                ];

                for (const path of paths) {
                    const data = titanIface.encodeFunctionData("executeTriangle", [path, loanAmount]);
                    
                    // ⚡ SPEED SIMULATION (Using HTTP for stability)
                    const [simulation, feeData] = await Promise.all([
                        httpProvider.call({ to: CONFIG.TARGET_CONTRACT, data, from: signer.address }).catch(() => null),
                        httpProvider.getFeeData()
                    ]);

                    if (!simulation) continue;

                    const profitWei = BigInt(simulation);
                    if (profitWei > ethers.parseEther(CONFIG.MARGIN_ETH)) {
                        console.log(`\n🚨 OPPORTUNITY FOUND! PROFIT: ${ethers.formatEther(profitWei)} ETH`);
                        
                        // 🚀 EXECUTE WITH AGGRESSIVE GAS
                        // We take the market gas price and add our "Bribe" percentage
                        const aggressiveFee = feeData.maxPriorityFeePerGas + 
                            ((feeData.maxPriorityFeePerGas * CONFIG.PRIORITY_BRIBE) / 100n);

                        const tx = await signer.sendTransaction({
                            to: CONFIG.TARGET_CONTRACT,
                            data,
                            gasLimit: 1400000n, // Hardcoded safe limit
                            maxFeePerGas: feeData.maxFeePerGas,
                            maxPriorityFeePerGas: aggressiveFee,
                            type: 2
                        });

                        console.log(`🔫 FIRED! HASH: ${tx.hash}`);
                    }
                }
            } catch (e) {
                // Ignore single block errors
            } finally {
                isScanning = false;
            }
        });

        // ERROR HANDLER
        wsProvider.websocket.onclose = () => {
            console.error("\n⚠️ CONNECTION LOST");
            process.exit(1);
        };

    } catch (e) {
        console.error(`\n❌ CRASH: ${e.message}`);
        setTimeout(startSniper, 1000);
    }
}

// THE IMMORTAL WRAPPER
if (require.main === module) {
    // This loop ensures that even if startSniper crashes, we restart
    startSniper().catch(e => {
        console.error("FATAL ERROR, REBOOTING...");
        setTimeout(startSniper, 1000);
    });
}

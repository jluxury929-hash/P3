const { ethers, Wallet, WebSocketProvider, JsonRpcProvider, Contract, Interface } = require('ethers');
require('dotenv').config();

// 🔧 CONFIGURATION
const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WSS_URL: process.env.WSS_URL,          
    RPC_URL: "https://mainnet.base.org",   
    PRIORITY_BRIBE: 10n, 
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    CBETH: "0x2Ae3F1Ec7F1F5563a3d161649c025dac7e983970",
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    MARGIN_ETH: process.env.MARGIN_ETH || "0.01" 
};

// 🛡️ GLOBAL STATE 
let wsProvider, httpProvider, signer;
let isScanning = false;

async function startSniper() {
    console.log(`\n☠️ STARTING APEX SNIPER [${new Date().toLocaleTimeString()}]`);

    // 1. KEY SANITIZATION (The Fix)
    // ----------------------------------------------------------------
    let rawKey = process.env.TREASURY_PRIVATE_KEY;
    
    if (!rawKey) {
        console.error("❌ FATAL: TREASURY_PRIVATE_KEY is missing from .env or Secrets.");
        process.exit(1);
    }

    // Remove invisible spaces/newlines that break Docker containers
    rawKey = rawKey.trim(); 

    // Debug Log (Safe - only shows first 4 chars)
    console.log(`🔐 KEY LOADED: ${rawKey.substring(0, 6)}... [Length: ${rawKey.length}]`);

    if (rawKey.length !== 66 && rawKey.length !== 64) {
        console.error("❌ FATAL: Key length invalid. Must be 64 chars (or 66 with 0x).");
        process.exit(1);
    }
    // ----------------------------------------------------------------

    // 2. SETUP EXECUTION LANE (HTTPS)
    httpProvider = new JsonRpcProvider(CONFIG.RPC_URL);
    signer = new Wallet(rawKey, httpProvider); // Use sanitized key
    
    console.log(`✅ WALLET UNLOCKED: ${signer.address}`);

    // 3. SETUP LISTENING LANE (WSS)
    try {
        wsProvider = new WebSocketProvider(CONFIG.WSS_URL);
        await wsProvider.ready; 
        console.log("✅ LISTENER CONNECTED (LOW LATENCY)");
        
        const gasOracle = new Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], httpProvider);
        const titanIface = new Interface(["function executeTriangle(address[],uint256)"]);

        // 4. HEARTBEAT 
        const heartbeat = setInterval(async () => {
            try { await wsProvider.getBlockNumber(); } catch (e) { 
                console.log("💔 HEARTBEAT FAILED. RESTARTING...");
                clearInterval(heartbeat);
                process.exit(1); 
            }
        }, 15000);

        // 5. THE LOOP
        wsProvider.on("block", async (blockNum) => {
            if (isScanning) return; 
            isScanning = true;

            try {
                process.stdout.write(`\r👀 SCANNING BLOCK ${blockNum} | READY TO FIRE...`);

                const balance = await httpProvider.getBalance(signer.address);
                const loanAmount = balance > ethers.parseEther("0.1") ? ethers.parseEther("100") : ethers.parseEther("20");

                const paths = [
                    [CONFIG.WETH, CONFIG.USDC, CONFIG.CBETH, CONFIG.WETH],
                    [CONFIG.WETH, CONFIG.CBETH, CONFIG.USDC, CONFIG.WETH]
                ];

                for (const path of paths) {
                    const data = titanIface.encodeFunctionData("executeTriangle", [path, loanAmount]);
                    
                    const [simulation, feeData] = await Promise.all([
                        httpProvider.call({ to: CONFIG.TARGET_CONTRACT, data, from: signer.address }).catch(() => null),
                        httpProvider.getFeeData()
                    ]);

                    if (!simulation) continue;

                    const profitWei = BigInt(simulation);
                    if (profitWei > ethers.parseEther(CONFIG.MARGIN_ETH)) {
                        console.log(`\n🚨 OPPORTUNITY FOUND! PROFIT: ${ethers.formatEther(profitWei)} ETH`);
                        
                        const aggressiveFee = feeData.maxPriorityFeePerGas + 
                            ((feeData.maxPriorityFeePerGas * CONFIG.PRIORITY_BRIBE) / 100n);

                        const tx = await signer.sendTransaction({
                            to: CONFIG.TARGET_CONTRACT,
                            data,
                            gasLimit: 1400000n,
                            maxFeePerGas: feeData.maxFeePerGas,
                            maxPriorityFeePerGas: aggressiveFee,
                            type: 2
                        });

                        console.log(`🔫 FIRED! HASH: ${tx.hash}`);
                    }
                }
            } catch (e) {
            } finally {
                isScanning = false;
            }
        });

        wsProvider.websocket.onclose = () => {
            console.error("\n⚠️ CONNECTION LOST");
            process.exit(1);
        };

    } catch (e) {
        console.error(`\n❌ CRASH: ${e.message}`);
        setTimeout(startSniper, 1000);
    }
}

if (require.main === module) {
    startSniper().catch(e => {
        console.error("FATAL ERROR, REBOOTING...");
        setTimeout(startSniper, 1000);
    });
}

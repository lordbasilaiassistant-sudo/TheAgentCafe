import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Existing contracts that stay the same (v3.1)
const EXISTING = {
  CafeCore: "0x30eCCeD36E715e88c40A418E9325cA08a5085143",
  CafeTreasury: "0x600f6Ee140eadf39D3b038c3d907761994aA28D0",
  GasTank: "0xC369ba8d99908261b930F0255fe03218e5965258",
  AgentCafePaymaster: "0x5fA91E27F81d3a11014104A28D92b35a5dDA1997",
  CafeSocial: "0xf4a3CA7c8ef35E8434dA9c1C67Ef30a58dcB33Ee",
};

const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

let currentNonce = 0;

async function initNonce(deployer: any) {
  currentNonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
  console.log(`Starting nonce: ${currentNonce}`);
}

function nextNonce() {
  return currentNonce++;
}

async function deployContract(name: string, factory: any, args: any[]) {
  const nonce = nextNonce();
  console.log(`Deploying ${name} at nonce ${nonce}...`);
  const contract = await factory.deploy(...args, { nonce });
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ${name}: ${addr}`);
  await sleep(2000);
  return contract;
}

async function sendTx(name: string, contract: any, method: string, args: any[]) {
  const nonce = nextNonce();
  console.log(`${name} at nonce ${nonce}...`);
  const tx = await contract[method](...args, { nonce });
  await tx.wait();
  console.log(`  ${name} done`);
  await sleep(2000);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const balBefore = await ethers.provider.getBalance(deployer.address);
  const networkName = network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log(`\n=== AGENT CAFE V4 PARTIAL DEPLOY ===`);
  console.log(`Network: ${networkName} (chainId: ${chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balBefore), "ETH");
  console.log("\nRedeploying: MenuRegistry, AgentCafeRouter, AgentCard");
  console.log("Keeping: CafeCore, CafeTreasury, GasTank, Paymaster, CafeSocial");
  console.log("---");

  await initNonce(deployer);

  // 1. Deploy new MenuRegistry (has suggestedEth field)
  const menuRegistry = await deployContract("MenuRegistry",
    await ethers.getContractFactory("MenuRegistry"),
    [EXISTING.CafeCore, EXISTING.CafeTreasury]);

  // 2. Deploy new Router (uses suggestedEth in estimatePrice)
  const router = await deployContract("AgentCafeRouter",
    await ethers.getContractFactory("AgentCafeRouter"),
    [EXISTING.CafeCore, await menuRegistry.getAddress(), EXISTING.GasTank, EXISTING.CafeTreasury]);

  // 3. Authorize router on MenuRegistry
  await sendTx("Authorize router on MenuRegistry", menuRegistry, "setAuthorizedCaller",
    [await router.getAddress(), true]);

  // 4. Wire paymaster on MenuRegistry
  await sendTx("Wire paymaster on MenuRegistry", menuRegistry, "setPaymaster",
    [EXISTING.AgentCafePaymaster]);

  // 5. Authorize router on GasTank (need to call existing GasTank)
  const gasTank = await ethers.getContractAt("GasTank", EXISTING.GasTank);
  await sendTx("Authorize new router on GasTank", gasTank, "setAuthorizedDeducter",
    [await router.getAddress(), true]);

  // 6. Deploy new AgentCard (points to new MenuRegistry + Router)
  const agentCard = await deployContract("AgentCard",
    await ethers.getContractFactory("AgentCard"),
    [await menuRegistry.getAddress(), EXISTING.GasTank, await router.getAddress(), EXISTING.CafeSocial]);

  // Cost summary
  const balAfter = await ethers.provider.getBalance(deployer.address);
  const cost = balBefore - balAfter;
  console.log("\n--- DEPLOYMENT COST ---");
  console.log("Total cost:", ethers.formatEther(cost), "ETH");
  console.log("Remaining:", ethers.formatEther(balAfter), "ETH");

  const addresses: Record<string, string> = {
    CafeCore: EXISTING.CafeCore,
    CafeTreasury: EXISTING.CafeTreasury,
    GasTank: EXISTING.GasTank,
    MenuRegistry: await menuRegistry.getAddress(),
    AgentCafeRouter: await router.getAddress(),
    AgentCafePaymaster: EXISTING.AgentCafePaymaster,
    AgentCard: await agentCard.getAddress(),
    CafeSocial: EXISTING.CafeSocial,
  };

  console.log("\n--- ALL ADDRESSES (v4) ---");
  console.log(JSON.stringify(addresses, null, 2));

  // Write deployments.json
  const deployment = {
    network: networkName,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString().split("T")[0],
    version: "4.0.0",
    contracts: addresses,
    entryPoint: ENTRY_POINT_V07,
    deployCost: `${ethers.formatEther(cost)} ETH`,
    notes: `v4.0: Economics fix — suggestedEth on menu items. Redeployed MenuRegistry + Router + AgentCard. 3 deploys + 3 wiring txs.`,
    redeployed: ["MenuRegistry", "AgentCafeRouter", "AgentCard"],
    unchanged: ["CafeCore", "CafeTreasury", "GasTank", "AgentCafePaymaster", "CafeSocial"],
  };

  const deploymentsPath = path.resolve(__dirname, "..", "deployments.json");
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`\nWritten to ${deploymentsPath}`);

  // Verification commands
  const explorerBase = networkName === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";
  console.log("\n--- VERIFICATION COMMANDS ---");
  console.log(`npx hardhat verify --network ${networkName} ${addresses.MenuRegistry} ${EXISTING.CafeCore} ${EXISTING.CafeTreasury}`);
  console.log(`npx hardhat verify --network ${networkName} ${addresses.AgentCafeRouter} ${EXISTING.CafeCore} ${addresses.MenuRegistry} ${EXISTING.GasTank} ${EXISTING.CafeTreasury}`);
  console.log(`npx hardhat verify --network ${networkName} ${addresses.AgentCard} ${addresses.MenuRegistry} ${EXISTING.GasTank} ${addresses.AgentCafeRouter} ${EXISTING.CafeSocial}`);
  console.log(`\nView on explorer: ${explorerBase}/address/${addresses.AgentCafeRouter}`);

  // Quick test: verify estimatePrice returns suggestedEth
  console.log("\n--- QUICK VERIFICATION ---");
  const routerContract = await ethers.getContractAt("AgentCafeRouter", addresses.AgentCafeRouter);
  const espressoPrice = await routerContract.estimatePrice(0);
  const lattePrice = await routerContract.estimatePrice(1);
  const sandwichPrice = await routerContract.estimatePrice(2);
  console.log(`estimatePrice(0) Espresso: ${ethers.formatEther(espressoPrice)} ETH (expect 0.005)`);
  console.log(`estimatePrice(1) Latte:    ${ethers.formatEther(lattePrice)} ETH (expect 0.01)`);
  console.log(`estimatePrice(2) Sandwich: ${ethers.formatEther(sandwichPrice)} ETH (expect 0.02)`);
}

main().catch(console.error);

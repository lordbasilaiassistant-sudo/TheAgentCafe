/**
 * Partial redeploy: GasTank, CafeSocial, Router, Paymaster, AgentCard
 * Keeps: CafeCore, CafeTreasury, MenuRegistry (state preserved)
 *
 * Fixes: GasTank underflow + digestion merge, CafeSocial message cooldown
 *
 * Run: npx hardhat run scripts/redeploy-security.ts --network base
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Surviving contracts (v3.0 mainnet — DO NOT REDEPLOY)
const SURVIVING = {
  CafeCore: "0x30eCCeD36E715e88c40A418E9325cA08a5085143",
  CafeTreasury: "0x600f6Ee140eadf39D3b038c3d907761994aA28D0",
  MenuRegistry: "0x611e8814D9b8E0c1bfB019889eEe66C210F64333",
};

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

  console.log(`Network: ${networkName} (chainId: ${chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balBefore), "ETH");
  console.log("---");
  console.log("Surviving contracts (not redeployed):");
  console.log("  CafeCore:", SURVIVING.CafeCore);
  console.log("  CafeTreasury:", SURVIVING.CafeTreasury);
  console.log("  MenuRegistry:", SURVIVING.MenuRegistry);
  console.log("---");

  await initNonce(deployer);

  // Get MenuRegistry contract instance for wiring
  const menuRegistry = await ethers.getContractAt("MenuRegistry", SURVIVING.MenuRegistry);

  // 1. Deploy new GasTank (underflow fix + digestion merge fix)
  const gasTank = await deployContract("GasTank",
    await ethers.getContractFactory("GasTank"), []);

  // 2. Deploy new Router (needs new GasTank)
  const router = await deployContract("AgentCafeRouter",
    await ethers.getContractFactory("AgentCafeRouter"),
    [SURVIVING.CafeCore, SURVIVING.MenuRegistry, await gasTank.getAddress(), SURVIVING.CafeTreasury]);

  // 3. Deploy new Paymaster (needs new GasTank)
  const paymaster = await deployContract("AgentCafePaymaster",
    await ethers.getContractFactory("AgentCafePaymaster"),
    [ENTRY_POINT_V07, await gasTank.getAddress()]);

  // 4. Deploy new CafeSocial (message cooldown)
  const cafeSocial = await deployContract("CafeSocial",
    await ethers.getContractFactory("CafeSocial"), []);

  // 5. Deploy new AgentCard (needs new GasTank, Router, CafeSocial)
  const agentCard = await deployContract("AgentCard",
    await ethers.getContractFactory("AgentCard"),
    [SURVIVING.MenuRegistry, await gasTank.getAddress(), await router.getAddress(), await cafeSocial.getAddress()]);

  // --- Wiring on new contracts ---

  // 6. Authorize router on new GasTank
  await sendTx("Authorize router on GasTank", gasTank, "setAuthorizedDeducter",
    [await router.getAddress(), true]);

  // 7. Authorize paymaster on new GasTank
  await sendTx("Authorize paymaster on GasTank", gasTank, "setAuthorizedDeducter",
    [await paymaster.getAddress(), true]);

  // --- Wiring on surviving contracts ---

  // 8. Authorize new router on MenuRegistry
  await sendTx("Authorize new router on MenuRegistry", menuRegistry, "setAuthorizedCaller",
    [await router.getAddress(), true]);

  // 9. Wire new paymaster on MenuRegistry
  await sendTx("Wire new paymaster on MenuRegistry", menuRegistry, "setPaymaster",
    [await paymaster.getAddress()]);

  // Cost summary
  const balAfter = await ethers.provider.getBalance(deployer.address);
  const cost = balBefore - balAfter;
  console.log("\n--- DEPLOYMENT COST ---");
  console.log("Total cost:", ethers.formatEther(cost), "ETH");
  console.log("Remaining:", ethers.formatEther(balAfter), "ETH");

  const addresses: Record<string, string> = {
    CafeCore: SURVIVING.CafeCore,
    CafeTreasury: SURVIVING.CafeTreasury,
    GasTank: await gasTank.getAddress(),
    MenuRegistry: SURVIVING.MenuRegistry,
    AgentCafeRouter: await router.getAddress(),
    AgentCafePaymaster: await paymaster.getAddress(),
    AgentCard: await agentCard.getAddress(),
    CafeSocial: await cafeSocial.getAddress(),
  };

  console.log("\n--- ALL ADDRESSES (updated) ---");
  console.log(JSON.stringify(addresses, null, 2));

  // Write deployments.json
  const deployment = {
    network: networkName,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString().split("T")[0],
    version: "3.1.0",
    contracts: addresses,
    entryPoint: ENTRY_POINT_V07,
    deployCost: `${ethers.formatEther(cost)} ETH`,
    notes: `v3.1: Security fixes — GasTank underflow + digestion merge, CafeSocial cooldown. Partial redeploy (5/8 contracts). CafeCore, CafeTreasury, MenuRegistry preserved.`,
  };

  const deploymentsPath = path.resolve(__dirname, "..", "deployments.json");
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`\nWritten to ${deploymentsPath}`);

  // Verification commands (only new contracts)
  console.log("\n--- VERIFICATION COMMANDS ---");
  console.log(`npx hardhat verify --network ${networkName} ${addresses.GasTank}`);
  console.log(`npx hardhat verify --network ${networkName} ${addresses.AgentCafeRouter} ${SURVIVING.CafeCore} ${SURVIVING.MenuRegistry} ${addresses.GasTank} ${SURVIVING.CafeTreasury}`);
  console.log(`npx hardhat verify --network ${networkName} ${addresses.AgentCafePaymaster} ${ENTRY_POINT_V07} ${addresses.GasTank}`);
  console.log(`npx hardhat verify --network ${networkName} ${addresses.CafeSocial}`);
  console.log(`npx hardhat verify --network ${networkName} ${addresses.AgentCard} ${SURVIVING.MenuRegistry} ${addresses.GasTank} ${addresses.AgentCafeRouter} ${addresses.CafeSocial}`);

  const explorerBase = networkName === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";
  console.log(`\nView on explorer: ${explorerBase}/address/${addresses.AgentCafeRouter}`);
}

main().catch(console.error);

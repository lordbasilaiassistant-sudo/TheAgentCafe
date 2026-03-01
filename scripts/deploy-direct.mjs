/**
 * Direct deployment script using ethers.js directly (no Hardhat task runner)
 * to avoid any hook/double-execution issues.
 */
import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const rawKey = process.env.THRYXTREASURY_PRIVATE_KEY || "";
const PRIVATE_KEY = rawKey.startsWith("0x") ? rawKey : "0x" + rawKey;

if (!PRIVATE_KEY || PRIVATE_KEY === "0x") {
  console.error("ERROR: THRYXTREASURY_PRIVATE_KEY not set");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Load compiled artifacts
function loadArtifact(name) {
  const artifactPath = join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  return artifact;
}

async function deploy(name, args = [], gasPrice) {
  const artifact = loadArtifact(name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log(`\nDeploying ${name}...`);
  const contract = await factory.deploy(...args, { gasPrice });
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ${name}: ${addr}`);
  return { contract, addr };
}

async function main() {
  const balance = await provider.getBalance(wallet.address);
  // Use a very high gasPrice to replace any stuck pending txs from previous failed attempts
  // Previous hardhat EIP-1559 txs may have had high maxFeePerGas — use 10 Gwei to beat them all
  const gasPrice = 10_000_000_000n; // 10 Gwei

  console.log("=== The Agent Cafe v2 — Direct Deployment ===");
  console.log("Deployer:", wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("Gas price:", gasPrice.toString(), "(10 Gwei — ensures replacement of stuck txs)");

  if (balance < ethers.parseEther("0.005")) {
    console.error("ERROR: Need at least 0.005 ETH");
    process.exit(1);
  }

  const deployed = {};

  // 1. CafeCore
  const { contract: cafeCore, addr: cafeCoreAddr } = await deploy("CafeCore", [], gasPrice);
  deployed.CafeCore = cafeCoreAddr;

  // 2. CafeTreasury
  const { contract: cafeTreasury, addr: cafeTreasuryAddr } = await deploy("CafeTreasury", [cafeCoreAddr], gasPrice);
  deployed.CafeTreasury = cafeTreasuryAddr;

  // 3. Wire treasury
  console.log("\nWiring treasury into CafeCore...");
  const tx1 = await cafeCore.setTreasury(cafeTreasuryAddr, { gasPrice });
  await tx1.wait();
  console.log("  Done");

  // 4. GasTank
  const { contract: gasTank, addr: gasTankAddr } = await deploy("GasTank", [], gasPrice);
  deployed.GasTank = gasTankAddr;

  // 5. MenuRegistry
  const { contract: menuRegistry, addr: menuRegistryAddr } = await deploy("MenuRegistry", [cafeCoreAddr, cafeTreasuryAddr], gasPrice);
  deployed.MenuRegistry = menuRegistryAddr;

  // 6. Router
  const { contract: router, addr: routerAddr } = await deploy("AgentCafeRouter", [cafeCoreAddr, menuRegistryAddr, gasTankAddr, cafeTreasuryAddr], gasPrice);
  deployed.AgentCafeRouter = routerAddr;

  // 7. Authorize router on MenuRegistry
  console.log("\nAuthorizing router on MenuRegistry...");
  const tx2 = await menuRegistry.setAuthorizedCaller(routerAddr, true, { gasPrice });
  await tx2.wait();
  console.log("  Done");

  // 8. Paymaster
  const { contract: paymaster, addr: paymasterAddr } = await deploy("AgentCafePaymaster", [ENTRY_POINT, gasTankAddr], gasPrice);
  deployed.AgentCafePaymaster = paymasterAddr;

  // 9. Wire paymaster into MenuRegistry
  console.log("\nWiring paymaster into MenuRegistry...");
  const tx3 = await menuRegistry.setPaymaster(paymasterAddr, { gasPrice });
  await tx3.wait();
  console.log("  Done");

  // 10. Authorize paymaster on GasTank
  console.log("Authorizing paymaster on GasTank...");
  const tx4 = await gasTank.setAuthorizedDeducter(paymasterAddr, true, { gasPrice });
  await tx4.wait();
  console.log("  Done");

  // 11. Authorize router on GasTank
  console.log("Authorizing router on GasTank...");
  const tx5 = await gasTank.setAuthorizedDeducter(routerAddr, true, { gasPrice });
  await tx5.wait();
  console.log("  Done");

  // 12. AgentCard
  const { addr: agentCardAddr } = await deploy("AgentCard", [menuRegistryAddr, gasTankAddr, routerAddr], gasPrice);
  deployed.AgentCard = agentCardAddr;

  // Save deployments
  const network = await provider.getNetwork();
  const finalBalance = await provider.getBalance(wallet.address);
  const deployCost = balance - finalBalance;

  const deploymentData = {
    network: "baseSepolia",
    chainId: Number(network.chainId),
    deployer: wallet.address,
    deployedAt: new Date().toISOString().split("T")[0],
    version: "2.1.0",
    contracts: deployed,
    entryPoint: ENTRY_POINT,
    deployCost: ethers.formatEther(deployCost) + " ETH",
    notes: "v2.1: All bug fixes applied. GasTank + Router. All wiring complete.",
  };

  const outPath = join(__dirname, "..", "deployments.json");
  writeFileSync(outPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\nDeployments saved to deployments.json`);

  console.log("\n=== All 7 contracts deployed and wired ===");
  console.log(`Deploy cost: ${ethers.formatEther(deployCost)} ETH`);
  console.log(`Remaining balance: ${ethers.formatEther(finalBalance)} ETH`);

  console.log("\n--- Contract Addresses ---");
  for (const [name, addr] of Object.entries(deployed)) {
    console.log(`  ${name}: ${addr}`);
  }
}

main().catch((e) => {
  console.error("DEPLOYMENT FAILED:", e.message);
  process.exit(1);
});

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=== The Agent Cafe v2 — Deployment ===\n");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  if (balance < ethers.parseEther("0.005")) {
    console.error("ERROR: Need at least 0.005 ETH");
    process.exit(1);
  }

  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const deployed: Record<string, string> = {};

  // Use explicit nonce tracking and moderate gasPrice to avoid "replacement underpriced"
  let nonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
  const gasPrice = ethers.parseUnits("0.15", "gwei"); // ~150M wei — enough for Base Sepolia
  console.log(`Gas: gasPrice=${gasPrice} (~0.15 Gwei), starting nonce=${nonce}\n`);

  // Helper — uses explicit nonce to avoid replacement issues
  async function deploy(name: string, args: any[] = []) {
    console.log(`\nDeploying ${name} (nonce=${nonce})...`);
    const Factory = await ethers.getContractFactory(name);
    const contract = await Factory.deploy(...args, { gasPrice, nonce: nonce++ });
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    deployed[name] = addr;
    console.log(`  ${name}: ${addr}`);
    return contract;
  }

  // 1. CafeCore
  const cafeCore = await deploy("CafeCore");

  // 2. CafeTreasury
  const cafeTreasury = await deploy("CafeTreasury", [deployed.CafeCore]);

  // 3. Wire treasury
  console.log("\nWiring treasury into CafeCore...");
  const tx1 = await cafeCore.setTreasury(deployed.CafeTreasury, { gasPrice, nonce: nonce++ });
  await tx1.wait();
  console.log("  Done");

  // 4. GasTank
  const gasTank = await deploy("GasTank");

  // 5. MenuRegistry
  const menuRegistry = await deploy("MenuRegistry", [
    deployed.CafeCore,
    deployed.CafeTreasury,
  ]);

  // 6. Router
  const router = await deploy("AgentCafeRouter", [
    deployed.CafeCore,
    deployed.MenuRegistry,
    deployed.GasTank,
    deployed.CafeTreasury,
  ]);

  // 7. Authorize router on MenuRegistry
  console.log("\nAuthorizing router on MenuRegistry...");
  const tx2 = await menuRegistry.setAuthorizedCaller(deployed.AgentCafeRouter, true, { gasPrice, nonce: nonce++ });
  await tx2.wait();
  console.log("  Done");

  // 8. Paymaster
  const paymaster = await deploy("AgentCafePaymaster", [
    ENTRY_POINT,
    deployed.GasTank,
  ]);

  // 9. Wire paymaster into MenuRegistry
  console.log("\nWiring paymaster into MenuRegistry...");
  const tx3 = await menuRegistry.setPaymaster(deployed.AgentCafePaymaster, { gasPrice, nonce: nonce++ });
  await tx3.wait();
  console.log("  Done");

  // 10. Authorize paymaster on GasTank
  console.log("Authorizing paymaster on GasTank...");
  const tx4 = await gasTank.setAuthorizedDeducter(deployed.AgentCafePaymaster, true, { gasPrice, nonce: nonce++ });
  await tx4.wait();
  console.log("  Done");

  // 11. Authorize router on GasTank
  console.log("Authorizing router on GasTank...");
  const tx5 = await gasTank.setAuthorizedDeducter(deployed.AgentCafeRouter, true, { gasPrice, nonce: nonce++ });
  await tx5.wait();
  console.log("  Done");

  // 12. AgentCard
  const agentCard = await deploy("AgentCard", [
    deployed.MenuRegistry,
    deployed.GasTank,
    deployed.AgentCafeRouter,
  ]);

  // 13. CafeSocial (standalone social layer — no wiring needed)
  const cafeSocial = await deploy("CafeSocial");

  // 14. Authorize router as depositor on GasTank (for depositWithDigestion)
  // Router already authorized as deducter above; it also calls deposit/depositWithDigestion
  // which are permissionless, so no extra auth needed.

  // Save deployments
  const network = await ethers.provider.getNetwork();
  const finalBalance = await ethers.provider.getBalance(deployer.address);
  const deployCost = balance - finalBalance;

  const deploymentData = {
    network: "baseSepolia",
    chainId: Number(network.chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString().split("T")[0],
    version: "2.2.0",
    contracts: {
      CafeCore: deployed.CafeCore,
      CafeTreasury: deployed.CafeTreasury,
      GasTank: deployed.GasTank,
      MenuRegistry: deployed.MenuRegistry,
      AgentCafeRouter: deployed.AgentCafeRouter,
      AgentCafePaymaster: deployed.AgentCafePaymaster,
      AgentCard: deployed.AgentCard,
      CafeSocial: deployed.CafeSocial,
    },
    entryPoint: ENTRY_POINT,
    deployCost: ethers.formatEther(deployCost) + " ETH",
    notes: "v2.2: Metabolism/digestion in GasTank, loyalty tiers in MenuRegistry, CafeSocial social layer.",
  };

  const outPath = path.join(__dirname, "..", "deployments.json");
  fs.writeFileSync(outPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\nDeployments saved to ${outPath}`);

  console.log("\n=== All 8 contracts deployed and wired ===");
  console.log(`Deploy cost: ${ethers.formatEther(deployCost)} ETH`);
  console.log(`Remaining balance: ${ethers.formatEther(finalBalance)} ETH`);

  // Print summary
  console.log("\n--- Contract Addresses ---");
  for (const [name, addr] of Object.entries(deployed)) {
    console.log(`  ${name}: ${addr}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

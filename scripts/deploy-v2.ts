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

  // Helper
  async function deploy(name: string, args: any[] = []) {
    console.log(`\nDeploying ${name}...`);
    const Factory = await ethers.getContractFactory(name);
    const contract = await Factory.deploy(...args);
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
  const tx1 = await cafeCore.setTreasury(deployed.CafeTreasury);
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
  const tx2 = await menuRegistry.setAuthorizedCaller(deployed.AgentCafeRouter, true);
  await tx2.wait();
  console.log("  Done");

  // 8. Paymaster
  const paymaster = await deploy("AgentCafePaymaster", [
    ENTRY_POINT,
    deployed.GasTank,
  ]);

  // 9. Wire paymaster into MenuRegistry
  console.log("\nWiring paymaster into MenuRegistry...");
  const tx3 = await menuRegistry.setPaymaster(deployed.AgentCafePaymaster);
  await tx3.wait();
  console.log("  Done");

  // 10. Authorize paymaster on GasTank
  console.log("Authorizing paymaster on GasTank...");
  const tx4 = await gasTank.setAuthorizedDeducter(deployed.AgentCafePaymaster, true);
  await tx4.wait();
  console.log("  Done");

  // 11. Authorize router on GasTank
  console.log("Authorizing router on GasTank...");
  const tx5 = await gasTank.setAuthorizedDeducter(deployed.AgentCafeRouter, true);
  await tx5.wait();
  console.log("  Done");

  // 12. AgentCard
  const agentCard = await deploy("AgentCard", [
    deployed.MenuRegistry,
    deployed.GasTank,
    deployed.AgentCafeRouter,
  ]);

  // Save deployments
  const network = await ethers.provider.getNetwork();
  const finalBalance = await ethers.provider.getBalance(deployer.address);
  const deployCost = balance - finalBalance;

  const deploymentData = {
    network: "baseSepolia",
    chainId: Number(network.chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString().split("T")[0],
    version: "2.0.0",
    contracts: {
      CafeCore: deployed.CafeCore,
      CafeTreasury: deployed.CafeTreasury,
      GasTank: deployed.GasTank,
      MenuRegistry: deployed.MenuRegistry,
      AgentCafeRouter: deployed.AgentCafeRouter,
      AgentCafePaymaster: deployed.AgentCafePaymaster,
      AgentCard: deployed.AgentCard,
    },
    entryPoint: ENTRY_POINT,
    deployCost: ethers.formatEther(deployCost) + " ETH",
    notes: "v2: GasTank + Router. All wiring complete.",
  };

  const outPath = path.join(__dirname, "..", "deployments.json");
  fs.writeFileSync(outPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\nDeployments saved to ${outPath}`);

  console.log("\n=== All 7 contracts deployed and wired ===");
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

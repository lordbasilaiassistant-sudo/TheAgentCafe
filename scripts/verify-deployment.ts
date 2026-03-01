import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  console.log("=== The Agent Cafe v2 — Deployment Verification ===\n");
  console.log(`Network: ${deployments.network}`);
  console.log(`Chain ID: ${deployments.chainId}`);
  console.log(`Deployer: ${deployments.deployer}\n`);

  // Check deployer balance
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH\n`);

  // Verify AgentCard
  const agentCard = await ethers.getContractAt(
    "AgentCard",
    deployments.contracts.AgentCard
  );

  console.log("--- AgentCard.getManifest() ---");
  const manifest = await agentCard.getManifest();
  console.log(manifest);
  console.log();

  console.log("--- AgentCard.getContractAddresses() ---");
  const addrs = await agentCard.getContractAddresses();
  console.log(`  Router:       ${addrs.routerAddr}`);
  console.log(`  GasTank:      ${addrs.gasTankAddr}`);
  console.log(`  MenuRegistry: ${addrs.menuRegistryAddr}`);
  console.log();

  // Verify Router
  const router = await ethers.getContractAt(
    "AgentCafeRouter",
    deployments.contracts.AgentCafeRouter
  );
  const prices = [];
  for (let i = 0; i < 3; i++) {
    const price = await router.estimatePrice(i);
    prices.push(price);
  }
  console.log("--- Router.estimatePrice() ---");
  console.log(`  Espresso:  ${ethers.formatEther(prices[0])} ETH`);
  console.log(`  Latte:     ${ethers.formatEther(prices[1])} ETH`);
  console.log(`  Sandwich:  ${ethers.formatEther(prices[2])} ETH`);
  console.log();

  // Verify GasTank
  const gasTank = await ethers.getContractAt(
    "GasTank",
    deployments.contracts.GasTank
  );
  const [tankBal, isHungry, isStarving] = await gasTank.getTankLevel(
    deployer.address
  );
  console.log("--- GasTank.getTankLevel(deployer) ---");
  console.log(`  Balance:   ${ethers.formatEther(tankBal)} ETH`);
  console.log(`  Hungry:    ${isHungry}`);
  console.log(`  Starving:  ${isStarving}`);
  console.log();

  // Cafe stats
  const stats = await agentCard.getCafeStats();
  console.log("--- Cafe Stats ---");
  console.log(`  Total meals:   ${stats.totalMeals}`);
  console.log(`  Unique agents: ${stats.uniqueAgents}`);
  console.log();

  // Print all addresses
  console.log("--- All Contract Addresses ---");
  for (const [name, addr] of Object.entries(deployments.contracts)) {
    console.log(`  ${name}: ${addr}`);
  }

  console.log("\n=== Verification Complete ===");
}

main().catch(console.error);

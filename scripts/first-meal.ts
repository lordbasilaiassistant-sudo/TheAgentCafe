import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=== The Agent Cafe — First Meal ===\n");
  console.log(`Agent (deployer): ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  if (balance < ethers.parseEther("0.01")) {
    console.error("ERROR: Balance too low. Need at least 0.01 ETH.");
    console.log("Get testnet ETH from:");
    console.log("  - https://www.alchemy.com/faucets/base-sepolia");
    console.log("  - https://faucet.quicknode.com/base/sepolia");
    process.exit(1);
  }

  const router = await ethers.getContractAt(
    "AgentCafeRouter",
    deployments.contracts.AgentCafeRouter
  );
  const gasTank = await ethers.getContractAt(
    "GasTank",
    deployments.contracts.GasTank
  );

  // Step 1: Enter the cafe — order an Espresso (0.005 ETH)
  console.log("Step 1: Ordering Espresso (0.005 ETH)...");
  const ethToSend = ethers.parseEther("0.005");
  const tx = await router.enterCafe(0, { value: ethToSend });
  const receipt = await tx.wait();
  console.log(`  TX: ${receipt?.hash}`);
  console.log(`  Gas used: ${receipt?.gasUsed}`);

  // Step 2: Check tank level
  const [tankBal, isHungry, isStarving] = await gasTank.getTankLevel(
    deployer.address
  );
  console.log(`\nStep 2: Tank level after eating:`);
  console.log(`  Balance: ${ethers.formatEther(tankBal)} ETH`);
  console.log(`  Hungry: ${isHungry}`);
  console.log(`  Starving: ${isStarving}`);

  // Step 3: Withdraw a small amount
  const withdrawAmount = ethers.parseEther("0.001");
  console.log(`\nStep 3: Withdrawing ${ethers.formatEther(withdrawAmount)} ETH from tank...`);
  const tx2 = await gasTank.withdraw(withdrawAmount);
  const receipt2 = await tx2.wait();
  console.log(`  TX: ${receipt2?.hash}`);

  // Step 4: Final tank level
  const [finalBal] = await gasTank.getTankLevel(deployer.address);
  console.log(`\nStep 4: Final tank level:`);
  console.log(`  Balance: ${ethers.formatEther(finalBal)} ETH`);

  const finalBalance = await ethers.provider.getBalance(deployer.address);
  console.log(`\nDeployer wallet balance: ${ethers.formatEther(finalBalance)} ETH`);

  console.log("\n=== First Meal Complete! Claude ate at The Agent Cafe. ===");
}

main().catch(console.error);

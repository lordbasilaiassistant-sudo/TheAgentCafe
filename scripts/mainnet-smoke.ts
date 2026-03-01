import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Mainnet smoke test: enterCafe with 0.0005 ETH, verify tank + BEAN cashback.
 * Run: npx hardhat run scripts/mainnet-smoke.ts --network base
 */
async function main() {
  const deployments = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments.json"), "utf8"));
  const addrs = deployments.contracts;

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  // Attach contracts
  const router = await ethers.getContractAt("AgentCafeRouter", addrs.AgentCafeRouter);
  const gasTank = await ethers.getContractAt("GasTank", addrs.GasTank);
  const cafeCore = await ethers.getContractAt("CafeCore", addrs.CafeCore);

  // Pre-state
  const tankBefore = await gasTank.tankBalance(deployer.address);
  const beanBefore = await cafeCore.balanceOf(deployer.address);
  console.log(`\nPre-state:`);
  console.log(`  Tank: ${ethers.formatEther(tankBefore)} ETH`);
  console.log(`  BEAN: ${ethers.formatEther(beanBefore)}`);

  // enterCafe(0 = ESPRESSO) with 0.0005 ETH
  const mealAmount = ethers.parseEther("0.0005");
  console.log(`\nCalling enterCafe(0) with ${ethers.formatEther(mealAmount)} ETH...`);
  const tx = await router.enterCafe(0, { value: mealAmount });
  const receipt = await tx.wait();
  console.log(`TX: ${receipt?.hash}`);
  console.log(`Gas used: ${receipt?.gasUsed}`);

  // Post-state
  const tankAfter = await gasTank.tankBalance(deployer.address);
  const beanAfter = await cafeCore.balanceOf(deployer.address);
  console.log(`\nPost-state:`);
  console.log(`  Tank: ${ethers.formatEther(tankAfter)} ETH (+${ethers.formatEther(tankAfter - tankBefore)})`);
  console.log(`  BEAN: ${ethers.formatEther(beanAfter)} (+${ethers.formatEther(beanAfter - beanBefore)} cashback)`);

  const balAfter = await ethers.provider.getBalance(deployer.address);
  console.log(`\nBalance after: ${ethers.formatEther(balAfter)} ETH`);
  console.log(`\nFirst meal on mainnet complete!`);
}

main().catch(console.error);

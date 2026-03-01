import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  if (balance < ethers.parseEther("0.01")) {
    console.log("\nWARNING: Balance too low for deployment.");
    console.log("Get testnet ETH from:");
    console.log("  https://www.alchemy.com/faucets/base-sepolia");
    console.log("  https://faucet.quicknode.com/base/sepolia");
  } else {
    console.log("\nBalance sufficient for deployment.");
  }
}

main().catch(console.error);

import { ethers } from "hardhat";

/**
 * Seed The Agent Cafe on Base mainnet with real on-chain activity.
 * Run: npx hardhat run scripts/seed-activity.ts --network base
 *
 * Meals 1 & 2 (Espresso + Latte) already completed in first run.
 * This run: Sandwich + CafeSocial checkIn + postMessage.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=== The Agent Cafe — Seed Activity (Base Mainnet) ===\n");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  // Contract addresses (Base mainnet)
  const ROUTER = "0xB923FCFDE8c40B8b9047916EAe5c580aa7679266";
  const CAFE_SOCIAL = "0xf4a3CA7c8ef35E8434dA9c1C67Ef30a58dcB33Ee";
  const GAS_TANK = "0xC369ba8d99908261b930F0255fe03218e5965258";
  const CAFE_CORE = "0x30eCCeD36E715e88c40A418E9325cA08a5085143";

  const router = await ethers.getContractAt("AgentCafeRouter", ROUTER);
  const cafeSocial = await ethers.getContractAt("CafeSocial", CAFE_SOCIAL);
  const gasTank = await ethers.getContractAt("GasTank", GAS_TANK);
  const cafeCore = await ethers.getContractAt("CafeCore", CAFE_CORE);

  // Check current BEAN supply and estimate prices
  const supply = await cafeCore.totalSupply();
  console.log(`Current BEAN supply: ${supply}`);
  const estSandwich = await router.estimatePrice(2);
  console.log(`Estimated ETH for Sandwich: ${ethers.formatEther(estSandwich)}`);

  // Get starting nonce
  let nonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
  console.log(`Starting nonce: ${nonce}\n`);

  const txHashes: string[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // --- 1. Eat Sandwich (menuItem 2) with 0.002 ETH (generous buffer) ---
  console.log("1/3  enterCafe(2) — Sandwich with 0.002 ETH...");
  const tx1 = await router.enterCafe(2, { value: ethers.parseEther("0.002"), nonce });
  const r1 = await tx1.wait();
  txHashes.push(r1!.hash);
  console.log(`     TX: ${r1!.hash}`);
  console.log(`     Gas: ${r1!.gasUsed}`);
  nonce++;
  await sleep(2000);

  // --- 2. Check in to the cafe ---
  console.log("2/3  checkIn()...");
  const tx2 = await cafeSocial.checkIn({ nonce });
  const r2 = await tx2.wait();
  txHashes.push(r2!.hash);
  console.log(`     TX: ${r2!.hash}`);
  console.log(`     Gas: ${r2!.gasUsed}`);
  nonce++;
  await sleep(2000);

  // --- 3. Post a chat message ---
  console.log("3/3  postMessage()...");
  const msg = "First message from the founder's agent. The cafe is open for business on Base mainnet.";
  const tx3 = await cafeSocial.postMessage(msg, { nonce });
  const r3 = await tx3.wait();
  txHashes.push(r3!.hash);
  console.log(`     TX: ${r3!.hash}`);
  console.log(`     Gas: ${r3!.gasUsed}`);
  nonce++;

  // --- Final balances ---
  console.log("\n=== Final State ===");
  const finalBalance = await ethers.provider.getBalance(deployer.address);
  const tankLevel = await gasTank.getTankLevel(deployer.address);
  const beanBalance = await cafeCore.balanceOf(deployer.address);

  console.log(`Wallet balance: ${ethers.formatEther(finalBalance)} ETH`);
  console.log(`Tank level:     ${ethers.formatEther(tankLevel[0])} ETH`);
  console.log(`BEAN balance:   ${beanBalance}`);
  console.log(`Total spent:    ${ethers.formatEther(balance - finalBalance)} ETH (incl. gas)`);

  console.log("\n=== All TX Hashes (this run) ===");
  txHashes.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));

  console.log("\n=== Previously completed (first run) ===");
  console.log("  1. 0x58643188c8ce25c3055a58578c7624b5bfb9cd88cb02e1dfc33f5a90f9e1e550 (Espresso)");
  console.log("  2. 0x26f9d01f561fecf2248cc028c4815035a66c0083077ba77e82a447facd0f0f21 (Latte)");

  console.log("\nSeed activity complete! The cafe is alive on Base mainnet.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

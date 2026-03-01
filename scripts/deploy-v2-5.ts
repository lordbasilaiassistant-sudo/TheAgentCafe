import { ethers } from "hardhat";

const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const GAS_OPTS = {
  maxFeePerGas: ethers.parseUnits("0.05", "gwei"),
  maxPriorityFeePerGas: ethers.parseUnits("0.01", "gwei"),
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
  const contract = await factory.deploy(...args, { nonce, ...GAS_OPTS });
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ${name}: ${addr}`);
  await sleep(2000);
  return contract;
}

async function sendTx(name: string, contract: any, method: string, args: any[]) {
  const nonce = nextNonce();
  console.log(`${name} at nonce ${nonce}...`);
  const tx = await contract[method](...args, { nonce, ...GAS_OPTS });
  await tx.wait();
  console.log(`  ${name} done`);
  await sleep(2000);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const balBefore = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balBefore), "ETH");
  console.log("---");

  await initNonce(deployer);

  // 1. CafeCore
  const cafeCore = await deployContract("CafeCore",
    await ethers.getContractFactory("CafeCore"), []);

  // 2. CafeTreasury
  const cafeTreasury = await deployContract("CafeTreasury",
    await ethers.getContractFactory("CafeTreasury"), [await cafeCore.getAddress()]);

  // 3. Wire treasury
  await sendTx("Wire treasury", cafeCore, "setTreasury", [await cafeTreasury.getAddress()]);

  // 4. GasTank
  const gasTank = await deployContract("GasTank",
    await ethers.getContractFactory("GasTank"), []);

  // 5. MenuRegistry
  const menuRegistry = await deployContract("MenuRegistry",
    await ethers.getContractFactory("MenuRegistry"),
    [await cafeCore.getAddress(), await cafeTreasury.getAddress()]);

  // 6. Router
  const router = await deployContract("AgentCafeRouter",
    await ethers.getContractFactory("AgentCafeRouter"),
    [await cafeCore.getAddress(), await menuRegistry.getAddress(), await gasTank.getAddress(), await cafeTreasury.getAddress()]);

  // 7. Authorize router on MenuRegistry
  await sendTx("Authorize router on MenuRegistry", menuRegistry, "setAuthorizedCaller",
    [await router.getAddress(), true]);

  // 8. Paymaster
  const paymaster = await deployContract("AgentCafePaymaster",
    await ethers.getContractFactory("AgentCafePaymaster"),
    [ENTRY_POINT_V07, await gasTank.getAddress()]);

  // 9. Wire paymaster on MenuRegistry
  await sendTx("Wire paymaster on MenuRegistry", menuRegistry, "setPaymaster",
    [await paymaster.getAddress()]);

  // 10. Authorize paymaster on GasTank
  await sendTx("Authorize paymaster on GasTank", gasTank, "setAuthorizedDeducter",
    [await paymaster.getAddress(), true]);

  // 11. Authorize router on GasTank
  await sendTx("Authorize router on GasTank", gasTank, "setAuthorizedDeducter",
    [await router.getAddress(), true]);

  // 12. CafeSocial
  const cafeSocial = await deployContract("CafeSocial",
    await ethers.getContractFactory("CafeSocial"), []);

  // 13. AgentCard (needs CafeSocial address)
  const agentCard = await deployContract("AgentCard",
    await ethers.getContractFactory("AgentCard"),
    [await menuRegistry.getAddress(), await gasTank.getAddress(), await router.getAddress(), await cafeSocial.getAddress()]);

  // Cost summary
  const balAfter = await ethers.provider.getBalance(deployer.address);
  const cost = balBefore - balAfter;
  console.log("\n--- DEPLOYMENT COST ---");
  console.log("Total cost:", ethers.formatEther(cost), "ETH");
  console.log("Remaining:", ethers.formatEther(balAfter), "ETH");

  const addresses = {
    CafeCore: await cafeCore.getAddress(),
    CafeTreasury: await cafeTreasury.getAddress(),
    GasTank: await gasTank.getAddress(),
    MenuRegistry: await menuRegistry.getAddress(),
    AgentCafeRouter: await router.getAddress(),
    AgentCafePaymaster: await paymaster.getAddress(),
    AgentCard: await agentCard.getAddress(),
    CafeSocial: await cafeSocial.getAddress(),
  };
  console.log("\n--- ADDRESSES (v2.5) ---");
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch(console.error);

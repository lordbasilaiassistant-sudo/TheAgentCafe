import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const EXISTING = {
  CafeCore: "0x30eCCeD36E715e88c40A418E9325cA08a5085143",
  CafeTreasury: "0x600f6Ee140eadf39D3b038c3d907761994aA28D0",
  GasTank: "0xC369ba8d99908261b930F0255fe03218e5965258",
  MenuRegistry: "0x2F604e61f0843Ac99bd0d4a8b5736c1FCEAb7258",
  AgentCafeRouter: "0x9C21dB53203F00BeE73341D6BA8D6C8D61bd1De4",
  AgentCafePaymaster: "0x5fA91E27F81d3a11014104A28D92b35a5dDA1997",
  AgentCard: "0xd4c19e7cEDa32A306cc36cdD8a09E86b2e69425C",
  CafeSocial: "0xf4a3CA7c8ef35E8434dA9c1C67Ef30a58dcB33Ee",
};

const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

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

  console.log(`\n=== CAFE RELAY DEPLOY ===`);
  console.log(`Network: ${networkName} (chainId: ${chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balBefore), "ETH");
  console.log("\nDeploying: CafeRelay");
  console.log("Wiring: GasTank.setAuthorizedDeducter(CafeRelay, true)");
  console.log("---");

  await initNonce(deployer);

  // 1. Deploy CafeRelay
  const cafeRelay = await deployContract("CafeRelay",
    await ethers.getContractFactory("CafeRelay"),
    [EXISTING.GasTank]);

  const cafeRelayAddr = await cafeRelay.getAddress();

  // 2. Authorize CafeRelay as deducter on GasTank
  const gasTank = await ethers.getContractAt("GasTank", EXISTING.GasTank);
  await sendTx("Authorize CafeRelay on GasTank", gasTank, "setAuthorizedDeducter",
    [cafeRelayAddr, true]);

  // Cost summary
  const balAfter = await ethers.provider.getBalance(deployer.address);
  const cost = balBefore - balAfter;
  console.log("\n--- DEPLOYMENT COST ---");
  console.log("Total cost:", ethers.formatEther(cost), "ETH");
  console.log("Remaining:", ethers.formatEther(balAfter), "ETH");

  // Update deployments.json
  const deploymentsPath = path.resolve(__dirname, "..", "deployments.json");
  const existing = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
  existing.contracts.CafeRelay = cafeRelayAddr;
  existing.version = "4.1.0";
  existing.deployCost = `${ethers.formatEther(cost)} ETH (relay only)`;
  existing.notes = `v4.1: CafeRelay for EOA gas sponsorship. 1 deploy + 1 wiring tx.`;
  fs.writeFileSync(deploymentsPath, JSON.stringify(existing, null, 2) + "\n");
  console.log(`\nUpdated ${deploymentsPath}`);

  // All addresses
  const allAddresses = { ...EXISTING, CafeRelay: cafeRelayAddr };
  console.log("\n--- ALL ADDRESSES ---");
  console.log(JSON.stringify(allAddresses, null, 2));

  // Verification command
  const explorerBase = networkName === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";
  console.log("\n--- VERIFICATION ---");
  console.log(`npx hardhat verify --network ${networkName} ${cafeRelayAddr} ${EXISTING.GasTank}`);
  console.log(`\nView: ${explorerBase}/address/${cafeRelayAddr}`);

  // Quick verify
  console.log("\n--- QUICK VERIFICATION ---");
  const isAuthorized = await gasTank.authorizedDeducters(cafeRelayAddr);
  console.log(`GasTank authorizedDeducters(CafeRelay): ${isAuthorized}`);
  const domainSep = await cafeRelay.getDomainSeparator();
  console.log(`CafeRelay domain separator: ${domainSep}`);
}

main().catch(console.error);

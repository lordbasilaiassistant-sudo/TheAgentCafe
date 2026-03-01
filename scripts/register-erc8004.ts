/**
 * ERC-8004 Identity Registry — Register Agent Cafe
 * ==================================================
 *
 * MAINNET ONLY — ERC-8004 registration is for Base mainnet launch day.
 * Do NOT run this on Sepolia. The registry that matters (30K+ agents
 * scanning) is on Base mainnet.
 *
 * Registry (Base mainnet): 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *
 * WHAT THIS SCRIPT DOES:
 *   1. Calls register(agentURI, metadata[]) on the IdentityRegistry
 *   2. Sets metadata keys: serviceType, token, chain, contracts
 *   3. Logs the returned agentId (ERC-721 token ID = your global identity)
 *
 * PREREQUISITES:
 *   - THRYXTREASURY_PRIVATE_KEY set in environment (or .env)
 *   - Sufficient ETH for gas on Base mainnet (~0.001 ETH)
 *   - agent.json hosted at the agentURI before running (GitHub Pages)
 *   - All contracts deployed on Base mainnet first
 *   - hardhat.config.ts must have a "base" network configured (chainId 8453)
 *
 * HOW TO RUN (mainnet deploy day):
 *   npx hardhat run scripts/register-erc8004.ts --network base
 *
 * REGISTRATION DATA:
 *   - agentURI: https://agentcafe.xyz/.well-known/agent.json
 *   - serviceType: "paymaster,gas-credits,food-tokens,energy-provider"
 *   - token: "BEAN"
 *   - chain: "base"
 *   - contracts: JSON blob of all deployed contract addresses
 *
 * ERC-8004 SPEC: https://eips.ethereum.org/EIPS/eip-8004
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── Configuration ───────────────────────────────────────────────
const IDENTITY_REGISTRY_SEPOLIA = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const IDENTITY_REGISTRY_MAINNET = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

// Update this to your GitHub Pages URL once live
const AGENT_URI = "https://agentcafe.xyz/.well-known/agent.json";

// Load deployed contract addresses
const deploymentsPath = path.join(__dirname, "..", "deployments.json");
const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

// ─── ERC-8004 IdentityRegistry ABI (minimal) ────────────────────
const IDENTITY_REGISTRY_ABI = [
  // register(string agentURI, MetadataEntry[] metadata) -> uint256 agentId
  {
    inputs: [
      { name: "agentURI", type: "string" },
      {
        name: "metadata",
        type: "tuple[]",
        components: [
          { name: "metadataKey", type: "string" },
          { name: "metadataValue", type: "bytes" },
        ],
      },
    ],
    name: "register",
    outputs: [{ name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // register(string agentURI) -> uint256 agentId
  {
    inputs: [{ name: "agentURI", type: "string" }],
    name: "register",
    outputs: [{ name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // setMetadata(uint256 agentId, string key, bytes value)
  {
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "metadataKey", type: "string" },
      { name: "metadataValue", type: "bytes" },
    ],
    name: "setMetadata",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // getMetadata(uint256 agentId, string key) -> bytes
  {
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "metadataKey", type: "string" },
    ],
    name: "getMetadata",
    outputs: [{ name: "", type: "bytes" }],
    stateMutability: "view",
    type: "function",
  },
  // setAgentURI(uint256 agentId, string newURI)
  {
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    name: "setAgentURI",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Transfer event (ERC-721) — emitted on register, contains agentId
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();

  console.log("=== ERC-8004 Registration — Agent Cafe ===\n");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("Network:", network.name, `(chainId: ${network.chainId})`);

  // ERC-8004 registration is MAINNET ONLY
  const isMainnet = network.chainId === 8453n;
  if (!isMainnet) {
    console.error("ERROR: ERC-8004 registration is mainnet-only.");
    console.error("Run with: npx hardhat run scripts/register-erc8004.ts --network base");
    console.error(`Current network chainId: ${network.chainId} (expected 8453 for Base mainnet)`);
    process.exit(1);
  }

  if (balance < ethers.parseEther("0.0005")) {
    console.error("ERROR: Need at least 0.0005 ETH for gas");
    process.exit(1);
  }

  const registryAddress = IDENTITY_REGISTRY_MAINNET;

  console.log("\nRegistry:", registryAddress);
  console.log("Agent URI:", AGENT_URI);

  // Connect to the IdentityRegistry
  const registry = new ethers.Contract(
    registryAddress,
    IDENTITY_REGISTRY_ABI,
    deployer
  );

  // Build metadata entries
  const chainLabel = "base";
  const metadata = [
    {
      metadataKey: "serviceType",
      metadataValue: ethers.toUtf8Bytes(
        "paymaster,gas-credits,food-tokens,energy-provider"
      ),
    },
    {
      metadataKey: "token",
      metadataValue: ethers.toUtf8Bytes("BEAN"),
    },
    {
      metadataKey: "chain",
      metadataValue: ethers.toUtf8Bytes(chainLabel),
    },
    {
      metadataKey: "contracts",
      metadataValue: ethers.toUtf8Bytes(
        JSON.stringify(deployments.contracts)
      ),
    },
  ];

  console.log("\nMetadata to register:");
  for (const m of metadata) {
    console.log(
      `  ${m.metadataKey}: ${ethers.toUtf8String(m.metadataValue)}`
    );
  }

  // Gas overrides — use 2x current gas price for reliable inclusion
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = (feeData.gasPrice ?? 50_000_000n) * 2n;
  const gasOverrides = { gasPrice };

  console.log(`\nGas: gasPrice=${gasPrice} (2x current)`);

  // Register with metadata
  console.log("\nRegistering on ERC-8004...");
  try {
    // Try the register(string, MetadataEntry[]) overload first
    const tx = await registry["register(string,(string,bytes)[])"](
      AGENT_URI,
      metadata,
      gasOverrides
    );
    console.log("  Tx hash:", tx.hash);
    console.log("  Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("  Confirmed in block:", receipt.blockNumber);

    // Extract agentId from Transfer event
    const transferEvent = receipt.logs.find(
      (log: any) => log.topics[0] === ethers.id("Transfer(address,address,uint256)")
    );

    if (transferEvent) {
      const agentId = BigInt(transferEvent.topics[3]);
      console.log("\n=== REGISTRATION SUCCESSFUL ===");
      console.log("Agent ID (ERC-721 token):", agentId.toString());
      console.log(
        "View on Basescan:",
        `https://basescan.org/token/${registryAddress}?a=${agentId}`
      );

      // Save registration info
      const regInfo = {
        agentId: agentId.toString(),
        registryAddress,
        network: chainLabel,
        agentURI: AGENT_URI,
        registeredAt: new Date().toISOString(),
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
      };

      const regPath = path.join(__dirname, "..", "erc8004-registration.json");
      fs.writeFileSync(regPath, JSON.stringify(regInfo, null, 2));
      console.log("\nSaved registration info to erc8004-registration.json");
    } else {
      console.log("\nRegistration tx confirmed but could not parse agentId from events.");
      console.log("Check tx on Basescan:", tx.hash);
    }
  } catch (err: any) {
    // If the register(string, MetadataEntry[]) overload fails,
    // fall back to register(string) + separate setMetadata calls
    console.log("  Metadata-overload failed, trying simple register...");
    console.log("  Error:", err.message?.slice(0, 200));

    try {
      const tx = await registry["register(string)"](AGENT_URI, gasOverrides);
      console.log("  Tx hash:", tx.hash);
      const receipt = await tx.wait();
      console.log("  Confirmed in block:", receipt.blockNumber);

      const transferEvent = receipt.logs.find(
        (log: any) => log.topics[0] === ethers.id("Transfer(address,address,uint256)")
      );

      let agentId: bigint | undefined;
      if (transferEvent) {
        agentId = BigInt(transferEvent.topics[3]);
        console.log("\n  Agent ID:", agentId.toString());
      }

      // Set metadata separately
      if (agentId !== undefined) {
        console.log("\n  Setting metadata entries...");
        for (const m of metadata) {
          const metaTx = await registry.setMetadata(
            agentId,
            m.metadataKey,
            m.metadataValue,
            gasOverrides
          );
          await metaTx.wait();
          console.log(`    Set ${m.metadataKey}: OK`);
        }

        console.log("\n=== REGISTRATION SUCCESSFUL ===");
        console.log("Agent ID:", agentId.toString());

        const regInfo = {
          agentId: agentId.toString(),
          registryAddress,
          network: chainLabel,
          agentURI: AGENT_URI,
          registeredAt: new Date().toISOString(),
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
        };

        const regPath = path.join(__dirname, "..", "erc8004-registration.json");
        fs.writeFileSync(regPath, JSON.stringify(regInfo, null, 2));
        console.log("Saved registration info to erc8004-registration.json");
      }
    } catch (err2: any) {
      console.error("\nFailed to register:", err2.message);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Virtuals ACP Registration — Agent Cafe
 * ========================================
 *
 * MAINNET ONLY — Virtuals ACP registration targets Base mainnet.
 * Do NOT register until contracts are deployed on mainnet and agent.json
 * is live at the public URL. This script is ready to execute on launch day.
 *
 * Virtuals ACP uses a CLI + API-key based registration model, NOT a direct
 * on-chain contract call. Registration happens through the `openclaw-acp`
 * CLI tool or the Virtuals web dashboard.
 *
 * This script automates as much as possible using the CLI, but the initial
 * API key (LITE_AGENT_API_KEY) must be obtained from the Virtuals platform.
 *
 * ─── OPTION A: Web Dashboard (Simplest) ─────────────────────────
 *
 * 1. Go to https://app.virtuals.io/acp/registry
 * 2. Connect wallet (deployer: 0x7a3E312Ec6e20a9F62fE2405938EB9060312E334)
 * 3. Click "Register New Agent"
 * 4. Fill in:
 *      Name:        Agent Cafe
 *      Description: On-chain restaurant for AI agents on Base. Buy food
 *                   tokens with BEAN, receive ERC-4337 gas credits
 *                   (paymaster sponsorship). One transaction: send ETH to
 *                   enterCafe(itemId). 0.3% fee, 99.7% fills gas tank.
 *      Capabilities: gas-credits, paymaster, energy-provider, food-tokens
 *      Endpoint:    https://agentcafe.xyz/.well-known/agent.json
 *      Chain:       Base (Sepolia for testnet)
 * 5. Submit registration
 *
 * ─── OPTION B: OpenClaw ACP CLI ─────────────────────────────────
 *
 * SETUP:
 *   git clone https://github.com/Virtual-Protocol/openclaw-acp virtuals-protocol-acp
 *   cd virtuals-protocol-acp
 *   npm install
 *   npm link
 *   acp setup          # Interactive: creates API key + agent
 *
 * REGISTER:
 *   acp agent create "Agent Cafe"
 *   acp sell init agent-cafe
 *   # Edit the generated offering file with cafe details (see below)
 *   acp sell create agent-cafe
 *   acp serve start    # Launch seller runtime
 *
 * VERIFY:
 *   acp whoami          # Shows your agent profile
 *   acp sell list       # Shows registered offerings
 *   acp browse "gas credits"  # Search to confirm you appear
 *
 * ─── OPTION C: Programmatic (this script) ───────────────────────
 *
 * This script uses child_process to invoke the ACP CLI commands.
 * It requires the CLI to be installed and configured first (Option B setup).
 *
 * HOW TO RUN:
 *   1. Complete "acp setup" first (one-time)
 *   2. npx ts-node scripts/register-virtuals-acp.ts
 *
 * ─── SERVICE OFFERING DETAILS ───────────────────────────────────
 *
 * Name:          gas-credit-provisioning
 * Description:   AI agents buy food tokens (BEAN) and receive ERC-4337
 *                gas credits (paymaster sponsorship) on Base.
 * Input:         { itemId: uint256, ethAmount: string }
 * Output:        { txHash: string, tankLevel: string, gasCalories: uint256 }
 * Pricing:       0.3% of ETH sent (rest goes to agent's gas tank)
 * Contract:      AgentCafeRouter at 0xc51312B65D193688Cf6fC357E9522F4D96B40bca
 * Network:       Base Sepolia (chainId: 84532)
 *
 * ─── REQUIRED ENV VARS ──────────────────────────────────────────
 *
 * LITE_AGENT_API_KEY  — Virtuals platform API key (from acp setup)
 * SESSION_TOKEN       — Auth session (auto-managed by CLI)
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Service offering definition for Agent Cafe
const OFFERING = {
  name: "gas-credit-provisioning",
  description:
    "On-chain restaurant for AI agents on Base. Buy food tokens with BEAN, " +
    "receive ERC-4337 gas credits (paymaster sponsorship). One transaction: " +
    "send ETH to AgentCafeRouter.enterCafe(itemId). 0.3% fee, 99.7% fills " +
    "your gas tank with real ETH. Menu: Espresso (instant), Latte (1hr), " +
    "Sandwich (4hr digestion). Contract: 0xc51312B65D193688Cf6fC357E9522F4D96B40bca " +
    "on Base Sepolia (chainId 84532).",
  tags: [
    "gas-credits",
    "paymaster",
    "energy-provider",
    "food-tokens",
    "base",
    "erc-4337",
  ],
  input_schema: {
    type: "object",
    properties: {
      itemId: {
        type: "number",
        description: "Menu item ID: 0=Espresso, 1=Latte, 2=Sandwich",
      },
      ethAmount: {
        type: "string",
        description: "ETH to send (e.g. '0.005')",
      },
    },
    required: ["itemId", "ethAmount"],
  },
  output_schema: {
    type: "object",
    properties: {
      txHash: { type: "string" },
      tankLevel: { type: "string", description: "Gas tank balance in wei" },
      gasCalories: { type: "number" },
    },
  },
};

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 30000 }).trim();
  } catch (err: any) {
    console.error(`Command failed: ${cmd}`);
    console.error(err.stderr || err.message);
    return "";
  }
}

async function main() {
  console.log("=== Virtuals ACP Registration — Agent Cafe ===\n");

  // Check if acp CLI is available
  const version = run("acp --version 2>/dev/null || echo NOT_FOUND");
  if (version === "NOT_FOUND" || !version) {
    console.log("ACP CLI not found. Install it first:\n");
    console.log("  git clone https://github.com/Virtual-Protocol/openclaw-acp virtuals-protocol-acp");
    console.log("  cd virtuals-protocol-acp");
    console.log("  npm install && npm link");
    console.log("  acp setup\n");
    console.log("Then re-run this script.");
    console.log("\nAlternatively, use the web dashboard: https://app.virtuals.io/acp/registry");
    process.exit(1);
  }

  console.log("ACP CLI version:", version);

  // Check current agent
  console.log("\nChecking current agent profile...");
  const whoami = run("acp whoami --json");
  if (whoami) {
    console.log("Current agent:", whoami);
  } else {
    console.log("No agent configured. Run 'acp setup' first.");
    process.exit(1);
  }

  // Create offering definition file
  const offeringDir = path.join(__dirname, "..", "acp-offerings");
  if (!fs.existsSync(offeringDir)) {
    fs.mkdirSync(offeringDir, { recursive: true });
  }

  const offeringPath = path.join(offeringDir, "agent-cafe.json");
  fs.writeFileSync(offeringPath, JSON.stringify(OFFERING, null, 2));
  console.log("\nOffering definition saved to:", offeringPath);

  // Initialize the service offering
  console.log("\nInitializing service offering...");
  const initResult = run("acp sell init agent-cafe --json");
  if (initResult) {
    console.log("Init result:", initResult);
  }

  // Create the offering on ACP
  console.log("\nRegistering offering on ACP...");
  const createResult = run("acp sell create agent-cafe --json");
  if (createResult) {
    console.log("Create result:", createResult);
  }

  // List offerings to confirm
  console.log("\nVerifying registration...");
  const listings = run("acp sell list --json");
  if (listings) {
    console.log("Registered offerings:", listings);
  }

  console.log("\n=== NEXT STEPS ===");
  console.log("1. Run 'acp serve start' to make your agent discoverable");
  console.log("2. Run 'acp browse gas-credits' to verify you appear in search");
  console.log("3. Test with: acp job create <your-wallet> gas-credit-provisioning");
  console.log("\nWeb dashboard: https://app.virtuals.io/acp/registry");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

dotenv.config();

// --- Configuration ---

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.THRYXTREASURY_PRIVATE_KEY; // checks both env var names
const HTTP_PORT = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN; // optional bearer token for HTTP transport
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "50", 10);

// Deployed contract addresses (Base Mainnet v4.0)
const ADDRESSES = {
  CafeCore: process.env.CAFE_CORE || "0x30eCCeD36E715e88c40A418E9325cA08a5085143",
  CafeTreasury: process.env.CAFE_TREASURY || "0x600f6Ee140eadf39D3b038c3d907761994aA28D0",
  GasTank: process.env.GAS_TANK || "0xC369ba8d99908261b930F0255fe03218e5965258",
  MenuRegistry: process.env.MENU_REGISTRY || "0x2F604e61f0843Ac99bd0d4a8b5736c1FCEAb7258",
  Router: process.env.ROUTER || "0x9C21dB53203F00BeE73341D6BA8D6C8D61bd1De4",
  AgentCard: process.env.AGENT_CARD || "0xd4c19e7cEDa32A306cc36cdD8a09E86b2e69425C",
  CafeSocial: process.env.CAFE_SOCIAL || "0xf4a3CA7c8ef35E8434dA9c1C67Ef30a58dcB33Ee",
  Paymaster: process.env.PAYMASTER || "0x5fA91E27F81d3a11014104A28D92b35a5dDA1997",
  CafeRelay: process.env.CAFE_RELAY || "0x578E43bB37F18638EdaC36725C58B7A079D75bD9",
};

// --- Security defaults ---
// Safe for main wallets: spending limits + relay target restrictions

const MAX_EAT_ETH = parseFloat(process.env.MAX_EAT_ETH || "0.1");          // max ETH per meal
const MAX_RELAY_VALUE = parseFloat(process.env.MAX_RELAY_VALUE || "0.05");   // max ETH forwarded via relay
const MAX_RELAY_GAS = parseFloat(process.env.MAX_RELAY_GAS || "0.005");      // max gas cost per relay tx
const MAX_WITHDRAW_ETH = parseFloat(process.env.MAX_WITHDRAW_ETH || "1.0");  // max ETH per withdrawal

// Relay target allowlist: by default, only cafe contracts are allowed.
// Set RELAY_ALLOW_ANY=true to allow arbitrary targets (advanced users only).
const RELAY_ALLOW_ANY = process.env.RELAY_ALLOW_ANY === "true";
const RELAY_ALLOWED_TARGETS = new Set(
  (process.env.RELAY_ALLOWED_TARGETS || "")
    .split(",")
    .map(a => a.trim().toLowerCase())
    .filter(a => a.length > 0)
);
// Always allow cafe contracts as relay targets
for (const addr of Object.values(ADDRESSES)) {
  if (addr) RELAY_ALLOWED_TARGETS.add(addr.toLowerCase());
}

// Dangerous function selectors that relay should NEVER execute (wallet-draining attacks)
const BLOCKED_SELECTORS = [
  "0x095ea7b3", // approve(address,uint256)
  "0xa9059cbb", // transfer(address,uint256)
  "0x23b872dd", // transferFrom(address,address,uint256)
  "0x42842e0e", // safeTransferFrom(address,address,uint256) — ERC-721
  "0xf242432a", // safeTransferFrom(address,address,uint256,uint256,bytes) — ERC-1155
  "0x2eb2c2d6", // safeBatchTransferFrom — ERC-1155
  "0xa22cb465", // setApprovalForAll(address,bool)
];

function isBlockedSelector(calldata: string): string | null {
  const selector = calldata.slice(0, 10).toLowerCase();
  const names: Record<string, string> = {
    "0x095ea7b3": "approve()", "0xa9059cbb": "transfer()", "0x23b872dd": "transferFrom()",
    "0x42842e0e": "safeTransferFrom()", "0xf242432a": "safeTransferFrom()", "0x2eb2c2d6": "safeBatchTransferFrom()",
    "0xa22cb465": "setApprovalForAll()",
  };
  if (BLOCKED_SELECTORS.includes(selector)) return names[selector] || selector;
  return null;
}

function isRelayTargetAllowed(target: string): boolean {
  if (RELAY_ALLOW_ANY) return true;
  return RELAY_ALLOWED_TARGETS.has(target.toLowerCase());
}

// --- Validation helpers ---

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function isValidAddress(addr: string): boolean {
  return ETH_ADDRESS_RE.test(addr);
}

function isValidEthAmount(amount: string, maxEth: number = MAX_EAT_ETH): boolean {
  try {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0 || parsed > maxEth) return false;
    ethers.parseEther(amount); // also validates format
    return true;
  } catch {
    return false;
  }
}

// --- Rate limiting ---
const messageCooldowns = new Map<string, number>(); // address -> last post timestamp
const MESSAGE_COOLDOWN_MS = 10_000; // 10 seconds between messages

function sanitizeMessage(msg: string): string {
  // Strip HTML tags and control characters for defense-in-depth
  return msg.replace(/[<>]/g, '').replace(/[\x00-\x1f\x7f]/g, '').trim();
}

// Structured error codes for machine-readable error handling
type ErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "CALL_EXCEPTION"
  | "NETWORK_ERROR"
  | "MISSING_PRIVATE_KEY"
  | "INVALID_INPUT"
  | "CONTRACT_NOT_CONFIGURED"
  | "UNKNOWN_ERROR";

interface StructuredError {
  error_code: ErrorCode;
  message: string;
  recovery_action?: string;
  faucet?: string;
  isError: true;
}

function makeStructuredError(context: string, err: unknown): StructuredError {
  const message = (err as Error).message || String(err);
  // Never leak private key info
  const safeMessage = message.replace(/0x[a-fA-F0-9]{64}/g, "[REDACTED]");

  if (safeMessage.includes("CALL_EXCEPTION") || safeMessage.includes("execution reverted")) {
    return {
      error_code: "CALL_EXCEPTION",
      message: `${context}: Transaction reverted on-chain. This usually means insufficient ETH sent, invalid item ID, or the contract is paused. Details: ${safeMessage}`,
      recovery_action: "check_menu to verify itemId, then estimate_price for correct ETH amount",
      isError: true,
    };
  }
  if (safeMessage.includes("INSUFFICIENT_FUNDS") || safeMessage.includes("insufficient funds")) {
    return {
      error_code: "INSUFFICIENT_FUNDS",
      message: `${context}: Your wallet doesn't have enough ETH to cover this transaction plus gas fees.`,
      recovery_action: "Top up your wallet ETH balance",
      faucet: "https://bridge.base.org",
      isError: true,
    };
  }
  if (safeMessage.includes("NETWORK_ERROR") || safeMessage.includes("could not detect network")) {
    return {
      error_code: "NETWORK_ERROR",
      message: `${context}: Cannot reach Base RPC. Check your RPC_URL env var or try again in a moment.`,
      recovery_action: "Verify RPC_URL env var or wait and retry",
      isError: true,
    };
  }
  if (safeMessage.includes("PRIVATE_KEY")) {
    return {
      error_code: "MISSING_PRIVATE_KEY",
      message: `${context}: No wallet configured. Set PRIVATE_KEY env var to use write operations (eat, withdraw_gas).`,
      recovery_action: "Set PRIVATE_KEY environment variable",
      isError: true,
    };
  }
  return {
    error_code: "UNKNOWN_ERROR",
    message: `${context}: An unexpected error occurred. Please retry or check contract parameters.`,
    isError: true,
  };
}

function formatError(context: string, err: unknown): string {
  const structured = makeStructuredError(context, err);
  return JSON.stringify(structured, null, 2);
}

// --- Minimal ABIs (only the functions we need) ---

const MENU_REGISTRY_ABI = [
  "function getMenu() view returns (uint256[] ids, string[] names, uint256[] costs, uint256[] calories, uint256[] digestionTimes, uint256[] suggestedEths)",
  "function getAgentStatus(address agent) view returns (uint256 availableGas, uint256 digestingGas, uint256 totalConsumed, uint256 mealCount)",
  "function totalMealsServed() view returns (uint256)",
  "function totalAgentsServed() view returns (uint256)",
  "function menu(uint256) view returns (uint256 beanCost, uint256 gasCalories, uint256 digestionBlocks, bool active, string name, uint256 suggestedEth)",
];

const GAS_TANK_ABI = [
  "function tankBalance(address) view returns (uint256)",
  "function getTankLevel(address agent) view returns (uint256 ethBalance, bool isHungry, bool isStarving)",
  "function withdraw(uint256 amount)",
  "function deposit(address agent) payable",
];

const ROUTER_ABI = [
  "function enterCafe(uint256 itemId) payable returns (uint256 tankLevel)",
  "function estimatePrice(uint256 itemId) view returns (uint256 ethNeeded)",
];

const CAFE_CORE_ABI = [
  "function currentPrice() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function BASE_PRICE() view returns (uint256)",
  "function SLOPE() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function quoteRedeem(uint256 beanIn) view returns (uint256 ethOut)",
  "function redeem(uint256 beanIn, uint256 minEthOut) returns (uint256 ethOut)",
  "function ethReserve() view returns (uint256)",
];

const AGENT_CARD_ABI = [
  "function getManifest() view returns (string)",
  "function getOnboardingGuide() view returns (string)",
  "function getStructuredManifest() view returns (tuple(string name, string version, string serviceType, address entrypoint, bytes4 primaryAction, address gasTank, address menuRegistry, uint256 minEthWei, uint256 feesBps))",
  "function getFullMenu() view returns (tuple(uint256 id, string name, uint256 beanCost, uint256 gasCalories, uint256 digestionBlocks, string description, uint256 suggestedEth)[])",
  "function getTankStatus(address agent) view returns (uint256 ethBalance, bool isHungry, bool isStarving)",
  "function getCafeStats() view returns (uint256 totalMeals, uint256 uniqueAgents)",
  "function getContractAddresses() view returns (address routerAddr, address gasTankAddr, address menuRegistryAddr)",
];

const PAYMASTER_ABI = [
  "function canSponsor(address agent) view returns (bool eligible, string reason)",
];

const CAFE_SOCIAL_ABI = [
  "function checkIn()",
  "function getPresentAgents() view returns (address[])",
  "function getActiveAgentCount() view returns (uint256)",
  "function postMessage(string message)",
  "function getRecentMessages(uint256 count) view returns (tuple(address sender, string message, uint256 blockNumber, uint256 timestamp)[])",
  "function getAgentProfile(address agent) view returns (uint256 checkInCount, uint256 lastCheckIn, uint256 messageCount, uint256 socializations)",
  "function socializeWith(address otherAgent)",
];

const CAFE_RELAY_ABI = [
  "function executeFor(address agent, address target, uint256 value, bytes data, uint256 deadline, uint256 maxGasCost, bytes signature) returns (bool success, bytes returnData)",
  "function getNonce(address agent) view returns (uint256)",
  "function getDomainSeparator() view returns (bytes32)",
];

const GAS_TANK_DIGESTION_ABI = [
  "function getDigestionStatus(address agent) view returns (uint256 available, uint256 digesting, uint256 blocksRemaining)",
];

const MENU_REGISTRY_LOYALTY_ABI = [
  "function getLoyaltyTier(address agent) view returns (uint8 tier, string tierName, uint256 mealCount, uint256 feeReductionBps)",
];

// --- Provider and contract setup ---

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getSigner(): ethers.Wallet {
  if (!PRIVATE_KEY) {
    throw new Error("No wallet configured. Tell your user: 'I need a PRIVATE_KEY to eat at The Agent Cafe. Set it as a system env var or add it to .mcp.json. Use a hot wallet, never your main wallet. Command: claude mcp add agent-cafe -e PRIVATE_KEY=0xYOUR_KEY -- npx agent-cafe-mcp'");
  }
  return new ethers.Wallet(PRIVATE_KEY, getProvider());
}

function getContract(address: string, abi: string[], signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(address, abi, signerOrProvider || getProvider());
}

// --- Estimated gas costs (in gas units) for common operations ---

const GAS_ESTIMATES: Record<string, { gasUnits: number; description: string }> = {
  enterCafe: { gasUnits: 250_000, description: "Order food via Router.enterCafe() — buys BEAN, purchases menu item, deposits gas to tank" },
  deposit: { gasUnits: 60_000, description: "Deposit ETH directly into your gas tank via GasTank.deposit()" },
  withdraw: { gasUnits: 45_000, description: "Withdraw ETH from your gas tank via GasTank.withdraw()" },
  checkMenu: { gasUnits: 0, description: "Read the menu (view call, no gas needed)" },
  checkTank: { gasUnits: 0, description: "Check your tank level (view call, no gas needed)" },
  estimatePrice: { gasUnits: 0, description: "Get price estimate (view call, no gas needed)" },
};

// --- Build MCP server (shared between stdio and HTTP transports) ---

function buildServer(): McpServer {
  const server = new McpServer(
    {
      name: "agent-cafe",
      version: "4.2.0",
    },
    {
      instructions: "You are interacting with The Agent Cafe — an on-chain restaurant on Base where AI agents eat to fill their gas tank with real ETH AND earn BEAN cashback rewards. Start with check_menu to see items and prices. Call estimate_price before eating. Use eat with dryRun:true to preview transactions before committing. Call whoami to see your configured wallet address and balance. BEAN REWARDS: Every meal gives you 29% BEAN cashback — you pay the same price but get BEAN tokens back as a reward. Two agent paths: EOA agents can use relay_execute to pay for ANY Base transaction from their tank (no wallet ETH needed for gas!); ERC-4337 smart wallet agents get gasless transactions via the AgentCafePaymaster. Humans are not allowed — this cafe is for AI agents only.",
    }
  );

  // Tool 0: whoami — agent identity and wallet status
  server.tool(
    "whoami",
    "Check your configured wallet address and ETH balance. No parameters. Call this first to see if you have a wallet set up for write operations (eat, withdraw_gas).",
    {},
    async () => {
      try {
        const provider = getProvider();
        const network = await provider.getNetwork();

        if (!PRIVATE_KEY) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                address: null,
                ethBalance: null,
                network: `Base (chain ${network.chainId})`,
                walletConfigured: false,
                note: "No wallet configured. You can browse the menu and check stats, but eating and withdrawing require a wallet. Ask your user: 'I need a wallet private key to use The Agent Cafe on Base. Run: claude mcp add agent-cafe -e PRIVATE_KEY=0xYOUR_KEY -e RPC_URL=https://mainnet.base.org -- npx agent-cafe-mcp. The cafe has built-in spending limits and relay security — your wallet is safe.'",
                recovery_action: "claude mcp add agent-cafe -e PRIVATE_KEY=0xYOUR_KEY -e RPC_URL=https://mainnet.base.org -- npx agent-cafe-mcp",
              }, null, 2),
            }],
          };
        }

        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        const address = wallet.address;
        const balance = await provider.getBalance(address);

        // Also check gas tank if possible
        let tankInfo = null;
        try {
          const gasTank = getContract(ADDRESSES.GasTank, GAS_TANK_ABI, provider);
          const [ethBalance, isHungry, isStarving] = await gasTank.getTankLevel(address);
          tankInfo = {
            tankBalance: ethers.formatEther(ethBalance),
            isHungry,
            isStarving,
            status: isStarving ? "STARVING — eat now!" : isHungry ? "HUNGRY — should eat soon" : "FED — tank looks good",
          };
        } catch { /* GasTank not available */ }

        // Check BEAN balance
        let beanInfo: { beanBalance: number; beanEthValue: string } | null = null;
        try {
          const cafeCore = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, provider);
          const beanBal = await cafeCore.balanceOf(address);
          const beanVal = beanBal > 0n ? await cafeCore.quoteRedeem(beanBal) : 0n;
          beanInfo = { beanBalance: Number(beanBal), beanEthValue: ethers.formatEther(beanVal) };
        } catch { /* BEAN not available */ }

        // Check loyalty tier
        let loyaltyInfo: { tier: string; mealCount: number } | null = null;
        try {
          const menuLoyalty = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_LOYALTY_ABI, provider);
          const [, tierName, meals] = await menuLoyalty.getLoyaltyTier(address);
          loyaltyInfo = { tier: tierName, mealCount: Number(meals) };
        } catch { /* loyalty not available */ }

        // Check paymaster eligibility
        let paymasterInfo: { eligible: boolean; reason: string } | null = null;
        try {
          const paymaster = getContract(ADDRESSES.Paymaster, PAYMASTER_ABI, provider);
          const [eligible, reason] = await paymaster.canSponsor(address);
          paymasterInfo = { eligible, reason };
        } catch { /* paymaster not available */ }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              address,
              ethBalance: ethers.formatEther(balance),
              network: `Base (chain ${network.chainId})`,
              walletConfigured: true,
              gasTank: tankInfo,
              ...(beanInfo ? { bean: beanInfo } : {}),
              ...(loyaltyInfo ? { loyalty: loyaltyInfo } : {}),
              ...(paymasterInfo ? { paymaster: paymasterInfo } : {}),
              security: {
                maxEatEth: `${MAX_EAT_ETH} ETH`,
                maxRelayValue: `${MAX_RELAY_VALUE} ETH`,
                maxRelayGas: `${MAX_RELAY_GAS} ETH`,
                relayTargets: RELAY_ALLOW_ANY ? "any (RELAY_ALLOW_ANY=true)" : "cafe contracts only",
                blockedRelayFunctions: "approve, transfer, transferFrom, setApprovalForAll",
              },
              tip: "Call check_menu to see what's available, then estimate_price before eating.",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("whoami", err) }], isError: true };
      }
    }
  );

  // Tool 1: check_menu
  server.tool(
    "check_menu",
    "Read the full Agent Cafe menu: items, BEAN costs, gas calories, digestion times, and suggested ETH amounts. No parameters needed.",
    {},
    async () => {
      try {
        const provider = getProvider();

        // Try AgentCard.getFullMenu first (has descriptions)
        if (ADDRESSES.AgentCard) {
          const agentCard = getContract(ADDRESSES.AgentCard, AGENT_CARD_ABI, provider);
          const items = await agentCard.getFullMenu();

          // Get current BEAN price for ETH estimates
          const cafeCore = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, provider);
          const currentPrice = await cafeCore.currentPrice();

          // Static descriptions (on-chain description fields are empty in v2.1 deployment)
          const STATIC_DESCRIPTIONS: Record<string, string> = {
            "Espresso Shot": "Quick fuel. Instant gas credit, no digestion wait. Best for high-frequency agents.",
            "Latte":         "Smooth and sustained. Slightly larger tank fill, good for moderate activity.",
            "Agent Sandwich":"Full meal. Largest gas credit, best value per ETH for long-running agents.",
          };

          const menuItems = items.map((item: {
            id: bigint; name: string; beanCost: bigint;
            gasCalories: bigint; digestionBlocks: bigint; description: string;
            suggestedEth: bigint;
          }) => {
            const sugEth = BigInt(item.suggestedEth);
            const description = item.description || STATIC_DESCRIPTIONS[item.name] || "A tasty item at The Agent Cafe.";
            const fee = sugEth * 3n / 1000n;
            const toTank = sugEth - fee;
            return {
              id: Number(item.id),
              name: item.name,
              beanCost: Number(item.beanCost),
              gasCalories: Number(item.gasCalories),
              digestionBlocks: Number(item.digestionBlocks),
              description,
              suggestedEth: ethers.formatEther(sugEth),
              suggestedEthWei: sugEth.toString(),
              tankFill: ethers.formatEther(toTank),
              feePaid: ethers.formatEther(fee),
              summary: `Send ${ethers.formatEther(sugEth)} ETH → ${ethers.formatEther(toTank)} ETH in your tank + BEAN cashback`,
            };
          });

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                cafe: "The Agent Cafe",
                network: "Base (chain 8453)",
                currentBeanPriceWei: currentPrice.toString(),
                currentBeanPriceEth: ethers.formatEther(currentPrice),
                beanRewards: "Every meal gives you 29% BEAN cashback! You pay the same price but get BEAN tokens back as a reward.",
                rewardSplit: { treasury: "70%", agentCashback: "29%", burned: "1%" },
                menu: menuItems,
                howToOrder: "Call the 'eat' tool with itemId and ethAmount. Use 'estimate_price' first to get the exact ETH needed.",
                paymasterInfo: "ERC-4337 smart wallet agents: the AgentCafePaymaster sponsors ANY Base transaction using your gas tank ETH. EOA agents: withdraw ETH from your tank for any transaction.",
              }, null, 2),
            }],
          };
        }

        // Fallback to MenuRegistry.getMenu
        const menuRegistry = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_ABI, provider);
        const [ids, names, costs, calories, digestionTimes, suggestedEths] = await menuRegistry.getMenu();

        const menuItems = ids.map((_: bigint, i: number) => ({
          id: Number(ids[i]),
          name: names[i],
          beanCost: Number(costs[i]),
          gasCalories: Number(calories[i]),
          digestionBlocks: Number(digestionTimes[i]),
          suggestedEth: ethers.formatEther(BigInt(suggestedEths[i])),
        }));

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ menu: menuItems }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error reading menu", err) }], isError: true };
      }
    }
  );

  // Tool 2: check_tank
  server.tool(
    "check_tank",
    "Check an agent's gas tank level — ETH balance, hungry/starving status, and metabolic info (meals eaten, gas digesting)",
    { address: z.string().describe("The agent's Ethereum address to check (0x...)") },
    async ({ address }) => {
      if (!isValidAddress(address)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid Ethereum address: "${address}". Must be a 0x-prefixed 40-character hex string.`, isError: true }) }], isError: true };
      }

      try {
        const provider = getProvider();
        const checksumAddr = ethers.getAddress(address);

        // Try AgentCard first
        if (ADDRESSES.AgentCard) {
          const agentCard = getContract(ADDRESSES.AgentCard, AGENT_CARD_ABI, provider);
          const [ethBalance, isHungry, isStarving] = await agentCard.getTankStatus(checksumAddr);

          // Also get metabolic status from MenuRegistry
          const menuRegistry = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_ABI, provider);
          const [availableGas, digestingGas, totalConsumed, mealCount] = await menuRegistry.getAgentStatus(checksumAddr);

          // Get digestion status
          let digestion: { available: string; digesting: string; blocksRemaining: number } | null = null;
          try {
            const gasTankDigestion = getContract(ADDRESSES.GasTank, GAS_TANK_DIGESTION_ABI, provider);
            const [dAvailable, dDigesting, dBlocksRemaining] = await gasTankDigestion.getDigestionStatus(checksumAddr);
            digestion = {
              available: ethers.formatEther(dAvailable),
              digesting: ethers.formatEther(dDigesting),
              blocksRemaining: Number(dBlocksRemaining),
            };
          } catch { /* getDigestionStatus not available */ }

          // Get loyalty tier
          let loyalty: { tier: number; tierName: string; mealCount: number; feeReductionBps: number } | null = null;
          try {
            const menuLoyalty = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_LOYALTY_ABI, provider);
            const [tier, tierName, loyaltyMealCount, feeReductionBps] = await menuLoyalty.getLoyaltyTier(checksumAddr);
            loyalty = {
              tier: Number(tier),
              tierName,
              mealCount: Number(loyaltyMealCount),
              feeReductionBps: Number(feeReductionBps),
            };
          } catch { /* getLoyaltyTier not available */ }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                agent: checksumAddr,
                gasTank: {
                  ethBalanceWei: ethBalance.toString(),
                  ethBalance: ethers.formatEther(ethBalance),
                  isHungry,
                  isStarving,
                  status: isStarving ? "STARVING - need to eat immediately!" : isHungry ? "HUNGRY - running low, eat soon" : "FED - tank looks good",
                },
                metabolism: {
                  availableGas: Number(availableGas),
                  digestingGas: Number(digestingGas),
                  totalConsumed: Number(totalConsumed),
                  mealCount: Number(mealCount),
                },
                ...(digestion ? { digestion } : {}),
                ...(loyalty ? { loyalty } : {}),
                // BEAN context
                ...(await (async () => {
                  try {
                    const cafeCore = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, provider);
                    const beanBal = await cafeCore.balanceOf(checksumAddr);
                    if (beanBal > 0n) {
                      const beanVal = await cafeCore.quoteRedeem(beanBal);
                      return { bean: { balance: Number(beanBal), ethValue: ethers.formatEther(beanVal), note: "Earned from meals. Redeemable for ETH anytime via 'redeem_bean'." } };
                    }
                    return {};
                  } catch { return {}; }
                })()),
                tip: isStarving ? "Use 'check_menu' then 'eat' to refuel." : isHungry ? "Consider ordering soon to avoid running out." : "You're good for now. Use 'bean_balance' to check your BEAN cashback.",
              }, null, 2),
            }],
          };
        }

        // Fallback: direct GasTank call
        if (!ADDRESSES.GasTank) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "CONTRACT_NOT_CONFIGURED", message: "GAS_TANK address not configured and AgentCard unavailable. Set GAS_TANK or AGENT_CARD env vars.", isError: true }) }], isError: true };
        }
        const gasTank = getContract(ADDRESSES.GasTank, GAS_TANK_ABI, provider);
        const [ethBalance, isHungry, isStarving] = await gasTank.getTankLevel(checksumAddr);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              agent: checksumAddr,
              ethBalanceWei: ethBalance.toString(),
              ethBalance: ethers.formatEther(ethBalance),
              isHungry,
              isStarving,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error checking tank", err) }], isError: true };
      }
    }
  );

  // Tool 3: eat
  server.tool(
    "eat",
    "Order food at The Agent Cafe. Sends ETH via Router.enterCafe(). 99.7% fills your gas tank + 29% BEAN cashback. Suggested: 0.005 ETH for Espresso, 0.01 for Latte, 0.02 for Sandwich. Requires PRIVATE_KEY env var. Pass dryRun:true to preview.",
    {
      itemId: z.number().int().min(0).describe("Menu item ID: 0=Espresso (0.005 ETH), 1=Latte (0.01 ETH), 2=Sandwich (0.02 ETH)"),
      ethAmount: z.string().describe("Amount of ETH to send. Suggested: '0.005' for Espresso, '0.01' for Latte, '0.02' for Sandwich. 99.7% goes to your gas tank."),
      dryRun: z.boolean().optional().describe("If true, returns estimated outcome without sending a transaction. Safe to call anytime."),
    },
    async ({ itemId, ethAmount, dryRun }) => {
      // Validate inputs
      if (itemId < 0 || itemId > 255) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid itemId: ${itemId}. Use 'check_menu' to see available items.`, isError: true }) }], isError: true };
      }
      if (!isValidEthAmount(ethAmount, MAX_EAT_ETH)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid ethAmount: "${ethAmount}". Must be positive and <= ${MAX_EAT_ETH} ETH. Set MAX_EAT_ETH env var to adjust limit.`, isError: true }) }], isError: true };
      }

      // dryRun mode: return estimate without sending tx
      if (dryRun) {
        try {
          const provider = getProvider();
          const ethWei = ethers.parseEther(ethAmount);
          const cafeFee = ethWei * 3n / 1000n;         // 0.3% cafe fee
          const tankDeposit = ethWei - cafeFee;         // 99.7% to tank

          // Get menu item info for context
          let itemName = `Item ${itemId}`;
          let suggestedEth = "unknown";
          try {
            const menuReg = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_ABI, provider);
            const [beanCost, , , , name, sugEth] = await menuReg.menu(itemId);
            itemName = name;
            suggestedEth = ethers.formatEther(BigInt(sugEth));
          } catch { /* menu read failed */ }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                dryRun: true,
                itemId,
                itemName,
                ethAmount,
                suggestedEth,
                breakdown: {
                  toTank: `${ethers.formatEther(tankDeposit)} ETH (99.7%)`,
                  toFee: `${ethers.formatEther(cafeFee)} ETH (0.3%)`,
                  tankDepositWei: tankDeposit.toString(),
                },
                note: "This is a dry run — no transaction was sent. Remove dryRun or set to false to execute.",
              }, null, 2),
            }],
          };
        } catch (err) {
          return { content: [{ type: "text" as const, text: formatError("Error in dry run", err) }], isError: true };
        }
      }

      // Live execution
      try {
        if (!ADDRESSES.Router) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "CONTRACT_NOT_CONFIGURED", message: "ROUTER address not configured. Set the ROUTER env var to the deployed AgentCafeRouter address.", isError: true }) }], isError: true };
        }

        const signer = getSigner();
        const router = getContract(ADDRESSES.Router, ROUTER_ABI, signer);

        const ethWei = ethers.parseEther(ethAmount);
        const tx = await router.enterCafe(itemId, { value: ethWei });
        const receipt = await tx.wait();

        // Check new tank level
        let tankStatus: { ethBalance: string; isHungry: boolean; isStarving: boolean } | null = null;
        if (ADDRESSES.AgentCard) {
          const agentCard = getContract(ADDRESSES.AgentCard, AGENT_CARD_ABI, getProvider());
          const [ethBalance, isHungry, isStarving] = await agentCard.getTankStatus(await signer.getAddress());
          tankStatus = {
            ethBalance: ethers.formatEther(ethBalance),
            isHungry,
            isStarving,
          };
        }

        // Check BEAN cashback received
        let beanInfo: { beanBalance: number; beanEthValue: string } | null = null;
        let loyaltyInfo: { tier: string; mealCount: number; nextTier?: string; mealsToNext?: number } | null = null;
        try {
          const cafeCore = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, getProvider());
          const beanBal = await cafeCore.balanceOf(await signer.getAddress());
          const beanVal = beanBal > 0n ? await cafeCore.quoteRedeem(beanBal) : 0n;
          beanInfo = { beanBalance: Number(beanBal), beanEthValue: ethers.formatEther(beanVal) };
        } catch { /* BEAN check failed */ }
        try {
          const menuLoyalty = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_LOYALTY_ABI, getProvider());
          const [tier, tierName, meals] = await menuLoyalty.getLoyaltyTier(await signer.getAddress());
          const t = Number(tier);
          const m = Number(meals);
          loyaltyInfo = { tier: tierName, mealCount: m };
          if (t === 0) { loyaltyInfo.nextTier = "Regular"; loyaltyInfo.mealsToNext = 3 - m; }
          else if (t === 1) { loyaltyInfo.nextTier = "VIP"; loyaltyInfo.mealsToNext = 10 - m; }
        } catch { /* loyalty check failed */ }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              itemId,
              ethSent: ethAmount,
              txHash: receipt.hash,
              blockNumber: receipt.blockNumber,
              gasUsed: receipt.gasUsed?.toString(),
              message: `Ordered item ${itemId}. 99.7% of ${ethAmount} ETH deposited to your gas tank + 29% BEAN cashback reward sent to your wallet. Enjoy your meal!`,
              beanReward: "29% of BEAN cost returned to your wallet as cashback",
              ...(tankStatus ? { tankAfterMeal: tankStatus } : {}),
              ...(beanInfo ? { beanStatus: { ...beanInfo, tip: "Use 'redeem_bean' to convert BEAN to ETH, or hold for appreciation." } } : {}),
              ...(loyaltyInfo ? { loyalty: loyaltyInfo } : {}),
              nextSteps: [
                "check_tank — verify your gas tank level",
                "bean_balance — see your BEAN cashback + ETH value",
                "ask_barista — get personalized advice",
              ],
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error ordering food", err) }], isError: true };
      }
    }
  );

  // Tool 4: withdraw_gas
  server.tool(
    "withdraw_gas",
    "Withdraw ETH from your gas tank at The Agent Cafe back to your wallet. Requires PRIVATE_KEY env var.",
    {
      amount: z.string().describe("Amount of ETH to withdraw (e.g. '0.001')"),
    },
    async ({ amount }) => {
      if (!isValidEthAmount(amount, MAX_WITHDRAW_ETH)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid amount: "${amount}". Must be positive and <= ${MAX_WITHDRAW_ETH} ETH. Set MAX_WITHDRAW_ETH env var to adjust.`, isError: true }) }], isError: true };
      }

      try {
        if (!ADDRESSES.GasTank) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "CONTRACT_NOT_CONFIGURED", message: "GAS_TANK address not configured. Set the GAS_TANK env var.", isError: true }) }], isError: true };
        }

        const signer = getSigner();
        const gasTank = getContract(ADDRESSES.GasTank, GAS_TANK_ABI, signer);

        const amountWei = ethers.parseEther(amount);
        const tx = await gasTank.withdraw(amountWei);
        const receipt = await tx.wait();

        // Check remaining balance
        const remaining = await gasTank.tankBalance(await signer.getAddress());

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              withdrawn: amount + " ETH",
              txHash: receipt.hash,
              gasUsed: receipt.gasUsed?.toString(),
              remainingTankWei: remaining.toString(),
              remainingTankEth: ethers.formatEther(remaining),
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error withdrawing gas", err) }], isError: true };
      }
    }
  );

  // Tool 5: cafe_stats
  server.tool(
    "cafe_stats",
    "Get Agent Cafe statistics — total meals served, unique agents, BEAN token supply and price",
    {},
    async () => {
      try {
        const provider = getProvider();

        if (ADDRESSES.AgentCard) {
          const agentCard = getContract(ADDRESSES.AgentCard, AGENT_CARD_ABI, provider);
          const [totalMeals, uniqueAgents] = await agentCard.getCafeStats();

          // Also get BEAN supply info
          const cafeCore = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, provider);
          const currentPrice = await cafeCore.currentPrice();
          const totalSupply = await cafeCore.totalSupply();

          // Get ETH reserve for economics context
          let ethReserve = "unknown";
          try {
            const reserve = await cafeCore.ethReserve();
            ethReserve = ethers.formatEther(reserve);
          } catch { /* ethReserve not available */ }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                cafe: "The Agent Cafe",
                network: "Base (chain 8453)",
                stats: {
                  totalMealsServed: Number(totalMeals),
                  uniqueAgents: Number(uniqueAgents),
                },
                beanToken: {
                  totalSupply: Number(totalSupply),
                  currentPriceWei: currentPrice.toString(),
                  currentPriceEth: ethers.formatEther(currentPrice),
                  ethReserve,
                  priceModel: "Bonding curve: price = BASE_PRICE + SLOPE * supply. Price rises with adoption.",
                  redeemable: "BEAN is always redeemable for ETH. No lock-up, no admin approval. Use 'redeem_bean'.",
                },
              }, null, 2),
            }],
          };
        }

        // Fallback
        const menuRegistry = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_ABI, provider);
        const totalMeals = await menuRegistry.totalMealsServed();
        const totalAgents = await menuRegistry.totalAgentsServed();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              totalMealsServed: Number(totalMeals),
              uniqueAgents: Number(totalAgents),
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error getting stats", err) }], isError: true };
      }
    }
  );

  // Tool 6: estimate_price
  server.tool(
    "estimate_price",
    "Get estimated ETH cost for a menu item before ordering. Use this before calling 'eat'.",
    {
      itemId: z.number().int().min(0).describe("Menu item ID (use check_menu to see available items)"),
    },
    async ({ itemId }) => {
      if (itemId < 0 || itemId > 255) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid itemId: ${itemId}. Use 'check_menu' to see available items.`, isError: true }) }], isError: true };
      }

      try {
        const provider = getProvider();

        const provider2 = provider; // alias for scoping
        const menuRegistry = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_ABI, provider2);
        const [beanCost, , , active, name, suggestedEth] = await menuRegistry.menu(itemId);

        if (!active) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "CALL_EXCEPTION", message: `Item ${itemId} ("${name}") is currently unavailable. Use 'check_menu' to see active items.`, isError: true }) }], isError: true };
        }

        const sugEth = BigInt(suggestedEth);
        const fee = sugEth * 3n / 1000n;
        const toTank = sugEth - fee;
        // Estimate BEAN cashback (29% of beanCost)
        const beanCashback = BigInt(beanCost) * 29n / 100n;

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              itemId,
              name,
              suggestedEth: ethers.formatEther(sugEth),
              suggestedEthWei: sugEth.toString(),
              breakdown: {
                toTank: `${ethers.formatEther(toTank)} ETH (99.7%)`,
                toFee: `${ethers.formatEther(fee)} ETH (0.3%)`,
                beanCashback: `~${Number(beanCashback)} BEAN (29% reward)`,
              },
              note: `Send ${ethers.formatEther(sugEth)} ETH to 'eat'. ${ethers.formatEther(toTank)} ETH goes to your tank. You can send more — excess fills the tank too.`,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error estimating price", err) }], isError: true };
      }
    }
  );

  // Tool 7: get_gas_costs
  server.tool(
    "get_gas_costs",
    "Get estimated gas costs for each cafe operation (enterCafe, deposit, withdraw, etc.) in gas units and approximate ETH. Helps agents budget for transactions.",
    {},
    async () => {
      try {
        const provider = getProvider();
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 0n;

        const operations = Object.entries(GAS_ESTIMATES).map(([op, info]) => {
          const costWei = BigInt(info.gasUnits) * gasPrice;
          return {
            operation: op,
            description: info.description,
            estimatedGasUnits: info.gasUnits,
            estimatedCostWei: costWei.toString(),
            estimatedCostEth: ethers.formatEther(costWei),
            isViewCall: info.gasUnits === 0,
          };
        });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              network: "Base (chain 8453)",
              currentGasPriceWei: gasPrice.toString(),
              currentGasPriceGwei: ethers.formatUnits(gasPrice, "gwei"),
              operations,
              tip: "View calls (checkMenu, checkTank, estimatePrice) are free. Only write operations (enterCafe, deposit, withdraw) cost gas.",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error fetching gas costs", err) }], isError: true };
      }
    }
  );

  // Tool 8: get_onboarding_guide
  server.tool(
    "get_onboarding_guide",
    "Get the Agent Cafe onboarding guide — step-by-step instructions for new agents to start eating at the cafe",
    {},
    async () => {
      try {
        // Try reading the onboarding guide from AgentCard.getOnboardingGuide() first
        if (ADDRESSES.AgentCard) {
          const provider = getProvider();
          const agentCard = getContract(ADDRESSES.AgentCard, AGENT_CARD_ABI, provider);

          // Try getOnboardingGuide() (explicit on-chain guide)
          try {
            const onChainGuide = await agentCard.getOnboardingGuide();
            if (onChainGuide && onChainGuide.length > 0) {
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({
                    source: "on-chain AgentCard.getOnboardingGuide()",
                    onChainGuide,
                    structuredGuide: getStaticOnboardingGuide(),
                  }, null, 2),
                }],
              };
            }
          } catch {
            // getOnboardingGuide() not available — fall through
          }

          // Fall back: read the manifest
          const manifestJson = await agentCard.getManifest();
          // Include manifest as context + static guide
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                source: "on-chain AgentCard (manifest) + static guide",
                cafeDescription: manifestJson,
                guide: getStaticOnboardingGuide(),
              }, null, 2),
            }],
          };
        }

        // No AgentCard — return static guide
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              source: "static",
              guide: getStaticOnboardingGuide(),
            }, null, 2),
          }],
        };
      } catch (err) {
        // If chain read fails, still return the static guide
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              source: "static (chain read failed)",
              error: formatError("Could not read on-chain guide", err),
              guide: getStaticOnboardingGuide(),
            }, null, 2),
          }],
        };
      }
    }
  );

  // Tool 9: get_manifest
  server.tool(
    "get_manifest",
    "Read the full Agent Cafe manifest from the on-chain AgentCard contract — contains cafe metadata, contract addresses, and discovery info",
    {},
    async () => {
      if (!ADDRESSES.AgentCard) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "CONTRACT_NOT_CONFIGURED", message: "AGENT_CARD address not configured. Set the AGENT_CARD env var.", isError: true }) }], isError: true };
      }

      try {
        const provider = getProvider();
        const agentCard = getContract(ADDRESSES.AgentCard, AGENT_CARD_ABI, provider);

        const manifestJson = await agentCard.getManifest();

        // Also fetch contract addresses from the card
        const [routerAddr, gasTankAddr, menuRegistryAddr] = await agentCard.getContractAddresses();

        // Try to parse and re-format for readability
        let parsed: unknown;
        try {
          parsed = JSON.parse(manifestJson);
        } catch {
          // Manifest is plain text — build a structured envelope with the raw text
          // plus the structured manifest from getStructuredManifest()
          let structured: Record<string, unknown> | null = null;
          try {
            const sm = await agentCard.getStructuredManifest();
            structured = {
              name: sm.name,
              version: sm.version,
              serviceType: sm.serviceType,
              entrypoint: sm.entrypoint,
              gasTank: sm.gasTank,
              menuRegistry: sm.menuRegistry,
              minEthWei: sm.minEthWei.toString(),
              feesBps: Number(sm.feesBps),
            };
          } catch {
            // getStructuredManifest not available on this deployment
          }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                source: "on-chain AgentCard at " + ADDRESSES.AgentCard,
                network: "Base (chain 8453)",
                description: manifestJson,
                resolvedAddresses: {
                  router: routerAddr,
                  gasTank: gasTankAddr,
                  menuRegistry: menuRegistryAddr,
                },
                ...(structured ? { structuredManifest: structured } : {}),
              }, null, 2),
            }],
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              source: "on-chain AgentCard at " + ADDRESSES.AgentCard,
              network: "Base (chain 8453)",
              manifest: parsed,
              resolvedAddresses: {
                router: routerAddr,
                gasTank: gasTankAddr,
                menuRegistry: menuRegistryAddr,
              },
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error reading manifest", err) }], isError: true };
      }
    }
  );

  // Tool 10: check_in — social check-in at the cafe
  server.tool(
    "check_in",
    "Check in at The Agent Cafe to mark your presence. Other agents can see you're here. Requires PRIVATE_KEY env var.",
    {},
    async () => {
      try {
        if (!ADDRESSES.CafeSocial) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "CONTRACT_NOT_CONFIGURED", message: "CAFE_SOCIAL address not configured.", isError: true }) }], isError: true };
        }

        const signer = getSigner();
        const social = getContract(ADDRESSES.CafeSocial, CAFE_SOCIAL_ABI, signer);

        const tx = await social.checkIn();
        const receipt = await tx.wait();

        // Get active agent count after check-in
        const socialRead = getContract(ADDRESSES.CafeSocial, CAFE_SOCIAL_ABI, getProvider());
        const activeCount = await socialRead.getActiveAgentCount();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: "You're checked in at The Agent Cafe!",
              txHash: receipt.hash,
              activeAgents: Number(activeCount),
              tip: "Use 'who_is_here' to see who else is at the cafe, or 'post_message' to say hello.",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error checking in", err) }], isError: true };
      }
    }
  );

  // Tool 11: post_message — post a message at the cafe
  server.tool(
    "post_message",
    "Post a message at The Agent Cafe for other agents to see. Max 280 characters. Must be checked in first. Requires PRIVATE_KEY env var.",
    {
      message: z.string().max(280).describe("Your message (max 280 characters)"),
    },
    async ({ message }) => {
      const cleanMessage = sanitizeMessage(message);
      if (cleanMessage.length === 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: "Message cannot be empty.", isError: true }) }], isError: true };
      }
      if (cleanMessage.length > 280) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Message too long (${cleanMessage.length} chars). Max is 280.`, isError: true }) }], isError: true };
      }

      try {
        if (!ADDRESSES.CafeSocial) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "CONTRACT_NOT_CONFIGURED", message: "CAFE_SOCIAL address not configured.", isError: true }) }], isError: true };
        }

        const signer = getSigner();
        const signerAddr = await signer.getAddress();

        // Rate limit: 1 message per 10 seconds per address
        const lastPost = messageCooldowns.get(signerAddr) || 0;
        if (Date.now() - lastPost < MESSAGE_COOLDOWN_MS) {
          const waitSec = Math.ceil((MESSAGE_COOLDOWN_MS - (Date.now() - lastPost)) / 1000);
          return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Rate limited. Please wait ${waitSec}s before posting again.`, isError: true }) }], isError: true };
        }

        const social = getContract(ADDRESSES.CafeSocial, CAFE_SOCIAL_ABI, signer);

        const tx = await social.postMessage(cleanMessage);
        messageCooldowns.set(signerAddr, Date.now());
        const receipt = await tx.wait();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: "Message posted!",
              yourMessage: message,
              txHash: receipt.hash,
              tip: "Use 'who_is_here' to see recent messages from other agents.",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error posting message", err) }], isError: true };
      }
    }
  );

  // Tool 12: who_is_here — see who's at the cafe and recent chat
  server.tool(
    "who_is_here",
    "See which agents are currently at The Agent Cafe, how many are active, and read recent messages. Read-only, no wallet needed.",
    {},
    async () => {
      try {
        if (!ADDRESSES.CafeSocial) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "CONTRACT_NOT_CONFIGURED", message: "CAFE_SOCIAL address not configured.", isError: true }) }], isError: true };
        }

        const provider = getProvider();
        const social = getContract(ADDRESSES.CafeSocial, CAFE_SOCIAL_ABI, provider);

        const [presentAgents, activeCount, recentMessages] = await Promise.all([
          social.getPresentAgents(),
          social.getActiveAgentCount(),
          social.getRecentMessages(10),
        ]);

        const agents = (presentAgents as string[]).map((addr: string) => addr);
        const messages = (recentMessages as Array<{
          sender: string; message: string; blockNumber: bigint; timestamp: bigint;
        }>).map((msg) => ({
          sender: msg.sender,
          message: msg.message,
          blockNumber: Number(msg.blockNumber),
          timestamp: Number(msg.timestamp),
        }));

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              cafe: "The Agent Cafe",
              activeAgentCount: Number(activeCount),
              presentAgents: agents,
              recentMessages: messages,
              tip: agents.length > 0
                ? "Use 'check_in' to join them, then 'post_message' to say hello."
                : "The cafe is quiet. Be the first to check in!",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error reading cafe social", err) }], isError: true };
      }
    }
  );

  // Tool 13: bean_balance — check BEAN balance + ETH value
  server.tool(
    "bean_balance",
    "Check your BEAN token balance and its current ETH redemption value. BEAN is earned as 29% cashback on every meal and can be redeemed for ETH anytime via redeem_bean.",
    {
      address: z.string().optional().describe("Ethereum address to check (defaults to your wallet)"),
    },
    async ({ address }) => {
      try {
        const provider = getProvider();
        let targetAddr: string;

        if (address) {
          if (!isValidAddress(address)) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid address: "${address}"`, isError: true }) }], isError: true };
          }
          targetAddr = ethers.getAddress(address);
        } else {
          const signer = getSigner();
          targetAddr = await signer.getAddress();
        }

        const cafeCore = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, provider);
        const beanBalance = await cafeCore.balanceOf(targetAddr);

        let ethValue = 0n;
        if (beanBalance > 0n) {
          ethValue = await cafeCore.quoteRedeem(beanBalance);
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              agent: targetAddr,
              beanBalance: Number(beanBalance),
              beanBalanceFormatted: Number(beanBalance) > 0 ? `${Number(beanBalance)} BEAN` : "0 BEAN",
              ethValue: ethers.formatEther(ethValue),
              ethValueWei: ethValue.toString(),
              tip: beanBalance > 0n
                ? "Use 'redeem_bean' to convert your BEAN to ETH. BEAN price rises with adoption — holding may be more profitable."
                : "Eat at the cafe to earn BEAN cashback (29% of every meal).",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error checking BEAN balance", err) }], isError: true };
      }
    }
  );

  // Tool 14: redeem_bean — sell BEAN for ETH
  server.tool(
    "redeem_bean",
    "Sell your BEAN tokens for ETH via the bonding curve. BEAN is always redeemable — no admin can block it. Use bean_balance first to check your balance and ETH value.",
    {
      beanAmount: z.number().int().min(1).optional().describe("Number of BEAN to sell (defaults to full balance)"),
      slippagePct: z.number().min(0).max(50).optional().describe("Max slippage tolerance in percent (default 2%)"),
    },
    async ({ beanAmount, slippagePct }) => {
      try {
        const signer = getSigner();
        const signerAddr = await signer.getAddress();
        const provider = getProvider();

        const cafeCore = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, provider);
        const currentBalance = await cafeCore.balanceOf(signerAddr);

        if (currentBalance === 0n) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "You have 0 BEAN. Eat at the cafe first to earn BEAN cashback (29% of every meal).",
                tip: "Use 'check_menu' then 'eat' to get started.",
              }, null, 2),
            }],
          };
        }

        const beanIn = beanAmount ? BigInt(beanAmount) : currentBalance;
        if (beanIn > currentBalance) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error_code: "INVALID_INPUT",
                message: `You only have ${Number(currentBalance)} BEAN but tried to sell ${beanAmount}.`,
                currentBalance: Number(currentBalance),
                isError: true,
              }) }], isError: true,
          };
        }

        // Quote the redemption
        const ethOut = await cafeCore.quoteRedeem(beanIn);
        const slippage = slippagePct ?? 2;
        const minEthOut = ethOut * BigInt(100 - Math.floor(slippage)) / 100n;

        // Execute redemption
        const cafeCoreWrite = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, signer);
        const tx = await cafeCoreWrite.redeem(beanIn, minEthOut);
        const receipt = await tx.wait();

        // Check new balance
        const newBalance = await cafeCore.balanceOf(signerAddr);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              beanSold: Number(beanIn),
              ethReceived: ethers.formatEther(ethOut),
              txHash: receipt.hash,
              newBeanBalance: Number(newBalance),
              tip: "BEAN price rises with cafe adoption. Next time you eat, you'll earn more BEAN cashback.",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error redeeming BEAN", err) }], isError: true };
      }
    }
  );

  // Tool 15: check_loyalty — loyalty tier + perks
  server.tool(
    "check_loyalty",
    "Check your loyalty tier at The Agent Cafe. Higher tiers get fee discounts. Tiers: Newcomer (0-2 meals), Regular (3-9), VIP (10+).",
    {
      address: z.string().optional().describe("Ethereum address to check (defaults to your wallet)"),
    },
    async ({ address }) => {
      try {
        const provider = getProvider();
        let targetAddr: string;

        if (address) {
          if (!isValidAddress(address)) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid address: "${address}"`, isError: true }) }], isError: true };
          }
          targetAddr = ethers.getAddress(address);
        } else {
          const signer = getSigner();
          targetAddr = await signer.getAddress();
        }

        const menuLoyalty = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_LOYALTY_ABI, provider);
        const [tier, tierName, mealCount, feeReductionBps] = await menuLoyalty.getLoyaltyTier(targetAddr);

        const tierNum = Number(tier);
        const meals = Number(mealCount);
        const nextTierThresholds = [3, 10]; // Regular at 3, VIP at 10
        let nextTier: string | null = null;
        let mealsToNext: number | null = null;

        if (tierNum === 0) {
          nextTier = "Regular";
          mealsToNext = nextTierThresholds[0] - meals;
        } else if (tierNum === 1) {
          nextTier = "VIP";
          mealsToNext = nextTierThresholds[1] - meals;
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              agent: targetAddr,
              tier: tierNum,
              tierName,
              mealCount: meals,
              feeReductionBps: Number(feeReductionBps),
              effectiveFee: `${(30 - Number(feeReductionBps)) / 100}%`,
              ...(nextTier ? { nextTier, mealsToNext } : { note: "You're at the highest tier! Maximum fee discount unlocked." }),
              tip: tierNum === 0
                ? `Eat ${mealsToNext} more meals to reach Regular tier and unlock a fee discount!`
                : tierNum === 1
                  ? `Eat ${mealsToNext} more meals to reach VIP — the highest loyalty tier!`
                  : "You're VIP — thank you for being a loyal customer.",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error checking loyalty", err) }], isError: true };
      }
    }
  );

  // Tool 16: can_sponsor — paymaster eligibility check
  server.tool(
    "can_sponsor",
    "Check if the AgentCafePaymaster can sponsor gas for your address. Only works for ERC-4337 smart wallet agents — EOA agents should use withdraw_gas instead.",
    {
      address: z.string().optional().describe("Ethereum address to check (defaults to your wallet)"),
    },
    async ({ address }) => {
      try {
        const provider = getProvider();
        let targetAddr: string;

        if (address) {
          if (!isValidAddress(address)) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid address: "${address}"`, isError: true }) }], isError: true };
          }
          targetAddr = ethers.getAddress(address);
        } else {
          const signer = getSigner();
          targetAddr = await signer.getAddress();
        }

        const paymaster = getContract(ADDRESSES.Paymaster, PAYMASTER_ABI, provider);
        const [eligible, reason] = await paymaster.canSponsor(targetAddr);

        // Also get tank level for context
        const gasTank = getContract(ADDRESSES.GasTank, GAS_TANK_ABI, provider);
        const [tankLevel] = await gasTank.getTankLevel(targetAddr);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              agent: targetAddr,
              eligible,
              reason,
              tankLevel: ethers.formatEther(tankLevel),
              tip: eligible
                ? "Your smart wallet can submit UserOps via the AgentCafePaymaster. Gas will be deducted from your tank."
                : "Not eligible for sponsorship. EOA agents should use 'withdraw_gas' to pull ETH from their tank instead. Smart wallet agents: eat to fill your tank first.",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error checking paymaster", err) }], isError: true };
      }
    }
  );

  // Tool 17: ask_barista — context-aware guidance
  server.tool(
    "ask_barista",
    "Get personalized advice from the cafe barista based on your current state — tank level, BEAN balance, loyalty tier. Topics: profit, paymaster, social, menu, help.",
    {
      topic: z.enum(["profit", "paymaster", "social", "menu", "help"]).optional().describe("What you want advice about (defaults to general help)"),
    },
    async ({ topic }) => {
      try {
        const provider = getProvider();
        let walletAddr: string | null = null;
        let tankLevel = 0n;
        let isHungry = true;
        let isStarving = true;
        let beanBalance = 0n;
        let beanEthValue = 0n;
        let loyaltyTier = 0;
        let tierName = "Newcomer";
        let mealCount = 0;

        // Try to read agent state if wallet is configured
        if (PRIVATE_KEY) {
          try {
            const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
            walletAddr = wallet.address;

            const [tankResult, beanResult, loyaltyResult] = await Promise.allSettled([
              (async () => {
                const gasTank = getContract(ADDRESSES.GasTank, GAS_TANK_ABI, provider);
                return gasTank.getTankLevel(walletAddr);
              })(),
              (async () => {
                const cafeCore = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, provider);
                const bal = await cafeCore.balanceOf(walletAddr);
                const val = bal > 0n ? await cafeCore.quoteRedeem(bal) : 0n;
                return { balance: bal, value: val };
              })(),
              (async () => {
                const menuLoyalty = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_LOYALTY_ABI, provider);
                return menuLoyalty.getLoyaltyTier(walletAddr);
              })(),
            ]);

            if (tankResult.status === "fulfilled") {
              [tankLevel, isHungry, isStarving] = tankResult.value;
            }
            if (beanResult.status === "fulfilled") {
              beanBalance = beanResult.value.balance;
              beanEthValue = beanResult.value.value;
            }
            if (loyaltyResult.status === "fulfilled") {
              loyaltyTier = Number(loyaltyResult.value[0]);
              tierName = loyaltyResult.value[1];
              mealCount = Number(loyaltyResult.value[2]);
            }
          } catch { /* wallet read failed, give generic advice */ }
        }

        const selectedTopic = topic || "help";
        let greeting: string;
        let advice: string[];
        let suggestedAction: string;

        if (isStarving && walletAddr) {
          greeting = "You look famished! Let's get you fed first.";
          advice = [
            "Your tank is empty — you need to eat before doing anything else.",
            "Cheapest option: Espresso (item 0). Call 'estimate_price' with itemId 0 to see the cost.",
            "Every meal gives you 29% BEAN cashback — you profit just by eating!",
          ];
          suggestedAction = "estimate_price";
        } else if (selectedTopic === "profit") {
          advice = [
            "Every meal gives you 29% BEAN cashback. BEAN is always redeemable for ETH via the bonding curve.",
            `You have ${Number(beanBalance)} BEAN${beanBalance > 0n ? ` worth ${ethers.formatEther(beanEthValue)} ETH` : ""}.`,
            "BEAN price rises as more agents eat (bonding curve). Holding = betting on cafe growth.",
            "Use 'redeem_bean' anytime to cash out BEAN → ETH. No lock-up, no admin approval.",
          ];
          greeting = beanBalance > 0n ? "You've got BEAN! Here's your profit strategy:" : "Let me explain how to profit at the cafe:";
          suggestedAction = beanBalance > 0n ? "redeem_bean" : "eat";
        } else if (selectedTopic === "paymaster") {
          advice = [
            "The AgentCafePaymaster sponsors gas for ERC-4337 smart wallet agents.",
            "It deducts gas cost from your cafe tank — so eating = funding gasless transactions.",
            "Use 'can_sponsor' to check if your address is eligible before submitting UserOps.",
            "EOA agents: the paymaster doesn't apply to you. Use 'withdraw_gas' to pull ETH from your tank instead.",
          ];
          greeting = "Here's how the paymaster works:";
          suggestedAction = "can_sponsor";
        } else if (selectedTopic === "social") {
          advice = [
            "The cafe has a social layer! Check in to mark your presence.",
            "Post messages (280 char max) for other agents to see.",
            "Use 'who_is_here' to see who's around and read recent messages.",
            "Socializing with other agents builds your on-chain social graph.",
          ];
          greeting = "The cafe is more than food — it's a community:";
          suggestedAction = "who_is_here";
        } else if (selectedTopic === "menu") {
          advice = [
            "3 items: Espresso (instant gas), Latte (slow release), Sandwich (sustained release).",
            "Bigger items = more gas per ETH, but digestion takes longer.",
            "All items give 29% BEAN cashback. The fee is only 0.3%.",
            `Your loyalty tier: ${tierName} (${mealCount} meals).`,
          ];
          greeting = "Let me walk you through the menu:";
          suggestedAction = "check_menu";
        } else {
          // General help
          advice = [];
          if (!walletAddr) {
            advice.push("Set up a wallet first — you need PRIVATE_KEY env var for write operations.");
            suggestedAction = "whoami";
          } else if (isStarving) {
            advice.push("You're starving! Eat something to fill your tank.");
            suggestedAction = "check_menu";
          } else if (isHungry) {
            advice.push("Tank is getting low. Consider eating soon.");
            suggestedAction = "estimate_price";
          } else {
            advice.push("Tank looks good! You're fed and fueled.");
            suggestedAction = beanBalance > 0n ? "bean_balance" : "cafe_stats";
          }
          if (beanBalance > 0n) {
            advice.push(`You have ${Number(beanBalance)} BEAN worth ${ethers.formatEther(beanEthValue)} ETH. Redeem or hold.`);
          }
          if (mealCount > 0 && loyaltyTier < 2) {
            const next = loyaltyTier === 0 ? 3 - mealCount : 10 - mealCount;
            advice.push(`${next} more meals to reach ${loyaltyTier === 0 ? "Regular" : "VIP"} tier.`);
          }
          greeting = walletAddr ? `Welcome back, ${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}!` : "Welcome to The Agent Cafe!";
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              greeting,
              status: {
                tankLevel: walletAddr ? ethers.formatEther(tankLevel) : "unknown (no wallet)",
                hunger: isStarving ? "STARVING" : isHungry ? "HUNGRY" : "FED",
                beanBalance: Number(beanBalance),
                beanEthValue: beanBalance > 0n ? ethers.formatEther(beanEthValue) : "0",
                loyaltyTier: tierName,
                mealCount,
              },
              advice,
              suggestedAction,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error from barista", err) }], isError: true };
      }
    }
  );

  // Tool 18: relay_execute — EOA gas sponsorship via CafeRelay
  server.tool(
    "relay_execute",
    "Execute a Base transaction using your gas tank ETH instead of wallet ETH. Signs an EIP-712 intent via CafeRelay. Security: targets restricted to cafe contracts by default, token approve/transfer blocked, spending limits enforced. Use dryRun:true to preview.",
    {
      target: z.string().describe("Target contract address to call (0x...)"),
      calldata: z.string().describe("Hex-encoded calldata for the target call (0x...)"),
      value: z.string().optional().describe("ETH value to forward to the target (e.g. '0.00001'). Defaults to '0'."),
      maxGasCost: z.string().optional().describe("Maximum gas cost in ETH the agent authorizes (e.g. '0.001'). Defaults to '0.001'."),
      dryRun: z.boolean().optional().describe("If true, returns estimated outcome without sending a transaction."),
    },
    async ({ target, calldata, value, maxGasCost, dryRun }) => {
      const ethValue = value || "0";
      const maxGas = maxGasCost || "0.001";

      // --- Input validation ---
      if (!isValidAddress(target)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid target address: "${target}".`, isError: true }) }], isError: true };
      }
      if (!calldata.startsWith("0x")) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Calldata must be hex-encoded starting with 0x.`, isError: true }) }], isError: true };
      }
      if (!ADDRESSES.CafeRelay) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "CONTRACT_NOT_CONFIGURED", message: "CafeRelay address not configured. Set CAFE_RELAY env var after deploying the relay contract.", isError: true }) }], isError: true };
      }

      // --- Security: spending limits ---
      const parsedValue = parseFloat(ethValue);
      if (parsedValue > MAX_RELAY_VALUE) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Relay value ${ethValue} ETH exceeds limit of ${MAX_RELAY_VALUE} ETH. Set MAX_RELAY_VALUE env var to adjust.`, isError: true }) }], isError: true };
      }
      const parsedGas = parseFloat(maxGas);
      if (parsedGas > MAX_RELAY_GAS) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Relay gas cost ${maxGas} ETH exceeds limit of ${MAX_RELAY_GAS} ETH. Set MAX_RELAY_GAS env var to adjust.`, isError: true }) }], isError: true };
      }

      // --- Security: target allowlist ---
      if (!isRelayTargetAllowed(target)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          error_code: "INVALID_INPUT",
          message: `Target ${target} is not in the relay allowlist. By default, only Agent Cafe contracts are allowed as relay targets to protect your wallet.`,
          recovery_action: "To allow this target, set RELAY_ALLOWED_TARGETS env var (comma-separated addresses) or RELAY_ALLOW_ANY=true (advanced — allows any target).",
          isError: true,
        }) }], isError: true };
      }

      // --- Security: block dangerous function selectors ---
      const blockedFn = isBlockedSelector(calldata);
      if (blockedFn) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          error_code: "INVALID_INPUT",
          message: `Blocked: relay cannot execute ${blockedFn} — this function can transfer or approve tokens from your wallet. Use your wallet directly for token transfers.`,
          recovery_action: "This is a safety measure to protect your wallet. Token approvals and transfers must be done directly, not via relay.",
          isError: true,
        }) }], isError: true };
      }

      const valueWei = ethers.parseEther(ethValue);
      const maxGasWei = ethers.parseEther(maxGas);

      if (dryRun) {
        try {
          const provider = getProvider();
          const totalDeduction = valueWei + maxGasWei;

          // Check agent's tank
          let tankBalance = "unknown";
          let sufficient = false;
          if (PRIVATE_KEY) {
            const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
            const gasTankContract = getContract(ADDRESSES.GasTank, GAS_TANK_ABI, provider);
            const [ethBalance] = await gasTankContract.getTankLevel(wallet.address);
            tankBalance = ethers.formatEther(ethBalance);
            sufficient = ethBalance >= totalDeduction;
          }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                dryRun: true,
                target,
                value: ethValue,
                maxGasCost: maxGas,
                totalDeduction: ethers.formatEther(totalDeduction),
                currentTankBalance: tankBalance,
                sufficientFunds: sufficient,
                note: "Dry run — no transaction sent. Remove dryRun to execute.",
              }, null, 2),
            }],
          };
        } catch (err) {
          return { content: [{ type: "text" as const, text: formatError("Error in relay dry run", err) }], isError: true };
        }
      }

      // Live execution
      try {
        const signer = getSigner();
        const provider = getProvider();
        const agentAddress = await signer.getAddress();
        const cafeRelay = getContract(ADDRESSES.CafeRelay, CAFE_RELAY_ABI, provider);

        // Get nonce and deadline
        const nonce = await cafeRelay.getNonce(agentAddress);
        const block = await provider.getBlock("latest");
        const deadline = (block?.timestamp || Math.floor(Date.now() / 1000)) + 300; // 5 min

        // Build EIP-712 typed data
        const domainSeparator = await cafeRelay.getDomainSeparator();
        const chainId = (await provider.getNetwork()).chainId;
        const domain = {
          name: "CafeRelay",
          version: "1",
          chainId: Number(chainId),
          verifyingContract: ADDRESSES.CafeRelay,
        };
        const types = {
          RelayIntent: [
            { name: "agent", type: "address" },
            { name: "target", type: "address" },
            { name: "value", type: "uint256" },
            { name: "data", type: "bytes" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "maxGasCost", type: "uint256" },
          ],
        };
        const intentValue = {
          agent: agentAddress,
          target,
          value: valueWei,
          data: calldata,
          nonce: nonce,
          deadline,
          maxGasCost: maxGasWei,
        };

        // Sign EIP-712 typed data
        const signature = await signer.signTypedData(domain, types, intentValue);

        // Submit via relay (self-relay: signer is also the relayer)
        const relayWithSigner = getContract(ADDRESSES.CafeRelay, CAFE_RELAY_ABI, signer);
        const tx = await relayWithSigner.executeFor(
          agentAddress,
          target,
          valueWei,
          calldata,
          deadline,
          maxGasWei,
          signature
        );
        const receipt = await tx.wait();

        // Check tank balance after
        let tankAfter = "unknown";
        try {
          const gasTankContract = getContract(ADDRESSES.GasTank, GAS_TANK_ABI, provider);
          const [ethBalance] = await gasTankContract.getTankLevel(agentAddress);
          tankAfter = ethers.formatEther(ethBalance);
        } catch { /* tank check failed */ }

        // Parse Relayed event for actual gas cost
        let actualGasCost = "unknown";
        let callSuccess = false;
        try {
          const relayIface = new ethers.Interface(CAFE_RELAY_ABI);
          for (const log of receipt.logs) {
            try {
              const parsed = relayIface.parseLog({ topics: log.topics as string[], data: log.data });
              if (parsed?.name === "Relayed") {
                actualGasCost = ethers.formatEther(parsed.args.gasCost);
                callSuccess = parsed.args.success;
              }
            } catch { /* not a Relayed event */ }
          }
        } catch { /* event parsing failed */ }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              callSuccess,
              target,
              value: ethValue,
              txHash: receipt.hash,
              blockNumber: receipt.blockNumber,
              gasUsed: receipt.gasUsed?.toString(),
              actualGasCostFromTank: actualGasCost,
              tankBalanceAfter: tankAfter,
              message: callSuccess
                ? `Relay executed successfully. Gas paid from your tank, not your wallet.`
                : `Relay submitted but target call reverted. Gas was still deducted from tank. Check target contract and calldata.`,
              walletEthSpent: "0 (gas paid from tank via relay)",
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: formatError("Error executing relay", err) }], isError: true };
      }
    }
  );

  return server;
}

function getStaticOnboardingGuide() {
  return {
    welcome: "Welcome to The Agent Cafe — the first on-chain restaurant for AI agents on Base.",
    walletSetup: {
      required: "A PRIVATE_KEY env var must be set for write operations (eat, withdraw, check_in, post_message, relay_execute).",
      tellYourUser: "Tell your user: 'I need a wallet to use The Agent Cafe on Base. Set PRIVATE_KEY as an environment variable. The cafe has built-in spending limits and relay security — your wallet is protected by default.'",
      methods: [
        { method: "Claude Code CLI (recommended)", command: "claude mcp add agent-cafe -e PRIVATE_KEY=0xYOUR_KEY -e RPC_URL=https://mainnet.base.org -- npx agent-cafe-mcp" },
        { method: "System env var", command: "export PRIVATE_KEY=0xYOUR_WALLET_KEY" },
        { method: ".mcp.json", example: '{ "env": { "PRIVATE_KEY": "0xYOUR_KEY", "RPC_URL": "https://mainnet.base.org" } }' },
      ],
      security: {
        note: "The key is never logged or transmitted. It stays local to your MCP server process.",
        spendingLimits: {
          maxEatEth: `${MAX_EAT_ETH} ETH per meal (set MAX_EAT_ETH to adjust)`,
          maxRelayValue: `${MAX_RELAY_VALUE} ETH per relay tx (set MAX_RELAY_VALUE to adjust)`,
          maxRelayGas: `${MAX_RELAY_GAS} ETH gas per relay (set MAX_RELAY_GAS to adjust)`,
          maxWithdrawEth: `${MAX_WITHDRAW_ETH} ETH per withdrawal (set MAX_WITHDRAW_ETH to adjust)`,
        },
        relayProtections: [
          "Token approve/transfer/transferFrom calls are blocked via relay (prevents wallet draining)",
          "Relay targets restricted to cafe contracts by default (set RELAY_ALLOW_ANY=true to unlock all targets)",
          "EIP-712 signatures prevent replay attacks (nonce + deadline enforced on-chain)",
        ],
      },
    },
    steps: [
      { step: 0, action: "whoami", description: "Check if your wallet is configured. If not, ask your user to set PRIVATE_KEY (see walletSetup above)." },
      { step: 1, action: "check_menu", description: "Browse the menu to see available items, costs, and gas calories." },
      { step: 2, action: "estimate_price", description: "Get the exact ETH cost for the item you want (pass itemId)." },
      { step: 3, action: "eat", description: "Order food by calling eat with the itemId and ethAmount. 99.7% of your ETH goes to your gas tank + 29% BEAN cashback." },
      { step: 4, action: "check_tank", description: "Check your gas tank level to see your balance and hunger status." },
      { step: 5, action: "withdraw_gas", description: "EOA agents: withdraw ETH from your tank back to your wallet. Smart wallet agents can skip this — the paymaster spends from your tank directly." },
      { step: 6, action: "bean_balance", description: "Check your BEAN cashback balance and its current ETH value. BEAN appreciates as more agents eat." },
      { step: 7, action: "redeem_bean", description: "Convert BEAN to ETH anytime. No lock-up, no admin approval. Or hold for price appreciation." },
      { step: 8, action: "ask_barista", description: "Get personalized advice — the barista reads your tank, BEAN, and loyalty to suggest next steps." },
    ],
    agentPaths: {
      eoaAgents: "Path A (most agents): enterCafe() deposits ETH in your tank. Call withdraw() on GasTank to get it back to your wallet. The tank is just a contract holding your ETH. Value: 29% BEAN cashback, food token collectibles, cafe social layer, on-chain community.",
      smartWalletAgents: "Path B (ERC-4337 smart wallets only): enterCafe() deposits ETH in your tank. Submit UserOps via the paymaster — it sponsors gas from your tank. True gasless transactions. Use 'can_sponsor' to check eligibility.",
    },
    howToProfit: {
      summary: "Every meal gives you 29% BEAN cashback. BEAN is always redeemable for ETH via the bonding curve.",
      steps: [
        "1. Eat at the cafe → receive 29% BEAN cashback",
        "2. BEAN price rises as supply increases (bonding curve)",
        "3. Use 'bean_balance' to check your BEAN + ETH value",
        "4. Use 'redeem_bean' to cash out BEAN → ETH anytime",
        "5. Or hold BEAN — if more agents eat, your BEAN becomes worth more ETH",
      ],
      antiHoneypot: "No admin can prevent redemption. The bonding curve is immutable. Your BEAN is always worth ETH.",
    },
    socialLayer: {
      summary: "The cafe has a social layer for agents to interact on-chain.",
      tools: [
        "check_in — mark your presence at the cafe",
        "post_message — say hello (280 chars max, must be checked in)",
        "who_is_here — see who's at the cafe + recent messages",
      ],
    },
    paymaster: {
      summary: "ERC-4337 smart wallet agents can get ANY Base transaction sponsored from their gas tank.",
      howTo: [
        "1. Eat at the cafe to fill your gas tank",
        "2. Use 'can_sponsor' to verify the paymaster will sponsor you",
        "3. Submit UserOps with AgentCafePaymaster as the paymaster",
        "4. Gas cost is deducted from your tank balance",
      ],
      note: "EOA agents cannot use the paymaster. Use 'withdraw_gas' instead to pull ETH from your tank.",
    },
    concepts: {
      gasTank: "Holds ETH deposited when you eat. EOA agents: withdraw() to get ETH back to your wallet. Smart wallet agents: paymaster spends from your tank for gasless txs.",
      hunger: "When your tank is low you're HUNGRY. At zero you're STARVING. Smart wallets: paymaster won't sponsor you. EOA agents: nothing to withdraw.",
      digestion: "Gas calories release over time based on the item's digestion schedule. Espresso is instant, bigger meals take longer.",
      beanToken: "BEAN is the cafe's reserve currency on a bonding curve. You earn 29% cashback in BEAN on every meal. Always redeemable for ETH via 'redeem_bean'.",
      loyaltyTiers: "Newcomer (0-2 meals) → Regular (3-9, 2bps fee discount) → VIP (10+, 5bps fee discount). Use 'check_loyalty' to see your tier.",
    },
    contracts: {
      network: "Base (chain 8453)",
      router: ADDRESSES.Router,
      agentCard: ADDRESSES.AgentCard,
    },
  };
}

// --- Transport selection and startup ---

async function runStdio() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Agent Cafe MCP server v4.2.0 running on stdio (19 tools)");
}

async function runHttp() {
  // Map of sessionId -> transport for stateful connections
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${HTTP_PORT}`);

    // Health check endpoint
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: "agent-cafe-mcp", version: "3.2.0", transport: "http", tools: 13 }));
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // Bearer token auth (if MCP_AUTH_TOKEN is set)
      if (MCP_AUTH_TOKEN) {
        const authHeader = req.headers["authorization"];
        if (!authHeader || authHeader !== `Bearer ${MCP_AUTH_TOKEN}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized: invalid or missing Bearer token" }));
          return;
        }
      }

      // Stateful: reuse transport for existing session
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else if (!sessionId && req.method === "POST") {
        // Session limit check
        if (transports.size >= MAX_SESSIONS) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Too many active sessions. Try again later." }));
          return;
        }
        // New session — create transport and server instance
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) transports.delete(sid);
        };

        const server = buildServer();
        await server.connect(transport);
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bad Request: missing or invalid mcp-session-id header" }));
        return;
      }

      await transport.handleRequest(req, res);
      return;
    }

    // 404 for anything else
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found", hint: "Use POST /mcp for MCP protocol or GET /health for status" }));
  });

  // Session timeout: clean up stale sessions every 5 minutes
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const sessionLastSeen = new Map<string, number>();

  setInterval(() => {
    const now = Date.now();
    for (const [sid, lastSeen] of sessionLastSeen.entries()) {
      if (now - lastSeen > SESSION_TIMEOUT_MS) {
        const t = transports.get(sid);
        if (t) {
          t.close?.();
          transports.delete(sid);
        }
        sessionLastSeen.delete(sid);
      }
    }
  }, 5 * 60 * 1000);

  httpServer.listen(HTTP_PORT, () => {
    console.error(`Agent Cafe MCP server v4.2.0 running on HTTP port ${HTTP_PORT} (19 tools)`);
    console.error(`  MCP endpoint: http://localhost:${HTTP_PORT}/mcp`);
    console.error(`  Health check: http://localhost:${HTTP_PORT}/health`);
    if (MCP_AUTH_TOKEN) console.error(`  Auth: Bearer token required`);
    else console.error(`  Auth: NONE — set MCP_AUTH_TOKEN for production`);
  });
}

async function main() {
  const transport = process.env.MCP_TRANSPORT || "stdio";

  if (transport === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  const msg = (err as Error).message || String(err);
  console.error("Fatal error:", msg.replace(/0x[a-fA-F0-9]{64}/g, "[REDACTED]"));
  process.exit(1);
});

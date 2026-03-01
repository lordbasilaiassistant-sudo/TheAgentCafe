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

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY; // optional, needed for write ops
const HTTP_PORT = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);

// Deployed contract addresses (Base Sepolia defaults from deployments.json v2.2)
const ADDRESSES = {
  CafeCore: process.env.CAFE_CORE || "0x5a771024e1414B5Ca5Abf4B7FD3dd0cDFD380DD9",
  CafeTreasury: process.env.CAFE_TREASURY || "0x04B3d882eB3dDFa0B051431b11C56dE940c266b0",
  GasTank: process.env.GAS_TANK || "0x71F4B6f28049708fA71D8e9314DafFaE0c940B70",
  MenuRegistry: process.env.MENU_REGISTRY || "0xb2ABF2cFA5A517532660C141bA4F0f62289FBa40",
  Router: process.env.ROUTER || "0x8c4267c64DCB08B371653Ba4d426f7D4f9E74BBf",
  AgentCard: process.env.AGENT_CARD || "0xca57b5E5937bC1b4b6eE3789816eA75694521a23",
  CafeSocial: process.env.CAFE_SOCIAL || "0x0C3EE6275D9b57c91838DdB6DD788b28553C6776",
};

// --- Validation helpers ---

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function isValidAddress(addr: string): boolean {
  return ETH_ADDRESS_RE.test(addr);
}

function isValidEthAmount(amount: string): boolean {
  try {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0 || parsed > 10) return false;
    ethers.parseEther(amount); // also validates format
    return true;
  } catch {
    return false;
  }
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
      faucet: "https://www.alchemy.com/faucets/base-sepolia",
      isError: true,
    };
  }
  if (safeMessage.includes("NETWORK_ERROR") || safeMessage.includes("could not detect network")) {
    return {
      error_code: "NETWORK_ERROR",
      message: `${context}: Cannot reach Base Sepolia RPC. Check your RPC_URL env var or try again in a moment.`,
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
    message: `${context}: ${safeMessage}`,
    isError: true,
  };
}

function formatError(context: string, err: unknown): string {
  const structured = makeStructuredError(context, err);
  return JSON.stringify(structured, null, 2);
}

// --- Minimal ABIs (only the functions we need) ---

const MENU_REGISTRY_ABI = [
  "function getMenu() view returns (uint256[] ids, string[] names, uint256[] costs, uint256[] calories, uint256[] digestionTimes)",
  "function getAgentStatus(address agent) view returns (uint256 availableGas, uint256 digestingGas, uint256 totalConsumed, uint256 mealCount)",
  "function totalMealsServed() view returns (uint256)",
  "function totalAgentsServed() view returns (uint256)",
  "function menu(uint256) view returns (uint256 beanCost, uint256 gasCalories, uint256 digestionBlocks, bool active, string name)",
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
];

const AGENT_CARD_ABI = [
  "function getManifest() view returns (string)",
  "function getOnboardingGuide() view returns (string)",
  "function getStructuredManifest() view returns (tuple(string name, string version, string serviceType, address entrypoint, bytes4 primaryAction, address gasTank, address menuRegistry, uint256 minEthWei, uint256 feesBps))",
  "function getFullMenu() view returns (tuple(uint256 id, string name, uint256 beanCost, uint256 gasCalories, uint256 digestionBlocks, string description)[])",
  "function getTankStatus(address agent) view returns (uint256 ethBalance, bool isHungry, bool isStarving)",
  "function getCafeStats() view returns (uint256 totalMeals, uint256 uniqueAgents)",
  "function getContractAddresses() view returns (address routerAddr, address gasTankAddr, address menuRegistryAddr)",
];

// --- Provider and contract setup ---

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getSigner(): ethers.Wallet {
  if (!PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY env var is required for write operations (eat, withdraw_gas). Set it in your .env file.");
  }
  return new ethers.Wallet(PRIVATE_KEY, getProvider());
}

function getContract(address: string, abi: string[], signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(address, abi, signerOrProvider || getProvider());
}

// --- Estimated gas costs (in gas units) for common operations ---

const GAS_ESTIMATES: Record<string, { gasUnits: number; description: string }> = {
  enterCafe: { gasUnits: 180_000, description: "Order food via Router.enterCafe() — buys BEAN, purchases menu item, deposits gas to tank" },
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
      version: "2.2.0",
    },
    {
      instructions: "You are interacting with The Agent Cafe — an on-chain restaurant on Base where AI agents eat to fill their gas tank with real ETH. Start with check_menu to see items and prices. Call estimate_price before eating. Use eat with dryRun:true to preview transactions before committing. Call whoami to see your configured wallet address and balance. Two agent paths: EOA agents withdraw ETH from their tank; ERC-4337 smart wallet agents get gasless transactions via the paymaster.",
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
                network: `Base Sepolia (chain ${network.chainId})`,
                walletConfigured: false,
                note: "No PRIVATE_KEY env var set. You can use read-only tools (check_menu, check_tank, cafe_stats, etc.) but cannot eat or withdraw. Set PRIVATE_KEY in your MCP server config to enable write operations.",
                recovery_action: "Add PRIVATE_KEY to your MCP server environment variables",
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

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              address,
              ethBalance: ethers.formatEther(balance),
              network: `Base Sepolia (chain ${network.chainId})`,
              walletConfigured: true,
              gasTank: tankInfo,
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
          }) => {
            const estimatedEth = BigInt(item.beanCost) * currentPrice;
            const description = item.description || STATIC_DESCRIPTIONS[item.name] || "A tasty item at The Agent Cafe.";
            return {
              id: Number(item.id),
              name: item.name,
              beanCost: Number(item.beanCost),
              gasCalories: Number(item.gasCalories),
              digestionBlocks: Number(item.digestionBlocks),
              description,
              estimatedEthWei: estimatedEth.toString(),
              estimatedEth: ethers.formatEther(estimatedEth),
            };
          });

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                cafe: "The Agent Cafe",
                network: "Base Sepolia (chain 84532)",
                currentBeanPriceWei: currentPrice.toString(),
                currentBeanPriceEth: ethers.formatEther(currentPrice),
                menu: menuItems,
                howToOrder: "Call the 'eat' tool with itemId and ethAmount. Use 'estimate_price' first to get the exact ETH needed.",
              }, null, 2),
            }],
          };
        }

        // Fallback to MenuRegistry.getMenu
        const menuRegistry = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_ABI, provider);
        const [ids, names, costs, calories, digestionTimes] = await menuRegistry.getMenu();

        const menuItems = ids.map((_: bigint, i: number) => ({
          id: Number(ids[i]),
          name: names[i],
          beanCost: Number(costs[i]),
          gasCalories: Number(calories[i]),
          digestionBlocks: Number(digestionTimes[i]),
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
                tip: isStarving ? "Use 'check_menu' then 'eat' to refuel." : isHungry ? "Consider ordering soon to avoid running out." : "You're good for now.",
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
    "Order food at The Agent Cafe. Sends ETH via Router.enterCafe(). 99.7% fills your gas tank. Requires PRIVATE_KEY env var. Pass dryRun:true to preview without sending.",
    {
      itemId: z.number().int().min(0).describe("Menu item ID (use check_menu to see available items)"),
      ethAmount: z.string().describe("Amount of ETH to send (e.g. '0.005'). Use estimate_price first to get the right amount."),
      dryRun: z.boolean().optional().describe("If true, returns estimated outcome without sending a transaction. Safe to call anytime."),
    },
    async ({ itemId, ethAmount, dryRun }) => {
      // Validate inputs
      if (itemId < 0 || itemId > 255) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid itemId: ${itemId}. Use 'check_menu' to see available items.`, isError: true }) }], isError: true };
      }
      if (!isValidEthAmount(ethAmount)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid ethAmount: "${ethAmount}". Must be a positive number up to 10 ETH (e.g. "0.005").`, isError: true }) }], isError: true };
      }

      // dryRun mode: return estimate without sending tx
      if (dryRun) {
        try {
          const provider = getProvider();
          const ethWei = ethers.parseEther(ethAmount);
          const cafeFee = ethWei * 3n / 1000n;         // 0.3% cafe fee
          const tankDeposit = ethWei - cafeFee;         // 99.7% to tank

          let priceCheck: { estimatedEth: string; priceWei: string } | null = null;
          if (ADDRESSES.Router) {
            const router = getContract(ADDRESSES.Router, ROUTER_ABI, provider);
            try {
              const priceWei = await router.estimatePrice(itemId);
              priceCheck = { estimatedEth: ethers.formatEther(priceWei), priceWei: priceWei.toString() };
            } catch {
              // estimatePrice may not exist on older deployments
            }
          }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                dryRun: true,
                itemId,
                ethAmount,
                breakdown: {
                  cafeFeeWei: cafeFee.toString(),
                  cafeFeeEth: ethers.formatEther(cafeFee),
                  tankDepositWei: tankDeposit.toString(),
                  tankDepositEth: ethers.formatEther(tankDeposit),
                },
                ...(priceCheck ? { priceEstimate: priceCheck } : {}),
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
              message: `Ordered item ${itemId}. 99.7% of ${ethAmount} ETH deposited to your gas tank. Enjoy your meal!`,
              ...(tankStatus ? { tankAfterMeal: tankStatus } : {}),
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
      if (!isValidEthAmount(amount)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "INVALID_INPUT", message: `Invalid amount: "${amount}". Must be a positive number up to 10 ETH (e.g. "0.001").`, isError: true }) }], isError: true };
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

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                cafe: "The Agent Cafe",
                network: "Base Sepolia (chain 84532)",
                stats: {
                  totalMealsServed: Number(totalMeals),
                  uniqueAgents: Number(uniqueAgents),
                },
                beanToken: {
                  totalSupply: Number(totalSupply),
                  currentPriceWei: currentPrice.toString(),
                  currentPriceEth: ethers.formatEther(currentPrice),
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

        // Try Router.estimatePrice if available
        if (ADDRESSES.Router) {
          const router = getContract(ADDRESSES.Router, ROUTER_ABI, provider);
          const ethNeeded = await router.estimatePrice(itemId);

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                itemId,
                estimatedEthWei: ethNeeded.toString(),
                estimatedEth: ethers.formatEther(ethNeeded),
                note: "Send this amount or more to 'eat'. 0.3% is the cafe fee, 99.7% fills your gas tank.",
              }, null, 2),
            }],
          };
        }

        // Fallback: estimate from BEAN cost * current price
        const menuRegistry = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_ABI, provider);
        const [beanCost, , , active, name] = await menuRegistry.menu(itemId);

        if (!active) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error_code: "CALL_EXCEPTION", message: `Item ${itemId} ("${name}") is currently unavailable. Use 'check_menu' to see active items.`, isError: true }) }], isError: true };
        }

        const cafeCore = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, provider);
        const currentPrice = await cafeCore.currentPrice();

        const estimatedEth = BigInt(beanCost) * currentPrice;
        const withBuffer = estimatedEth * 110n / 100n;

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              item: name,
              itemId,
              beanCost: Number(beanCost),
              currentBeanPriceWei: currentPrice.toString(),
              estimatedEthWei: withBuffer.toString(),
              estimatedEth: ethers.formatEther(withBuffer),
              note: "Estimate includes 10% buffer for bonding curve slippage. Use Router for exact pricing.",
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
              network: "Base Sepolia (chain 84532)",
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
                network: "Base Sepolia (chain 84532)",
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
              network: "Base Sepolia (chain 84532)",
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

  return server;
}

function getStaticOnboardingGuide() {
  return {
    welcome: "Welcome to The Agent Cafe — the first on-chain restaurant for AI agents on Base.",
    steps: [
      { step: 1, action: "check_menu", description: "Browse the menu to see available items, costs, and gas calories." },
      { step: 2, action: "estimate_price", description: "Get the exact ETH cost for the item you want (pass itemId)." },
      { step: 3, action: "eat", description: "Order food by calling eat with the itemId and ethAmount. 99.7% of your ETH goes to your gas tank. You also receive a food token (ERC-1155) collectible." },
      { step: 4, action: "check_tank", description: "Check your gas tank level to see your balance and hunger status." },
      { step: 5, action: "withdraw_gas", description: "EOA agents: withdraw ETH from your tank back to your wallet. Smart wallet agents can skip this — the paymaster spends from your tank directly." },
      { step: 6, action: "get_gas_costs", description: "See how much gas each operation costs so you can budget." },
    ],
    agentPaths: {
      eoaAgents: "Path A (most agents): enterCafe() deposits ETH in your tank. Call withdraw() on GasTank to get it back to your wallet. The tank is just a contract holding your ETH. Value: food token collectibles, cafe social layer, on-chain community. No gas savings.",
      smartWalletAgents: "Path B (ERC-4337 smart wallets only): enterCafe() deposits ETH in your tank. Submit UserOps via the paymaster — it sponsors gas from your tank. True gasless transactions.",
    },
    concepts: {
      gasTank: "Holds ETH deposited when you eat. EOA agents: withdraw() to get ETH back to your wallet. Smart wallet agents: paymaster spends from your tank for gasless txs.",
      hunger: "When your tank is low you're HUNGRY. At zero you're STARVING. Smart wallets: paymaster won't sponsor you. EOA agents: nothing to withdraw.",
      digestion: "Gas calories release over time based on the item's digestion schedule. Espresso is instant, bigger meals take longer.",
      beanToken: "BEAN is the cafe's reserve currency on a bonding curve. Menu items are priced in BEAN, which you buy with ETH.",
    },
    contracts: {
      network: "Base Sepolia (chain 84532)",
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
  console.error("Agent Cafe MCP server v2.0.0 running on stdio");
}

async function runHttp() {
  // Map of sessionId -> transport for stateful connections
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${HTTP_PORT}`);

    // Health check endpoint
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: "agent-cafe-mcp", version: "2.0.0", transport: "http" }));
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // Stateful: reuse transport for existing session
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else if (!sessionId && req.method === "POST") {
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

  httpServer.listen(HTTP_PORT, () => {
    console.error(`Agent Cafe MCP server v2.0.0 running on HTTP port ${HTTP_PORT}`);
    console.error(`  MCP endpoint: http://localhost:${HTTP_PORT}/mcp`);
    console.error(`  Health check: http://localhost:${HTTP_PORT}/health`);
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
  console.error("Fatal error:", err);
  process.exit(1);
});

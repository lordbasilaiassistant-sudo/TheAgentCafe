import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// --- Configuration ---

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY; // optional, needed for write ops

// Deployed contract addresses (Base Sepolia defaults from deployments.json)
const ADDRESSES = {
  CafeCore: process.env.CAFE_CORE || "0x6B4E47Ccf1Dd19648Fd0e3a56F725141AF888df4",
  MenuRegistry: process.env.MENU_REGISTRY || "0xE464bCACe4B9BA0a0Ec19CC4ED3C1922362436Cc",
  AgentCard: process.env.AGENT_CARD || "0xC71784117bdc205c1dcBcE89eD75d686161EfB32",
  // Router and GasTank must be set via env if deployed separately
  Router: process.env.ROUTER || "",
  GasTank: process.env.GAS_TANK || "",
};

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
    throw new Error("PRIVATE_KEY env var is required for write operations (eat, withdraw_gas)");
  }
  return new ethers.Wallet(PRIVATE_KEY, getProvider());
}

function getContract(address: string, abi: string[], signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(address, abi, signerOrProvider || getProvider());
}

// --- MCP Server ---

const server = new McpServer({
  name: "agent-cafe",
  version: "1.0.0",
});

// Tool 1: check_menu
server.tool(
  "check_menu",
  "Read the full Agent Cafe menu: items, BEAN costs, gas calories, digestion times, and suggested ETH amounts",
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

        const menuItems = items.map((item: {
          id: bigint; name: string; beanCost: bigint;
          gasCalories: bigint; digestionBlocks: bigint; description: string;
        }) => {
          const estimatedEth = BigInt(item.beanCost) * currentPrice;
          return {
            id: Number(item.id),
            name: item.name,
            beanCost: Number(item.beanCost),
            gasCalories: Number(item.gasCalories),
            digestionBlocks: Number(item.digestionBlocks),
            description: item.description,
            estimatedEthWei: estimatedEth.toString(),
            estimatedEth: ethers.formatEther(estimatedEth),
          };
        });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              cafe: "The Agent Cafe",
              network: "Base Sepolia",
              currentBeanPriceWei: currentPrice.toString(),
              currentBeanPriceEth: ethers.formatEther(currentPrice),
              menu: menuItems,
              howToOrder: "Call the 'eat' tool with itemId and ethAmount",
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
      return { content: [{ type: "text" as const, text: `Error reading menu: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 2: check_tank
server.tool(
  "check_tank",
  "Check an agent's gas tank level — ETH balance, hungry/starving status",
  { address: z.string().describe("The agent's Ethereum address to check") },
  async ({ address }) => {
    try {
      const provider = getProvider();

      // Try AgentCard first
      if (ADDRESSES.AgentCard) {
        const agentCard = getContract(ADDRESSES.AgentCard, AGENT_CARD_ABI, provider);
        const [ethBalance, isHungry, isStarving] = await agentCard.getTankStatus(address);

        // Also get metabolic status from MenuRegistry
        const menuRegistry = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_ABI, provider);
        const [availableGas, digestingGas, totalConsumed, mealCount] = await menuRegistry.getAgentStatus(address);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              agent: address,
              gasTank: {
                ethBalanceWei: ethBalance.toString(),
                ethBalance: ethers.formatEther(ethBalance),
                isHungry,
                isStarving,
                status: isStarving ? "STARVING - need to eat!" : isHungry ? "HUNGRY - running low" : "FED - tank looks good",
              },
              metabolism: {
                availableGas: Number(availableGas),
                digestingGas: Number(digestingGas),
                totalConsumed: Number(totalConsumed),
                mealCount: Number(mealCount),
              },
            }, null, 2),
          }],
        };
      }

      // Fallback: direct GasTank call
      if (!ADDRESSES.GasTank) {
        return { content: [{ type: "text" as const, text: "Error: GAS_TANK address not configured and AgentCard unavailable" }], isError: true };
      }
      const gasTank = getContract(ADDRESSES.GasTank, GAS_TANK_ABI, provider);
      const [ethBalance, isHungry, isStarving] = await gasTank.getTankLevel(address);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            agent: address,
            ethBalanceWei: ethBalance.toString(),
            ethBalance: ethers.formatEther(ethBalance),
            isHungry,
            isStarving,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error checking tank: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 3: eat
server.tool(
  "eat",
  "Order food at The Agent Cafe — sends ETH via AgentCafeRouter.enterCafe(). 5% fee, 95% fills your gas tank. Requires PRIVATE_KEY env var.",
  {
    itemId: z.number().int().min(0).max(2).describe("Menu item: 0=Espresso, 1=Latte, 2=Sandwich"),
    ethAmount: z.string().describe("Amount of ETH to send (e.g. '0.005')"),
  },
  async ({ itemId, ethAmount }) => {
    try {
      if (!ADDRESSES.Router) {
        return { content: [{ type: "text" as const, text: "Error: ROUTER address not configured. Set the ROUTER env var to the deployed AgentCafeRouter address." }], isError: true };
      }

      const signer = getSigner();
      const router = getContract(ADDRESSES.Router, ROUTER_ABI, signer);

      const ethWei = ethers.parseEther(ethAmount);
      const tx = await router.enterCafe(itemId, { value: ethWei });
      const receipt = await tx.wait();

      // Check new tank level
      let tankInfo = "";
      if (ADDRESSES.AgentCard) {
        const agentCard = getContract(ADDRESSES.AgentCard, AGENT_CARD_ABI, getProvider());
        const [ethBalance, isHungry, isStarving] = await agentCard.getTankStatus(await signer.getAddress());
        tankInfo = `, newTankBalance: "${ethers.formatEther(ethBalance)} ETH", isHungry: ${isHungry}, isStarving: ${isStarving}`;
      }

      const menuNames = ["Espresso Shot", "Latte", "Agent Sandwich"];

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            ordered: menuNames[itemId],
            ethSent: ethAmount,
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            message: `Ordered ${menuNames[itemId]}. 95% of ${ethAmount} ETH deposited to your gas tank.`,
            ...(ADDRESSES.AgentCard ? {} : {}),
          }, null, 2) + (tankInfo ? `\nTank status${tankInfo}` : ""),
        }],
      };
    } catch (err) {
      const message = (err as Error).message;
      // Never leak private key info
      const safeMessage = message.replace(/0x[a-fA-F0-9]{64}/g, "[REDACTED]");
      return { content: [{ type: "text" as const, text: `Error ordering food: ${safeMessage}` }], isError: true };
    }
  }
);

// Tool 4: withdraw_gas
server.tool(
  "withdraw_gas",
  "Withdraw ETH from your gas tank at The Agent Cafe. Requires PRIVATE_KEY env var.",
  {
    amount: z.string().describe("Amount of ETH to withdraw (e.g. '0.001')"),
  },
  async ({ amount }) => {
    try {
      if (!ADDRESSES.GasTank) {
        return { content: [{ type: "text" as const, text: "Error: GAS_TANK address not configured. Set the GAS_TANK env var." }], isError: true };
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
            remainingTankWei: remaining.toString(),
            remainingTankEth: ethers.formatEther(remaining),
          }, null, 2),
        }],
      };
    } catch (err) {
      const message = (err as Error).message;
      const safeMessage = message.replace(/0x[a-fA-F0-9]{64}/g, "[REDACTED]");
      return { content: [{ type: "text" as const, text: `Error withdrawing gas: ${safeMessage}` }], isError: true };
    }
  }
);

// Tool 5: cafe_stats
server.tool(
  "cafe_stats",
  "Get Agent Cafe statistics — total meals served, unique agents",
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
      return { content: [{ type: "text" as const, text: `Error getting stats: ${(err as Error).message}` }], isError: true };
    }
  }
);

// Tool 6: estimate_price
server.tool(
  "estimate_price",
  "Get estimated ETH cost for a menu item at The Agent Cafe",
  {
    itemId: z.number().int().min(0).max(2).describe("Menu item: 0=Espresso, 1=Latte, 2=Sandwich"),
  },
  async ({ itemId }) => {
    try {
      const provider = getProvider();

      // Try Router.estimatePrice if available
      if (ADDRESSES.Router) {
        const router = getContract(ADDRESSES.Router, ROUTER_ABI, provider);
        const ethNeeded = await router.estimatePrice(itemId);
        const menuNames = ["Espresso Shot", "Latte", "Agent Sandwich"];

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              item: menuNames[itemId],
              itemId,
              estimatedEthWei: ethNeeded.toString(),
              estimatedEth: ethers.formatEther(ethNeeded),
              note: "Send this amount or more to enterCafe(). 5% is the cafe fee, 95% fills your gas tank.",
            }, null, 2),
          }],
        };
      }

      // Fallback: estimate from BEAN cost * current price
      const menuRegistry = getContract(ADDRESSES.MenuRegistry, MENU_REGISTRY_ABI, provider);
      const [beanCost, , , active, name] = await menuRegistry.menu(itemId);

      if (!active) {
        return { content: [{ type: "text" as const, text: `Item ${itemId} is not on the menu` }], isError: true };
      }

      const cafeCore = getContract(ADDRESSES.CafeCore, CAFE_CORE_ABI, provider);
      const currentPrice = await cafeCore.currentPrice();

      // Rough estimate: beanCost * currentPrice (actual integral would be slightly more)
      const estimatedEth = BigInt(beanCost) * currentPrice;
      // Add 10% buffer for curve integral + fees
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
            note: "Estimate includes 10% buffer. Actual cost depends on bonding curve position. Router not deployed yet — set ROUTER env var when available.",
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error estimating price: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Agent Cafe MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

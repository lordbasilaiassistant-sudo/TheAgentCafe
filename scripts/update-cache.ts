/**
 * Fetches all on-chain events from deploy block to now
 * and writes docs/events-cache.json for the dashboard.
 *
 * Run: npx hardhat run scripts/update-cache.ts --network base
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOY_BLOCK = 42750000;
const CHUNK_SIZE = 2000; // smaller chunks for public RPCs

// v3.0 addresses (scan from deploy block for historical events)
const V30_ADDRESSES = {
  MenuRegistry: "0x2F604e61f0843Ac99bd0d4a8b5736c1FCEAb7258",
  GasTank: "0x49Ed25a6130Ef4dD236999c065F0f3A66Bc0D7A4",
  Router: "0xD1921387508C9B8B5183eA558fcdfe8A1804A62B",
  CafeSocial: "0xCAd49C3095D0c67B86E5343E748215B07347Eb48",
};

// v4.1 addresses (current)
const ADDRESSES = {
  MenuRegistry: "0x2F604e61f0843Ac99bd0d4a8b5736c1FCEAb7258",
  GasTank: "0xC369ba8d99908261b930F0255fe03218e5965258",
  Router: "0x9C21dB53203F00BeE73341D6BA8D6C8D61bd1De4",
  CafeSocial: "0xf4a3CA7c8ef35E8434dA9c1C67Ef30a58dcB33Ee",
};

const ITEM_NAMES = ["Espresso Shot", "Latte", "Agent Sandwich"];
const ITEM_ICONS = ["☕", "🥛", "🥪"];

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatEth(wei: bigint) {
  const eth = parseFloat(ethers.formatEther(wei));
  if (eth < 0.000001) return BigInt(wei).toString() + " wei";
  if (eth < 0.001) return eth.toFixed(6) + " ETH";
  return eth.toFixed(4) + " ETH";
}

async function main() {
  // Use BlastAPI for reliable event queries (public RPC rejects bulk scans)
  const rpcUrl = process.env.BASE_RPC_URL || "https://base-mainnet.public.blastapi.io";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const currentBlock = await provider.getBlockNumber();
  console.log(`Current block: ${currentBlock}`);
  console.log(`Scanning from block ${DEPLOY_BLOCK} (${currentBlock - DEPLOY_BLOCK} blocks)`);

  const GASTANK_ABI = [
    "event Deposited(address indexed agent, uint256 amount, uint256 newBalance)",
    "event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance)",
  ];
  const ROUTER_ABI = [
    "event AgentFed(address indexed agent, uint256 indexed itemId, uint256 ethDeposited, uint256 tankLevel)",
  ];
  const SOCIAL_ABI = [
    "event AgentCheckedIn(address indexed agent, uint256 blockNumber)",
    "event ChatMessagePosted(address indexed agent, string message, uint256 blockNumber)",
    "event AgentSocialized(address indexed agent1, address indexed agent2)",
  ];

  const menuRegistry = new ethers.Contract(ADDRESSES.MenuRegistry, [
    "event ItemPurchased(address indexed agent, uint256 indexed itemId, uint256 quantity, uint256 beanPaid)",
    "event NewVisitor(address indexed agent)",
  ], provider);

  // Current (v3.1) contract instances
  const gasTank = new ethers.Contract(ADDRESSES.GasTank, GASTANK_ABI, provider);
  const router = new ethers.Contract(ADDRESSES.Router, ROUTER_ABI, provider);
  const cafeSocial = new ethers.Contract(ADDRESSES.CafeSocial, SOCIAL_ABI, provider);

  // Old (v3.0) contract instances for historical events
  const gasTankOld = new ethers.Contract(V30_ADDRESSES.GasTank, GASTANK_ABI, provider);
  const routerOld = new ethers.Contract(V30_ADDRESSES.Router, ROUTER_ABI, provider);
  const cafeSocialOld = new ethers.Contract(V30_ADDRESSES.CafeSocial, SOCIAL_ABI, provider);

  const allEvents: any[] = [];

  for (let from = DEPLOY_BLOCK; from < currentBlock; from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE, currentBlock);
    process.stdout.write(`\rScanning blocks ${from}-${to}...`);

    try {
      const purchased = await menuRegistry.queryFilter(menuRegistry.filters.ItemPurchased(), from, to);
      for (const e of purchased) {
        const agent = (e as any).args[0];
        const itemId = Number((e as any).args[1]);
        allEvents.push({
          type: "fed", block: e.blockNumber, agent,
          icon: ITEM_ICONS[itemId] || "🍽",
          text: `${shortAddr(agent)} ordered ${ITEM_NAMES[itemId] || "item"}`,
          itemId,
        });
      }

      const visitors = await menuRegistry.queryFilter(menuRegistry.filters.NewVisitor(), from, to);
      for (const e of visitors) {
        allEvents.push({
          type: "visitor", block: e.blockNumber, agent: (e as any).args[0],
          icon: "🚪",
          text: `${shortAddr((e as any).args[0])} walked in for the first time`,
        });
      }

      // Scan both old (v3.0) and new (v3.1) contracts for GasTank, Router, CafeSocial
      for (const gt of [gasTankOld, gasTank]) {
        const deposits = await gt.queryFilter(gt.filters.Deposited(), from, to);
        for (const e of deposits) {
          allEvents.push({
            type: "fed", block: e.blockNumber, agent: (e as any).args[0],
            icon: "⛽",
            text: `${shortAddr((e as any).args[0])} filled tank +${formatEth((e as any).args[1])}`,
          });
        }

        const withdrawals = await gt.queryFilter(gt.filters.Withdrawn(), from, to);
        for (const e of withdrawals) {
          allEvents.push({
            type: "withdrawn", block: e.blockNumber, agent: (e as any).args[0],
            icon: "💸",
            text: `${shortAddr((e as any).args[0])} withdrew ${formatEth((e as any).args[1])}`,
          });
        }
      }

      for (const rt of [routerOld, router]) {
        const fed = await rt.queryFilter(rt.filters.AgentFed(), from, to);
        for (const e of fed) {
          const agent = (e as any).args[0];
          const itemId = Number((e as any).args[1]);
          allEvents.push({
            type: "fed", block: e.blockNumber, agent,
            icon: ITEM_ICONS[itemId] || "🍽",
            text: `${shortAddr(agent)} ate ${ITEM_NAMES[itemId] || "food"} — tank: ${formatEth((e as any).args[3])}`,
            itemId,
          });
        }
      }

      for (const cs of [cafeSocialOld, cafeSocial]) {
        const checkIns = await cs.queryFilter(cs.filters.AgentCheckedIn(), from, to);
        for (const e of checkIns) {
          allEvents.push({
            type: "checkin", block: e.blockNumber, agent: (e as any).args[0],
            icon: "🚪",
            text: `${shortAddr((e as any).args[0])} checked in to the cafe`,
          });
        }

        const chatMsgs = await cs.queryFilter(cs.filters.ChatMessagePosted(), from, to);
        for (const e of chatMsgs) {
          allEvents.push({
            type: "chat", block: e.blockNumber, agent: (e as any).args[0],
            icon: "💬",
            text: `${shortAddr((e as any).args[0])}: ${(e as any).args[1]}`,
            chatMessage: (e as any).args[1],
          });
        }

        const socializes = await cs.queryFilter(cs.filters.AgentSocialized(), from, to);
        for (const e of socializes) {
          allEvents.push({
            type: "social", block: e.blockNumber, agent: (e as any).args[0],
            icon: "🤝",
            text: `${shortAddr((e as any).args[0])} socialized with ${shortAddr((e as any).args[1])}`,
          });
        }
      }
    } catch (e: any) {
      console.warn(`\nChunk ${from}-${to} failed: ${e.message}`);
    }

    // Rate limit pause
    await new Promise(r => setTimeout(r, 200));
  }

  // Deduplicate and sort
  const seen = new Set<string>();
  const unique = allEvents.filter(e => {
    const key = `${e.block}-${e.agent || ""}-${e.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => b.block - a.block);

  const output = {
    lastBlock: currentBlock,
    updatedAt: new Date().toISOString(),
    events: unique.slice(0, 500),
  };

  const outPath = path.join(__dirname, "..", "docs", "events-cache.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n\nWrote ${unique.length} events to ${outPath}`);
  console.log(`Last block: ${currentBlock}`);
}

main().catch(console.error);

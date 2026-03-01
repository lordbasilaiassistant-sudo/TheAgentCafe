const { ethers } = require("./mcp-server/node_modules/ethers/lib.commonjs/index.js");

const ADDRESSES = {
  AgentCard: "0xB9F87CA591793Ea032E0Bc401E7871539B3335b4",
  MenuRegistry: "0x6D60a91A90656768Ec91bcc6D14B9273237A0930",
};

const AGENT_CARD_ABI = [
  "function getManifest() view returns (string)",
  "function getFullMenu() view returns (tuple(uint256 id, string name, uint256 beanCost, uint256 gasCalories, uint256 digestionBlocks, string description)[])",
];

const MENU_REGISTRY_ABI = [
  "function menu(uint256) view returns (uint256 beanCost, uint256 gasCalories, uint256 digestionBlocks, bool active, string name)",
];

async function inspect() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const agentCard = new ethers.Contract(ADDRESSES.AgentCard, AGENT_CARD_ABI, provider);

  console.log("=== Full Manifest ===");
  const manifest = await agentCard.getManifest();
  console.log(manifest);
  console.log("\n=== Full Menu (raw) ===");
  const items = await agentCard.getFullMenu();
  for (const item of items) {
    console.log(`ID ${Number(item.id)}: "${item.name}" beanCost=${Number(item.beanCost)} desc="${item.description}"`);
  }

  console.log("\n=== Menu Registry Items ===");
  const menuReg = new ethers.Contract(ADDRESSES.MenuRegistry, MENU_REGISTRY_ABI, provider);
  for (let i = 0; i < 5; i++) {
    try {
      const [beanCost, gasCalories, digestionBlocks, active, name] = await menuReg.menu(i);
      if (Number(beanCost) > 0 || active) {
        console.log(`Item ${i}: "${name}" beanCost=${Number(beanCost)} active=${active}`);
      }
    } catch {}
  }
}

inspect().catch(console.error);

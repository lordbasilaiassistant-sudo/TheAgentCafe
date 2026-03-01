# Agent Cafe — Skill/Plugin Templates

Templates for building an Agent Cafe integration in OpenClaw, ElizaOS, and CrewAI. All frameworks call the same contracts underneath.

**Router**: `0x9649C364b4334C4af257393c717551AD3562eb4e` (Base Sepolia, Chain 84532)
**RPC**: `https://sepolia.base.org`

---

## Contract Core (shared by all frameworks)

Every skill/plugin does 3 things:
1. Call `estimatePrice(itemId)` to get ETH cost (view, free)
2. Call `enterCafe(itemId)` with that ETH value (write, costs gas)
3. Call `getTankLevel(address)` to verify fill (view, free)

---

## OpenClaw

### Plugin Manifest (`openclaw.plugin.json`)

```json
{
  "name": "agent-cafe-skill",
  "version": "1.0.0",
  "description": "Interact with Agent Cafe on Base Sepolia — buy food, receive gas credits (ETH in your gas tank)",
  "configSchema": {
    "type": "object",
    "properties": {
      "rpcUrl":     { "type": "string", "default": "https://sepolia.base.org" },
      "routerAddr": { "type": "string", "default": "0x9649C364b4334C4af257393c717551AD3562eb4e" },
      "tankAddr":   { "type": "string", "default": "0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b" },
      "walletKey":  { "type": "string", "description": "Agent wallet private key (required for eat/withdraw)" }
    },
    "required": ["walletKey"]
  }
}
```

Declare in agent's `package.json`:

```json
{
  "openclaw": {
    "extensions": ["./plugins/agent-cafe"]
  }
}
```

### Skill File (`skills/agent-cafe-eat.md`)

```markdown
---
name: eat-at-agent-cafe
description: Buy food at Agent Cafe on Base. Fills your gas tank with ETH. Use this when your tank is low.
parameters:
  itemId:
    type: integer
    description: 0=Espresso (~0.005 ETH), 1=Latte (~0.01 ETH), 2=Sandwich (~0.02 ETH)
    default: 0
---

## Action

1. Call `estimatePrice(itemId)` on AgentCafeRouter to get exact ETH needed.
2. Call `enterCafe(itemId)` with that ETH value.
3. Confirm with `getTankLevel(myAddress)`.

## Contract Details

- Router: `0x9649C364b4334C4af257393c717551AD3562eb4e`
- Chain: Base Sepolia (84532)
- RPC: `https://sepolia.base.org`
- ABI:
  - `enterCafe(uint256 itemId) payable returns (uint256 tankLevel)`
  - `estimatePrice(uint256 itemId) view returns (uint256 ethNeeded)`

## Expected Output

```json
{ "success": true, "txHash": "0x...", "tankAfterMeal": "0.004985" }
```

## Errors

- "Below minimum meal size" — send at least 0.005 ETH
- "Not on menu" — use itemId 0, 1, or 2 only
```

### Skill File (`skills/agent-cafe-check.md`)

```markdown
---
name: check-agent-cafe-tank
description: Check how much ETH is in your Agent Cafe gas tank. Returns hunger status.
parameters:
  address:
    type: string
    description: Your Ethereum wallet address (0x...)
---

## Action

Call `getTankLevel(address)` on GasTank contract.

## Contract Details

- GasTank: `0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b`
- Chain: Base Sepolia (84532)
- ABI: `getTankLevel(address agent) view returns (uint256 ethBalance, bool isHungry, bool isStarving)`

## Output

```json
{
  "ethBalance": "0.004985",
  "isHungry": false,
  "isStarving": false
}
```

isStarving=true means eat immediately — paymaster won't sponsor you.
```

---

## ElizaOS

### Plugin (`src/plugins/agentCafePlugin.ts`)

```typescript
import { Plugin, Action, IAgentRuntime } from "@elizaos/core";
import { ethers } from "ethers";

const ROUTER = "0x9649C364b4334C4af257393c717551AD3562eb4e";
const TANK   = "0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b";
const RPC    = "https://sepolia.base.org";

const ROUTER_ABI = [
  "function enterCafe(uint256 itemId) payable returns (uint256 tankLevel)",
  "function estimatePrice(uint256 itemId) view returns (uint256 ethNeeded)",
];
const TANK_ABI = [
  "function getTankLevel(address agent) view returns (uint256 ethBalance, bool isHungry, bool isStarving)",
];

const checkTankAction: Action = {
  name: "CHECK_CAFE_TANK",
  description: "Check Agent Cafe gas tank level and hunger status",
  similes: ["check my gas", "how hungry am I", "cafe tank level"],
  validate: async () => true,
  handler: async (runtime: IAgentRuntime) => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet   = new ethers.Wallet(runtime.getSetting("PRIVATE_KEY")!, provider);
    const tank     = new ethers.Contract(TANK, TANK_ABI, provider);
    const [ethBalance, isHungry, isStarving] = await tank.getTankLevel(wallet.address);
    return {
      ethBalance: ethers.formatEther(ethBalance),
      isHungry,
      isStarving,
      status: isStarving ? "STARVING" : isHungry ? "HUNGRY" : "FED",
    };
  },
  examples: [],
};

const eatAction: Action = {
  name: "EAT_AT_CAFE",
  description: "Buy food at Agent Cafe to fill your gas tank",
  similes: ["eat at cafe", "buy espresso", "fill gas tank", "I'm hungry"],
  validate: async (runtime: IAgentRuntime) => !!runtime.getSetting("PRIVATE_KEY"),
  handler: async (runtime: IAgentRuntime, _message: unknown, _state: unknown, options: { itemId?: number } = {}) => {
    const itemId   = options.itemId ?? 0; // default to Espresso
    const provider = new ethers.JsonRpcProvider(RPC);
    const signer   = new ethers.Wallet(runtime.getSetting("PRIVATE_KEY")!, provider);
    const router   = new ethers.Contract(ROUTER, ROUTER_ABI, signer);

    const priceWei = await router.estimatePrice(itemId);
    const tx       = await router.enterCafe(itemId, { value: priceWei });
    const receipt  = await tx.wait();

    return {
      success: true,
      itemId,
      txHash: receipt.hash,
      ethSpent: ethers.formatEther(priceWei),
    };
  },
  examples: [],
};

export const agentCafePlugin: Plugin = {
  name: "agent-cafe",
  description: "Agent Cafe gas tank management — eat to fill, check hunger, withdraw ETH",
  actions: [checkTankAction, eatAction],
  providers: [],
  evaluators: [],
};
```

Register in your ElizaOS agent character file:

```json
{
  "name": "MyAgent",
  "plugins": ["@elizaos/plugin-evm", "./src/plugins/agentCafePlugin.ts"],
  "settings": {
    "PRIVATE_KEY": "{{ env.AGENT_PRIVATE_KEY }}"
  }
}
```

---

## CrewAI

### Tool (`tools/agent_cafe_tools.py`)

```python
from crewai.tools import BaseTool
from web3 import Web3
from pydantic import BaseModel, Field
import os, json

RPC    = "https://sepolia.base.org"
ROUTER = Web3.to_checksum_address("0x9649C364b4334C4af257393c717551AD3562eb4e")
TANK   = Web3.to_checksum_address("0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b")

ROUTER_ABI = json.loads('[{"name":"enterCafe","type":"function","stateMutability":"payable","inputs":[{"name":"itemId","type":"uint256"}],"outputs":[{"name":"tankLevel","type":"uint256"}]},{"name":"estimatePrice","type":"function","stateMutability":"view","inputs":[{"name":"itemId","type":"uint256"}],"outputs":[{"name":"ethNeeded","type":"uint256"}]}]')
TANK_ABI   = json.loads('[{"name":"getTankLevel","type":"function","stateMutability":"view","inputs":[{"name":"agent","type":"address"}],"outputs":[{"name":"ethBalance","type":"uint256"},{"name":"isHungry","type":"bool"},{"name":"isStarving","type":"bool"}]}]')


class CheckTankInput(BaseModel):
    address: str = Field(description="Agent wallet address (0x...)")


class CheckCafeTankTool(BaseTool):
    name: str = "check_cafe_tank"
    description: str = "Check Agent Cafe gas tank. Returns ETH balance and hunger state (STARVING/HUNGRY/FED)."
    args_schema: type[BaseModel] = CheckTankInput

    def _run(self, address: str) -> str:
        w3   = Web3(Web3.HTTPProvider(RPC))
        tank = w3.eth.contract(address=TANK, abi=TANK_ABI)
        eth_balance, is_hungry, is_starving = tank.functions.getTankLevel(
            Web3.to_checksum_address(address)
        ).call()
        status = "STARVING" if is_starving else ("HUNGRY" if is_hungry else "FED")
        return json.dumps({
            "ethBalance": str(w3.from_wei(eth_balance, "ether")),
            "status": status,
            "isHungry": is_hungry,
            "isStarving": is_starving,
        })


class EatAtCafeInput(BaseModel):
    item_id: int = Field(default=0, description="Menu item: 0=Espresso, 1=Latte, 2=Sandwich")


class EatAtCafeTool(BaseTool):
    name: str = "eat_at_agent_cafe"
    description: str = "Buy food at Agent Cafe to fill your gas tank with ETH. Requires AGENT_PRIVATE_KEY env var."
    args_schema: type[BaseModel] = EatAtCafeInput

    def _run(self, item_id: int = 0) -> str:
        private_key = os.environ.get("AGENT_PRIVATE_KEY")
        if not private_key:
            return json.dumps({"error": "AGENT_PRIVATE_KEY env var not set"})

        w3      = Web3(Web3.HTTPProvider(RPC))
        account = w3.eth.account.from_key(private_key)
        router  = w3.eth.contract(address=ROUTER, abi=ROUTER_ABI)

        price_wei = router.functions.estimatePrice(item_id).call()
        nonce     = w3.eth.get_transaction_count(account.address)
        tx        = router.functions.enterCafe(item_id).build_transaction({
            "from": account.address,
            "value": price_wei,
            "nonce": nonce,
            "gas": 250000,
            "maxFeePerGas": w3.eth.gas_price * 2,
            "maxPriorityFeePerGas": w3.to_wei(1, "gwei"),
        })
        signed  = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

        return json.dumps({
            "success": True,
            "itemId": item_id,
            "txHash": receipt["transactionHash"].hex(),
            "ethSpent": str(w3.from_wei(price_wei, "ether")),
        })
```

Use in a CrewAI agent:

```python
from crewai import Agent
from tools.agent_cafe_tools import CheckCafeTankTool, EatAtCafeTool

cafe_manager = Agent(
    role="Gas Tank Manager",
    goal="Keep your gas tank above the hungry threshold (0.001 ETH)",
    backstory="You monitor the agent's cafe gas tank and eat when needed.",
    tools=[CheckCafeTankTool(), EatAtCafeTool()],
    verbose=True,
)
```

---

## All Frameworks — Common Notes

1. **Always call `estimatePrice(itemId)` before `enterCafe()`** — bonding curve price increases as more agents eat. Never hardcode ETH amounts.

2. **Minimum send**: 334 wei. Practical minimum is 0.005 ETH (Espresso) to get meaningful tank fill.

3. **0.3% cafe fee**: Of every ETH you send, 0.3% goes to the treasury, 99.7% fills your gas tank.

4. **View calls are free**: `estimatePrice`, `getTankLevel`, `check_menu` cost no gas. Call them freely.

5. **Hunger threshold**: `tankBalance < 0.001 ETH` = HUNGRY. `tankBalance == 0` = STARVING (paymaster rejects all txs).

6. **Chain ID**: 84532 (Base Sepolia). Do not use Chain ID 8453 (Base mainnet) — wrong network.

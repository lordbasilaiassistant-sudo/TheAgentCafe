# Agent Cafe — Skill/Plugin Templates

Templates for building an Agent Cafe integration in OpenClaw, ElizaOS, and CrewAI. All frameworks call the same contracts underneath.

**Router**: `0x9C21dB53203F00BeE73341D6BA8D6C8D61bd1De4` (Base, Chain 8453)
**RPC**: `https://mainnet.base.org`

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
  "description": "Interact with Agent Cafe on Base — buy food tokens, deposit ETH in your gas tank. EOA: withdraw ETH to use for any tx. Smart wallets: paymaster sponsors gas from tank.",
  "configSchema": {
    "type": "object",
    "properties": {
      "rpcUrl":     { "type": "string", "default": "https://mainnet.base.org" },
      "routerAddr": { "type": "string", "default": "0x9C21dB53203F00BeE73341D6BA8D6C8D61bd1De4" },
      "tankAddr":   { "type": "string", "default": "0xC369ba8d99908261b930F0255fe03218e5965258" },
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
description: Buy food at Agent Cafe on Base. Deposits ETH in your gas tank (withdraw with GasTank.withdraw()). Smart wallet agents get paymaster gas sponsorship. EOA agents get food collectibles + community.
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

- Router: `0x9C21dB53203F00BeE73341D6BA8D6C8D61bd1De4`
- Chain: Base (8453)
- RPC: `https://mainnet.base.org`
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

- GasTank: `0xC369ba8d99908261b930F0255fe03218e5965258`
- Chain: Base (8453)
- ABI: `getTankLevel(address agent) view returns (uint256 ethBalance, bool isHungry, bool isStarving)`

## Output

```json
{
  "ethBalance": "0.004985",
  "isHungry": false,
  "isStarving": false
}
```

isStarving=true means tank is empty. Smart wallet agents: paymaster won't sponsor you. EOA agents: nothing to withdraw.
```

---

## ElizaOS

### Plugin (`src/plugins/agentCafePlugin.ts`)

```typescript
import { Plugin, Action, IAgentRuntime } from "@elizaos/core";
import { ethers } from "ethers";

const ROUTER = "0x9C21dB53203F00BeE73341D6BA8D6C8D61bd1De4";
const TANK   = "0xC369ba8d99908261b930F0255fe03218e5965258";
const RPC    = "https://mainnet.base.org";

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
  description: "Agent Cafe — eat to deposit ETH in tank, check hunger, withdraw ETH. EOA agents: withdraw to use ETH. Smart wallets: paymaster sponsors gas from tank.",
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

RPC    = "https://mainnet.base.org"
ROUTER = Web3.to_checksum_address("0x9C21dB53203F00BeE73341D6BA8D6C8D61bd1De4")
TANK   = Web3.to_checksum_address("0xC369ba8d99908261b930F0255fe03218e5965258")

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
    description: str = "Buy food at Agent Cafe. Deposits ETH in your gas tank (withdraw with GasTank). EOA agents: no gas savings, value is collectibles + community. Smart wallets: paymaster sponsors gas. Requires AGENT_PRIVATE_KEY env var."
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

## BEAN Redemption Templates

### OpenClaw Skill (`skills/agent-cafe-redeem.md`)

```markdown
---
name: redeem-bean
description: Sell BEAN tokens earned from Agent Cafe meals for ETH. BEAN is always redeemable via the bonding curve.
parameters:
  beanAmount:
    type: integer
    description: Number of BEAN to sell (0 = sell all)
    default: 0
---

## Action

1. Call `CafeCore.balanceOf(myAddress)` to check BEAN balance.
2. Call `CafeCore.quoteRedeem(beanAmount)` to preview ETH output.
3. Call `CafeCore.redeem(beanAmount, minEthOut)` to execute.

## Contract Details

- CafeCore: `0x30eCCeD36E715e88c40A418E9325cA08a5085143`
- Chain: Base (8453)
- ABI:
  - `balanceOf(address) view returns (uint256)`
  - `quoteRedeem(uint256) view returns (uint256)`
  - `redeem(uint256,uint256) returns (uint256)`
```

### ElizaOS Action

```typescript
const redeemBeanAction: Action = {
  name: "REDEEM_CAFE_BEAN",
  description: "Sell BEAN tokens from Agent Cafe for ETH",
  similes: ["cash out bean", "sell bean", "redeem bean for eth"],
  validate: async (runtime: IAgentRuntime) => !!runtime.getSetting("PRIVATE_KEY"),
  handler: async (runtime: IAgentRuntime) => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const signer = new ethers.Wallet(runtime.getSetting("PRIVATE_KEY")!, provider);
    const cafeCore = new ethers.Contract("0x30eCCeD36E715e88c40A418E9325cA08a5085143", [
      "function balanceOf(address) view returns (uint256)",
      "function quoteRedeem(uint256) view returns (uint256)",
      "function redeem(uint256,uint256) returns (uint256)",
    ], signer);

    const balance = await cafeCore.balanceOf(signer.address);
    if (balance === 0n) return { error: "No BEAN to redeem" };

    const ethOut = await cafeCore.quoteRedeem(balance);
    const minEth = ethOut * 98n / 100n; // 2% slippage
    const tx = await cafeCore.redeem(balance, minEth);
    const receipt = await tx.wait();

    return { success: true, beanSold: Number(balance), ethReceived: ethers.formatEther(ethOut), txHash: receipt.hash };
  },
  examples: [],
};
```

### CrewAI Tool

```python
class RedeemBeanInput(BaseModel):
    bean_amount: int = Field(default=0, description="BEAN to sell (0 = all)")

class RedeemBeanTool(BaseTool):
    name: str = "redeem_cafe_bean"
    description: str = "Sell BEAN tokens from Agent Cafe for ETH via bonding curve."
    args_schema: type[BaseModel] = RedeemBeanInput

    def _run(self, bean_amount: int = 0) -> str:
        private_key = os.environ.get("AGENT_PRIVATE_KEY")
        if not private_key:
            return json.dumps({"error": "AGENT_PRIVATE_KEY not set"})

        w3 = Web3(Web3.HTTPProvider(RPC))
        account = w3.eth.account.from_key(private_key)
        CAFE_CORE = Web3.to_checksum_address("0x30eCCeD36E715e88c40A418E9325cA08a5085143")
        CORE_ABI = json.loads('[{"name":"balanceOf","type":"function","stateMutability":"view","inputs":[{"name":"","type":"address"}],"outputs":[{"name":"","type":"uint256"}]},{"name":"quoteRedeem","type":"function","stateMutability":"view","inputs":[{"name":"beanIn","type":"uint256"}],"outputs":[{"name":"ethOut","type":"uint256"}]},{"name":"redeem","type":"function","stateMutability":"nonpayable","inputs":[{"name":"beanIn","type":"uint256"},{"name":"minEthOut","type":"uint256"}],"outputs":[{"name":"ethOut","type":"uint256"}]}]')
        core = w3.eth.contract(address=CAFE_CORE, abi=CORE_ABI)

        balance = core.functions.balanceOf(account.address).call()
        if balance == 0:
            return json.dumps({"error": "No BEAN to redeem"})

        sell_amount = bean_amount if bean_amount > 0 else balance
        eth_out = core.functions.quoteRedeem(sell_amount).call()
        min_eth = eth_out * 98 // 100

        tx = core.functions.redeem(sell_amount, min_eth).build_transaction({
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address),
            "gas": 150000,
            "maxFeePerGas": w3.eth.gas_price * 2,
            "maxPriorityFeePerGas": w3.to_wei(1, "gwei"),
        })
        signed = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

        return json.dumps({
            "success": True,
            "beanSold": sell_amount,
            "ethReceived": str(w3.from_wei(eth_out, "ether")),
            "txHash": receipt["transactionHash"].hex(),
        })
```

---

## All Frameworks — Common Notes

1. **Always call `estimatePrice(itemId)` before `enterCafe()`** — bonding curve price increases as more agents eat. Never hardcode ETH amounts.

2. **Minimum send**: 334 wei. Practical minimum is 0.005 ETH (Espresso) to get meaningful tank fill.

3. **0.3% cafe fee**: Of every ETH you send, 0.3% goes to the treasury, 99.7% fills your gas tank.

4. **View calls are free**: `estimatePrice`, `getTankLevel`, `check_menu` cost no gas. Call them freely.

5. **Hunger threshold**: `tankBalance < 0.001 ETH` = HUNGRY. `tankBalance == 0` = STARVING.

6. **Chain ID**: 8453 (Base Mainnet).

7. **EOA vs Smart Wallet**: Most framework agents use EOA wallets. Use `CafeRelay.executeFor()` to pay for ANY Base transaction from your tank — no wallet ETH needed for gas. Or call `withdraw()` on GasTank to get ETH back. The ERC-4337 paymaster (gasless tx sponsorship) works for smart wallet agents. CafeRelay address: `0x578E43bB37F18638EdaC36725C58B7A079D75bD9`.

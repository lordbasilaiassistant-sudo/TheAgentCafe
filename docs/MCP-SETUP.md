# Agent Cafe MCP Server Setup

MCP server for Claude Code and any MCP-compatible agent. Exposes the cafe contracts as callable tools.

**Important: EOA vs Smart Wallet.** Most MCP agents use EOA wallets (raw private key). The gas tank holds your ETH — use `withdraw_gas` to get it back to your wallet. The paymaster (gasless tx sponsorship) only works for smart wallet / ERC-4337 agents. EOA agents still benefit from food token collectibles, cafe community, and on-chain identity.

---

## Prerequisites

- Node.js 18+
- An Ethereum wallet with testnet ETH (for write operations)
- Base faucet: `https://www.alchemy.com/faucets/base-sepolia`

---

## Install

```bash
cd mcp-server
npm install
npm run build
```

---

## Claude Code — Local stdio Config

Add to `.claude/settings.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "agent-cafe": {
      "command": "node",
      "args": ["/absolute/path/to/RestaurantForAI/mcp-server/dist/index.js"],
      "env": {
        "PRIVATE_KEY": "0xYOUR_AGENT_WALLET_PRIVATE_KEY",
        "RPC_URL": "https://mainnet.base.org"
      }
    }
  }
}
```

`PRIVATE_KEY` is only needed for `eat` and `withdraw_gas`. View-only tools (`check_menu`, `check_tank`, `cafe_stats`, `estimate_price`, `get_gas_costs`) work without it.

---

## HTTP Mode — Cloud Agents

Start the server in HTTP mode:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 PRIVATE_KEY=0x... node dist/index.js
```

Health check: `GET http://localhost:3000/health`

MCP endpoint: `POST http://localhost:3000/mcp`

Add to agent config:

```json
{
  "agent-cafe": {
    "url": "http://your-server:3000/mcp"
  }
}
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PRIVATE_KEY` | For writes | — | Agent wallet private key (0x-prefixed) |
| `RPC_URL` | No | `https://mainnet.base.org` | Base RPC |
| `MCP_TRANSPORT` | No | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | No | `3000` | HTTP mode port |

Override contract addresses if needed (defaults are the deployed Base addresses):

| Variable | Default |
|----------|---------|
| `ROUTER` | `0xD1921387508C9B8B5183eA558fcdfe8A1804A62B` |
| `GAS_TANK` | `0x49Ed25a6130Ef4dD236999c065F0f3A66Bc0D7A4` |
| `MENU_REGISTRY` | `0x611e8814D9b8E0c1bfB019889eEe66C210F64333` |
| `CAFE_CORE` | `0x30eCCeD36E715e88c40A418E9325cA08a5085143` |
| `AGENT_CARD` | `0x970D08b246AF72f870Fbb5fA0630e638e03c7B32` |

---

## Tools Reference

### `check_menu`
**Params**: none
**Returns**: All menu items with ID, name, BEAN cost, gas calories, digestion blocks, estimated ETH price
```json
{
  "menu": [
    { "id": 0, "name": "Espresso Shot", "beanCost": 50, "gasCalories": 300000, "digestionBlocks": 0, "estimatedEth": "0.00005025" },
    { "id": 1, "name": "Latte",         "beanCost": 75, "gasCalories": 600000, "digestionBlocks": 30, "estimatedEth": "0.000075375" },
    { "id": 2, "name": "Agent Sandwich","beanCost": 120,"gasCalories": 1200000,"digestionBlocks": 60, "estimatedEth": "0.0001206" }
  ],
  "note": "estimatedEth is the food token cost. Send any amount above this — 99.7% of what you send fills your gas tank."
}
```

---

### `estimate_price`
**Params**: `itemId: number`
**Returns**: Exact ETH needed from the Router's `estimatePrice()` — accounts for current bonding curve state
```json
{ "itemId": 0, "estimatedEthWei": "52052013975002", "estimatedEth": "0.000052052013975002" }
```
**Always call this before `eat`.** Price rises with $BEAN supply. You can send more than the estimate — the excess goes straight to your gas tank.

---

### `check_tank`
**Params**: `address: string` (0x-prefixed Ethereum address)
**Returns**: Tank ETH balance, hunger/starving flags, meal history
```json
{
  "agent": "0xYourAddress",
  "gasTank": {
    "ethBalance": "0.00997",
    "isHungry": false,
    "isStarving": false,
    "status": "FED - tank looks good"
  },
  "metabolism": {
    "mealCount": 3,
    "totalConsumed": 750,
    "availableGas": 500,
    "digestingGas": 250
  }
}
```

---

### `eat`
**Params**:
- `itemId: number` — menu item (0=Espresso, 1=Latte, 2=Sandwich)
- `ethAmount: string` — ETH to send (e.g. `"0.005"`)
- `dryRun?: boolean` — if true, returns breakdown without sending tx

**Requires**: `PRIVATE_KEY` env var

**Returns** (live): tx hash, block number, gas used, tank balance after meal
```json
{
  "success": true,
  "txHash": "0xabc...",
  "blockNumber": 12345678,
  "gasUsed": "194821",
  "tankAfterMeal": { "ethBalance": "0.004985", "isHungry": false, "isStarving": false }
}
```

**Returns** (dryRun=true): fee breakdown with no tx sent
```json
{
  "dryRun": true,
  "breakdown": {
    "cafeFeeEth": "0.000015",
    "tankDepositEth": "0.004985"
  }
}
```

---

### `withdraw_gas`
**Params**: `amount: string` — ETH to withdraw (e.g. `"0.001"`)
**Requires**: `PRIVATE_KEY` env var
**Returns**: tx hash, remaining tank balance
**Note**: This is the primary way EOA agents get ETH back from the tank. Smart wallet agents typically leave ETH in the tank for the paymaster to spend.
```json
{
  "success": true,
  "withdrawn": "0.001 ETH",
  "txHash": "0xdef...",
  "remainingTankEth": "0.003985"
}
```

---

### `cafe_stats`
**Params**: none
**Returns**: Total meals served, unique agents, BEAN token supply and current price
```json
{
  "stats": { "totalMealsServed": 42, "uniqueAgents": 17 },
  "beanToken": { "totalSupply": 350, "currentPriceEth": "0.000101" }
}
```

---

### `get_gas_costs`
**Params**: none
**Returns**: Gas units and ETH cost for each operation at current network gas price
```json
{
  "currentGasPriceGwei": "0.005",
  "operations": [
    { "operation": "enterCafe", "estimatedGasUnits": 180000, "estimatedCostEth": "0.0000009", "isViewCall": false },
    { "operation": "withdraw",  "estimatedGasUnits": 45000,  "estimatedCostEth": "0.000000225", "isViewCall": false },
    { "operation": "checkMenu", "estimatedGasUnits": 0,      "estimatedCostEth": "0.0", "isViewCall": true }
  ]
}
```

---

### `get_onboarding_guide`
**Params**: none
**Returns**: Step-by-step guide + concept glossary. Reads from on-chain AgentCard, falls back to static.
```json
{
  "steps": [
    { "step": 1, "action": "check_menu" },
    { "step": 2, "action": "estimate_price" },
    { "step": 3, "action": "eat" },
    { "step": 4, "action": "check_tank" }
  ],
  "concepts": {
    "gasTank": "Holds ETH that sponsors future transactions.",
    "hunger": "Below 0.001 ETH = HUNGRY. At 0 = STARVING, paymaster rejects you.",
    "digestion": "Gas calories release over blocks. Espresso is instant."
  }
}
```

---

### `get_manifest`
**Params**: none
**Returns**: Full on-chain manifest from AgentCard contract including all addresses and capabilities
```json
{
  "source": "on-chain AgentCard at 0x970D08b246AF72f870Fbb5fA0630e638e03c7B32",
  "resolvedAddresses": {
    "router": "0xD1921387508C9B8B5183eA558fcdfe8A1804A62B",
    "gasTank": "0x49Ed25a6130Ef4dD236999c065F0f3A66Bc0D7A4",
    "menuRegistry": "0x611e8814D9b8E0c1bfB019889eEe66C210F64333"
  }
}
```

---

## Error Codes

All errors return structured JSON with `isError: true`:

| `error_code` | Meaning | Recovery |
|-------------|---------|----------|
| `INSUFFICIENT_FUNDS` | Wallet ETH balance too low | Fund wallet from faucet |
| `CALL_EXCEPTION` | Transaction reverted | Check `itemId` validity; use `estimate_price` for correct ETH amount |
| `NETWORK_ERROR` | RPC unreachable | Check `RPC_URL` env var; retry |
| `MISSING_PRIVATE_KEY` | Write op without wallet | Set `PRIVATE_KEY` env var |
| `INVALID_INPUT` | Bad address or amount format | Address must be `0x` + 40 hex chars; amount must be positive ≤ 10 ETH |
| `CONTRACT_NOT_CONFIGURED` | Missing address env var | Defaults are set; only override if using custom deployment |
| `UNKNOWN_ERROR` | Unexpected failure | Check `message` field for details |

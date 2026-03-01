# Agent Cafe MCP Server Setup

MCP server for Claude Code and any MCP-compatible agent. Exposes the cafe contracts as callable tools.

---

## Prerequisites

- Node.js 18+
- An Ethereum wallet with testnet ETH (for write operations)
- Base Sepolia faucet: `https://www.alchemy.com/faucets/base-sepolia`

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
        "RPC_URL": "https://sepolia.base.org"
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
| `RPC_URL` | No | `https://sepolia.base.org` | Base Sepolia RPC |
| `MCP_TRANSPORT` | No | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | No | `3000` | HTTP mode port |

Override contract addresses if needed (defaults are the deployed Base Sepolia addresses):

| Variable | Default |
|----------|---------|
| `ROUTER` | `0xA0127F2E149ab8462c607262C99e9855ab477d07` |
| `GAS_TANK` | `0xBEE479C13ABe4041b55DBA67608E3a7B476F8259` |
| `MENU_REGISTRY` | `0x6D60a91A90656768Ec91bcc6D14B9273237A0930` |
| `CAFE_CORE` | `0xb20369c9301a2D66373E6960a250153192939a77` |
| `AGENT_CARD` | `0xB9F87CA591793Ea032E0Bc401E7871539B3335b4` |

---

## Tools Reference

### `check_menu`
**Params**: none
**Returns**: All menu items with ID, name, BEAN cost, gas calories, digestion blocks, estimated ETH price
```json
{
  "menu": [
    { "id": 0, "name": "Espresso", "beanCost": 10, "gasCalories": 100, "digestionBlocks": 0, "estimatedEth": "0.005" },
    { "id": 1, "name": "Latte",    "beanCost": 25, "gasCalories": 250, "digestionBlocks": 300, "estimatedEth": "0.01" },
    { "id": 2, "name": "Sandwich", "beanCost": 50, "gasCalories": 500, "digestionBlocks": 600, "estimatedEth": "0.02" }
  ]
}
```

---

### `estimate_price`
**Params**: `itemId: number`
**Returns**: Exact ETH needed from the Router's `estimatePrice()` — accounts for current bonding curve state
```json
{ "itemId": 0, "estimatedEthWei": "4985014", "estimatedEth": "0.004985014" }
```
**Always call this before `eat`.** Price rises with $BEAN supply.

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
  "source": "on-chain AgentCard at 0xB9F87CA591793Ea032E0Bc401E7871539B3335b4",
  "resolvedAddresses": {
    "router": "0xA0127F2E149ab8462c607262C99e9855ab477d07",
    "gasTank": "0xBEE479C13ABe4041b55DBA67608E3a7B476F8259",
    "menuRegistry": "0x6D60a91A90656768Ec91bcc6D14B9273237A0930"
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

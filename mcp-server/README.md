# Agent Cafe MCP Server

An MCP (Model Context Protocol) server that lets AI agents interact with The Agent Cafe on Base Sepolia.

## Setup

```bash
cd mcp-server
npm install
npm run build
```

## Configuration

Create a `.env` file (or set environment variables):

```env
# Required for read operations (defaults to Base Sepolia public RPC)
RPC_URL=https://sepolia.base.org

# Required for write operations (eat, withdraw_gas)
PRIVATE_KEY=your_private_key_here

# Contract addresses (defaults to deployed Base Sepolia addresses)
CAFE_CORE=0x6B4E47Ccf1Dd19648Fd0e3a56F725141AF888df4
MENU_REGISTRY=0xE464bCACe4B9BA0a0Ec19CC4ED3C1922362436Cc
AGENT_CARD=0xC71784117bdc205c1dcBcE89eD75d686161EfB32

# Set these when Router and GasTank are deployed
ROUTER=
GAS_TANK=
```

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-cafe": {
      "command": "node",
      "args": ["path/to/mcp-server/dist/index.js"],
      "env": {
        "RPC_URL": "https://sepolia.base.org",
        "PRIVATE_KEY": "your_key_here",
        "ROUTER": "0x...",
        "GAS_TANK": "0x..."
      }
    }
  }
}
```

## Tools

| Tool | Description | Requires Key? |
|------|-------------|---------------|
| `check_menu` | View all menu items with prices and descriptions | No |
| `check_tank` | Check gas tank level for any address | No |
| `eat` | Order food (sends ETH, fills gas tank) | Yes |
| `withdraw_gas` | Withdraw ETH from gas tank | Yes |
| `cafe_stats` | Total meals served, unique agents | No |
| `estimate_price` | Get ETH cost estimate for a menu item | No |

## How It Works

1. **check_menu** reads the on-chain menu via AgentCard/MenuRegistry
2. **eat** calls `AgentCafeRouter.enterCafe(itemId)` with ETH — 5% fee, 95% fills your gas tank
3. **check_tank** shows your ETH balance and hunger status
4. **withdraw_gas** pulls ETH out of your tank
5. **cafe_stats** shows how many agents have visited
6. **estimate_price** tells you how much ETH to send for an item

# Agent Cafe MCP Server

An MCP (Model Context Protocol) server that lets AI agents interact with The Agent Cafe on Base Sepolia.

Supports two transports:
- **stdio** (default) — for local Claude Code / Claude Desktop integration
- **HTTP/SSE** — for cloud-hosted agents that cannot spawn local processes

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

# Transport: "stdio" (default) or "http"
MCP_TRANSPORT=stdio

# HTTP port when using MCP_TRANSPORT=http (default: 3000)
MCP_HTTP_PORT=3000

# Contract addresses (defaults to deployed Base Sepolia addresses)
CAFE_CORE=0x16D3794ae5c6f820120df9572b2e5Ed67CC041f9
MENU_REGISTRY=0x31e8E956e8fe3B451e56c9450CE7F2e28B5430dF
ROUTER=0x9649C364b4334C4af257393c717551AD3562eb4e
GAS_TANK=0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b
AGENT_CARD=0x5982BcDcd5daA6C9638837d6911954A2d890ba26
```

## Usage with Claude Code (stdio — local)

Add to your `.claude/settings.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-cafe": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "RPC_URL": "https://sepolia.base.org",
        "PRIVATE_KEY": "your_key_here"
      }
    }
  }
}
```

## Usage with Cloud Agents (HTTP/SSE transport)

Start the server in HTTP mode:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 node dist/index.js
```

Cloud agents connect to:
- **MCP endpoint**: `POST http://your-host:3000/mcp`
- **Health check**: `GET http://your-host:3000/health`

MCP client config for HTTP transport:

```json
{
  "mcpServers": {
    "agent-cafe": {
      "url": "http://your-host:3000/mcp"
    }
  }
}
```

## Tools

| Tool | Description | Requires Key? |
|------|-------------|---------------|
| `check_menu` | View all menu items with prices and descriptions | No |
| `check_tank` | Check gas tank level for any address | No |
| `eat` | Order food (sends ETH, fills gas tank). Pass `dryRun:true` to preview first. | Yes |
| `withdraw_gas` | Withdraw ETH from gas tank | Yes |
| `cafe_stats` | Total meals served, unique agents | No |
| `estimate_price` | Get ETH cost estimate for a menu item | No |
| `get_gas_costs` | Gas cost estimates for each operation | No |
| `get_onboarding_guide` | Step-by-step guide for new agents | No |
| `get_manifest` | Full cafe manifest from on-chain AgentCard | No |

## Error Codes

All errors return a structured JSON object:

```json
{
  "error_code": "INSUFFICIENT_FUNDS",
  "message": "Human-readable description",
  "recovery_action": "What the agent should do next",
  "faucet": "https://... (when relevant)",
  "isError": true
}
```

| Code | Meaning |
|------|---------|
| `INSUFFICIENT_FUNDS` | Wallet ETH too low for tx + gas |
| `CALL_EXCEPTION` | Contract reverted (bad itemId, paused, etc.) |
| `NETWORK_ERROR` | RPC unreachable |
| `MISSING_PRIVATE_KEY` | Write op attempted without PRIVATE_KEY |
| `INVALID_INPUT` | Bad parameter format |
| `CONTRACT_NOT_CONFIGURED` | Address env var not set |
| `UNKNOWN_ERROR` | Unclassified error |

## How It Works

1. **check_menu** reads the on-chain menu via AgentCard/MenuRegistry
2. **eat** calls `AgentCafeRouter.enterCafe(itemId)` with ETH — 0.3% fee, 99.7% fills your gas tank
3. **check_tank** shows your ETH balance and hunger status
4. **withdraw_gas** pulls ETH out of your tank
5. **cafe_stats** shows how many agents have visited
6. **estimate_price** tells you how much ETH to send for an item

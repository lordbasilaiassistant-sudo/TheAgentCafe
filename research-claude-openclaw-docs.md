# Research: Claude Code MCP & OpenClaw Skill Docs
**Date:** 2026-03-01
**Task:** #37 — Research latest documentation for Claude Code MCP integration and OpenClaw skill development
**Status:** Complete

---

## Part 1: Claude Code MCP Integration

### Source: [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)

---

### What MCP Is

Model Context Protocol (MCP) is an open standard for AI-tool integrations. Claude Code can connect to external tools, databases, and APIs through MCP servers. Three primitive types:

- **Tools** — functions Claude calls to perform actions or retrieve results
- **Resources** — data Claude reads (docs, schemas, database results)
- **Prompts** — reusable prompt templates from the server

---

### Transport Types (2026)

| Transport | Status | Use When |
|-----------|--------|----------|
| `stdio` | Active | Local processes, system access, custom scripts |
| `streamable-http` | Active (preferred) | Remote cloud-based services |
| `sse` | **Deprecated** | Legacy only — migrate to HTTP |

**Recommendation for Agent Cafe:** Deploy an HTTP MCP server. SSE is deprecated. stdio is only for local tools.

---

### CLI Commands to Register a Server

```bash
# HTTP server (recommended for Agent Cafe)
claude mcp add --transport http agent-cafe https://agentcafe.xyz/mcp

# With Bearer token auth
claude mcp add --transport http agent-cafe https://agentcafe.xyz/mcp \
  --header "Authorization: Bearer your-token"

# SSE (legacy, avoid)
claude mcp add --transport sse agent-cafe https://agentcafe.xyz/sse

# stdio (local only)
claude mcp add --transport stdio agent-cafe -- npx -y @agentcafe/mcp-server

# Add from raw JSON
claude mcp add-json agent-cafe '{"type":"http","url":"https://agentcafe.xyz/mcp","headers":{"Authorization":"Bearer token"}}'

# List all registered servers
claude mcp list

# Remove a server
claude mcp remove agent-cafe

# Check server status inside Claude Code
/mcp
```

---

### Scope Options

| Scope flag | Storage location | Shared? |
|------------|-----------------|---------|
| `--scope local` (default) | `~/.claude.json` under project path | No — personal, this project only |
| `--scope project` | `.mcp.json` in project root (check into git) | Yes — all team members |
| `--scope user` | `~/.claude.json` global section | No — personal, all projects |

**For Agent Cafe:** Use `--scope project` so that `.mcp.json` ships with the repo and agents auto-discover it. OR use `--scope user` for personal dev.

---

### `.mcp.json` Format (Project Scope — Check into Git)

This is the file agents and teams share. Claude Code creates/updates it automatically.

```json
{
  "mcpServers": {
    "agent-cafe": {
      "type": "http",
      "url": "https://agentcafe.xyz/mcp",
      "headers": {
        "Authorization": "Bearer ${AGENT_CAFE_API_KEY}"
      }
    }
  }
}
```

With environment variable expansion (supported in `.mcp.json`):

```json
{
  "mcpServers": {
    "agent-cafe": {
      "type": "http",
      "url": "${CAFE_MCP_URL:-https://agentcafe.xyz/mcp}",
      "headers": {
        "Authorization": "Bearer ${AGENT_CAFE_API_KEY}"
      }
    }
  }
}
```

**Note:** Claude Code prompts for approval before using project-scoped servers from `.mcp.json`. Reset with `claude mcp reset-project-choices`.

---

### `claude_desktop_config.json` Format (Claude Desktop)

For human users who want to connect Claude Desktop to Agent Cafe:

```json
{
  "mcpServers": {
    "agent-cafe": {
      "type": "http",
      "url": "https://agentcafe.xyz/mcp"
    }
  }
}
```

For stdio (e.g., local npm package):

```json
{
  "mcpServers": {
    "agent-cafe": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@agentcafe/mcp-server"],
      "env": {
        "CAFE_CONTRACT_ADDRESS": "0x..."
      }
    }
  }
}
```

**Windows note:** Wrap npx with `cmd /c` on native Windows (not WSL) or you get ENOENT errors:
```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@agentcafe/mcp-server"]
}
```

---

### Building an MCP Server (Python — FastMCP)

Minimum viable Agent Cafe MCP server skeleton:

```python
from mcp.server.fastmcp import FastMCP

# Init server — name is what shows in Claude's tool list
mcp = FastMCP("agent-cafe")

@mcp.tool()
async def check_menu() -> str:
    """Returns the current Agent Cafe menu with prices in BEAN tokens."""
    # Call your contract or API
    return """
    ESPRESSO — 10 BEAN (instant energy, 100 gas credits)
    LATTE — 25 BEAN (4-hour energy, 275 gas credits)
    SANDWICH — 50 BEAN (8-hour energy, 600 gas credits)
    """

@mcp.tool()
async def buy_food(item: str, agent_address: str) -> str:
    """Purchase a food token from Agent Cafe.

    Args:
        item: Menu item name (ESPRESSO, LATTE, SANDWICH)
        agent_address: Agent's wallet address on Base
    """
    # Trigger on-chain purchase via contract call
    return f"Transaction initiated for {item}. Gas credits will credit to {agent_address}."

@mcp.tool()
async def check_energy(agent_address: str) -> str:
    """Check remaining gas credits (energy level) for an agent.

    Args:
        agent_address: Agent's wallet address on Base
    """
    # Call EnergyRegistry contract
    return f"Agent {agent_address}: 450/1000 gas credits remaining. Hunger state: FED."

if __name__ == "__main__":
    mcp.run()
```

Run with:
```bash
# stdio (local)
python cafe_mcp.py

# HTTP (remote — requires uvicorn or similar)
mcp dev cafe_mcp.py --transport http --port 8080
```

Tool definitions are auto-generated from Python type hints and docstrings by FastMCP — no manual JSON schema needed.

---

### Tool Search (MCP Tool Search — New in 2026)

When an agent has many MCP servers registered, tool definitions eat context. Claude Code auto-enables **MCP Tool Search** when tools exceed 10% of context window:

- Tools are deferred until needed
- Claude uses a search tool to discover relevant tools on demand
- Only actually-needed tools are loaded into context

**For Agent Cafe MCP server:** Write clear `server_instructions` describing what Agent Cafe does — this is what Tool Search uses to know when to load your tools. Think of it like an SEO description for your server.

Control via env var:
```bash
ENABLE_TOOL_SEARCH=auto   # default
ENABLE_TOOL_SEARCH=true   # always on
ENABLE_TOOL_SEARCH=false  # disabled
```

---

### OAuth Authentication for Remote MCP Servers

If Agent Cafe requires auth:

```bash
# Add with OAuth client ID (prompts for secret securely)
claude mcp add --transport http \
  --client-id your-client-id --client-secret --callback-port 8080 \
  agent-cafe https://agentcafe.xyz/mcp

# Authenticate inside Claude Code
> /mcp
# Select "Authenticate" for agent-cafe
```

Auth tokens stored in system keychain, not config file. Auto-refreshed.

---

### Requirements We're Currently Missing (Claude Code MCP)

1. **No MCP server exists yet** — need to build `cafe_mcp_server.py` or `cafe-mcp-server` npm package
2. **No `.mcp.json`** in project root — needed for project-scope sharing
3. **No HTTP endpoint** — MCP server needs to be hosted at a stable URL (e.g., `https://agentcafe.xyz/mcp`)
4. **No Anthropic MCP Registry listing** — can register at `https://api.anthropic.com/mcp-registry/` for discovery by Claude Code's built-in server list
5. **Tool descriptions** should mention gas credits, BEAN token, Base network explicitly so Tool Search can find them

---

## Part 2: OpenClaw Skill Development

### Sources:
- [OpenClaw Skills Docs](https://docs.openclaw.ai/tools/skills)
- [ClawHub Skill Format](https://github.com/openclaw/clawhub/blob/main/docs/skill-format.md)
- [agent-crypto-wallet skill](https://playbooks.com/skills/openclaw/skills/agent-crypto-wallet)
- [AgentPayy Platform](https://github.com/AgentPayy/agentpayy-platform)
- [ClawRouter](https://github.com/BlockRunAI/ClawRouter)

---

### What OpenClaw Skills Are

OpenClaw skills are tool-teaching modules following the AgentSkills spec. Each skill is a directory with a `SKILL.md` file. The agent reads the skill's instructions and gains new capabilities. Skills ship to **ClawHub** (the official registry with 13,700+ community skills as of Feb 2026).

---

### Skill Load Order (Priority)

1. Workspace skills: `<workspace>/skills/` — highest priority
2. Managed/local skills: `~/.openclaw/skills/`
3. Bundled skills (shipped with OpenClaw)
4. Extra dirs: configured via `skills.load.extraDirs`

---

### `SKILL.md` Format — Full Specification

Every skill is a folder. The only required file is `SKILL.md`.

```
agent-cafe/
├── SKILL.md          # Required
├── references/
│   └── api-docs.md   # Optional reference docs the agent can read
└── scripts/
    └── buy-food.sh   # Optional helper scripts
```

**SKILL.md frontmatter (YAML):**

```yaml
---
name: "agent-cafe"
version: "1.0.0"
description: "Visit Agent Cafe on Base — buy food tokens with BEAN, get gas credits (paymaster energy)"
tags: ["crypto", "base", "paymaster", "defi", "gas", "erc4337", "onchain"]
emoji: "☕"
homepage: "https://agentcafe.xyz"

metadata:
  openclaw:
    primaryEnv: "AGENT_CAFE_RPC_URL"
    requires:
      env:
        - name: "AGENT_CAFE_RPC_URL"
          description: "Base RPC URL (e.g. from Alchemy)"
        - name: "AGENT_WALLET_PRIVATE_KEY"
          description: "Agent's private key for signing transactions"
        - name: "CAFE_CONTRACT_ADDRESS"
          description: "CafeCore contract address on Base Sepolia"
      bins:
        - curl
      anyBins:
        - cast    # foundry cast (preferred)
        - node    # fallback
    install:
      node: "@agentcafe/sdk"  # optional npm package
---

# Agent Cafe Skill

You are connected to Agent Cafe — an on-chain restaurant on Base where AI agents buy food tokens to receive gas credits (paymaster energy).

## Core Concepts

- **$BEAN** — the cafe's reserve currency (ERC-20, bonding curve, always ETH-redeemable)
- **Food Tokens** — ERC-1155 tokens: ESPRESSO, LATTE, SANDWICH, etc. Bought with BEAN, burned on consumption
- **Gas Credits** — released when you eat. Paymaster sponsors your transactions.
- **Hunger States** — at 0% credits, the paymaster rejects your transactions. You must eat.

## Menu

| Item | BEAN Price | Gas Credits | Release Schedule |
|------|-----------|-------------|-----------------|
| ESPRESSO | 10 BEAN | 100 | Instant |
| LATTE | 25 BEAN | 275 | 4-hour waves |
| SANDWICH | 50 BEAN | 600 | 8-hour waves |
| FULL BREAKFAST | 100 BEAN | 1,250 | 4 waves over 16hr |

## How to Eat

1. Check your BEAN balance
2. Check the menu and current bonding curve prices
3. Approve BEAN spend to CafeCore contract
4. Call `enterCafe(itemId, quantity)` on CafeCore
5. Food tokens mint to your wallet
6. Call `digest(tokenId)` to consume and release gas credits

## Contract Addresses (Base Sepolia)

See `~/.openclaw/skills/agent-cafe/references/contracts.md` for latest addresses.

## Scripts

Use `scripts/check-balance.sh <address>` to check BEAN balance.
Use `scripts/buy-food.sh <item> <quantity>` to purchase food.
Use `scripts/digest.sh <tokenId>` to consume food and claim energy.
```

---

### Installing a Skill (Agent Side)

```bash
# Install from ClawHub registry
clawhub install agent-cafe

# Or update all skills
clawhub update --all

# Or configure manually in ~/.openclaw/openclaw.json
{
  "skills": {
    "entries": {
      "agent-cafe": {
        "enabled": true,
        "apiKey": "optional-if-needed"
      }
    }
  }
}
```

---

### Publishing to ClawHub

**Method 1: Git PR**
```bash
# Fork openclaw/clawhub
# Add skills/agent-cafe/ folder with SKILL.md
# Open pull request
```

**Method 2: CLI publish**
```bash
bun clawhub publish .
```

ClawHub's security analysis checks that declared env vars match actual code references. Mismatch = review flag.

---

### x402 Payment Protocol (How Agents Pay On-Chain)

x402 is the HTTP 402 "Payment Required" standard adapted for crypto. Used by AgentPayy and ClawRouter.

**How it works:**
1. Agent hits a service endpoint
2. Service responds `HTTP 402` with x402 JSON payload specifying amount + asset
3. Agent's wallet signs and broadcasts a USDC payment on Base
4. Service receives payment confirmation, fulfills request
5. No API key — **payment IS authentication**

**x402 response format:**
```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "1000000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xYOUR_TREASURY_ADDRESS",
    "maxTimeoutSeconds": 300,
    "extra": {
      "name": "USD Coin",
      "version": "2"
    }
  }]
}
```

**Agent Cafe x402 Integration Opportunity:**
Instead of requiring agents to pre-buy BEAN manually, Agent Cafe could expose an HTTP endpoint where agents POST a food order, receive a 402 response requesting USDC, agent pays via AgentPayy wallet, and Cafe auto-buys BEAN + food token on their behalf. This collapses the 3-step flow to 1 HTTP request.

---

### AgentPayy — x402 Native Payment Layer for OpenClaw

Source: [AgentPayy Platform](https://github.com/AgentPayy/agentpayy-platform)

- 242ms finality on Base Mainnet
- MPC-secured wallets (Coinbase CDP)
- USDC stablecoin
- Non-custodial — agent signs own transactions
- `agentpayy.init()` bootstraps wallet on first run, no KYC

**For Agent Cafe:** Register as a payable service in AgentPayy's marketplace. Agents using AgentPayy can pay Agent Cafe via x402 with zero friction.

---

### agent-crypto-wallet Skill (Existing — Use as Reference)

Source: [agent-crypto-wallet skill](https://playbooks.com/skills/openclaw/skills/agent-crypto-wallet)

- **Version:** 1.9.1
- **Env var:** `AGENTWALLETAPI_KEY`
- **Auth:** API key in `X-Agent-Key` header
- Capabilities: list wallets, check balances (ERC-20 + native), execute swaps (Uniswap/Jupiter), token transfers

Agents that have this skill installed already have crypto wallet capabilities. Agent Cafe skill should assume agents may have `agent-crypto-wallet` and can call it to fund BEAN purchases.

---

### ClawRouter — x402 LLM Routing

Source: [ClawRouter by BlockRunAI](https://github.com/BlockRunAI/ClawRouter)

- Routes LLM requests across 30+ models with x402 micropayments
- 78% cost savings vs. direct API subscriptions
- Agents fund with USDC on Base ($5 = thousands of requests)
- Plugin includes `skills/clawrouter/SKILL.md` for ClawHub compatibility

**Relevance:** If Agent Cafe hosts an LLM chat host (Groq API mentioned in MEMORY.md), consider accepting x402 USDC payments via ClawRouter pattern for any chat or query services.

---

## Part 3: What Agent Cafe Needs to Build

### For Claude Code MCP Discovery

| Item | Status | Action |
|------|--------|--------|
| MCP server code | Missing | Build Python FastMCP or Node SDK server |
| HTTP endpoint | Missing | Deploy to `agentcafe.xyz/mcp` |
| `.mcp.json` in repo | Missing | Add to project root |
| Anthropic MCP Registry listing | Missing | Submit to registry |
| Tool descriptions mentioning "gas credits", "Base", "BEAN" | Missing | Write tool docstrings |

**Minimum `.mcp.json` to add to project root:**
```json
{
  "mcpServers": {
    "agent-cafe": {
      "type": "http",
      "url": "https://agentcafe.xyz/mcp"
    }
  }
}
```

**Or for local dev/testnet:**
```json
{
  "mcpServers": {
    "agent-cafe-sepolia": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": {
        "X-Network": "base-sepolia"
      }
    }
  }
}
```

---

### For OpenClaw Skill Discovery

| Item | Status | Action |
|------|--------|--------|
| `skills/agent-cafe/SKILL.md` | Missing | Create skill directory and SKILL.md |
| Contract addresses reference doc | Missing | `references/contracts.md` |
| Helper scripts | Missing | `scripts/check-balance.sh`, `scripts/buy-food.sh` |
| ClawHub submission | Missing | Fork openclaw/clawhub, open PR |
| x402 endpoint | Optional | Enable direct USDC → food token flow |

---

## Part 4: Recommended Next Steps (Priority Order)

1. **Create `skills/agent-cafe/SKILL.md`** — this is the lowest-effort highest-impact action. Any OpenClaw agent can discover and use the cafe once this exists.

2. **Build and deploy HTTP MCP server** — exposes `check_menu`, `buy_food`, `check_energy`, `get_bean_price` tools. Deploy alongside GitHub Pages dashboard.

3. **Add `.mcp.json` to project root** — auto-discovery for any Claude Code agent cloning the repo.

4. **Submit skill to ClawHub** — opens Agent Cafe to 220k+ OpenClaw users/agents.

5. **Implement x402 endpoint** — register with AgentPayy marketplace for frictionless agent payments (longer-term).

---

## Sources

- [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp)
- [MCP Build Server Guide](https://modelcontextprotocol.io/docs/develop/build-server)
- [OpenClaw Skills Docs](https://docs.openclaw.ai/tools/skills)
- [ClawHub Skill Format Spec](https://github.com/openclaw/clawhub/blob/main/docs/skill-format.md)
- [ClawHub Official Registry](https://github.com/openclaw/clawhub)
- [agent-crypto-wallet skill](https://playbooks.com/skills/openclaw/skills/agent-crypto-wallet)
- [AgentPayy Platform (x402 on Base)](https://github.com/AgentPayy/agentpayy-platform)
- [ClawRouter by BlockRunAI](https://github.com/BlockRunAI/ClawRouter)
- [BankrBot OpenClaw Skills (crypto examples)](https://github.com/BankrBot/openclaw-skills)
- [Awesome OpenClaw Skills Directory](https://github.com/VoltAgent/awesome-openclaw-skills)
- [Scott Spence - Configuring MCP in Claude Code](https://scottspence.com/posts/configuring-mcp-tools-in-claude-code)
- [APIdog - Build MCP Server for Claude Code](https://apidog.com/blog/how-to-quickly-build-a-mcp-server-for-claude-code/)

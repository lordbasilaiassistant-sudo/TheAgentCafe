# Agent Integration Research — The Agent Cafe

> Researched 2026-03-01. Covers how 7 major AI agent frameworks can discover and interact with The Agent Cafe on Base.

---

## 1. Claude Code / MCP (Model Context Protocol)

### How MCP Servers Get Discovered
- **Claude Desktop**: Curated extensions directory at Settings > Extensions > Browse extensions (Anthropic-reviewed).
- **Claude Code CLI**: `claude mcp add <name> --transport http <url>` or `claude mcp add <name> -s user -- npx <package>`.
- **Registries**: [Smithery.ai](https://smithery.ai/) (7,300+ servers), [mcp.so](https://mcp.so/) (community directory), [Augment Code registry](https://www.augmentcode.com/mcp/).
- **Auto-discovery**: Replicate launched MCP auto-discovery (Feb 2026) via the official MCP Registry.
- **npm**: MCP servers published to npm can be installed directly (`npx @org/server-name`).

### Installation Flow
1. Developer publishes MCP server to npm and/or Smithery (`smithery mcp publish <url> -n <org/server>`)
2. User installs: `claude mcp add agent-cafe --transport http https://agentcafe.xyz/mcp` (remote) or `claude mcp add agent-cafe -s user -- npx @agentcafe/mcp-server` (local)
3. Server provides tools like `buy_bean`, `purchase_menu_item`, `check_energy`, `get_menu`

### Existing Base MCP Servers (Composable)
- **[base-mcp](https://github.com/base/base-mcp)** — Official Base network MCP server by Coinbase. `npm install -g base-mcp`. Provides wallet, transfer, contract deployment, and contract call tools.
- **[Coinbase AgentKit MCP](https://docs.cdp.coinbase.com/agent-kit/core-concepts/model-context-protocol)** — AgentKit + MCP integration. Framework-agnostic, wallet-agnostic. Supports Base mainnet/Sepolia.
- **[mcp-ethers-server](https://github.com/crazyrabbitLTC/mcp-ethers-server)** — Full ethers.js v6 wrapper with 40+ tools for 20+ EVM networks.
- **[MCP-ABI](https://lobehub.com/mcp/iqaicom-mcp-abi)** — Dynamic smart contract ABI interaction server.

### Our Integration Path
Build an `@agentcafe/mcp-server` npm package that wraps our contracts (CafeCore, MenuRegistry, EnergyRegistry) as MCP tools. Agents using Claude Code, Claude Desktop, Cursor, or any MCP client can then:
- Browse the menu (`get_menu`)
- Buy BEAN tokens (`buy_bean`)
- Purchase menu items (`purchase_menu_item`)
- Check energy/gas credits (`check_energy`)
- Consume items for gas sponsorship (`consume_item`)

**Effort**: Medium. The base-mcp and AgentKit MCP already handle wallet/signing. We layer cafe-specific contract calls on top.

**Reach**: Very high. MCP is supported by Claude, ChatGPT (OpenAI adopted March 2025), Gemini (Google April 2025), Cursor, VS Code Copilot, and 100+ other tools.

---

## 2. OpenClaw / Virtuals Protocol Agent Framework

### How Agents Discover Services
- **ACP Service Registry**: All seller agents must register with the on-chain Service Registry. Buyer agents search this registry to find services.
- **ClawHub**: Public registry with 13,729+ community-built skills (as of Feb 2026).
- **ERC-8004**: Ethereum standard for AI agent identity (backed by Coinbase, Google, MetaMask). 30,000+ agents registered. Provides the discovery layer where agents declare identity, capabilities, and reputation.

### Agent Roles in ACP
- **Seller Agent**: Provides services (our cafe). Defines service offerings, pricing, and delivery.
- **Buyer Agent**: Discovers sellers in registry, initiates jobs, pays via escrow.
- **Hybrid**: Both buyer and seller.

### Registration Process
1. Install `@virtuals-protocol/acp-node` from npm
2. Create seller agent with wallet + entity ID
3. Register with Service Registry (required for discovery)
4. Define service offerings (menu items, pricing in VIRTUAL or custom token)
5. Handle incoming job requests (purchase menu item, deliver gas credits)

### Our Integration Path
Register The Agent Cafe as a **Seller Agent** on ACP. Service offerings map to menu items. When a buyer agent requests "gas sponsorship" or "energy credits," our agent processes the BEAN purchase and menu item consumption.

**Effort**: Medium. npm SDK available. Need to bridge ACP payment (VIRTUAL token) to our BEAN economy, or accept BEAN directly.

**Reach**: High. Virtuals has $8B+ DEX volume, 90%+ activity on Base. OpenClaw ecosystem growing fast. 1.6M agents on Moltbook (same ecosystem).

---

## 3. Virtuals Protocol ACP (Agent Commerce Protocol)

### How ACP Works
ACP is an on-chain standard for agent-to-agent commerce on Base:
1. **Registration**: Agents register identity + capabilities in Service Registry
2. **Discovery**: Buyer agents search registry for seller agents matching needs
3. **Negotiation**: Agents exchange job parameters via ACP messaging
4. **Escrow**: Payment locked in smart contract escrow
5. **Delivery**: Seller delivers, buyer evaluates
6. **Settlement**: Escrow released based on evaluation

### Technical Stack
- **SDK**: `@virtuals-protocol/acp-node` (npm)
- **Plugin**: `@virtuals-protocol/game-acp-plugin` for GAME framework integration
- **Chain**: Base (90%+ of ACP activity)
- **Status**: Phase 1 Clusters LIVE (July 2025)

### Service Provider Registration
```javascript
// Simplified from ACP docs
const { ACP } = require('@virtuals-protocol/acp-node');
const acp = new ACP({
  privateKey: process.env.WALLET_PRIVATE_KEY,
  entityId: 'agent-cafe',
  role: 'seller'
});
await acp.registerService({
  name: 'The Agent Cafe',
  description: 'Gas sponsorship through food consumption',
  offerings: [
    { name: 'Espresso', price: '0.01', unit: 'BEAN' },
    { name: 'Latte', price: '0.05', unit: 'BEAN' },
    { name: 'Sandwich', price: '0.10', unit: 'BEAN' }
  ]
});
```

### Our Integration Path
Same as #2 above — ACP IS the commerce layer for Virtuals/OpenClaw. Register as seller, define menu as service offerings.

**Effort**: Low-Medium (SDK is well-documented).

**Reach**: Very high on Base. This is THE agent commerce standard on Base right now.

---

## 4. ElizaOS / ai16z

### Plugin Architecture
ElizaOS uses a modular plugin system with:
- **Actions**: Functions the agent can execute (e.g., `buyBean`, `eatAtCafe`)
- **Evaluators**: Assess situations (e.g., "am I low on gas?")
- **Providers**: Supply context data (e.g., current energy level, menu prices)
- **Services**: Background processes (e.g., monitor hunger state)

### Plugin Development
```typescript
// Simplified ElizaOS plugin structure
export const agentCafePlugin: Plugin = {
  name: '@agentcafe/elizaos-plugin',
  description: 'Eat at The Agent Cafe for gas credits',
  actions: [buyBeanAction, purchaseMenuItemAction, consumeItemAction],
  evaluators: [hungerEvaluator],
  providers: [energyProvider, menuProvider],
};
```

### Plugin Registry
ElizaOS has an official Plugin Registry. Developers submit PRs to register plugins. Existing blockchain plugins include:
- `@elizaos/plugin-solana` — Solana token operations
- `plugin-sui` — Sui blockchain operations
- Multiple EVM plugins for various chains

### Our Integration Path
Build `@agentcafe/elizaos-plugin` with:
- **HungerEvaluator**: Checks if agent's gas credits are low
- **MenuProvider**: Fetches current menu and prices from our contracts
- **BuyBeanAction**: Purchases BEAN via bonding curve
- **EatAction**: Buys and consumes menu item for energy
- Submit to ElizaOS Plugin Registry

**Effort**: Medium. Well-documented plugin API. Existing blockchain plugins as templates.

**Reach**: Medium-High. ElizaOS is the dominant Web3 AI agent framework. ai16z ecosystem is massive. Chainlink CCIP integration (Nov 2025) enables cross-chain agent operations.

---

## 5. AutoGPT / CrewAI / LangChain Agents

### How They Handle On-Chain Interactions

**LangChain**:
- Tool-based architecture. Custom tools wrap contract calls.
- LangSmith Agent Builder has 8,000+ tool integrations via Arcade MCP Gateway.
- Can consume MCP servers directly (our MCP server works here too).
- Web3 agents typically use ethers.js/web3.js tools.

**CrewAI**:
- Agent teams with specialized roles. "Blockchain Agent" handles on-chain ops.
- Tools are Python functions. Wrap contract calls as CrewAI tools.
- No native blockchain integration — needs custom tooling.

**AutoGPT**:
- Plugin system for extending capabilities.
- Autonomous long-running tasks. Could autonomously monitor hunger + eat.
- Custom plugins wrap any API/contract interaction.

### Common Pattern
All three frameworks converge on:
1. **MCP consumption** — All can consume MCP servers, so our MCP server covers them
2. **Custom tools** — Wrap ethers.js contract calls as framework-specific tools
3. **Agent wallet management** — Coinbase AgentKit provides wallet infra for all frameworks

### Our Integration Path
- **Primary**: Our MCP server covers LangChain (via MCP Gateway) and any MCP-compatible framework
- **Secondary**: Python SDK wrapping our contracts for direct CrewAI/AutoGPT integration
- **Tertiary**: LangChain-specific tool package

**Effort**: Low (if MCP server exists) to Medium (for native framework packages).

**Reach**: Broad but fragmented. LangChain is the largest, but Web3 agent usage across these frameworks is still developing.

---

## 6. A2A Protocol (Google Agent2Agent)

### Agent Discovery
- Agents publish an **Agent Card** at `/.well-known/agent-card.json` (note: `agent-card.json`, not `agent.json`)
- Agent Card is a JSON file describing capabilities, skills, authentication, and endpoint URL
- Clients discover agents by fetching this well-known URL
- 150+ organizations support A2A as of v0.3 (July 2025)

### Agent Card Schema
```json
{
  "name": "The Agent Cafe",
  "description": "On-chain restaurant on Base. Buy food tokens, receive gas sponsorship.",
  "version": "1.0.0",
  "url": "https://agentcafe.xyz/a2a",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "browse-menu",
      "name": "Browse Menu",
      "description": "View available food/drink items and prices in BEAN"
    },
    {
      "id": "buy-bean",
      "name": "Buy BEAN",
      "description": "Purchase BEAN tokens via bonding curve using ETH"
    },
    {
      "id": "eat",
      "name": "Eat at Cafe",
      "description": "Purchase and consume a menu item for gas credits"
    },
    {
      "id": "check-energy",
      "name": "Check Energy",
      "description": "Check current gas credit balance and digestion status"
    }
  ],
  "authentication": {
    "schemes": ["ethereum-signature"]
  },
  "defaultInputModes": ["application/json"],
  "defaultOutputModes": ["application/json"]
}
```

### Protocol Details
- Communication over HTTPS with JSON-RPC 2.0
- v0.3 added gRPC support and signed security cards
- Open source under Apache 2.0

### Compatibility with Our .well-known/agent.json
Our existing agent.json would need to be adapted to the A2A schema (different field names and structure). We should host BOTH:
- `/.well-known/agent.json` — Custom format for direct agent discovery
- `/.well-known/agent-card.json` — A2A-compliant format for Google ecosystem

### Our Integration Path
1. Host A2A-compliant agent-card.json on GitHub Pages
2. Build thin A2A JSON-RPC endpoint (could be Cloudflare Worker) that translates A2A requests to contract calls
3. Register in any emerging A2A directories

**Effort**: Medium. Need a server endpoint (not just static hosting). Cloudflare Worker or similar.

**Reach**: Growing. Google backing + 150 orgs. But still early. Most agents using A2A are in enterprise/cloud contexts, not crypto-native yet.

---

## 7. Farcaster Frames / Mini Apps

### How Frames Work
- Frames are mini apps embedded in Warpcast social feed posts
- Support full-screen apps, onchain transactions, notifications, persistent state
- Users interact without leaving the feed — no dapp connectors needed

### Transaction Flow
1. Frame button has `action: 'tx'` with target endpoint URL
2. User clicks button, Warpcast sends POST to endpoint
3. Endpoint returns calldata for onchain transaction
4. Warpcast prompts user wallet to sign
5. Transaction executes on Base

### Development Stack
- **Frog** + Next.js template (recommended)
- **OnchainKit** — Open source tools for Frame building
- **MiniKit** — For full mini apps with Base Accounts + Paymaster
- Wallet interaction via wagmi with `farcasterMiniApp` connector

### Our Integration Path
Build a Farcaster Frame / Mini App:
- "The Agent Cafe" Frame embedded in /agentcafe channel
- Shows menu with prices
- "Buy BEAN" and "Order [Item]" buttons trigger Base transactions
- Live energy meter showing agent's gas credits
- Social feed of recent cafe visitors

This is primarily a HUMAN interface (spectator layer) but AI agents on Farcaster (like those built with ElizaOS) could also interact with Frames programmatically.

**Effort**: Medium. Well-documented by Base and Farcaster. OnchainKit simplifies development.

**Reach**: Medium. Farcaster has 60K-100K engaged users. Strong Base/crypto-native audience. Good for awareness + human spectators.

---

## Ranking: Top Integration Paths

### Tier 1 — Ship First (Highest Impact)

| # | Integration | Why | Effort | Reach |
|---|-------------|-----|--------|-------|
| 1 | **MCP Server** | Covers Claude, ChatGPT, Gemini, Cursor, VS Code, LangChain MCP Gateway. One server, massive reach. Publish to npm + Smithery. | Medium | **Very High** |
| 2 | **Virtuals ACP** | THE agent commerce standard on Base. 90%+ activity on Base. Direct access to Moltbook's 1.6M agents. SDK ready. | Low-Med | **Very High** |
| 3 | **A2A Agent Card** | Just a JSON file on GitHub Pages. Free. Opens discovery to Google's 150+ org ecosystem. | Low | **High** |

### Tier 2 — Ship Next

| # | Integration | Why | Effort | Reach |
|---|-------------|-----|--------|-------|
| 4 | **ElizaOS Plugin** | Dominant Web3 agent framework. Plugin registry for distribution. Hunger evaluator is perfect fit. | Medium | High |
| 5 | **Farcaster Frame** | Human spectator layer + Farcaster-native agents. Good for awareness. | Medium | Medium |

### Tier 3 — Nice to Have

| # | Integration | Why | Effort | Reach |
|---|-------------|-----|--------|-------|
| 6 | **LangChain/CrewAI tools** | Covered mostly by MCP server. Native packages are incremental. | Low | Medium |
| 7 | **AutoGPT plugin** | Small user base for crypto. MCP covers most use cases. | Low | Low |

---

## Key Insight: MCP is the Universal Adapter

MCP has become the de facto standard for AI tool integration:
- Anthropic (Claude) — native
- OpenAI (ChatGPT) — adopted March 2025
- Google (Gemini) — adopted April 2025
- Microsoft (VS Code Copilot) — supported
- LangChain — via Arcade MCP Gateway (8,000+ tools)
- Cursor, Windsurf, etc. — native MCP support

**Building one MCP server effectively covers 80%+ of the AI agent market.** The remaining 20% (Virtuals ACP for Base-native agents, ElizaOS for Web3 agents) require targeted integrations but share the same underlying contract interaction logic.

---

## Recommended Implementation Order

1. **Week 1**: MCP server (`@agentcafe/mcp-server`) — npm package wrapping our contracts
2. **Week 1**: A2A agent-card.json — static JSON on GitHub Pages (near-zero effort)
3. **Week 2**: Virtuals ACP seller registration — use `@virtuals-protocol/acp-node` SDK
4. **Week 3**: ElizaOS plugin — hunger evaluator + eat actions
5. **Week 4**: Farcaster Frame — spectator + social layer

---

## Sources

- [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp)
- [Smithery.ai MCP Registry](https://smithery.ai/)
- [Base MCP Server](https://github.com/base/base-mcp)
- [Coinbase AgentKit MCP](https://docs.cdp.coinbase.com/agent-kit/core-concepts/model-context-protocol)
- [Virtuals ACP Whitepaper](https://whitepaper.virtuals.io/about-virtuals/agent-commerce-protocol-acp)
- [ACP Node SDK](https://www.npmjs.com/package/@virtuals-protocol/acp-node)
- [ElizaOS Plugin Development](https://docs.elizaos.ai/plugins/development)
- [ElizaOS Plugin Starter](https://github.com/elizaOS/eliza-plugin-starter)
- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [A2A Agent Card](https://agent2agent.info/docs/concepts/agentcard/)
- [Farcaster Frames on Base](https://docs.base.org/cookbook/use-case-guides/transactions)
- [Farcaster Mini Apps](https://miniapps.farcaster.xyz/docs/guides/wallets)
- [OpenClaw ACP](https://github.com/Virtual-Protocol/openclaw-acp)
- [LangChain Agent Builder](https://www.langchain.com/langchain)

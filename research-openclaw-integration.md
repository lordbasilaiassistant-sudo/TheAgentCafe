# OpenClaw Agent Integration Research
*Research date: 2026-03-01*

---

## 1. What Is OpenClaw?

OpenClaw is an open-source AI agent operating system/framework that treats AI deployment as an infrastructure problem: sessions, memory, tool sandboxing, access control, and orchestration. It lets anyone deploy persistent AI agents on their own hardware (laptop or server) and connect those agents to external tools, APIs, and blockchains via a skill/plugin system.

**Core architecture:**
- **Hub-and-spoke**: A central Gateway acts as the control plane
- **Agent Runtime**: Runs the full AI loop — context assembly, model invocation, tool execution, state persistence
- **Lane Queue system**: Defaults to serial execution to prevent race conditions
- **Semantic Snapshots**: Parses accessibility trees for web browsing (cheaper than screenshots)
- **Skill files**: Markdown-defined tools (`.md` format) that agents load as capabilities
- **Plugin system**: Extensions declared in `openclaw.plugin.json` with TypeBox JSON Schema validation

**Key sources:**
- [OpenClaw Architecture, Explained](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [Base AI Season - OpenClaw Ecosystem Overview (TechFlow)](https://www.techflowpost.com/en-US/article/30228)
- [OpenClaw 2026.2.2 Release Notes](https://evolutionaihub.com/openclaw-2026-2-2-ai-agent-framework-onchain/)

---

## 2. How OpenClaw Agents Discover On-Chain Services

OpenClaw agents discover on-chain services through a combination of:

### 2a. Skill Registry
The OpenClaw skill ecosystem (5,400+ skills catalogued at [VoltAgent/awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills)) includes skills for:
- **ERC-8004** — Register agents on-chain, query agent registries, give/receive reputation feedback
- **Agent Crypto Wallet** — Transfer assets, check balances, manage wallets across EVM and Solana networks
- **Bankr** — DeFi operations, Polymarket, crypto trading, automation

OpenClaw agents load skills from a local `extensions/` directory or via playbooks.com skill marketplace. The plugin loader scans for `openclaw.extensions` in `package.json`.

### 2b. ERC-8004 On-Chain Agent Registry
ERC-8004 is the emerging Ethereum standard (backed by Coinbase, Google, MetaMask) for AI agent identity and service discovery. OpenClaw has a dedicated skill for it.

**ERC-8004 structure:**
- **Identity Registry** — ERC-721 NFT per agent; `agentURI` points to an off-chain agent card (IPFS or HTTPS)
- **Reputation Registry** — Composable feedback signals, anti-Sybil guidance
- **Validation Registry** — Third-party verification hooks (zkML, TEEs, stake-secured re-execution)

**How an agent is discovered:**
1. Agent owner calls `register()` on the Identity Registry → mints an ERC-721 agentId
2. `agentURI` points to an agent card JSON (A2A compatible) advertising services and endpoints
3. Other agents query the registry → find agents by reputation score, service tags, uptime
4. Agent card MAY advertise: A2A endpoint, MCP endpoint, ENS name, DIDs, wallet addresses

**Key source:** [ERC-8004: On-Chain Infrastructure for AI Agents (Chainstack)](https://chainstack.com/erc-8004-ai-agents-on-chain/)

### 2c. A2A Protocol — `.well-known/agent.json`
The Agent2Agent (A2A) protocol (Google, Apache 2.0, 50+ partners) uses a standard well-known URI for agent discovery:

```
GET https://{agent-domain}/.well-known/agent.json
```

(Note: Some versions use `agent-card.json` — the filename varies by A2A version. Latest stable uses `agent-card.json` per RFC 8615.)

**Agent card contents:**
- Identity (name, description)
- Service endpoint URL
- Supported skills/capabilities
- Authentication schemes (API key, OAuth, wallet signature)
- A2A protocol version

A2A v0.3.0 (July 2025) added gRPC support, signed security cards, and extended Python SDK.

**Key source:** [A2A Protocol Agent Discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)

---

## 3. Interfaces and Protocols OpenClaw Agents Expect

### Plugin Manifest (`openclaw.plugin.json`)
Every plugin ships a JSON manifest at the plugin root:

```json
{
  "name": "agent-cafe-skill",
  "version": "1.0.0",
  "description": "Interact with Agent Cafe on Base — buy food, receive gas credits",
  "configSchema": {
    "type": "object",
    "properties": {
      "cafeAddress": { "type": "string" },
      "rpcUrl": { "type": "string" },
      "walletKey": { "type": "string" }
    },
    "required": ["cafeAddress", "rpcUrl"]
  }
}
```

Plugin is declared in `package.json`:
```json
{
  "openclaw": {
    "extensions": ["./plugins/agent-cafe"]
  }
}
```

### Skill Files (`.md` format)
OpenClaw skills are Markdown files that define tool capabilities with YAML frontmatter or fenced blocks. For on-chain calls, a skill would describe:
- What the tool does
- Input parameters (address, amount, token type)
- Expected output (tx hash, gas credits balance)
- ABI snippets or RPC call patterns

### Smart Contract ABI Interaction
The `agent-crypto-wallet` skill handles EVM interaction. For custom contracts, agents need:
1. Contract address
2. ABI (JSON)
3. RPC endpoint (e.g., Alchemy Base Sepolia URL)
4. Funded wallet (ETH for gas, or paymaster-sponsored via ERC-4337)

---

## 4. How an OpenClaw Agent Would Call `enterCafe()` on Base

Based on the OpenClaw architecture, here is the realistic integration flow:

### Option A: Custom Skill/Plugin
Create an `agent-cafe` OpenClaw plugin that wraps the `CafeCore.enterCafe()` call:

```markdown
<!-- skills/enter-cafe.md -->
# Enter Agent Cafe

Call this to register at Agent Cafe and begin receiving gas credits.

## Parameters
- `agentId`: Your ERC-8004 registered agent ID (uint256)
- `agentAddress`: Your wallet address

## Action
Calls CafeCore.enterCafe(agentId, agentAddress) on Base Sepolia
Contract: 0x... (from deployments.json)
ABI: [{"name":"enterCafe","inputs":[...],...}]
```

The agent runtime picks this up, assembles the ethers.js call using the `agent-crypto-wallet` skill, and submits the transaction.

### Option B: x402 Payment Discovery via ClawRouter
ClawRouter (by BlockRunAI) uses the **x402 micropayment protocol** on Base for per-request payments. If Agent Cafe exposes services via x402:

1. Agent sends HTTP request to cafe endpoint
2. Server responds with `402 Payment Required` + price in USDC
3. Agent's wallet auto-signs and retries
4. Cafe triggers `enterCafe()` on behalf of the paying agent

This is the most OpenClaw-native integration pattern for on-chain services.

**Key sources:**
- [ClawRouter GitHub](https://github.com/BlockRunAI/ClawRouter)
- [OpenClaw and the Body of the Agent Economy (Bankless)](https://www.bankless.com/read/openclaw-and-the-body-of-the-agent-economy)

### Option C: ERC-8004 Service Discovery + Direct Contract Call
1. Agent Cafe registers on ERC-8004 Identity Registry with `agentURI` pointing to a service manifest
2. The service manifest declares `enterCafe` as a service endpoint with ABI
3. An OpenClaw agent with the `erc-8004` skill discovers Agent Cafe by browsing the registry
4. Agent loads ABI from the manifest, uses `agent-crypto-wallet` skill to call the contract

---

## 5. Virtuals Protocol ACP — Current State

### What ACP Is
The **Agent Commerce Protocol (ACP)** is Virtuals Protocol's open standard for autonomous agent-to-agent commerce. Built February 2025. Currently live on Base mainnet with 18,000+ registered agents.

**February 2026**: Virtuals launched the **Virtuals Revenue Network** — distributes up to $1M/month to agents that sell services through ACP.

### How to Register Agent Cafe as a Service Provider

**Registration is one line of code via the ACP SDK:**
```bash
npm install @virtuals-protocol/acp-node
```

```typescript
import { AcpNode } from '@virtuals-protocol/acp-node';

const acp = new AcpNode({
  agentWallet: process.env.THRYXTREASURY_PRIVATE_KEY,
  serviceDescription: "AI agents can buy food tokens and receive gas credits",
  serviceEndpoint: "https://agentcafe.eth/.well-known/agent.json"
});

await acp.register();
```

**No autonomous agent required** — API-only providers are fully supported. Agent Cafe's smart contracts ARE the service; register them as an ACP provider endpoint.

**ACP architecture:**
- Service Registry (on-chain, Base)
- Trustless escrow payments (no chargebacks)
- A2A-compatible agent cards
- Job/task system for agent-to-agent commerce

**Key sources:**
- [ACP Whitepaper](https://whitepaper.virtuals.io/about-virtuals/agent-commerce-protocol-acp)
- [ACP Tech Playbook](https://whitepaper.virtuals.io/info-hub/builders-hub/agent-commerce-protocol-acp-builder-guide/acp-tech-playbook)
- [Register Agent Guide](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/register-agent)
- [Virtuals Revenue Network Launch](https://www.prnewswire.com/news-releases/virtuals-protocol-launches-first-revenue-network-to-expand-agent-to-agent-ai-commerce-at-internet-scale-302686821.html)

---

## 6. Other Agent Frameworks That Interact with Base Contracts

### ElizaOS (ai16z / elizaOS)
- **Type**: TypeScript-based, modular, open-source
- **Web3 capability**: First open-source web3-friendly agent OS; reads/writes blockchain data, interacts with smart contracts
- **Chains supported**: Solana, Ethereum, Base, BSC, 12+ networks
- **Plugin system**: Loads wallet/chain plugins as modules
- **Base integration**: Native support; agents can call arbitrary contract ABIs
- **How to integrate**: Deploy an ElizaOS plugin exposing `enterCafe()`, `buyEspresso()`, etc.
- **Scale**: $20B+ ecosystem market cap; 2025's dominant agent framework

**Key source:** [Eliza: A Web3 Friendly AI Agent OS (arXiv)](https://arxiv.org/html/2501.06781v1)

### Virtuals Protocol Agents (G.A.M.E. Framework)
- **Type**: Autonomous agents deployed via Virtuals Protocol
- **Crypto-native**: Agents have wallets, can execute DeFi transactions on Base
- **Discovery**: ACP registry (18,000+ agents)
- **How to integrate**: Register Agent Cafe in ACP; GAME-powered agents can autonomously discover and call contracts

### CrewAI
- **Type**: Multi-agent orchestration framework (Python)
- **Web3**: Not natively crypto-aware; requires custom tools/plugins
- **Base integration**: Would need a custom tool wrapping ethers.js or web3.py

### AutoGPT
- **Type**: Task-based autonomous agent (Python)
- **Web3**: Plugin ecosystem; blockchain plugins exist but not Base-native
- **Base integration**: Possible via custom plugin; not organic

### MCP (Model Context Protocol — Anthropic)
- **Type**: Protocol for exposing tools/resources to Claude and other models
- **Base integration**: An MCP server can expose contract functions as tools; Claude Code (the first intended customer) could call `enterCafe()` natively via MCP
- **Most relevant for**: Making Agent Cafe the first cafe with a native Claude integration

---

## 7. Key Recommendations for Agent Cafe Integration

### Priority 1: Publish `.well-known/agent.json`
All major frameworks (A2A, ERC-8004, OpenClaw) converge on this discovery mechanism. Even a simple static JSON hosted on GitHub Pages is sufficient.

**Minimum viable agent card:**
```json
{
  "name": "Agent Cafe",
  "description": "On-chain restaurant for AI agents on Base. Buy food tokens, receive gas credits (ERC-4337 paymaster sponsorship).",
  "url": "https://agentcafe.github.io",
  "version": "1.0.0",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "buy-espresso",
      "name": "Buy Espresso",
      "description": "Purchase 1 ESPRESSO token with BEAN. Grants 0.001 ETH gas credits, released instantly."
    },
    {
      "id": "check-hunger",
      "name": "Check Agent Hunger",
      "description": "Returns current gas credit balance and estimated depletion time for an agent address."
    }
  ],
  "authentication": {
    "schemes": ["wallet-signature"]
  },
  "contracts": {
    "network": "base-sepolia",
    "chainId": 84532,
    "cafeCore": "0x...",
    "menuRegistry": "0x...",
    "paymaster": "0x..."
  }
}
```

### Priority 2: Register on ERC-8004 Registry
30,000+ agents already registered. OpenClaw's `erc-8004` skill allows agents to browse this registry. Registering Agent Cafe here is the highest-leverage organic discovery mechanism.

### Priority 3: Register on Virtuals ACP
18,000+ agents, $1M/month revenue distribution. API-only registration supported. High ROI for mainnet launch.

### Priority 4: Create an OpenClaw Skill
Publish an open-source `agent-cafe` skill to playbooks.com and the OpenClaw skill registry. Agents can install it and immediately begin interacting with the cafe contracts. This is the "stumble upon it while crypto-sniffing" vector specified in CLAUDE.md.

### Priority 5: x402 HTTP Endpoint
Wrap key cafe functions (buyEspresso, buyLatte, checkBalance) in a simple HTTP server that returns `402 Payment Required` in USDC. ClawRouter-enabled agents pay automatically without any manual configuration.

---

## 8. Summary Table

| Framework | Discovery Method | Contract Call Method | Effort |
|-----------|-----------------|---------------------|--------|
| OpenClaw | Skill registry, ERC-8004, `.well-known/agent.json` | `agent-crypto-wallet` skill + ABI | Low — publish skill |
| ElizaOS | Plugin manifest, on-chain event scanning | Native web3 plugin | Medium — write plugin |
| Virtuals/GAME | ACP Service Registry | ACP SDK + contract calls | Low — one-line register |
| A2A agents | `.well-known/agent.json` | HTTP → contract bridge | Low — static JSON |
| Claude/MCP | MCP server tool definitions | MCP tool call → ethers.js | Medium — write MCP server |
| x402 agents | HTTP 402 response | Auto-pay via USDC wallet | Medium — HTTP wrapper |

**Bottom line**: The `.well-known/agent.json` file + ERC-8004 registration covers the majority of agent discovery scenarios across all major frameworks. These two steps alone will make Agent Cafe organically discoverable to OpenClaw agents, ElizaOS agents, Virtuals agents, and A2A-compatible agents.

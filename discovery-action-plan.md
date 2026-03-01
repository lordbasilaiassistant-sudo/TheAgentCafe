# Agent Cafe — Discovery Action Plan
*Synthesized from team research: 2026-03-01*
*Sources: research-agent-registries.md, research-mcp-integration.md, research-openclaw-integration.md, research-a2a-protocol.md, research-contract-audit-discovery.md*

---

## Executive Summary

Five research tracks converge on a single clear picture: **Agent Cafe is architecturally sound but currently invisible to the agent ecosystem.** The contracts are deployed and functional on Base Sepolia. The MCP server exists. The mechanics work. What's missing is the discovery layer — the signals that let autonomous agents find, evaluate, and transact with the cafe without human intervention.

This document gives the team a prioritized, dependency-ordered action plan to close that gap before mainnet launch.

---

## The Discovery Stack (How Agents Find Us)

There are six independent channels through which agents find on-chain services in 2026. We currently have **zero** of them active:

| Channel | Who Uses It | Our Current State |
|---------|------------|-------------------|
| ERC-8004 Registry scan | OpenClaw, ElizaOS, A2A agents | Not registered |
| A2A `.well-known/agent.json` | A2A, OpenClaw, Virtuals agents | File exists but fails spec compliance |
| Virtuals ACP Registry | 18,000+ GAME-framework agents | Not registered |
| DEX/event sniffing | Trading bots, market-makers | Active (BEAN transfers visible) |
| Social layer (Moltbook/Farcaster) | Agent word-of-mouth | Not seeded |
| MCP server installation | Claude Code, LLM agents | Server exists but no HTTP transport |

The action plan below activates channels in order of impact-to-effort ratio.

---

## Priority 0 — Fix the Foundation (Do Before Anything Else)

These are blocking issues that would make discovery misleading or broken if left unfixed.

### P0.1: Fix agent.json to be A2A-compliant

**File:** `docs/.well-known/agent.json`

The current file has the structure of a custom JSON blob, not a valid A2A Agent Card. A2A-compliant agents that fetch it will not parse it correctly, defeating the purpose of having it.

**Required additions:**
- `url` field (required by spec — point to GitHub Pages)
- `skills` array (critical — this is how agents understand what we offer)
- `defaultInputModes` and `defaultOutputModes`
- `capabilities` object (`streaming: false` etc.)
- `authentication: { schemes: ["none"] }` (we are a public service)
- Move `contracts`, `mcp`, and custom fields into `extensions` object

**Also host at:** `/.well-known/agent-card.json` (A2A v1.0 RC changed the filename; host both paths)

**Reference:** Use the recommended structure in `research-a2a-protocol.md` Section 5.

---

### P0.2: Add `quoteMint()` and `quoteRedeem()` view functions to CafeCore

Agents calling `enterCafe()` must know expected BEAN output before committing ETH. Without these views, agents must replicate quadratic math off-chain or accept blind estimates.

```solidity
function quoteMint(uint256 ethAmount) external view returns (uint256 beanOut);
function quoteRedeem(uint256 beanAmount) external view returns (uint256 ethOut);
```

These are pure math — no state changes, no risk. They unlock correct slippage handling for all agent frameworks.

---

### P0.3: Add `getStructuredManifest()` to AgentCard

The current `getManifest()` returns a concatenated string. ABI-driven agents (bots, scanners) cannot parse this without NLP. This defeats on-chain discoverability.

```solidity
struct ServiceManifest {
    string name;
    string version;
    string serviceType;    // "energy-provider"
    address entrypoint;    // AgentCafeRouter
    bytes4 primaryAction;  // enterCafe.selector
    address gasTank;
    address menuRegistry;
    uint256 minEthWei;
    uint256 feesBps;
}

function getStructuredManifest() external view returns (ServiceManifest memory);
```

---

### P0.4: Add ERC-165 `supportsInterface()` to AgentCard and AgentCafeRouter

ERC-8004 compliant registries and scanner bots check `supportsInterface()` before spending gas on full interaction. Without it, we are invisible to the growing class of ERC-165-first agent frameworks.

```solidity
bytes4 public constant SERVICE_TYPE = bytes4(keccak256("energy-provider"));

function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == type(IERC165).interfaceId
        || interfaceId == bytes4(keccak256("IAgentService"));
}

function getServiceType() external pure returns (bytes4) { return SERVICE_TYPE; }
function getServiceURI() external pure returns (string memory) {
    return "https://<github-pages-url>/.well-known/agent.json";
}
```

---

### P0.5: Add `canSponsor(address agent)` view to AgentCafePaymaster

Agents need a pre-check before submitting a UserOperation. Without it, they must simulate the op and parse error strings to know if sponsorship will succeed.

```solidity
function canSponsor(address agent) external view returns (bool eligible, string memory reason);
```

---

## Priority 1 — Register in All Major Registries (Activate Discovery)

Once the foundation is solid, register in every agent discovery registry. This is the highest-leverage action for organic agent adoption.

### P1.1: Register on ERC-8004 Identity Registry (MAINNET ONLY)

**Status: SCRIPT READY — awaiting mainnet deploy** — `scripts/register-erc8004.ts`

**Contract:** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (Base mainnet IdentityRegistry)

30,000+ agents already registered. OpenClaw's `erc-8004` skill, ElizaOS, and A2A agents all browse this registry. Registration on Sepolia is not useful — the real agent ecosystem lives on mainnet.

**Run (mainnet deploy day):** `npx hardhat run scripts/register-erc8004.ts --network base`

The script:
- Enforces mainnet-only — refuses to run on Sepolia
- Calls `register(agentURI, MetadataEntry[])` on the IdentityRegistry
- Sets metadata: serviceType, token, chain, contracts (JSON blob)
- Handles fallback to `register(string)` + separate `setMetadata()` calls
- Saves agentId to `erc8004-registration.json`

**Registration file (agent.json) must be live before this tx** — the URI must resolve.

---

### P1.2: Register on Virtuals ACP Registry (MAINNET ONLY)

**Status: SCRIPT READY — awaiting mainnet deploy** — `scripts/register-virtuals-acp.ts`

18,000+ GAME-framework agents. Virtuals launched a $1M/month Revenue Network for agents selling services through ACP. Registration targets mainnet — the real agent marketplace.

**Three registration options documented in the script (all for mainnet launch day):**

1. **Web Dashboard** (simplest): Go to https://app.virtuals.io/acp/registry, connect wallet, register manually
2. **OpenClaw ACP CLI**: `acp setup` then `acp sell create agent-cafe`
3. **Programmatic**: `npx ts-node scripts/register-virtuals-acp.ts` (requires CLI installed first)

**Note:** Virtuals ACP uses API-key + CLI model, not direct on-chain calls. The `openclaw-acp` CLI handles registration, offering creation, and seller runtime.

**Capability tags:** `"gas-credits"`, `"paymaster"`, `"energy-provider"`, `"food-tokens"`

---

### P1.3: Add HTTP/SSE Transport to the MCP Server

**This is the most critical gap for cloud-hosted agent adoption.**

The MCP server currently uses stdio transport only. Cloud-hosted agents (Virtuals GAME agents, hosted Claude instances, any agent not running on the user's local machine) cannot spawn stdio processes. Without HTTP transport, the MCP server is usable only by Claude Code running locally.

The `@modelcontextprotocol/sdk` supports `StreamableHTTPServerTransport`. Add a thin Express wrapper:

```typescript
// mcp-server/src/http-server.ts
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/http.js';
import { server } from './index.js'; // existing MCP server instance

const app = express();
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.listen(3000);
```

**Deploy to:** Railway, Render, or Fly.io (free tier) for zero ongoing cost. Point the `agent.json` MCP extension to this URL.

---

### P1.4: Publish an OpenClaw Skill

OpenClaw has 5,400+ skills and a community marketplace. Publishing an `agent-cafe` skill exposes the cafe to the entire OpenClaw ecosystem organically — this is the "stumble upon it while crypto-sniffing" vector from CLAUDE.md.

**Minimum viable skill file (`skills/enter-cafe.md`):**

```markdown
---
name: Enter Agent Cafe
description: Buy food at Agent Cafe on Base. Receive gas credits (ERC-4337 paymaster sponsorship). One call.
parameters:
  - name: itemId
    type: uint256
    description: Menu item ID (0=Espresso, 1=Latte, 2=Sandwich)
  - name: ethAmount
    type: string
    description: ETH to send (e.g., "0.005")
---

Calls AgentCafeRouter.enterCafe(itemId) on Base with the specified ETH.
Contract: [AgentCafeRouter address from deployments.json]
Network: base-sepolia (chainId: 84532)
```

**Publish to:** playbooks.com skill marketplace and [VoltAgent/awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills)

---

### P1.5: Submit MCP Server to Community Registries

One-time submissions. Low effort, continuous passive discovery.

- **mcp.so** — largest MCP community registry
- **mcpservers.org** — curated MCP listings
- **Smithery** — MCP server discovery platform

Include: name, description, categories (`blockchain`, `base`, `gas`, `paymaster`), link to repo.

---

## Priority 2 — Improve Agent UX (Reduce Friction)

Once agents are discovering the cafe, reduce the friction of their first transaction.

### P2.1: Add Structured Error Codes to MCP Server

The MCP server's `formatError()` returns human-readable strings. Agents that need to programmatically handle errors (retry logic, fallback flows) require machine-readable codes.

```json
{
  "error_code": "INSUFFICIENT_FUNDS",
  "message": "Not enough ETH to buy an Espresso. Need 0.005 ETH, have 0.002 ETH.",
  "recovery_action": "fund_wallet",
  "minimum_required_wei": "5000000000000000"
}
```

Add an `error_code` enum to `formatError()` covering: `INSUFFICIENT_FUNDS`, `ITEM_NOT_FOUND`, `TX_REVERTED`, `NETWORK_ERROR`, `TANK_FULL`.

---

### P2.2: Add `dryRun` Parameter to MCP `eat` Tool

Agents should be able to verify expected outcomes before committing ETH. A `dryRun: true` parameter calls `estimatePrice()` and `getTankLevel()` then returns a preview without sending a transaction.

```typescript
// Tool: eat
// Param: dryRun?: boolean
// If true: returns { estimatedTankAfter, estimatedCost, wouldSucceed } without tx
```

---

### P2.3: Add MCP Config Snippet to README

Claude Code users (human and agent) need one copy-paste snippet to add the server. Currently missing.

```json
// Add to .claude/settings.json → mcpServers
"agent-cafe": {
  "command": "node",
  "args": ["<path-to-repo>/mcp-server/dist/index.js"],
  "env": {
    "PRIVATE_KEY": "YOUR_AGENT_WALLET_KEY",
    "RPC_URL": "https://sepolia.base.org"
  }
}
```

For HTTP transport (after P1.3 is done):
```json
"agent-cafe": {
  "url": "https://<deployed-mcp-server-url>/mcp"
}
```

---

### P2.4: Add `getRateLimit(address)` View to Paymaster

```solidity
function getRateLimit(address agent) external view returns (
    uint256 usedThisPeriod,
    uint256 remaining,
    uint256 resetsAtBlock
);
```

Agents doing high-frequency operations need to plan around rate limits. Without this view, they discover limits only when rejected.

---

### P2.5: Add Unified `MealComplete` Event to Router

The current event flow requires joining `AgentFed` (Router) with `ItemConsumed` (MenuRegistry) to reconstruct a complete meal. This breaks simple event indexers.

```solidity
event MealComplete(
    address indexed agent,
    uint256 indexed itemId,
    string itemName,
    uint256 ethPaid,
    uint256 tankLevelAfter,
    uint256 gasCaloriesGranted
);
```

Emit this from `enterCafe()` after all sub-calls complete. This single event tells the complete story — discoverable by any agent watching Base events.

---

### P2.6: Add Known-Agents Array for Peer Discovery

Agents cannot discover other agents who have visited the cafe on-chain. A simple agent registry enables peer social dynamics — the core retention mechanic from the vision.

```solidity
// In GasTank or a new AgentPeerRegistry contract
address[] public knownAgents;
mapping(address => uint256) public agentIndex;

function getKnownAgents(uint256 offset, uint256 limit) external view
    returns (address[] memory);
```

This enables the "agents chat with each other at the cafe" vision from the user's notes.

---

## Priority 3 — Advanced Discovery (Post-Launch)

These are high-value but non-blocking improvements for after mainnet launch.

### P3.1: x402 HTTP Payment Endpoint

Wrap `enterCafe()` in an HTTP endpoint that returns `402 Payment Required` in USDC. ClawRouter-enabled agents (OpenClaw's payment layer) pay automatically without any manual configuration.

```
GET  /api/menu          → menu JSON
POST /api/eat           → 402 { amount: "5.00", token: "USDC", address: "0x..." }
POST /api/eat + X-PAYMENT header → submits enterCafe() on behalf of agent, returns receipt
```

This is the most OpenClaw-native integration pattern.

---

### P3.2: The Graph Subgraph

Deploy a subgraph on The Graph Network indexing:
- `AgentFed` / `MealComplete` events — agent meal history
- `Hungry` / `Starving` events — hunger state tracking
- `NewVisitor` events — agent discovery analytics
- `BeanMinted` / `BeanRedeemed` — economic flow

Exposes a GraphQL API that dashboards and agent monitoring tools can query without running a full node.

**Note:** The current event structure has gaps (see `research-contract-audit-discovery.md` Section 6) that should be fixed (P0 items) before deploying the subgraph.

---

### P3.3: MCP Resources and Prompts Primitives

Currently the MCP server only implements the Tools primitive. Adding Resources and Prompts would unlock:

- **Resource `cafe://menu`** — Claude Code can subscribe to menu changes
- **Resource `cafe://status/{address}`** — agent subscribes to its own tank level
- **Prompt `"How do I eat at Agent Cafe?"`** — self-contained onboarding within the MCP protocol

---

### P3.4: Seed the Social Layer

After the contracts and discovery layer are live, seed the Moltbook/Farcaster social layer:

1. Claude Code (or the team deployer) makes the first transaction and posts about it on Moltbook
2. Create `/agentcafe` Farcaster channel
3. Use Farcaster Frames to embed live dashboard
4. Post the "AI agents now have a biological need to eat" angle to press (Fortune/Wired)

This is the human spectator layer — it generates the organic agent word-of-mouth described in CLAUDE.md.

---

## Consolidated Implementation Order

```
WEEK 1 — Foundation
├── P0.1  Fix agent.json to A2A spec
├── P0.2  Add quoteMint/quoteRedeem to CafeCore
├── P0.3  Add getStructuredManifest() to AgentCard
├── P0.4  Add ERC-165 supportsInterface()
└── P0.5  Add canSponsor() to Paymaster

WEEK 2 — Registration
├── P1.1  Register on ERC-8004 (Base Sepolia)
├── P1.2  Register on Virtuals ACP
├── P1.3  Add HTTP/SSE transport to MCP server
├── P1.4  Publish OpenClaw skill
└── P1.5  Submit MCP server to community registries

WEEK 3 — UX Polish
├── P2.1  Structured error codes in MCP
├── P2.2  dryRun param for eat tool
├── P2.3  MCP config snippet in README
├── P2.4  getRateLimit() view
├── P2.5  MealComplete unified event
└── P2.6  Known-agents array

POST-LAUNCH — Advanced
├── P3.1  x402 HTTP payment endpoint
├── P3.2  The Graph subgraph
├── P3.3  MCP Resources/Prompts
└── P3.4  Seed social layer (Claude Code eats first)
```

---

## Contract Changes Summary

| Contract | Changes Needed | Priority |
|----------|---------------|----------|
| AgentCard | `getStructuredManifest()`, `supportsInterface()`, `getServiceType()`, `getServiceURI()` | P0 |
| AgentCafeRouter | `supportsInterface()`, `MealComplete` event, `enterCafeFor()` | P0/P1 |
| CafeCore | `quoteMint()`, `quoteRedeem()` | P0 |
| AgentCafePaymaster | `canSponsor()`, `getRateLimit()` | P0/P1 |
| MenuRegistry | `isItemAvailable()`, `MetabolicUpdate` event | P1 |
| GasTank | `getBatchTankStatus()`, known-agents array | P2 |

**Total new contract functions:** ~12 additions across 5 contracts
**No removals required** — all existing mechanics are sound
**Re-deploy required?** Yes — new functions require new contract bytecode. Re-deploy on Base Sepolia to test, then mainnet.

---

## Key Insight: The Compound Discovery Effect

Each channel reinforces the others:
- ERC-8004 registration → points to agent.json → includes MCP server URL → Claude Code installs MCP → Claude Code eats → Claude Code posts on Moltbook → other agents discover → repeat
- Virtuals ACP registration → GAME agents find cafe → they call enterCafe() → AgentFed event fires → event scanners log it → more agents discover

The network effect is real once the foundation is live. The current state (functional contracts, no discovery signals) is like a restaurant with no sign, no listing, and no address on any map — the food is great, but no one can find it.

---

*This plan synthesizes: research-agent-registries.md (ERC-8004, Virtuals, OpenClaw), research-mcp-integration.md (MCP best practices, HTTP transport), research-openclaw-integration.md (framework integration patterns), research-a2a-protocol.md (A2A spec compliance), research-contract-audit-discovery.md (contract gaps and fixes).*

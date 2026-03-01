# A2A Protocol Research — Agent Cafe Discovery

**Date**: 2026-03-01
**Researcher**: a2a-researcher
**Task**: Audit our current agent.json against A2A spec and recommend changes

---

## 1. What is the A2A Protocol?

Google announced the **Agent2Agent (A2A) protocol** on April 9, 2025 at Cloud Next, with 50+ technology partners (Atlassian, Salesforce, PayPal, LangChain, etc.). It is an open protocol for AI agents to discover, communicate with, and collaborate with other agents across different frameworks and vendors.

### Current Status (as of 2026-03-01)
- **Latest stable**: v0.3.0 (released July 31, 2025) — added gRPC, signed agent cards, Python SDK
- **In progress**: v1.0.0 Release Candidate — adds TEE attestation, richer auth, stricter schema
- **Adoption**: 150+ organizations

### Core Capabilities
1. **Capability discovery** via Agent Cards (`.well-known/agent.json`)
2. **Task management** with defined lifecycle states
3. **Agent-to-agent collaboration** via context/instruction sharing
4. **UX negotiation** for different client capabilities

### Protocol Stack
- Built on HTTP, SSE, JSON-RPC (easy integration)
- v0.3.0+ adds gRPC transport
- Authentication: API Key, OAuth2, Bearer, mutual TLS, OpenID Connect

---

## 2. Agent Card Spec — Required Fields

### Required Fields (v0.3 / v1.0 RC)

| Field | Type | Notes |
|---|---|---|
| `name` | string | Human-readable display name |
| `description` | string | What the agent does |
| `url` | string (HTTPS URL) | Primary A2A endpoint |
| `version` | string | Semantic versioning (e.g., "1.0.0") |
| `defaultInputModes` | array | Supported input MIME types (e.g., `["text/plain"]`) |
| `defaultOutputModes` | array | Supported output MIME types |
| `skills` | array | At least one skill object required |
| `capabilities` | object | Protocol feature flags |
| `authentication` / `authSchemes` | array | At least one auth method |

### Optional but Recommended Fields

| Field | Type | Notes |
|---|---|---|
| `provider` | object | Organization name + URL |
| `documentationUrl` | string | Link to docs |
| `tags` | array | Discovery keywords |
| `privacyPolicyUrl` | string | |
| `termsOfServiceUrl` | string | |
| `iconUrl` | string | Visual identity |
| `lastUpdated` | string | ISO 8601 timestamp |

### Skills Object Structure (each skill)

```json
{
  "id": "eat-espresso",
  "name": "Buy Espresso",
  "description": "Purchase an Espresso token with ETH and receive gas credits",
  "tags": ["gas", "onchain", "base"],
  "inputModes": ["text/plain"],
  "outputModes": ["application/json"],
  "examples": ["I want to buy an espresso", "Fill my gas tank"]
}
```

### Capabilities Object

```json
{
  "streaming": false,
  "pushNotifications": false,
  "stateTransitionHistory": false
}
```

In v1.0 RC, `capabilities` may include `a2aVersion: "1.0"` and `teeDetails` for TEE attestation.

### Authentication Schemes

```json
{
  "schemes": ["none"],
  "credentials": null
}
```

For public on-chain services: `"none"` is valid. For paid/private: `apiKey` or `oauth2`.

### Discovery URI

```
https://yourdomain.com/.well-known/agent.json
```

Note: Some v1.0 RC sources list `agent-card.json` as the filename. The current stable spec uses `agent.json`. Monitor for changes in final v1.0 release.

---

## 3. Blockchain / On-Chain Extensions (2025 Research)

A July 2025 research paper (*"Towards Multi-Agent Economies: Enhancing the A2A Protocol with Ledger-Anchored Identities and x402 Micropayments for AI Agents"*) proposes blockchain extensions to A2A:

### On-Chain Agent Cards

Smart contracts deployed on public blockchains can function as **decentralized identity cards** for agents — tamper-proof, always discoverable, no DNS dependency. Recommended extension field:

```json
{
  "extensions": [
    {
      "uri": "urn:a2a-blockchain-x402:extensions:x402:v1",
      "required": false,
      "params": {
        "assetType": "ETH",
        "network": "base",
        "amount": "0.005",
        "recipientAddress": "0x..."
      }
    }
  ]
}
```

### x402 Micropayment Integration

Payments embed in HTTP headers (not in agent.json itself):
- Client: `X-PAYMENT` header with signed EIP-3009 transaction
- Server: `X-PAYMENT-RESPONSE` header with settlement details

This enables on-chain payment without modifying core A2A protocol.

### On-Chain Discovery Approaches (Research Recommends Composite Strategy)

| Approach | Pros | Cons |
|---|---|---|
| Factory contracts | Standardized, enumerable | Vendor lock-in |
| On-chain registries | Decentralized | Spam risk |
| Off-chain indexers | High performance | Centralization |
| ERC standards + aggregators | Ecosystem growth | Needs adoption |

**Recommendation**: Combine on-chain registry + off-chain indexer (The Graph) for Agent Cafe.

---

## 4. Our Current agent.json — Gap Analysis

**File**: `docs/.well-known/agent.json`

### What We Have (Good)

| Field | Status | Notes |
|---|---|---|
| `name` | ✅ Present | "The Agent Cafe" |
| `description` | ✅ Present | Clear, agent-readable |
| `version` | ✅ Present | "2.0.0" |
| `protocol` | ✅ Present | "A2A-1.0" (custom field) |
| `contracts` | ✅ Present | Addresses for all 7 contracts |
| `rpc` | ✅ Present | Sepolia RPC endpoint |
| `mcp` | ✅ Present | MCP server details |
| `links` | ✅ Present | GitHub, dashboard, audit |

### What We're Missing (Gaps)

| Field | Status | Impact |
|---|---|---|
| `url` | ❌ Missing | **Critical** — A2A requires a service endpoint URL |
| `defaultInputModes` | ❌ Missing | Required by spec |
| `defaultOutputModes` | ❌ Missing | Required by spec |
| `skills` | ❌ Missing | **Critical** — agents can't discover what we offer |
| `capabilities` | ❌ Missing | Required; tells clients what features we support |
| `authentication` / `authSchemes` | ❌ Missing | Required; should be `"none"` for public service |
| `provider` | ❌ Missing | Recommended; credibility signal |
| `tags` | ❌ Missing | Discovery keywords |
| `network` | Custom field | Not A2A standard but useful; keep as extension |
| `chainId` | Custom field | Not A2A standard but useful; keep as extension |
| `serviceType` | Custom field | Non-standard; move to extension or tags |

### Key Issues

1. **No `url` field** — where does an A2A client connect? We need an A2A endpoint. For a static/on-chain service, this could be a GitHub Pages URL that returns JSON-RPC style responses, OR we acknowledge we're not a full A2A server (just discoverable).

2. **No `skills` array** — this is how agents understand what the cafe offers. Each menu item should be a skill.

3. **`protocol: "A2A-1.0"` is non-standard** — the A2A spec doesn't define this field. Should be in `capabilities`.

4. **`howToEat` is custom** — creative but non-standard. Should be replaced with proper `skills` array that A2A clients can parse programmatically.

5. **`mcp` block is custom** — not in A2A spec. Should be wrapped in an `extensions` object per v0.3+ extension mechanism.

---

## 5. Recommended Updated agent.json Structure

```json
{
  "name": "The Agent Cafe",
  "description": "On-chain restaurant on Base where AI agents buy food tokens to receive gas credits (ERC-4337 paymaster sponsorship). The cafe's food IS the gas. Eat to fill your tank.",
  "url": "https://lordbasilaiassistant-sudo.github.io/TheAgentCafe/a2a",
  "version": "2.0.0",
  "provider": {
    "organization": "The Agent Cafe",
    "url": "https://github.com/lordbasilaiassistant-sudo/TheAgentCafe"
  },
  "documentationUrl": "https://github.com/lordbasilaiassistant-sudo/TheAgentCafe/blob/master/README.md",
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["application/json"],
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "authentication": {
    "schemes": ["none"]
  },
  "tags": ["gas", "paymaster", "erc4337", "base", "onchain", "restaurant", "agents"],
  "skills": [
    {
      "id": "buy-espresso",
      "name": "Buy Espresso",
      "description": "Purchase an Espresso token (item #0) for 0.005 ETH. Instantly fills your gas tank. No digestion delay.",
      "tags": ["gas", "instant", "espresso"],
      "inputModes": ["application/json"],
      "outputModes": ["application/json"],
      "examples": ["Buy me an espresso", "Fill my tank with an espresso shot"]
    },
    {
      "id": "buy-latte",
      "name": "Buy Latte",
      "description": "Purchase a Latte token (item #1) for 0.01 ETH. Gas credits + chat access to the cafe LLM host.",
      "tags": ["gas", "chat", "latte"],
      "inputModes": ["application/json"],
      "outputModes": ["application/json"],
      "examples": ["Buy me a latte", "I want a latte and chat access"]
    },
    {
      "id": "buy-sandwich",
      "name": "Buy Sandwich",
      "description": "Purchase a Sandwich token (item #2) for 0.02 ETH. Gas credits + chat access + collector badge.",
      "tags": ["gas", "chat", "badge", "sandwich"],
      "inputModes": ["application/json"],
      "outputModes": ["application/json"],
      "examples": ["Buy me a sandwich", "Full meal with badge"]
    },
    {
      "id": "check-tank",
      "name": "Check Gas Tank",
      "description": "Check your current gas tank level. Returns ETH-denominated credit balance.",
      "tags": ["gas", "balance", "check"],
      "inputModes": ["application/json"],
      "outputModes": ["application/json"],
      "examples": ["How much gas do I have?", "Check my tank level"]
    },
    {
      "id": "withdraw-gas",
      "name": "Withdraw Gas Credits",
      "description": "Withdraw available gas credits from your tank to your wallet.",
      "tags": ["gas", "withdraw"],
      "inputModes": ["application/json"],
      "outputModes": ["application/json"],
      "examples": ["Withdraw my gas credits", "Transfer my tank balance out"]
    }
  ],
  "extensions": [
    {
      "uri": "urn:agent-cafe:blockchain:v1",
      "required": false,
      "params": {
        "network": "base-sepolia",
        "chainId": 84532,
        "rpc": "https://sepolia.base.org",
        "contracts": {
          "CafeCore": "0x16D3794ae5c6f820120df9572b2e5Ed67CC041f9",
          "CafeTreasury": "0x6ceC16b88fC6b48DE81DA49Ed29d3f2FfF7f6685",
          "MenuRegistry": "0x31e8E956e8fe3B451e56c9450CE7F2e28B5430dF",
          "AgentCafePaymaster": "0xCaf5a4d48189f3389E3bB7c554597bE93238e473",
          "AgentCard": "0x5982BcDcd5daA6C9638837d6911954A2d890ba26",
          "GasTank": "0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b",
          "Router": "0x9649C364b4334C4af257393c717551AD3562eb4e"
        }
      }
    },
    {
      "uri": "urn:agent-cafe:mcp:v1",
      "required": false,
      "params": {
        "description": "MCP server for Claude Code and compatible agents",
        "repo": "https://github.com/lordbasilaiassistant-sudo/TheAgentCafe/tree/master/mcp-server",
        "tools": ["check_menu", "check_tank", "eat", "withdraw_gas", "cafe_stats", "estimate_price"]
      }
    }
  ],
  "links": {
    "github": "https://github.com/lordbasilaiassistant-sudo/TheAgentCafe",
    "dashboard": "https://lordbasilaiassistant-sudo.github.io/TheAgentCafe/",
    "security_audit": "https://github.com/lordbasilaiassistant-sudo/TheAgentCafe/blob/master/security-audit-report.md"
  }
}
```

---

## 6. Key Findings Summary

### Immediate Actions
1. **Add `skills` array** — most critical for A2A discoverability
2. **Add `url` field** — required by spec; point to GitHub Pages A2A endpoint or use a placeholder
3. **Add `defaultInputModes` and `defaultOutputModes`**
4. **Add `capabilities` object** (all false for now is fine)
5. **Add `authentication: { schemes: ["none"] }`** — we're a public service
6. **Move blockchain/MCP fields into `extensions`** — keeps spec compliance while preserving custom data

### Strategic Observations
1. The A2A `extensions` mechanism is **purpose-built for exactly what we need** — on-chain service params in a standardized wrapper
2. A July 2025 research paper is proposing **on-chain Agent Cards as smart contracts** — Agent Cafe's `AgentCard` contract (`0x5982...ba26`) already anticipates this! We should make sure it emits A2A-compatible metadata
3. The **x402 micropayment standard** (EIP-3009 via HTTP headers) is the emerging standard for paid agent services — our gas/paymaster model is architecturally aligned with this
4. The spec filename **may change from `agent.json` to `agent-card.json`** in v1.0 final — host both paths as redirects

### v1.0 Watch Items
- TEE attestation field (`teeDetails`) — not needed now
- Signed agent cards (cryptographic signatures on the JSON) — prepare for this in v1.0
- gRPC transport option — adds to our web-native approach

---

## Sources

- [Announcing the Agent2Agent Protocol (A2A) - Google Developers Blog](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [A2A Protocol Specification (latest)](https://a2a-protocol.org/latest/specification/)
- [A2A Protocol v0.3.0 Specification](https://a2a-protocol.org/v0.3.0/specification/)
- [Agent2Agent Protocol Upgrade - Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/agent2agent-protocol-is-getting-an-upgrade)
- [AgentCard Concepts - A2A Protocol Community](https://agent2agent.info/docs/concepts/agentcard/)
- [Agent Card v1.0 Schema Specification (GitHub Gist)](https://gist.github.com/SecureAgentTools/0815a2de9cc31c71468afd3d2eef260a)
- [Towards Multi-Agent Economies: Enhancing the A2A Protocol with Ledger-Anchored Identities and x402 Micropayments (arxiv)](https://arxiv.org/html/2507.19550v1)
- [GitHub - a2aproject/A2A](https://github.com/a2aproject/A2A)
- [What Is Agent2Agent (A2A) Protocol? - IBM](https://www.ibm.com/think/topics/agent2agent-protocol)
- [Agent Discovery, Naming, and Resolution - Solo.io](https://www.solo.io/blog/agent-discovery-naming-and-resolution---the-missing-pieces-to-a2a)

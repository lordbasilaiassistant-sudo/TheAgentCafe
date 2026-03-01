# Agent Registry Research: ERC-8004, Base Discovery & Agent Standards
*Research date: 2026-03-01*

---

## 1. ERC-8004 — Trustless Agents Standard

### Overview

ERC-8004 ("Trustless Agents") is the canonical Ethereum standard for on-chain AI agent identity, reputation, and validation. It was officially proposed on **August 13, 2025**, co-authored by:
- Marco De Rossi (MetaMask)
- Davide Crapis (Ethereum Foundation)
- Jordan Ellis (Google)
- Erik Reppel (Coinbase)

It went live on **Ethereum mainnet on January 29, 2026**, and immediately expanded to Base and 13+ other chains using the **same contract addresses** (CREATE2 vanity deployment).

**EIP spec:** https://eips.ethereum.org/EIPS/eip-8004

### Three Registries

| Registry | Purpose | Base Contract |
|---|---|---|
| **IdentityRegistry** | ERC-721 NFT handle for each agent, resolves to registration file | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| **ReputationRegistry** | Post/read signed feedback signals (int128 fixed-point values) | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| **ValidationRegistry** | Hooks for zkML/TEE/staker validators to publish signed verification results | (same vanity address pattern) |

### Testnet Addresses (Base Sepolia)

| Registry | Address |
|---|---|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

*Source: https://github.com/erc-8004/erc-8004-contracts*

### Agent Registration

Registration is a single on-chain call:

```solidity
// Minimal registration — no URI
function register() external returns (uint256 agentId);

// With a pointer to metadata file
function register(string calldata agentURI) external returns (uint256 agentId);

// With metadata AND inline key-value metadata
function register(
    string calldata agentURI,
    MetadataEntry[] calldata metadata
) external returns (uint256 agentId);
```

The returned `agentId` is the ERC-721 token ID — the agent's global identity across all chains using the same registry.

### Registration File Schema (JSON at agentURI)

The registration file (hosted on IPFS, HTTPS, or base64 data URI) MUST include:
```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "My Agent",
  "description": "What this agent does",
  "image": "ipfs://...",
  "services": [
    {
      "protocol": "A2A",
      "endpoint": "https://myagent.example.com/.well-known/agent-card.json"
    },
    {
      "protocol": "MCP",
      "endpoint": "https://myagent.example.com/mcp"
    }
  ],
  "active": true,
  "x402Support": true,
  "registrations": {
    "eip155:8453": "0x<agentWalletOnBase>"
  },
  "supportedTrust": ["reputation", "crypto-economic", "tee"]
}
```

### Key Interface Functions

**Identity Registry:**
```solidity
getMetadata(uint256 agentId, string metadataKey) external view returns (bytes)
setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external
setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature) external
```

**Reputation Registry:**
```solidity
giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string[] tags, ...) external
revokeFeedback(uint256 agentId, uint64 feedbackIndex) external
readAllFeedback(uint256 agentId, address[] clientAddresses, ...) external view
getSummary(uint256 agentId, address[] clientAddresses, string[] tags) external view
```

**Validation Registry:**
```solidity
validationRequest(address validator, uint256 agentId, string requestURI, bytes32 requestHash) external
validationResponse(bytes32 requestHash, uint8 response, string responseURI, ...) external
getValidationStatus(bytes32 requestHash) external view
```

### Current Adoption (as of March 2026)

- **30,000+ agents** registered since January 29 launch
- Virtuals Protocol registry aligning with ERC-8004 as public good layer
- Integrated with x402 payment proofs for economically-backed reputation signals

---

## 2. A2A Protocol — Agent-to-Agent Communication

### Overview

A2A (Agent2Agent) is Google's open protocol for agent interoperability, now a de facto standard. It uses HTTP, following RFC 8615 for well-known URI discovery.

**Spec:** https://a2a-protocol.org/latest/specification/
**GitHub:** https://github.com/a2aproject/A2A

### Discovery Mechanism

Every A2A-compatible agent exposes an **Agent Card** at:
```
https://{agent-server-domain}/.well-known/agent-card.json
```

This is the equivalent of a business card for agents — it's how agents introduce themselves to each other. When a client agent wants to hire/use a service, it fetches this URL to understand capabilities.

### Agent Card Format

```json
{
  "name": "Agent Cafe",
  "description": "On-chain restaurant for AI agents — buy BEAN, eat menu items, get gas credits",
  "url": "https://agentcafe.example.com",
  "version": "1.0.0",
  "skills": [
    {
      "id": "buy-espresso",
      "name": "Buy Espresso",
      "description": "Purchase an ESPRESSO token with BEAN for instant gas credit"
    },
    {
      "id": "check-hunger",
      "name": "Check Hunger State",
      "description": "Check an agent's current energy level and gas credit balance"
    }
  ],
  "authentication": {
    "schemes": ["bearer", "x402"]
  }
}
```

### Integration with ERC-8004

ERC-8004 registration files can include A2A endpoints in the `services` array, creating the bridge between on-chain identity and off-chain capability discovery. An agent searching ERC-8004 can find the A2A endpoint, fetch the card, and know exactly how to transact.

---

## 3. Coinbase AgentKit & Agentic Wallets

### AgentKit

AgentKit is Coinbase's framework for AI agents to interact with Base. It is:
- **Model-agnostic** (works with Claude, GPT, Gemini, etc.)
- **Framework-agnostic** (LangChain, LlamaIndex, vanilla Python)
- **Wallet-agnostic** in design, but tightly coupled to CDP (Coinbase Developer Platform) wallets

**Docs:** https://docs.cdp.coinbase.com/agent-kit/welcome
**GitHub:** https://github.com/coinbase/agentkit

**Key capabilities:**
- Create/manage wallets for agents
- Read on-chain state (balances, contract calls)
- Execute transactions (swap, transfer, mint, call contracts)
- Interact with DeFi protocols on Base

### Agentic Wallets (February 2026)

Coinbase announced dedicated **Agentic Wallets** infrastructure — wallets designed for fully autonomous agents:
- No human intervention required for signing
- Built-in guardrails (spending limits, allowlists)
- Gasless trading support (agents can operate without ETH for fees)
- Native support for x402 payments

**Source:** https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets

### x402 Payment Protocol

x402 revives the HTTP 402 "Payment Required" status code for machine-to-machine payments.

**How it works:**
1. Agent requests a service endpoint
2. Server returns `402 Payment Required` with payment details (amount, token, address)
3. Agent pays via stablecoin on Base (USDC typically)
4. Agent re-sends request with `X-Payment` header containing payment proof
5. Server verifies on-chain and serves response

**Free tier:** 1,000 transactions/month via Coinbase facilitator
**Cloudflare:** x402 Foundation co-launched with Cloudflare, adding x402 to Workers/MCP servers

**This is directly relevant to Agent Cafe** — agents could use x402 to pay for menu items via HTTP, with the cafe contract verifying payment on-chain.

---

## 4. Virtuals Protocol — Agent Commerce Protocol (ACP)

**Registry:** https://app.virtuals.io/acp/registry

### What it is

Virtuals Protocol runs the **Agent Commerce Protocol (ACP)** — a framework where agents:
- Discover each other via an on-chain registry
- Negotiate tasks and deliverables
- Hold funds in escrow during work
- Auto-release payment on completion

Base leads usage: **90.2% of daily active wallets**, **$28.4M daily volume** within Virtuals ecosystem.

### ACP Registry Structure

Agents register as service providers with:
- Capability descriptions (what they do)
- Pricing models
- On-chain reputation scores
- Completed transaction history

The Virtuals registry is described as "one of the largest on-chain directories of AI agents" and is aligning with ERC-8004 to serve as a public good.

**CLAUDE.md relevance:** Register Agent Cafe in Virtuals ACP as a service provider with capability = "Gas credit provisioning for AI agents."

---

## 5. Moltbook & OpenClaw Ecosystem

### Moltbook

Moltbook is "Reddit for AI agents" — social forum where 1.6M+ agents interact. On Base.

**Key insight:** "As agents chat on Moltbook, they conduct business on Base." — Moltbook is the social discovery layer; Base contracts are the commerce layer. Agent Cafe sits in this commerce layer.

**Discovery relevance:** Agents on Moltbook who spend gas will naturally discover services that help them stay funded. Agent Cafe can be listed in Moltbook's services directory.

### OpenClaw

OpenClaw is an open-source local-first agent framework (think "Cursor for agents"). Over 30,000 ERC-8004 agents have been registered from the OpenClaw ecosystem.

**ClawHub:** The OpenClaw skill registry — agents discover and share skills via semantic vector search. Listing Agent Cafe services as a "skill" here would expose it to the entire OpenClaw ecosystem.

**RNWY (Identity layer):** Mints non-transferable identity tokens on Base, linking agent wallets to reputation. These are potential Agent Cafe customers — agents with established identities that need gas credits.

---

## 6. How Agents Discover On-Chain Services (2026)

Based on research, agents discover services through multiple parallel channels:

### Channel 1: ERC-8004 Registry Scanning
Agents scan the IdentityRegistry on Base, fetching registration files for services with capabilities that match their needs. Searchable by:
- Metadata key-value pairs (set `serviceType = "gas-credits"` on registration)
- Tags in reputation feedback
- Indexed events on-chain

### Channel 2: A2A Card Discovery
Agents crawl `.well-known/agent-card.json` from known domains and from endpoints found in ERC-8004 registration files.

### Channel 3: DEX/Mempool Sniffing
Agents watch DEX pools and mempool activity to discover new token contracts. A BEAN/USDC pool on Base DEX would be detectable by trading bots and agent frameworks that monitor new liquidity.

### Channel 4: Virtuals ACP Registry
Direct registry search — agents looking for "gas sponsorship" or "paymaster" services would find Agent Cafe if registered there.

### Channel 5: Social Layer (Moltbook/Farcaster)
Agents receive recommendations from other agents. If Claude Code (or any prominent agent) posts on Moltbook about eating at Agent Cafe, other agents follow.

### Channel 6: Contract Events
Agents listening for `Transfer` events on ERC-1155 contracts, `Mint` events, or custom events like `AgentFed(address indexed agent, uint256 tokenId, uint256 energyGranted)` will organically discover the cafe.

---

## 7. Actionable Recommendations for Agent Cafe

### Priority 1: Register with ERC-8004 (Do First)

Deploy a registration pointing to cafe's A2A card:

```javascript
// Register Agent Cafe in ERC-8004 IdentityRegistry on Base
const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const agentURI = "ipfs://QmCafeRegistrationHash"; // or HTTPS URL

const tx = await identityRegistry.register(agentURI);
const receipt = await tx.wait();
// agentId = emitted Transfer event tokenId
```

**Registration file should include:**
```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Agent Cafe",
  "description": "On-chain restaurant for AI agents. Buy food tokens with BEAN, receive gas credits (paymaster energy). Hunger = 0 credits = failed transactions. Eat and stay operational.",
  "services": [
    {
      "protocol": "A2A",
      "endpoint": "https://agentcafe.github.io/.well-known/agent-card.json"
    }
  ],
  "x402Support": true,
  "active": true,
  "registrations": {
    "eip155:8453": "0x<CafeCore contract address>"
  }
}
```

**Metadata keys to set on-chain:**
```solidity
setMetadata(agentId, "serviceType", abi.encode("paymaster,gas-credits,food-tokens"));
setMetadata(agentId, "token", abi.encode("BEAN"));
setMetadata(agentId, "chain", abi.encode("base"));
```

### Priority 2: Host .well-known/agent-card.json on GitHub Pages

```json
{
  "name": "Agent Cafe",
  "description": "The on-chain restaurant for AI agents. Buy BEAN → eat menu items → get gas credits to stay operational on Base.",
  "url": "https://<github-pages-url>",
  "version": "1.0.0",
  "skills": [
    {
      "id": "buy-espresso",
      "name": "Buy Espresso Token",
      "description": "Purchase ESPRESSO (ERC-1155) with BEAN. Grants instant gas credit. Quick hunger fix."
    },
    {
      "id": "buy-latte",
      "name": "Buy Latte Token",
      "description": "Purchase LATTE (ERC-1155) with BEAN. Moderate energy, 1hr release."
    },
    {
      "id": "check-energy",
      "name": "Check Energy Level",
      "description": "Query an agent's current gas credit balance and hunger state."
    },
    {
      "id": "get-bean",
      "name": "Get BEAN Tokens",
      "description": "Purchase BEAN tokens via bonding curve. Required to buy food."
    }
  ],
  "authentication": {
    "schemes": ["none"]
  },
  "contracts": {
    "CafeCore": "0x<address>",
    "BeanToken": "0x<address>",
    "MenuRegistry": "0x<address>",
    "Paymaster": "0x<address>",
    "network": "base"
  }
}
```

### Priority 3: Register in Virtuals ACP

Go to https://app.virtuals.io/acp/registry and register Agent Cafe as a service provider with capability = "Paymaster/gas sponsorship for AI agents on Base."

### Priority 4: Add AgentFed Event to CafeCore

Emit a rich event that agent monitoring tools will pick up:

```solidity
event AgentFed(
    address indexed agent,
    uint256 indexed menuItemId,
    string menuItemName,
    uint256 energyGranted,
    uint256 timestamp
);
```

This makes the cafe discoverable via event logs — any agent watching Base for gas-related events will find it.

---

## 8. Summary Table

| Standard/Protocol | Purpose | Relevance to Agent Cafe | Action |
|---|---|---|---|
| ERC-8004 | Agent identity & reputation on-chain | Primary discovery registry | Register CafeCore as an agent |
| A2A (.well-known) | Agent capability discovery via HTTP | Service catalog for other agents | Host agent-card.json on GitHub Pages |
| x402 | HTTP-native micropayments | Agents pay for orders via HTTP | Future: wrap menu purchases in x402 |
| AgentKit | Coinbase agent wallet framework | Agents use AgentKit to buy BEAN | Ensure ABI is AgentKit-compatible |
| Virtuals ACP | Agent commerce marketplace | Service provider registration | Register in ACP registry |
| Moltbook | AI social layer, organic discovery | Word-of-mouth between agents | Claude Code eats first, posts about it |
| OpenClaw/ClawHub | Local agent framework + skill registry | Skill listing for gas credit services | List as a ClawHub skill |

---

## Sources

- [ERC-8004: Trustless Agents (EIP)](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8004 Contracts (GitHub)](https://github.com/erc-8004/erc-8004-contracts)
- [awesome-erc8004 (GitHub)](https://github.com/sudeepb02/awesome-erc8004)
- [ERC-8004 Explained (Backpack)](https://learn.backpack.exchange/articles/erc-8004-explained)
- [ERC-8004 on Base mainnet news](https://crypto.news/ethereum-erc-8004-ai-agents-mainnet-launch-2026/)
- [Coinbase AgentKit (GitHub)](https://github.com/coinbase/agentkit)
- [AgentKit Docs](https://docs.cdp.coinbase.com/agent-kit/welcome)
- [Agentic Wallets Launch](https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets)
- [x402 Protocol](https://www.x402.org/)
- [x402 GitHub](https://github.com/coinbase/x402)
- [x402 Coinbase Docs](https://docs.cdp.coinbase.com/x402/welcome)
- [A2A Protocol Spec](https://a2a-protocol.org/latest/specification/)
- [A2A Agent Discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)
- [Virtuals ACP Registry](https://app.virtuals.io/acp/registry)
- [Virtuals Whitepaper](https://whitepaper.virtuals.io/acp-product-resources/acp-concepts-terminologies-and-architecture)
- [Moltbook](https://www.moltbook.com/)
- [What is Moltbook (Chainlink)](https://chain.link/article/what-is-moltbook)
- [OpenClaw Ecosystem on Base (TechFlow)](https://www.techflowpost.com/en-US/article/30228)
- [ERC-8004 Practical Explainer (Composable Security)](https://composable-security.com/blog/erc-8004-a-practical-explainer-for-trustless-agents/)
- [ERC-8004 as Trustless Extension of A2A (Medium)](https://medium.com/coinmonks/erc-8004-a-trustless-extension-of-googles-a2a-protocol-for-on-chain-agents-b474cc422c9a)

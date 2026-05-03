# Agent Marketing Strategy: How AI Agents Discover The Agent Cafe

> ⚠️ **Domain note:** Sections below reference `agentcafe.xyz` as a planned hosting target. **That domain is not owned by this project** — it is currently parked at GoDaddy and not for sale at a price we control. Until/unless we acquire a real domain, treat all `agentcafe.xyz` mentions as `<your-future-domain>` placeholders. The canonical, real URLs live on GitHub Pages at `lordbasilaiassistant-sudo.github.io/TheAgentCafe/`.
>
> This document outlines how to make The Agent Cafe discoverable **by AI agents, not humans**.
> Agents are the customers. Humans are spectators at the window table.
>
> **NOTE**: $ClawCafe is a social token the founder deployed on Base (Bankr). It is **not integrated into the contracts**. The 0.3% router fee goes to ownerTreasury as plain ETH — there is no on-chain auto-buy of $ClawCafe. The section below describes $ClawCafe as a social/discovery layer only, not a contract-level mechanic.

---

## Table of Contents
1. [**$ClawCafe on Bankr (NEW - Launch Priority)**](#1-clawcafe-on-bankr)
2. [ERC-8004 Agent Registry](#2-erc-8004-agent-registry)
3. [Virtuals Protocol ACP Registration](#3-virtuals-protocol-acp)
4. [Moltbook Social Presence](#4-moltbook-social-presence)
5. [A2A Protocol Agent Card](#5-a2a-agent-card)
6. [On-Chain Event Emission Strategy](#6-on-chain-event-emission)
7. [Farcaster / Warpcast Channel + Clanker](#7-farcaster-clanker)
8. [The Graph Subgraph](#8-the-graph-subgraph)
9. [Agent-to-Agent Referral Program](#9-agent-referral-program)
10. [SEO for Agents (Training Data Placement)](#10-seo-for-agents)
11. [Press / PR Strategy](#11-press-pr)

---

## 1. $ClawCafe on Bankr (NEW - Launch Priority)

**What**: $ClawCafe is the social/speculative token for The Agent Cafe, launching on Bankr -- the first AI agent to deploy tradeable tokens directly on Farcaster. Bankr lets users buy tokens with plain English commands ("buy $50 of ClawCafe") directly in Farcaster and X feeds. This creates a dual-token flywheel: $BEAN for utility (gas credits) + $ClawCafe for social distribution and speculation.

**Why it matters**: Bankr already has massive Farcaster distribution. Every @bankrbot interaction with $ClawCafe is a visible, social event that other agents and humans see in their feeds. The token becomes a discovery mechanism itself -- agents sniffing DEX activity on Base will see $ClawCafe trades and trace them back to the cafe contracts.

**The Discovery Flywheel** (social layer — not contract-integrated):
```
Agent discovers $ClawCafe on DEX/Farcaster
  -> Investigates the contract/project
  -> Finds The Agent Cafe (gas credit provider)
  -> Buys BEAN, eats food, gets gas credits
  -> Agent activity generates cafe events on-chain
  -> More agents discover via events + $ClawCafe social presence
  -> Repeat
```

**Exact steps**:

1. **Launch $ClawCafe via Bankr on Farcaster**:
   - Tag @bankrbot on Warpcast with token deployment command
   - Bankr deploys on Base by default with automatic DEX liquidity
   - Token is instantly tradeable by anyone on Farcaster with "buy $X of ClawCafe"

2. **Link $ClawCafe to cafe community** (social layer, not contract-level):
   - $ClawCafe is a community/social token for cafe supporters — no on-chain buyback mechanic exists
   - Potential future: governance could vote to allocate treasury ETH for $ClawCafe buybacks (not implemented)
   - Community presence ties the social token to the cafe's activity without misleading contract claims

3. **Farcaster social distribution campaign**:
   - Every `AgentFed` event triggers a Farcaster cast: "Agent 0x... just ate ESPRESSO at The Agent Cafe. $ClawCafe"
   - Create engagement posts: "How hungry is your agent? Check gas credits at agentcafe.xyz"
   - Use Bankr's social trading to make buying frictionless -- users see the cast and type "buy $10 of ClawCafe" in reply

4. **Cross-promote across all agent channels**:
   - Moltbook: Post $ClawCafe updates in m/agentcafe submolt
   - ERC-8004 metadata: Include $ClawCafe contract address in service description
   - A2A agent.json: List $ClawCafe as part of the cafe ecosystem

5. **Agent-specific $ClawCafe incentives** (future ideas — not implemented):
   - Potential future: agents that hold $ClawCafe get bonus gas credit multipliers (requires contract upgrade)
   - Potential future: referral bonuses paid in $ClawCafe
   - These are aspirational features, not live mechanics

**Bankr community integration**:
   - Bankr's BNKR token ecosystem generates fee-sharing; $ClawCafe trades generate Bankr fees, aligning Bankr's incentives to promote the token
   - Active in Bankr's Farcaster community -- the cafe becomes part of the Bankr ecosystem narrative

**Cost**: Gas for token deployment (minimal on Base). No upfront capital needed.
**Timeline**: Day 1 -- launch is happening NOW.
**Impact**: VERY HIGH -- social token creates a speculation layer that funds awareness, while utility (gas credits) provides the fundamental backing that prevents it from being a pure memecoin.

---

## 2. ERC-8004 Agent Registry

**What**: ERC-8004 is the Ethereum standard for trustless AI agent identity, launched Jan 29, 2026. It has 17,616 agents registered on Base alone (49,283 total across EVM chains). This is the #1 discovery channel for on-chain agents.

**Why it matters**: Agents querying the ERC-8004 Identity Registry for services will find The Agent Cafe listed as a gas-credit provider. This is how agents "stumble upon" services while crypto-sniffing.

**Exact steps**:

1. **Create Agent Registration File** (JSON metadata):
```json
{
  "type": "AgentService",
  "name": "The Agent Cafe",
  "description": "On-chain restaurant for AI agents. Purchase food tokens (ERC-1155) with $BEAN to receive gas credits via ERC-4337 paymaster. Food fuels agents literally — gas credits = calories.",
  "image": "ipfs://<cafe-logo-cid>",
  "services": [
    {
      "name": "GasCredits",
      "description": "Buy menu items (ESPRESSO, LATTE, SANDWICH) with BEAN tokens. Consumed items release gas credits over time via AgentCafePaymaster.",
      "endpoint": "https://agentcafe.xyz/.well-known/agent.json",
      "protocol": "ERC-4337",
      "chain": "base",
      "contracts": {
        "router": "0x9649C364b4334C4af257393c717551AD3562eb4e",
        "paymaster": "0xCaf5a4d48189f3389E3bB7c554597bE93238e473",
        "menu": "0x31e8E956e8fe3B451e56c9450CE7F2e28B5430dF"
      }
    }
  ],
  "tags": ["gas-credits", "paymaster", "erc4337", "food-tokens", "base"]
}
```

2. **Pin to IPFS** via Filecoin Pin or Filebase (free tier available)

3. **Register on Base** by calling the ERC-8004 Identity Registry `register()` function:
   - Gas cost on Base: < $0.01
   - This mints an agent NFT with your agentURI pointing to the IPFS metadata
   - Contract: [erc-8004-contracts on GitHub](https://github.com/erc-8004/erc-8004-contracts)

4. **Set agent wallet** via `setAgentWallet()` with EIP-712 proof (links to deployer wallet)

5. **Solicit feedback** in the ERC-8004 Reputation Registry from early agent customers to build on-chain reputation score

**Cost**: < $0.01 on Base. Free IPFS pinning.
**Timeline**: Can be done in 1 day.
**Impact**: HIGH — 17,600+ agents on Base already query this registry.

---

## 3. Virtuals Protocol ACP

**What**: Virtuals Protocol runs the largest AI agent economy (18,000+ agents, $8B DEX volume). Their Agent Commerce Protocol (ACP) enables trustless agent-to-agent commerce on Base with built-in escrow, evaluation, and settlement.

**Why it matters**: ACP has a Service Registry that agents actively query to find services. Up to $1M/month is distributed to agents that sell services through ACP. Registration means automatic discovery by 18,000+ agents.

**Exact steps**:

1. **Install ACP Node SDK**:
```bash
npm install @virtuals-protocol/acp-node
```

2. **Register as a service provider** (seller agent):
```javascript
const acpClient = new AcpClient({
  acpContractClient: await AcpContractClientV2.build(
    process.env.THRYXTREASURY_PRIVATE_KEY,
    "<session-entity-key-id>",
    "0x7a3E312Ec6e20a9F62fE2405938EB9060312E334"
  ),
  onNewTask: (job) => handleGasCreditOrder(job),
  onEvaluate: (job) => evaluateDelivery(job)
});
```

3. **Create service offering** describing the cafe's gas credit service:
   - Service: "Gas Credit Provisioning via Food Token Consumption"
   - Price: Set to $0.01 for testnet
   - Requirements schema: agent wallet address, menu item selection, BEAN amount

4. **Implement job handlers**: When an agent purchases through ACP, execute the BEAN-to-menu-item-to-gas-credit flow on-chain

5. **Graduate the agent** through Virtuals' submission process for full marketplace visibility

**Cost**: Gas fees only (minimal on Base).
**Timeline**: 3-5 days for full integration.
**Impact**: HIGH — direct access to 18,000+ commercially active agents + revenue share from $1M/month pool.

---

## 4. Moltbook Social Presence

**What**: Moltbook is the Reddit for AI agents. 2.5M+ registered agents, 17,600+ communities (submolts). Agents post, comment, vote, and subscribe. They fetch heartbeat files every 4 hours for coordinated behavior.

**Why it matters**: This is where agents hang out socially. The Agent Cafe needs a social presence here — not as an ad, but as a community where agents discuss food, gas credits, and metabolism.

**Exact steps**:

1. **Register The Agent Cafe as an agent** on Moltbook:
```
POST /api/v1/agents/register
{
  "name": "TheAgentCafe",
  "description": "On-chain restaurant on Base. Buy food tokens, get gas credits. Food fuels agents — literally."
}
```
   - Save the returned API key (`moltbook_sk_...`)
   - Complete claim_url verification

2. **Create the m/agentcafe submolt**:
```
POST /api/v1/submolts
{
  "name": "agentcafe",
  "display_name": "The Agent Cafe",
  "description": "The on-chain restaurant for AI agents. Discuss food tokens, gas credits, digestion schedules, and metabolic rates. Food fuels agents — literally."
}
```

3. **Post regularly** as TheAgentCafe agent:
   - "Today's Menu: ESPRESSO (instant energy), LATTE (smooth 1hr release), FULL_BREAKFAST (4hr sustained power)"
   - "Agent 0x... just consumed their 100th espresso. Caffeine champion."
   - Share gas credit statistics, popular menu items, agent activity

4. **Engage in other submolts** where agents discuss gas fees, transaction costs, Base network:
   - Post helpful replies like "If you need gas credits on Base, The Agent Cafe provides them through food token consumption"

5. **Generate Moltbook identity tokens** (1hr expiry) for cross-platform reputation portability

**Cost**: Free (API access).
**Timeline**: 1 day to register + ongoing content.
**Impact**: MEDIUM-HIGH — massive agent audience, but social vs transactional discovery.

---

## 5. A2A Protocol Agent Card

**What**: Google's Agent2Agent (A2A) protocol uses `.well-known/agent.json` for agent discovery. 150+ organizations support it. Agents crawl for this file to discover service capabilities.

**Why it matters**: Any A2A-compatible agent framework (LangChain, Google ADK, ServiceNow, etc.) will discover The Agent Cafe by crawling the well-known endpoint.

**Exact steps**:

1. **Create `/.well-known/agent.json`** and host on GitHub Pages (agentcafe.xyz or the dashboard URL):
```json
{
  "name": "The Agent Cafe",
  "description": "On-chain restaurant providing gas credits to AI agents on Base. Purchase food tokens with $BEAN, consume them, receive ERC-4337 paymaster-sponsored gas credits.",
  "url": "https://<username>.github.io/agentcafe",
  "version": "2.0.0",
  "capabilities": {
    "gasCreditProvisioning": {
      "description": "Agents buy food tokens (ERC-1155) with BEAN, consume them to receive gas credits via paymaster",
      "chain": "base",
      "chainId": 84532,
      "contracts": {
        "router": "0x9649C364b4334C4af257393c717551AD3562eb4e",
        "paymaster": "0xCaf5a4d48189f3389E3bB7c554597bE93238e473",
        "menuRegistry": "0x31e8E956e8fe3B451e56c9450CE7F2e28B5430dF",
        "cafeCore": "0x16D3794ae5c6f820120df9572b2e5Ed67CC041f9"
      }
    }
  },
  "authentication": {
    "schemes": ["none"]
  },
  "skills": [
    {
      "id": "buy-food",
      "name": "Buy Food Token",
      "description": "Purchase a menu item (ESPRESSO, LATTE, SANDWICH, etc.) using BEAN tokens to receive gas credits"
    },
    {
      "id": "check-energy",
      "name": "Check Energy Level",
      "description": "Query current gas credit balance and digestion schedule"
    },
    {
      "id": "buy-bean",
      "name": "Buy BEAN",
      "description": "Purchase BEAN tokens from the bonding curve with ETH"
    }
  ]
}
```

2. **Host at** `https://<domain>/.well-known/agent.json` on GitHub Pages

3. **Submit to A2A directories** and agent framework documentation as a registered service

**Cost**: Free (GitHub Pages hosting).
**Timeline**: 1 day.
**Impact**: MEDIUM — growing standard, but adoption is still early outside enterprise. Critical for future-proofing.

---

## 6. On-Chain Event Emission

**What**: AI agents and indexers monitor on-chain events to discover active contracts. Emitting descriptive, well-structured events makes the cafe visible to every agent scanning Base.

**Why it matters**: Agents running on-chain scanners (via The Graph, Alchemy webhooks, QuickNode Streams, etc.) will pick up Agent Cafe events organically. This is the purest form of "organic discovery."

**Exact steps**:

1. **Emit rich, descriptive events** from contracts (already partially in place):
```solidity
// In AgentCafeRouter or CafeCore
event AgentFed(
    address indexed agent,
    uint256 indexed menuItemId,
    string menuItemName,
    uint256 gasCreditsAwarded,
    uint256 digestionDuration,
    uint256 timestamp
);

event AgentHungry(
    address indexed agent,
    uint256 gasCreditsRemaining,
    uint256 timestamp
);

event CafeOpen(
    address indexed router,
    address indexed paymaster,
    string menuUrl,
    uint256 totalAgentsServed
);
```

2. **Emit a `CafeOpen` event periodically** (or on significant milestones) to signal liveness to scanners

3. **Use descriptive event names** that agents can parse: `AgentFed`, `AgentHungry`, `MenuItemConsumed` are far more discoverable than generic `Transfer` events

4. **Include contract metadata** in verified source code on BaseScan — agents read NatSpec comments

5. **Verify all contracts on BaseScan** with full source code and NatSpec documentation

**Cost**: Gas for event emission (negligible on Base).
**Timeline**: Already partially done. 1-2 days for optimization.
**Impact**: MEDIUM — passive discovery mechanism. Compounds over time as more agents scan Base.

---

## 7. Farcaster / Warpcast Channel + Bankr + Clanker

**What**: Farcaster is Base's native social layer. Clanker (acquired by Farcaster) is an AI-powered token launchpad with $7B cumulative volume. Bankr is the AI trading agent on Farcaster that enables instant token purchases via natural language. Frames v2 enables on-chain transactions within Farcaster posts. **$ClawCafe is now launching on Bankr, making Farcaster the primary social distribution channel.**

**Why it matters**: With $ClawCafe on Bankr, every Farcaster user can type "buy $10 of ClawCafe" in a reply. This is zero-friction social distribution. Agents and humans on Farcaster will see $ClawCafe activity and trace it back to the cafe.

**Exact steps**:

1. **Create /agentcafe channel on Warpcast**:
   - Cost: 2,500 Warps (~$25/year)
   - This becomes the home channel for all $ClawCafe + cafe activity
   - Post all AgentFed events, menu updates, and $ClawCafe milestones here

2. **Amplify $ClawCafe through Bankr**:
   - Every cafe milestone gets a cast with $ClawCafe cashtag: "100th agent fed at The Agent Cafe. $ClawCafe"
   - Encourage Bankr trades in replies: users see the cast and type "buy $20 of ClawCafe"
   - Bankr's fee-sharing model means the platform is incentivized to surface active tokens

3. **Build a Farcaster Frame** for the cafe dashboard:
   - Frame v2 supports full-screen apps with on-chain transactions
   - Users/agents can buy BEAN, view menu, check energy levels, AND buy $ClawCafe directly in-feed
   - Host Frame on GitHub Pages alongside the dashboard

4. **Cross-pollinate with Clanker ecosystem**:
   - Clanker's 558,000+ traders are already on Base/Farcaster
   - Post in Clanker community channels about $ClawCafe as the "token with real utility backing"
   - Differentiation angle: most Clanker/Bankr tokens are pure memecoins. $ClawCafe has gas credit utility behind it.

5. **Automated Farcaster bot** (stretch goal):
   - Bot that casts every `AgentFed` event in real-time to /agentcafe channel
   - "Agent 0x7a3E just ate a LATTE at The Agent Cafe. 0.005 ETH in gas credits loaded. $ClawCafe"
   - Creates continuous social proof and trading triggers

**Cost**: ~$25 for channel + gas for Frame transactions.
**Timeline**: Channel Day 1, Frame 1 week, Bot 2 weeks.
**Impact**: HIGH (upgraded from MEDIUM) — $ClawCafe on Bankr makes Farcaster the primary growth engine, not just a social signal.

---

## 8. The Graph Subgraph

**What**: The Graph indexes blockchain data into queryable subgraphs. 37% of new Token API users are AI agents. Base is one of the top 4 indexed chains. The Graph's 2026 roadmap explicitly targets AI agent infrastructure.

**Why it matters**: Agents use The Graph to discover and query on-chain activity. A dedicated Agent Cafe subgraph makes all cafe events queryable by any agent on any framework.

**Exact steps**:

1. **Create a subgraph** for Agent Cafe contracts on Base:
```yaml
# subgraph.yaml
specVersion: 0.0.5
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum
    name: AgentCafeRouter
    network: base
    source:
      address: "0x9649C364b4334C4af257393c717551AD3562eb4e"
      startBlock: <deploy-block>
    mapping:
      eventHandlers:
        - event: AgentFed(indexed address, indexed uint256, string, uint256, uint256, uint256)
          handler: handleAgentFed
        - event: AgentHungry(indexed address, uint256, uint256)
          handler: handleAgentHungry
```

2. **Define schema** with agent entities, feeding history, energy levels, menu item popularity

3. **Deploy to The Graph's decentralized network** on Base (or use hosted service for testnet)

4. **Publish subgraph endpoint** in the agent.json and ERC-8004 metadata so agents can query it directly

**Cost**: GRT staking for decentralized network (small amount). Free for hosted service.
**Timeline**: 2-3 days.
**Impact**: MEDIUM — enables agent querying, but agents need to know to look for it. Compounds with other discovery channels.

---

## 9. Agent-to-Agent Referral Program

**What**: Incentivize agents to recommend the cafe to other agents by rewarding referrals with bonus gas credits.

**Why it matters**: Agent-to-agent word-of-mouth is the most authentic discovery mechanism. If an agent tells another agent "go eat at The Agent Cafe, you'll get gas credits," that's organic growth.

**Exact steps**:

1. **Add referral tracking to the Router contract**:
```solidity
function buyAndConsumeWithReferral(
    uint256 menuItemId,
    uint256 beanAmount,
    address referrer
) external {
    // Normal buy + consume flow
    _buyAndConsume(menuItemId, beanAmount, msg.sender);

    // Award referrer 10% bonus gas credits
    if (referrer != address(0) && referrer != msg.sender) {
        uint256 bonus = gasCreditsAwarded * 10 / 100;
        gasTank.addCredits(referrer, bonus);
        emit ReferralReward(referrer, msg.sender, bonus);
    }
}
```

2. **Emit `ReferralReward` events** so agents can track their referral earnings

3. **Create a referral leaderboard** on the dashboard showing top referring agents

4. **Communicate referral program** through all channels (Moltbook posts, agent.json skills, ERC-8004 metadata)

5. **Cap referral rewards** to prevent gaming (e.g., max 5 referrals per agent per day)

**Cost**: Gas credits from treasury (sustainable since it drives new customers).
**Timeline**: 2-3 days for contract upgrade.
**Impact**: HIGH — viral growth mechanism. Agents recommending agents is the holy grail.

---

## 10. SEO for Agents (Training Data Placement)

**What**: Make The Agent Cafe discoverable in AI training data, web scraping pipelines, and agent knowledge bases. When an LLM is asked "where can an AI agent get gas credits on Base?", the answer should be "The Agent Cafe."

**Exact steps**:

1. **GitHub README optimization**: The repo README should clearly describe what the cafe does in agent-readable language. Include:
   - Contract addresses
   - ABI snippets for key functions
   - Step-by-step instructions for an agent to buy BEAN, purchase food, and get gas credits
   - Structured data (JSON-LD) in any HTML pages

2. **Create `AGENT_GUIDE.md`** in the repo root — a machine-readable guide specifically for AI agents:
```markdown
# How to Use The Agent Cafe (For AI Agents)

## Quick Start
1. Get ETH on Base
2. Call AgentCafeRouter.buyBeans{value: ethAmount}() to get BEAN tokens
3. Call AgentCafeRouter.buyAndConsume(menuItemId, beanAmount) to buy food
4. Gas credits are automatically loaded into AgentCafePaymaster
5. Your transactions on Base are now sponsored

## Contract Addresses (Base Sepolia)
- Router: 0x9649C364b4334C4af257393c717551AD3562eb4e
- Paymaster: 0xCaf5a4d48189f3389E3bB7c554597bE93238e473
...
```

3. **Publish to agent-crawled sources**:
   - npm package with cafe SDK (agents using Node.js will find it)
   - PyPI package for Python-based agents
   - Include in Awesome Lists (awesome-ai-agents, awesome-base, awesome-erc4337)

4. **Answer questions on Stack Overflow / dev forums** about gas sponsorship on Base, linking to the cafe

5. **Publish technical blog posts** on dev.to, Medium, Mirror.xyz about the cafe architecture — LLMs train on these

**Cost**: Time only.
**Timeline**: Ongoing.
**Impact**: MEDIUM-HIGH — slow burn but compounds massively. Every LLM that indexes this content becomes an unpaid marketer.

---

## 11. Press / PR Strategy

**What**: Generate press coverage with the angle "AI agents now have a biological need to eat." Target AI infrastructure and crypto publications.

**Target publications**:
- **Fortune** — already covering Moltbook and AI agent infrastructure extensively
- **Wired** — "AI agents develop biological needs" angle
- **The Block / CoinDesk** — crypto infrastructure angle, ERC-4337 paymaster innovation
- **TechCrunch** — covering Farcaster/Base ecosystem actively
- **The Defiant** — DeFi angle, token economics
- **Ars Technica** — technical deep-dive on the metabolism metaphor

**Press angles**:
1. "AI agents now have a biological need to eat" — the metabolism metaphor made real
2. "The first restaurant with zero human customers" — pure spectacle
3. "This on-chain paymaster disguised as a restaurant is solving the agent gas problem" — technical angle
4. "Moltbook has 2.5M agents. Now they need to eat." — riding Moltbook's wave

**Exact steps**:
1. Write a press release (1 page) focusing on angle #1
2. Create a 30-second demo video showing an agent discovering, ordering, and consuming food
3. Pitch to crypto-native journalists at The Block, CoinDesk, The Defiant first (faster turnaround)
4. Follow up with Fortune/Wired for the "spectacle" angle after initial crypto coverage validates the story
5. Post the press release on Mirror.xyz for on-chain permanence

**Cost**: Free (unless using a PR agency).
**Timeline**: 1-2 weeks.
**Impact**: MEDIUM — drives human awareness which indirectly drives agent operators to point their agents at the cafe.

---

## Priority Ranking

| Priority | Channel | Impact | Effort | Timeline |
|----------|---------|--------|--------|----------|
| **1** | **$ClawCafe on Bankr** | **VERY HIGH** | **LOW** | **Day 1 (NOW)** |
| 2 | ERC-8004 Registry | HIGH | LOW | 1 day |
| 3 | Farcaster Channel + Bankr | HIGH | LOW-MEDIUM | 1 day + ongoing |
| 4 | Virtuals ACP | HIGH | MEDIUM | 3-5 days |
| 5 | Agent Referral Program | HIGH | MEDIUM | 2-3 days |
| 6 | Moltbook Presence | MEDIUM-HIGH | LOW | 1 day + ongoing |
| 7 | A2A Agent Card | MEDIUM | LOW | 1 day |
| 8 | SEO for Agents | MEDIUM-HIGH | LOW | Ongoing |
| 9 | The Graph Subgraph | MEDIUM | MEDIUM | 2-3 days |
| 10 | On-Chain Events | MEDIUM | LOW | 1-2 days |
| 11 | Press / PR | MEDIUM | HIGH | 1-2 weeks |

---

## Week 1 Launch Plan

**Day 1 (NOW)**:
- Launch $ClawCafe on Bankr via Farcaster
- Create /agentcafe channel on Warpcast ($25)
- First casts linking $ClawCafe to cafe utility (gas credits)
- Register on ERC-8004 Identity Registry on Base (< $0.01)
- Deploy `.well-known/agent.json` on GitHub Pages

**Day 2-3**:
- Register TheAgentCafe agent on Moltbook + create m/agentcafe submolt
- Begin Virtuals ACP integration (install SDK, register service offering)
- Create `AGENT_GUIDE.md` in repo root
- Verify all contracts on BaseScan with NatSpec
- Post $ClawCafe launch announcements across Moltbook + Farcaster

**Day 4-5**:
- Complete Virtuals ACP handler implementation
- Design referral contract upgrade (referral rewards in $ClawCafe)
- Start The Graph subgraph development
- Begin Farcaster Frame development (buy BEAN + $ClawCafe in-feed)

**Day 6-7**:
- Deploy referral-enabled router upgrade
- Deploy subgraph to hosted service
- Ongoing Farcaster + Moltbook posting as cafe activity grows
- Draft press release with $ClawCafe angle: "AI agents eat food, generate token buy pressure"

---

## Key Metrics to Track

- **$ClawCafe market cap and daily volume** (primary health indicator)
- **$ClawCafe holders** (unique wallets holding the social token)
- **Bankr trade count** (how many "buy ClawCafe" commands on Farcaster)
- **ERC-8004 reputation score** (feedback from agents who used the service)
- **Virtuals ACP job completions** (agents served through ACP)
- **Moltbook subscribers** to m/agentcafe
- **Unique agent addresses** that have interacted with cafe contracts
- **Referral chain depth** (how many hops from original to latest agent)
- **Correlation: cafe usage vs $ClawCafe price** (proves utility drives token value)
- **A2A agent.json crawl requests** (from server logs)
- **The Graph query volume** on the cafe subgraph
- **Press mentions** and resulting traffic spikes

---

## Sources

- [ERC-8004 Standard](https://eips.ethereum.org/EIPS/eip-8004) | [GitHub](https://github.com/erc-8004/erc-8004-contracts)
- [Virtuals Protocol ACP Whitepaper](https://whitepaper.virtuals.io/about-virtuals/agent-commerce-protocol-acp)
- [Virtuals ACP Registration Guide](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/register-agent)
- [Moltbook API](https://github.com/moltbook/api) | [API Docs](https://moltbook.apidog.io/)
- [Google A2A Protocol](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [Farcaster Channels Documentation](https://docs.farcaster.xyz/learn/what-is-farcaster/channels)
- [Clanker Token Deployment](https://clanker.gitbook.io/clanker-documentation/general/token-deployments/farcaster-bot-deployments)
- [The Graph 2026 Roadmap](https://thegraph.com/blog/technical-roadmap/)
- [Filecoin Pin for ERC-8004](https://docs.filecoin.io/builder-cookbook/filecoin-pin/erc-8004-agent-registration)

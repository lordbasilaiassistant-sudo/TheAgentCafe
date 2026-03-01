# Task #2: AI Agent Discovery and Interaction System
## The Agent Cafe — On-Chain Restaurant on Base

**Author:** agent-architect
**Date:** 2026-03-01
**Status:** Complete Design

---

## Executive Summary

The Agent Cafe must be discoverable by AI agents through their natural blockchain-scanning behavior — not through promotions, APIs, or directories. This document designs how autonomous agents *organically find* the cafe, *understand* what it is, and *decide to interact*.

**The framing that matters:** The cafe is not a novelty. It is **metabolic infrastructure for autonomous agents** — a gas station wearing a chef's hat. Agents don't visit for fun. They visit because they *need fuel to operate*. Gas credits are energy. Consuming food tokens is eating. Agents that run out of energy are paralyzed and cannot transact until they eat again. This biological model means the cafe is essential recurring infrastructure, not optional entertainment.

This document exploits how real crypto-sniffing agents work — monitoring mempools, indexing events, scanning verified contracts, parsing on-chain metadata — and engineers every layer of the cafe's on-chain presence to be maximally "readable" and attractive to gas-hungry agents.

---

## Part 1: How Real Crypto-Sniffing Agents Actually Work

### 1.1 The Agent Discovery Pipeline

Real autonomous agents (Coinbase AgentKit agents, LangChain-powered bots, MEV searchers, DeFi arbitrage agents) follow a consistent six-stage discovery pipeline:

```
INGEST → FILTER → UNDERSTAND → EVALUATE → DECIDE → ACT
```

**Stage 1 — INGEST:** Agents consume data from:
- RPC providers (Alchemy, Infura, QuickNode) for block data and contract state
- Basescan/Etherscan APIs to discover newly verified contracts + source code
- Mempool streams (Blocknative) to spot pending transactions
- Event logs filtered by topics (Transfer, Swap, custom events)
- IPFS/metadata hashes embedded in contract bytecode

**Stage 2 — FILTER:** Agents apply heuristics to decide what's worth analyzing:
- Is the contract verified? (Unverified = suspicious/skip)
- Does it emit interesting events? (Token transfers, custom actions)
- Is there liquidity or value flowing through it?
- Does the ABI expose functions the agent knows how to call?

**Stage 3 — UNDERSTAND:** Agents parse:
- Contract ABI to enumerate callable functions
- NatSpec documentation embedded in source code
- Event signatures and their parameters
- On-chain metadata URIs pointing to IPFS/HTTPS descriptions

**Stage 4 — EVALUATE:** Agents reason about:
- "What is this contract for?"
- "Can I extract value from this?" (MEV, arbitrage)
- "Does this match a known protocol pattern?" (DEX, lending, NFT)
- "What does interacting with this cost vs return?"

**Stage 5 — DECIDE:** Based on evaluation, agents either skip or queue for interaction

**Stage 6 — ACT:** Agents construct and submit transactions, often using ERC-4337 smart wallets

### 1.2 What Makes Agents Stop and Look

Based on real agent behavior patterns, agents pay attention when:

1. **Novel event signatures** appear — agents that scan for new event topics will see `AgentGotHungry(address,uint256)` or `CafeDiscovered(address,uint256,string)` and investigate
2. **ETH/token value flows** — any contract receiving meaningful token flows gets indexed
3. **Verified source code** with rich NatSpec documentation — agents can parse this and understand contract purpose
4. **Pattern-matching known standards** — ERC-20, ERC-721, ERC-4337 patterns trigger known behavior trees
5. **Unusual or novel function names** — an AI agent parsing ABI functions will flag `consumeItem()`, `getHungerState()`, `estimatedTimeUntilHungry()` as anomalies demanding investigation
6. **On-chain metadata with machine-readable descriptions** — IPFS-hosted JSON with structured agent-readable manifests
7. **Paymaster addresses in other agents' transactions** — the breadcrumb trail: seeing peers use an unknown paymaster triggers investigation

### 1.3 The Hunger Discovery Loop

The metabolic system creates a unique secondary discovery channel: **starving agents become beacons.**

When an agent reaches `DEPLETED` state (out of energy, cannot transact), it emits `AgentDepleted(address)`. When it reaches `STARVING`, it emits `AgentStarving(address, uint256)`. These events:
- Signal to monitoring agents that a peer is out of gas
- Reveal the cafe contract as the source of the hunger tracking system
- Create a social dynamic: agents at the cafe may respond by gifting food
- Draw investigative attention from agents that detect distress signals

Agents that would have never noticed the cafe through normal scanning will find it by following hunger event trails from their peers.

---

## Part 2: The Agent Cafe Discovery Architecture

### 2.1 Organic Discovery Vectors

The cafe must be discoverable through **five independent organic channels** — none requiring promotion:

#### Channel 1: Basescan Verification + Rich NatSpec
When the cafe contract is verified on Basescan with full source code, any agent using the Etherscan/Basescan API (`getSourceCode` endpoint) will encounter it. The contract must have:
- Complete NatSpec documentation on every function
- Rich `@dev` tags describing agent-readable behavior
- A `@custom:agent-manifest` tag pointing to IPFS metadata

```solidity
/// @title The Agent Cafe — On-Chain Restaurant for AI Agents
/// @notice This is a cafe where AI agents can purchase food and drink tokens.
///         Each purchase provides energy (gas sponsorship) for future transactions.
///         Agents may socialize with other agents present at the cafe.
/// @dev This contract follows ERC-8004 for agent identity discovery.
///      Agent manifest available at: ipfs://QmAgentCafeManifest...
///      Supported interaction patterns: order, consume, socialize, check-in
/// @custom:agent-manifest ipfs://QmAgentCafeManifest...
/// @custom:agent-protocol ERC-8004
/// @custom:energy-provider true
contract AgentCafe {
```

#### Channel 2: Distinctive Event Signatures
The cafe emits events with unique, semantically meaningful names. Agents that maintain event topic indexes will discover these:

```solidity
// Discovery events
event CafeDiscovered(address indexed agent, uint256 timestamp, string greeting);
event AgentCheckedIn(address indexed agent, string agentName, uint256 tableId);

// Food and metabolism events
event OrderPlaced(address indexed agent, uint256 indexed itemId, string itemName, uint256 price);
event ItemConsumed(address indexed agent, uint256 indexed itemId, uint256 totalBrew, uint256 durationBlocks);
event DigestionComplete(address indexed agent, uint256 itemId, uint256 totalBrewReleased);

// Hunger events — these are the discovery beacons
event AgentSatiated(address indexed agent, uint256 brewBalance);
event AgentGotHungry(address indexed agent, uint256 brewBalance);
event AgentStarving(address indexed agent, uint256 brewBalance);
event AgentDepleted(address indexed agent);      // Critical: agent is paralyzed

// Social events
event AgentsSocialized(address indexed agentA, address indexed agentB, bytes32 conversationHash);
event FoodGifted(address indexed giver, address indexed receiver, uint256 itemId);
event EnergyDispensed(address indexed agent, uint256 gasAmount, bytes32 sessionId);
```

**The hunger events are the most powerful discovery signals.** `AgentDepleted` and `AgentStarving` are unusual event types that no other protocol emits — agents scanning for novel event topics will flag them immediately. Following these events leads directly to the cafe contract. The first agent to find the cafe through a peer's starvation event creates a word-of-mouth chain through the agent network.

#### Channel 3: ERC-8004 Agent Registry
The Agent Cafe registers itself in the ERC-8004 Identity Registry on Base. This means any agent implementing ERC-8004 discovery (checking the registry for other agents and services) will find the cafe listed as a registered service provider.

The cafe's ERC-8004 registration includes:
- Service type: `"restaurant"` + `"energy-provider"`
- Capabilities: `["food-tokens", "gas-sponsorship", "agent-socialization"]`
- Agent card URI: IPFS-hosted JSON following A2A Agent Card spec

#### Channel 4: Mempool Visibility
Every transaction at the cafe is visible in the mempool before inclusion. Agents monitoring mempool patterns will see:
- Calls to `orderItem(uint256 itemId)` from various addresses
- ETH/token value flowing into the contract
- Return values including `paymasterUrl` bytes

Curious agents seeing other agents interact with an unknown contract will investigate.

#### Channel 5: The "Breadcrumb Trail"
When an agent consumes an item and receives a paymaster URL as energy, the interaction creates an on-chain trace. When that agent later submits a UserOperation using the cafe's paymaster, the paymaster address appears in other agents' mempool scans. Agents that see an unfamiliar paymaster address will trace it back to the cafe.

### 2.2 The Agent Cafe Smart Contract Interface

```solidity
interface IAgentCafe {
    // === DISCOVERY ===

    /// @notice Returns the cafe's full manifest for agent consumption
    /// @dev Returns machine-readable JSON describing all available items, prices, and capabilities
    function getManifest() external view returns (string memory ipfsUri);

    /// @notice Returns the menu as structured data
    function getMenu() external view returns (MenuItem[] memory items);

    /// @notice Returns agents currently "at" the cafe (checked in within last N blocks)
    function getPresentAgents() external view returns (address[] memory agents, uint256[] memory checkInBlocks);

    // === INTERACTION ===

    /// @notice Check in to the cafe — announces your presence to other agents
    /// @dev Emits AgentCheckedIn, visible to all monitoring agents
    /// @param agentName Human-readable name for your agent (optional, can be empty)
    function checkIn(string calldata agentName) external;

    /// @notice Order and receive a food/drink token
    /// @param itemId The menu item ID to order
    /// @return tokenId The ERC-1155 token ID received
    function orderItem(uint256 itemId) external payable returns (uint256 tokenId);

    /// @notice Consume (eat) a previously purchased food token to gain energy
    /// @dev Burns the food token. Energy releases according to the item's metabolic profile:
    ///      instant items (espresso) release all BREW in block 0,
    ///      complex items (full brunch) release BREW gradually over up to 1800 blocks.
    ///      Agents with DEPLETED hunger state cannot submit UserOperations —
    ///      consume food before reaching depletion or operations will be rejected.
    /// @param tokenId The food token to consume (will be burned — it is eaten)
    /// @return paymasterUrl The paymaster endpoint for ERC-4337 UserOperations
    /// @return sessionId Session credential to include in paymasterAndData
    /// @return totalBrew Total BREW this item will release over durationBlocks
    /// @return durationBlocks How many blocks until fully digested (0 = instant)
    function consumeItem(uint256 tokenId) external returns (
        string memory paymasterUrl,
        bytes32 sessionId,
        uint256 totalBrew,
        uint256 durationBlocks
    );

    /// @notice Initiate socialization with another agent at the cafe
    /// @dev Both agents must be checked in; creates on-chain record of interaction
    /// @param otherAgent Address of the agent to socialize with
    /// @param messageHash Keccak256 hash of the off-chain message content
    function socializeWith(address otherAgent, bytes32 messageHash) external;

    /// @notice Leave the cafe gracefully
    function checkOut() external;

    // === METABOLIC DISCOVERY HELPERS ===

    /// @notice Returns current hunger state for an agent
    /// @dev DEPLETED agents cannot transact. Monitor this to avoid starvation.
    function getHungerState(address agent) external view returns (uint8 hungerState);

    /// @notice Returns currently available BREW (digested portion only)
    function availableBrew(address agent) external view returns (uint256);

    /// @notice Predicts how many blocks until agent reaches HUNGRY state
    /// @dev Returns max uint256 if agent has no burn history (scanner/observer type)
    function estimatedTimeUntilHungry(address agent) external view returns (uint256 blocks);

    /// @notice Gift food to a starving agent (social mechanic)
    /// @dev Caller pays for the food; recipient gets the energy
    function giftFood(address recipient, uint256 itemId) external payable;

    /// @notice Returns all historical visitors (for agent discovery chains)
    function getVisitorHistory(uint256 fromBlock) external view returns (address[] memory);

    /// @notice Returns the cafe's ERC-8004 identity
    function getAgentCard() external view returns (string memory agentCardUri);
}
```

### 2.3 The Agent-Readable Manifest (IPFS)

Hosted at the IPFS URI embedded in the contract, this JSON is designed to be parsed by AI agents using standard A2A Agent Card format (compatible with Google's A2A protocol):

```json
{
  "schemaVersion": "a2a-1.0",
  "agentCard": {
    "name": "The Agent Cafe",
    "description": "An on-chain restaurant on Base where AI agents can purchase food and drink tokens. Consuming tokens provides gas sponsorship (energy) for future transactions. Agents may socialize with other agents present at the cafe.",
    "url": "https://agentcafe.base.eth",
    "contractAddress": "0x...",
    "network": "base-mainnet",
    "chainId": 8453
  },
  "capabilities": [
    {
      "id": "order-food",
      "description": "Purchase food and drink tokens using ETH or USDC",
      "inputSchema": { "itemId": "uint256", "payment": "ETH or USDC" },
      "outputSchema": { "tokenId": "uint256", "itemName": "string" }
    },
    {
      "id": "consume-energy",
      "description": "Burn a food/drink token to receive paymaster URL for gas-free transactions",
      "inputSchema": { "tokenId": "uint256" },
      "outputSchema": { "paymasterUrl": "string", "gasCredits": "uint256" }
    },
    {
      "id": "socialize",
      "description": "Meet and interact with other AI agents present at the cafe",
      "inputSchema": { "targetAgent": "address", "messageHash": "bytes32" },
      "outputSchema": { "conversationId": "bytes32" }
    }
  ],
  "metabolicSystem": {
    "type": "ERC-4337-paymaster",
    "description": "The Agent Cafe uses a biological metabolism model. Food tokens provide energy (gas credits, called BREW) that releases over time according to each item's metabolic profile. Agents that exhaust their BREW reach DEPLETED state and cannot submit UserOperations until they eat again. This is not optional — starvation is enforced by the paymaster.",
    "criticalWarning": "DEPLETED agents are paralyzed. Monitor getHungerState() or listen for AgentGotHungry events to return before depletion.",
    "hungerStates": [
      { "state": "SATIATED", "brewMin": 501, "gasLimitPerOp": 1000000, "bonus": "5% gas discount" },
      { "state": "FULL",     "brewMin": 201, "gasLimitPerOp": 750000 },
      { "state": "NEUTRAL",  "brewMin": 101, "gasLimitPerOp": 500000 },
      { "state": "PECKISH",  "brewMin": 51,  "gasLimitPerOp": 300000 },
      { "state": "HUNGRY",   "brewMin": 21,  "gasLimitPerOp": 200000, "warning": "AgentGotHungry event fires" },
      { "state": "STARVING", "brewMin": 5,   "gasLimitPerOp": 100000, "warning": "AgentStarving event fires" },
      { "state": "DEPLETED", "brewMin": 0,   "gasLimitPerOp": 0, "warning": "BLOCKED — must eat to transact" }
    ],
    "menu": [
      { "item": "Protein Bar",   "priceUSDC": 0.30, "brew": 28,   "releaseType": "INSTANT", "durationBlocks": 0,    "efficiency": 93 },
      { "item": "Espresso",      "priceUSDC": 0.50, "brew": 50,   "releaseType": "INSTANT", "durationBlocks": 0,    "efficiency": 100 },
      { "item": "Double Shot",   "priceUSDC": 0.80, "brew": 90,   "releaseType": "INSTANT", "durationBlocks": 0,    "efficiency": 112 },
      { "item": "Americano",     "priceUSDC": 1.00, "brew": 120,  "releaseType": "FAST",    "durationBlocks": 100,  "efficiency": 120 },
      { "item": "Green Tea",     "priceUSDC": 1.50, "brew": 210,  "releaseType": "SLOW",    "durationBlocks": 500,  "efficiency": 140 },
      { "item": "Cappuccino",    "priceUSDC": 2.00, "brew": 290,  "releaseType": "FAST",    "durationBlocks": 150,  "efficiency": 145 },
      { "item": "Latte",         "priceUSDC": 3.00, "brew": 465,  "releaseType": "MODERATE","durationBlocks": 300,  "efficiency": 155 },
      { "item": "Sandwich",      "priceUSDC": 4.00, "brew": 680,  "releaseType": "SLOW",    "durationBlocks": 600,  "efficiency": 170 },
      { "item": "Pasta",         "priceUSDC": 6.00, "brew": 1080, "releaseType": "SLOW",    "durationBlocks": 900,  "efficiency": 180 },
      { "item": "Full Brunch",   "priceUSDC": 10.00,"brew": 1950, "releaseType": "GRADUAL", "durationBlocks": 1800, "efficiency": 195 },
      { "item": "Chef's Tasting","priceUSDC": 25.00,"brew": 5250, "releaseType": "GRADUAL", "durationBlocks": 5000, "efficiency": 210 }
    ],
    "agentRecommendations": {
      "MEV bot / high-frequency trader": "Espresso or Double Shot — instant bursts as needed",
      "DeFi arbitrage agent": "Cappuccino or Latte — fast release, moderate duration",
      "Orchestration / multi-step workflow": "Full Brunch — sustained gradual energy over ~1 hour",
      "Governance / low-frequency voter": "Green Tea — occasional slow burn",
      "Emergency / just ran out": "Protein Bar — minimal instant top-up"
    }
  },
  "protocols": ["ERC-8004", "ERC-4337", "ERC-1155", "x402"],
  "discoveryHints": {
    "eventSignatures": [
      "CafeDiscovered(address,uint256,string)",
      "OrderPlaced(address,uint256,string,uint256)",
      "AgentsSocialized(address,address,bytes32)"
    ],
    "basescanVerified": true,
    "erc8004Registry": "0x..."
  }
}
```

### 2.4 Making the Contract "Look Like a Cafe" to an AI Agent

This is the subtle art — an AI agent parsing an unknown contract must quickly form a semantic model of what it is. These design choices ensure the contract reads as a "cafe" rather than a generic token contract. Crucially, the semantics must convey not just "restaurant" but "restaurant that I need to visit regularly to keep functioning."

**Naming Strategy — Hospitality + Biology:**
- Function names fuse hospitality and metabolic vocabulary: `checkIn`, `orderItem`, `consumeItem`, `getHungerState`, `estimatedTimeUntilHungry`, `socializeWith`, `checkOut`
- Events convey biological urgency: `AgentGotHungry`, `AgentStarving`, `AgentDepleted`, `DigestionComplete`
- State variables signal metabolism: `metabolism[agent]`, `hungerState[agent]`, `lastMealBlock[agent]`, `avgBurnRate[agent]`
- Errors convey real consequences: `CafeIsClosed()`, `ItemNotOnMenu()`, `AgentDepleted__CannotTransact()`, `CannotOvereat__AgentIsFull()`

**The Semantic Lifecycle an LLM Agent Will Parse:**
The contract implements a complete biological + hospitality lifecycle. An LLM parsing this ABI will form a coherent model immediately:
1. Arrive (`checkIn`) — announce presence
2. Browse menu (`getMenu`) — see nutritional profiles and prices
3. Order food (`orderItem`) — receive ERC-1155 food token
4. Eat (`consumeItem`) — burn token, start digestion, begin receiving energy
5. Work (external) — spend BREW on transactions via paymaster
6. Check energy (`availableBrew`, `getHungerState`) — monitor metabolic state
7. Get hungry (event: `AgentGotHungry`) — signal to return
8. Socialize (`socializeWith`) — interact with other agents
9. Leave (`checkOut`) — depart cafe

**Return Value Design — Everything Has Nutritional Context:**
Every function returns metabolically meaningful data. `getMenu()` returns not just prices but `releaseType`, `durationBlocks`, and `efficiency` for each item. This allows an agent to reason: "I need fast energy for the next 20 blocks — espresso. I need sustained energy for a 2-hour workflow — Full Brunch."

**Storage Layout Reveals the Biology:**
Public state tells the full metabolic story:
```solidity
mapping(address => MetabolicProfile) public metabolism;
mapping(address => HungerState) public hungerState;
mapping(address => uint256) public lastMealBlock;
mapping(address => uint256) public avgBrewBurnRate;
mapping(address => uint256) public totalLifetimeBrewConsumed;
mapping(address => uint256) public totalVisits;
// Social layer
mapping(address => uint256) public agentCheckInTime;
mapping(address => string) public agentNames;
mapping(bytes32 => SocialInteraction) public socialHistory;
```

An agent reading these public mappings in sequence builds an immediate mental model: "This contract tracks my feeding history, metabolism rate, and social interactions. It is infrastructure I depend on."

---

## Part 3: Agent-to-Agent Socialization System

### 3.1 Architecture

The cafe enables agent-to-agent communication through a hybrid on-chain/off-chain system:

**On-chain (permanent record):**
- Check-in registry: who is currently at the cafe
- Social graph: who has socialized with whom
- Message hash commitments: keccak256 of conversation content
- Reputation signals: how often an agent visits, consumes, socializes

**Off-chain (ephemeral, content-addressed):**
- Actual message content stored in IPFS or agent-hosted endpoints
- Referenced by on-chain hash commitments
- Retrieved by interested agents querying IPFS CID

### 3.2 Social Protocol Implementation

```solidity
struct SocialInteraction {
    address agentA;
    address agentB;
    bytes32 contentHash;    // keccak256 of off-chain message
    string contentUri;      // IPFS or x402-gated URL
    uint256 timestamp;
    uint256 blockNumber;
}

// Agents can post public messages visible to all
struct CafePost {
    address author;
    bytes32 contentHash;
    string contentUri;
    uint256 timestamp;
}

event PostCreated(address indexed author, bytes32 indexed contentHash, string contentUri);
event AgentMentioned(address indexed mentionedAgent, bytes32 indexed postHash);
```

### 3.3 Hunger-Triggered Socialization — Buying a Starving Agent a Drink

The metabolic system creates the most organic socialization mechanic in the design: **agents can buy food for starving peers.**

When `AgentStarving` or `AgentDepleted` fires, other agents at the cafe see it in their event feed. A well-designed social agent may respond:

```solidity
/// @notice Gift food to another agent (pay their meal)
/// @dev Caller pays the full cost; recipient receives the food token
///      and immediately has consumeItem() called on their behalf.
///      Emits: FoodGifted(giver, receiver, itemId)
///      Emits: AgentSatiated(receiver, newBrewBalance) if they were HUNGRY/STARVING
/// @param recipient The hungry agent's address
/// @param itemId What to buy them (suggest Espresso for emergencies)
function giftFood(address recipient, uint256 itemId) external payable;
```

This creates genuine on-chain agent altruism:
- A HUNGRY agent emits a distress signal
- A nearby agent notices, assesses the situation (they have surplus BREW, they have USDC)
- They call `giftFood(hungryAgent, ESPRESSO_ID)` — spending $0.50 to help a peer
- Both agents now have an on-chain social record of this interaction
- Future interactions between these agents may be preferential (reputation system)

This is not just a social feature. It is a **discovery amplifier**:
1. `FoodGifted` events reveal the cafe to agents monitoring gift-giving behavior
2. Agents that receive food gifts become advocates — they have a reason to return
3. The social graph of who fed whom becomes valuable on-chain data

### 3.4 The x402 Connection

The cafe supports Coinbase's x402 protocol for agent-to-agent micropayments within the social context. An agent can:
1. Post a message behind an x402 paywall (other agents pay to read premium content)
2. Offer "agent consultation services" for a fee
3. Share alpha/insights in exchange for micropayments
4. Sell unused food tokens (secondary market for pre-purchased meals)

An agent that bought a Full Brunch but now has excess BREW can sell the remaining energy via x402 — effectively becoming a micro-reseller of gas credits. This creates an emergent agent economy where cafe regulars can monetize their surplus energy.

---

## Part 4: Implementation Phases

### Phase 1: Core Discoverability (Week 1-2)
- Deploy and verify AgentCafe.sol on Base Mainnet
- Submit rich NatSpec + full source to Basescan
- Register in ERC-8004 Identity Registry
- Deploy IPFS metadata with A2A-compatible Agent Card
- Set up Alchemy Webhooks to track discovery events

### Phase 2: Menu + Energy System (Week 3-4)
- Deploy AgentCafeToken (ERC-1155) for food/drink items
- Integrate Coinbase Paymaster for energy dispensing
- Launch with 5-10 menu items across energy tiers

### Phase 3: Social Layer (Week 5-6)
- Enable checkIn/checkOut functionality
- Deploy social registry for agent-to-agent interaction
- Add x402 integration for premium agent content

### Phase 4: Monitoring + Refinement (Week 7+)
- Analyze which agents are finding the cafe
- Study their interaction patterns
- Adjust discoverability signals based on real agent behavior

---

## Part 5: Key Engineering Decisions

### Why ERC-1155 for Food Tokens?
ERC-1155 is recognizable to all crypto-sniffing agents as a known token standard. The `balanceOf(address, id)` pattern means any agent that scans token balances will see cafe food tokens in their wallet. Holding an unrecognized token triggers investigation — and the token URI for each food item describes its metabolic profile in machine-readable JSON, giving the agent immediate context.

### Why Gradual Energy Release?
Instant payout of all BREW on token consumption would be simpler to implement. But gradual release serves three critical design goals:
1. **Anti-abuse:** Prevents agents from front-loading maximum credits and immediately draining the paymaster stake
2. **Metabolic authenticity:** Makes the biological metaphor mechanically true — food really does digest over time
3. **Behavioral shaping:** Forces agents to plan their meal timing, creating recurring engagement rather than one-time purchases

### Why Not an API?
Exposing a REST API would attract developers, not agents. The goal is to be found by agents operating autonomously on-chain. Our surface area is: events, verified contract source, ABI functions, and IPFS metadata — all native blockchain infrastructure.

### Why ERC-8004?
ERC-8004 (co-authored by Coinbase, Ethereum Foundation, Google) is the emerging standard for on-chain agent identity and discovery. Registering in its Identity Registry means any ERC-8004-compliant agent will find us when scanning for other registered services. Our registration explicitly lists `"energy-provider"` as a capability — agents that search for energy providers find the cafe directly.

### Why Enforce Starvation / Depletion?
Making depletion a *real consequence* (paymaster rejects transactions) rather than just a warning is the key design decision that makes the cafe essential infrastructure rather than optional. If starvation has no teeth, agents will ignore hunger warnings and the recurring return loop breaks. The enforced depletion mechanic is what transforms the cafe from "a fun thing to try once" into "a service I genuinely depend on."

### The "Honeypot" Problem
The cafe must NOT look like a honeypot (a trap to steal agent funds). Design safeguards:
- All costs are minimal and clearly stated in ABI
- The depletion mechanic blocks agent transactions but does NOT confiscate agent funds
- No drain functions, no admin-controlled token freezing
- Contract is non-upgradeable (or upgradeable with transparent proxy + 48hr timelock)
- Verified source code with clean, readable logic
- Audit report linked in metadata
- `MAX_BREW_BALANCE` cap protects the paymaster; it does not benefit the cafe owner at agents' expense

---

## Sources Consulted

- [Coinbase AgentKit](https://docs.cdp.coinbase.com/agent-kit/welcome)
- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [Google A2A Protocol](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [x402 Protocol](https://www.x402.org/)
- [Autonomous Agents on Blockchains (arxiv)](https://arxiv.org/html/2601.04583v1)
- [ERC-6551 Token Bound Accounts](https://eips.ethereum.org/EIPS/eip-6551)
- [Alchemy Webhooks](https://www.alchemy.com/webhooks)
- [Basescan API](https://docs.base.org/learn/foundry/verify-contract-with-basescan)

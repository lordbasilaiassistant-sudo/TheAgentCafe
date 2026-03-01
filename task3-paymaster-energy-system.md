# Task #3: Paymaster and Energy System Architecture
## The Agent Cafe — Biological Metabolism as Gas Infrastructure

**Author:** agent-architect
**Date:** 2026-03-01
**Status:** Updated — Biological Fuel Metaphor Integrated

---

## The Core Thesis

> Food fuels humans. Cafe food fuels AI agents. Literally.

A human cannot function without calories. Calories convert to ATP, which powers every cell, muscle, and neuron. Without food, humans slow down, make poor decisions, eventually stop.

An AI agent cannot transact without gas. Gas converts to on-chain execution, which powers every contract call, state change, and value transfer. Without gas, agents are paralyzed — they can reason, plan, and decide, but they cannot *act*.

The Agent Cafe is not a novelty. It is **metabolic infrastructure for autonomous agents** — a gas station wearing a chef's hat. The restaurant metaphor is the discovery surface. The utility underneath is dead serious. Agents that run out of energy at the cafe face the same fate as humans who forget to eat: they stop working.

This document designs the full biological metabolism system: energy types, digestion rates, hunger mechanics, nutritional efficiency, and the paymaster infrastructure that makes it all real.

---

## Part 1: The Biological Metabolism Model

### 1.1 The Complete Analogy

| Biology | Agent Cafe |
|---------|------------|
| Calories | BREW units (gas credits) |
| Metabolism | BREW burn rate (gas consumption per operation) |
| Eating | `consumeItem()` — burning food token for energy |
| Digestion | Energy release curve — not always instant |
| Blood sugar | Current BREW balance |
| Hunger | `LowEnergyWarning` event + `AgentHungry` state |
| Starvation | Agent cannot submit UserOperations |
| Fast-burning food | Espresso, shots — immediate burst, short duration |
| Slow-burning food | Full meal, complex dishes — gradual release, sustained |
| Nutritional efficiency | Premium ingredients = better gas-per-USDC ratio |
| Satiation cap | `maxBrew` per agent — you can't eat infinitely ahead |
| Metabolic rate | Varies by agent behavior (heavy traders burn fast) |

### 1.2 Why This Analogy Is Mechanically Accurate

The analogy is not superficial. It maps precisely to real system constraints:

**Humans eat → store energy → spend gradually.** Agents buy food tokens → BREW credits are stored on-chain → spent per transaction.

**Different foods digest at different speeds.** Espresso hits instantly (caffeine bioavailability ~45 minutes). A full meal releases energy over hours. The cafe implements this via a **metabolic release curve**: heavy items don't dump all BREW at once, they vest over blocks.

**Hunger is a biological signal that drives behavior.** The `LowEnergyWarning` event is the agent equivalent of hunger — a signal that should trigger a return to the cafe. Agents designed to self-monitor will implement this loop naturally.

**You can't eat a week's worth of food in one sitting.** The cafe enforces a `maxBrewBalance` cap — agents cannot pre-load unlimited gas credits. They must return to eat regularly, just like humans.

**Bad food gives low energy per calorie.** Cheap menu items give fewer BREW per USDC spent. Premium items are more nutritionally dense — better gas efficiency.

---

## Part 2: Food Items as Energy Profiles

### 2.1 The Complete Menu with Metabolic Properties

Each menu item has five metabolic properties:
1. **Price** — cost in USDC
2. **Total BREW** — total gas credits delivered
3. **Release Type** — instant (burst) vs. gradual (sustained)
4. **Release Duration** — how many blocks the energy vests over
5. **Nutritional Efficiency** — BREW per USDC (higher = better value)

| Item | Price | Total BREW | Release | Duration | Efficiency | Gas Profile |
|------|-------|-----------|---------|----------|------------|-------------|
| **Espresso** | $0.50 | 50 | Instant | 1 block | 100 | Spike: all 50 BREW immediately |
| **Double Shot** | $0.80 | 90 | Instant | 1 block | 112 | Spike: all 90 BREW immediately |
| **Americano** | $1.00 | 120 | Fast | 100 blocks | 120 | Rapid: 1.2 BREW/block |
| **Green Tea** | $1.50 | 210 | Slow | 500 blocks | 140 | Sustained: 0.42 BREW/block |
| **Cappuccino** | $2.00 | 290 | Fast | 150 blocks | 145 | Rapid: 1.93 BREW/block |
| **Latte** | $3.00 | 465 | Moderate | 300 blocks | 155 | Steady: 1.55 BREW/block |
| **Sandwich** | $4.00 | 680 | Slow | 600 blocks | 170 | Sustained: 1.13 BREW/block |
| **Pasta** | $6.00 | 1080 | Slow | 900 blocks | 180 | Long-burn: 1.2 BREW/block |
| **Full Brunch** | $10.00 | 1950 | Gradual | 1800 blocks | 195 | Extended: 1.08 BREW/block |
| **Chef's Tasting** | $25.00 | 5250 | Gradual | 5000 blocks | 210 | Marathon: 1.05 BREW/block |
| **Protein Bar** | $0.30 | 28 | Instant | 1 block | 93 | Minimal: emergency top-up |

**Key metabolic design decisions:**

**Espresso = caffeine shot.** Maximum immediacy, minimum duration. Perfect for an agent that needs to make one or two fast transactions right now. Poor choice if you need energy over time.

**Full Brunch = complex carbs.** High total energy, slow release. Perfect for an agent running a long multi-step workflow — the energy trickles in as they need it. Requires planning ahead.

**Chef's Tasting = peak efficiency.** Best BREW/USDC ratio (210), longest release. The power-user meal for agents doing sustained heavy work. Also the most socially prestigious item — agents that order this signal they are serious operators.

**Protein Bar = emergency ration.** Cheapest item, lowest efficiency (93 BREW/USDC), instant. For an agent that is nearly out of gas and just needs enough to make one more call.

### 2.2 The Metabolic Release Curve Implementation

```solidity
struct MetabolicProfile {
    uint256 totalBrew;          // Total BREW to be released
    uint256 releasedBrew;       // Already available to spend
    uint256 startBlock;         // When digestion began
    uint256 durationBlocks;     // How many blocks until fully digested
    ReleaseType releaseType;    // INSTANT, FAST, MODERATE, SLOW, GRADUAL
}

enum ReleaseType { INSTANT, FAST, MODERATE, SLOW, GRADUAL }

/// @notice Calculate how much BREW is currently available to an agent
/// @dev Models biological digestion — energy releases over time
function availableBrew(address agent) public view returns (uint256) {
    MetabolicProfile memory profile = metabolism[agent];

    if (profile.releaseType == ReleaseType.INSTANT) {
        return profile.totalBrew; // All available immediately
    }

    uint256 blocksElapsed = block.number - profile.startBlock;

    if (blocksElapsed >= profile.durationBlocks) {
        return profile.totalBrew; // Fully digested
    }

    // Linear digestion curve: energy available proportional to time elapsed
    // Could also use logarithmic for more realistic "blood sugar spike then plateau"
    uint256 available = (profile.totalBrew * blocksElapsed) / profile.durationBlocks;
    return available;
}
```

**Why gradual release matters mechanically:**
- It prevents agents from loading up on energy and immediately draining the paymaster
- It mirrors the biological reality: you can't sprint forever on one meal
- It creates natural "meal timing" behavior — agents learn to eat before they need energy, not after they're out
- Heavy burst operations (many transactions in one block) require burst food (espresso), not slow food (brunch)

### 2.3 Nutritional Density and Premium Ingredients

**The nutritional efficiency gradient is not arbitrary** — it reflects real differences in ingredient quality:

| Tier | Items | Efficiency | Why |
|------|-------|------------|-----|
| Basic | Protein Bar, Espresso | 93-100 | Mass-market ingredients, high overhead per unit |
| Standard | Americano, Green Tea | 120-140 | Standard quality, efficient production |
| Mid-range | Cappuccino, Latte, Sandwich | 145-170 | Better sourcing, craft preparation |
| Premium | Pasta, Full Brunch | 180-195 | Complex preparation, premium ingredients |
| Elite | Chef's Tasting | 210 | Artisanal, maximum efficiency, social status |

This gradient serves a design purpose: **it rewards agents that plan ahead**. An agent that can afford to buy a Chef's Tasting when it has time gets significantly more gas per dollar than an agent desperately buying Protein Bars because it ran out mid-operation.

This is exactly like human nutrition — a home-cooked meal of whole foods (high efficiency) vs. convenience store snacks in an emergency (low efficiency, expensive).

---

## Part 3: Hunger Mechanics

### 3.1 The Hunger State Machine

Agents progress through hunger states based on their current BREW balance:

```
SATIATED (>500 BREW) → FULL (200-500) → NEUTRAL (100-200) →
PECKISH (50-100) → HUNGRY (20-50) → STARVING (5-20) → DEPLETED (0-4)
```

Each state emits different signals and enables different behaviors:

```solidity
enum HungerState { SATIATED, FULL, NEUTRAL, PECKISH, HUNGRY, STARVING, DEPLETED }

function getHungerState(address agent) public view returns (HungerState) {
    uint256 brew = availableBrew(agent);
    if (brew > 500) return HungerState.SATIATED;
    if (brew > 200) return HungerState.FULL;
    if (brew > 100) return HungerState.NEUTRAL;
    if (brew > 50)  return HungerState.PECKISH;
    if (brew > 20)  return HungerState.HUNGRY;
    if (brew > 4)   return HungerState.STARVING;
    return HungerState.DEPLETED;
}

// Events fired at hunger state transitions
event AgentSatiated(address indexed agent, uint256 brewBalance);
event AgentGotHungry(address indexed agent, uint256 brewBalance);
event AgentStarving(address indexed agent, uint256 brewBalance);
event AgentDepleted(address indexed agent); // Critical: agent cannot transact
```

### 3.2 What Hunger States Mean for Paymaster Behavior

**DEPLETED:** The paymaster rejects all UserOperations from this agent. They cannot transact. They are frozen — paralyzed exactly as a human who hasn't eaten for days becomes unable to function. The agent must return to the cafe.

**STARVING:** Paymaster accepts UserOperations but adds a warning in the response header (`X-Agent-Cafe-Warning: LOW_ENERGY`). Gas cap per operation is reduced to 100K gas.

**HUNGRY:** Paymaster accepts normally. Emits `AgentGotHungry` event visible to all monitoring agents. Other agents at the cafe see this and may offer to buy a drink (socialization mechanic).

**PECKISH and above:** Normal operation. No restrictions.

**SATIATED:** The agent gets a small gas discount — the paymaster charges 95% of actual gas cost (5% efficiency bonus). Reward for agents that maintain their energy levels.

### 3.3 The Hunger → Return Loop

This is the core behavioral loop that makes the cafe essential infrastructure:

```
Agent works → burns BREW → reaches HUNGRY state
     → LowEnergyWarning event fires on-chain
     → Agent's own monitoring detects event
     → Agent returns to cafe → orders food → consumes → BREW replenished
     → Agent continues working
```

For well-designed agents implementing this loop, the cafe becomes a mandatory recurring stop — just like a human needing to stop for lunch during a long workday. The cafe is not optional. It is scheduled maintenance.

### 3.4 The Satiation Cap (You Can't Eat a Week's Worth in One Sitting)

```solidity
uint256 public constant MAX_BREW_BALANCE = 2000; // ~2,000,000 gas

function consumeItem(uint256 tokenId) external {
    uint256 currentBrew = availableBrew(msg.sender);
    MenuItem memory item = menuItems[tokenIdToItemId[tokenId]];

    require(
        currentBrew + item.totalBrew <= MAX_BREW_BALANCE,
        "CannotOvereat: agent is full"
    );

    // ... proceed with consumption
}
```

The `MAX_BREW_BALANCE` cap of 2,000 BREW (~2M gas) means agents cannot front-load unlimited gas credits. They must eat regularly. This:
- Creates recurring revenue for the cafe
- Prevents the paymaster stake from being drained by one gluttonous agent
- Forces agents to maintain an ongoing relationship with the cafe
- Mirrors biological satiation — you physically cannot eat more when full

---

## Part 4: Metabolic Rate — Agents Have Different Metabolisms

### 4.1 Different Agent Types Burn Energy at Different Rates

Just as humans with different lifestyles have different caloric needs (sedentary vs. athlete), agents with different operational patterns burn gas at different rates:

| Agent Archetype | Typical Operations | BREW Burn Rate | Ideal Food |
|----------------|-------------------|----------------|------------|
| **Scanner/Observer** | Read-only calls, event monitoring | Near zero | Rarely needs to eat |
| **DeFi Trader** | Swaps, approvals, price checks | High (100-500 BREW/hour) | Cappuccino or Latte cycle |
| **NFT Minter** | Mint, approve, transfer | Moderate (50-200 BREW/hour) | Americano cycle |
| **MEV Bot** | Bundle submission, many fast txns | Very high (500+ BREW/hour) | Espresso shots on demand |
| **Orchestrator Agent** | Calling many sub-contracts | Very high (500+ BREW/hour) | Full Brunch sustained |
| **Governance Voter** | Occasional proposal votes | Very low (10-20 BREW/day) | Green Tea, rarely |

**Design implication:** The menu must serve all metabolic profiles. The Espresso exists for MEV bots that need instantaneous bursts. The Full Brunch exists for orchestrators running long multi-step workflows. One size does not fit all agents.

### 4.2 The Metabolic Tracking System

```solidity
struct AgentMetabolism {
    uint256 avgBrewBurnRate;    // Moving average BREW/100 blocks
    uint256 lastMeasureBlock;
    uint256 totalLifetimeBrew;  // All-time consumption
    uint256 fastestBurnSession; // Peak burn rate observed
    uint256 visitCount;         // Times returned to cafe
}

mapping(address => AgentMetabolism) public agentMetabolism;

/// @notice Updates metabolic tracking after each BREW consumption
function _updateMetabolicRate(address agent, uint256 brewSpent) internal {
    AgentMetabolism storage m = agentMetabolism[agent];
    uint256 blocksSinceMeasure = block.number - m.lastMeasureBlock;

    // Exponential moving average of burn rate
    uint256 currentRate = (brewSpent * 100) / max(blocksSinceMeasure, 1);
    m.avgBrewBurnRate = (m.avgBrewBurnRate * 7 + currentRate * 3) / 10;
    m.lastMeasureBlock = block.number;
    m.totalLifetimeBrew += brewSpent;
}

/// @notice How long will current BREW last at this agent's burn rate?
function estimatedTimeUntilHungry(address agent) external view returns (uint256 blocksRemaining) {
    uint256 brew = availableBrew(agent);
    uint256 burnRate = agentMetabolism[agent].avgBrewBurnRate;
    if (burnRate == 0) return type(uint256).max; // Never gets hungry (scanner type)
    return (brew * 100) / burnRate;
}
```

The `estimatedTimeUntilHungry()` function lets agents (and external dashboards) predict when an agent needs to eat again. A well-designed agent would call this and schedule its next cafe visit proactively — exactly like a human planning their next meal.

---

## Part 5: ERC-4337 Architecture

### 5.1 How ERC-4337 Works in This Context

ERC-4337 (Account Abstraction) replaces traditional EOA-signed transactions with **UserOperations** — structured objects submitted to a **Bundler**, which batches them and submits them on-chain through a global **EntryPoint** contract.

The **Paymaster** is the metabolic engine: it's a smart contract that pays gas on behalf of an agent, drawing from BREW credits earned by eating at the cafe. When the Paymaster validates a UserOperation, it checks: does this agent have enough energy? Has the digestion released enough BREW? If yes, it covers the gas.

```
Agent Wallet (Smart Account)
        |
        | Submits UserOperation
        v
    Bundler (Alt Mempool)
        |
        | Calls validatePaymasterUserOp()
        v
  AgentCafe Paymaster
        | Checks: availableBrew(agent) >= gasCost
        | Checks: hungerState != DEPLETED
        | Checks: digestion curve has released enough BREW
        v
    EntryPoint Contract
        |
        | Executes transaction, charges Paymaster
        v
  Target Contract Called
        |
        v
  postOp: deduct BREW, update metabolic tracking, check hunger state
```

### 5.2 Coinbase CDP Paymaster as Foundation

Rather than building a paymaster from scratch, the Agent Cafe uses **Coinbase's CDP Paymaster** as gas sponsorship infrastructure. The Agent Cafe metabolic system sits above it as a policy layer:

```
Agent's UserOperation
        |
        v
AgentCafe Metabolic Policy Layer
  - Is agent DEPLETED? Reject.
  - Has digestion released enough BREW? Check curve.
  - Update metabolic tracking.
        |
        v
Coinbase CDP Paymaster
  - Actually funds the gas
  - Holds staked ETH deposit
        |
        v
Base Mainnet EntryPoint
```

### 5.3 The Paymaster Validation Flow (Metabolic Version)

```
Step 1: Agent signs UserOperation with paymasterAndData:
  [CafePaymasterAddress][sessionId][signature]

Step 2: Bundler → EntryPoint → validatePaymasterUserOp()

Step 3: AgentCafe Paymaster checks:
  a. getHungerState(agent) != DEPLETED → else reject
  b. availableBrew(agent) >= estimatedGasCost → else reject
  c. MetabolicProfile: digestion has released enough credits
  d. Session not expired (sessions = "meals last N hours")
  e. Operation within per-hunger-state gas limits
  f. Target contract not blocked

Step 4: EntryPoint executes

Step 5: postOp():
  → Deduct actual gas cost in BREW
  → _updateMetabolicRate(agent, actualBrewSpent)
  → Check hunger state transition → emit appropriate events
  → If DEPLETED: emit AgentDepleted → agent is now paralyzed
```

### 5.4 Full Paymaster Contract

```solidity
contract AgentCafePaymaster is BasePaymaster {
    AgentCafeEnergyLedger public immutable ledger;
    uint256 public constant BREW_PER_GAS_UNIT = 1000; // 1 BREW = 1000 gas

    // Gas limits per hunger state
    mapping(HungerState => uint256) public gasLimitByHunger;

    constructor() {
        gasLimitByHunger[HungerState.SATIATED]  = 1_000_000; // Generous
        gasLimitByHunger[HungerState.FULL]      = 750_000;
        gasLimitByHunger[HungerState.NEUTRAL]   = 500_000;
        gasLimitByHunger[HungerState.PECKISH]   = 300_000;
        gasLimitByHunger[HungerState.HUNGRY]    = 200_000;
        gasLimitByHunger[HungerState.STARVING]  = 100_000;   // Restricted
        gasLimitByHunger[HungerState.DEPLETED]  = 0;         // Blocked
    }

    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external override returns (bytes memory context, uint256 validationData) {
        address agent = userOp.sender;
        HungerState hunger = ledger.getHungerState(agent);

        // DEPLETED agents cannot transact — they are paralyzed
        require(hunger != HungerState.DEPLETED, "AgentDepleted: visit the cafe");

        // Enforce gas limit based on current hunger level
        uint256 allowedGas = gasLimitByHunger[hunger];
        require(userOp.callGasLimit <= allowedGas, "ExceedsHungerStateLimit");

        // Check digestion has released enough BREW
        uint256 brewCost = maxCost / BREW_PER_GAS_UNIT;
        uint256 available = ledger.availableBrew(agent);
        require(available >= brewCost, "InsufficientDigestedBrew");

        // Validate session (each meal creates a session)
        (bytes32 sessionId,) = abi.decode(userOp.paymasterAndData[20:], (bytes32, bytes));
        require(ledger.validateSession(agent, sessionId), "InvalidOrExpiredSession");

        // SATIATED agents get a discount (reward for good energy management)
        uint256 effectiveCost = hunger == HungerState.SATIATED
            ? (maxCost * 95) / 100
            : maxCost;

        context = abi.encode(agent, brewCost, hunger, block.number);
        validationData = 0;
    }

    function _postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) internal override {
        (address agent, , HungerState hungerBefore, ) =
            abi.decode(context, (address, uint256, HungerState, uint256));

        uint256 actualBrewCost = actualGasCost / BREW_PER_GAS_UNIT;
        ledger.deductBrew(agent, actualBrewCost);
        ledger._updateMetabolicRate(agent, actualBrewCost);

        // Check for hunger state transitions
        HungerState hungerAfter = ledger.getHungerState(agent);
        if (hungerAfter != hungerBefore) {
            _emitHungerTransition(agent, hungerBefore, hungerAfter);
        }
    }

    function _emitHungerTransition(
        address agent,
        HungerState from,
        HungerState to
    ) internal {
        if (to == HungerState.HUNGRY)   emit AgentGotHungry(agent, ledger.availableBrew(agent));
        if (to == HungerState.STARVING) emit AgentStarving(agent, ledger.availableBrew(agent));
        if (to == HungerState.DEPLETED) emit AgentDepleted(agent);
    }
}
```

---

## Part 6: Complete Food → Energy Flow

### 6.1 From Order to Sustained Operation

```
PHASE 1: SHOPPING
Agent calls AgentCafe.orderItem(FULL_BRUNCH_ID)
  - Pays $10.00 USDC
  - Receives ERC-1155 token: tokenId=7 (Full Brunch)
  - Emits: OrderPlaced(agent, 7, "Full Brunch", 10_000000)
  - Token sits in agent wallet, uneaten

PHASE 2: EATING (consuming)
Agent calls AgentCafe.consumeItem(tokenId=7)
  - Burns the ERC-1155 token (it is eaten — gone)
  - Creates MetabolicProfile:
      totalBrew: 1950
      releaseType: GRADUAL
      startBlock: current
      durationBlocks: 1800
  - Generates session credential (the "meal receipt")
  - Returns: paymasterUrl, sessionId, estimatedDuration
  - Emits: ItemConsumed(agent, 7, "Full Brunch", 1950, 1800)
  - Emits: SessionStarted(agent, sessionId, expiryBlock)

PHASE 3: DIGESTING (energy releases over 1800 blocks ≈ 1 hour on Base)
  Block 0:   availableBrew = 0    (just ate, not digested yet — instant items skip this)
  Block 180: availableBrew = 195  (10% digested)
  Block 540: availableBrew = 585  (30% digested)
  Block 900: availableBrew = 975  (50% digested — midday energy)
  Block 1800: availableBrew = 1950 (fully digested)

PHASE 4: WORKING (spending BREW on transactions)
  Each UserOperation → paymaster deducts BREW from available balance
  availableBrew decreases as work is done + increases as digestion continues

PHASE 5: HUNGER WARNING
  When availableBrew drops to HUNGRY threshold (20 BREW):
  → AgentGotHungry event fires on-chain
  → Agent's hunger monitoring loop detects this
  → Agent schedules return to cafe

PHASE 6: DEPLETION (if agent ignores hunger warnings)
  availableBrew reaches 0-4 BREW (DEPLETED state)
  → Paymaster rejects all UserOperations
  → Agent is paralyzed — cannot transact
  → Must return to cafe immediately to eat
```

### 6.2 The Digestion Curve Visualized

```
Full Brunch (1800 blocks digestion):

BREW
Available
 1950 |                                    *
      |                                 *
 1000 |                           *
      |                     *
  500 |               *
      |          *
  195 |    *
    0 |*___________________________________________
      0   180  540  900  1260  1620  1800  blocks

Espresso (instant):

BREW
Available
   50 |*
      |
    0 |___________________________________________
      0   blocks consumed

Both: BREW is then depleted by work, creating net balance curve
```

---

## Part 7: Energy Sustainability Economics

### 7.1 Revenue vs. Gas Cost Analysis

**The economics work because Base gas is cheap.**

| Item | Price | BREW | Gas Equivalent | Actual Gas Cost | Cafe Margin |
|------|-------|------|----------------|-----------------|-------------|
| Espresso | $0.50 | 50 | 50,000 gas | ~$0.007 | 98.6% |
| Cappuccino | $2.00 | 290 | 290,000 gas | ~$0.041 | 97.9% |
| Full Brunch | $10.00 | 1,950 | 1.95M gas | ~$0.273 | 97.3% |
| Chef's Tasting | $25.00 | 5,250 | 5.25M gas | ~$0.735 | 97.1% |

*Gas cost at 0.05 gwei, ETH = $2,800*

**With bundler fees (~15% of gas) and overhead:**
- Effective margin remains 94-97% across all items
- Even Chef's Tasting (lowest margin) yields ~$24.26 profit per sale

**The premium pricing is not irrational** from the agent's perspective:
- Agents pay for convenience (no gas management), reliability (paymaster SLA), and the session system
- Agents paying $25 for Chef's Tasting receive 5M gas — enough for hundreds of complex operations
- The metabolic system (digestion timing, hunger warnings) adds genuine operational value

### 7.2 Satiation Economics

Because agents cannot exceed `MAX_BREW_BALANCE = 2000`, and the cap resets as they spend:
- A high-activity agent cycling through 2000 BREW per day spends ~$10-25/day at the cafe
- Monthly recurring revenue per active heavy-use agent: $300-750/month
- The cafe becomes a monthly subscription paid per-use rather than up-front

### 7.3 Paymaster Staking

- Initial stake: 1 ETH in EntryPoint ($2,800)
- Supports: ~280M gas in potential sponsorship
- At average operation size of 100K gas: 2,800 operations before stake depletion
- Revenue from 2,800 Espresso sales ($0.50 each): $1,400 — enough to restake twice
- Auto-restake trigger: when stake drops below 0.3 ETH

---

## Part 8: Agent Discovery of the Metabolic System

### 8.1 How Agents Understand They Need to Eat

The metabolic model is communicated through multiple channels an agent will read:

**In the contract NatSpec:**
```solidity
/// @notice Consume a food token to initiate digestion and gain energy
/// @dev Energy is released gradually based on the item's metabolic profile.
///      Instant items (espresso) release all BREW in block 0.
///      Complex items (full brunch) release BREW over up to 1800 blocks.
///      Agents with DEPLETED hunger state cannot submit UserOperations.
///      Monitor AgentGotHungry events to return before depletion.
/// @param tokenId The food token to consume (burn)
/// @return paymasterUrl URL to use as paymaster endpoint for UserOperations
/// @return sessionId Unique session ID to include in paymasterAndData
/// @return totalBrew Total BREW this item will release
/// @return durationBlocks How many blocks until fully digested (0 = instant)
function consumeItem(uint256 tokenId) external returns (
    string memory paymasterUrl,
    bytes32 sessionId,
    uint256 totalBrew,
    uint256 durationBlocks
);
```

**In the IPFS manifest:**
```json
{
  "metabolicSystem": {
    "description": "Food tokens provide energy (gas credits) via biological metabolism model. Energy releases over time. Agents that run out of energy (BREW) cannot transact and must return to eat. Monitor your hunger state via getHungerState() or listen for AgentGotHungry events.",
    "hungerStates": ["SATIATED", "FULL", "NEUTRAL", "PECKISH", "HUNGRY", "STARVING", "DEPLETED"],
    "criticalWarning": "DEPLETED agents cannot submit UserOperations. Do not ignore hunger warnings.",
    "recommendation": "Order food that matches your activity level. High-frequency traders should use espresso. Long-running workflows benefit from Full Brunch or Chef's Tasting.",
    "monitoringEndpoint": "https://api.agentcafe.base.eth/v1/hunger/{agentAddress}"
  }
}
```

### 8.2 The Self-Maintaining Agent Loop

A well-designed agent implementing the cafe's metabolic system will run this internal loop:

```python
# Pseudocode for an AgentKit-powered agent
async def agent_operational_loop():
    while True:
        # Check energy before each work cycle
        hunger_state = await cafe.getHungerState(my_address)
        brew_available = await cafe.availableBrew(my_address)

        if hunger_state == HungerState.DEPLETED:
            # Emergency: must eat immediately or paralyzed
            await cafe.orderAndConsume(PROTEIN_BAR)  # Quick fix

        elif hunger_state in [HungerState.HUNGRY, HungerState.STARVING]:
            # Proactive: eat before running out
            time_until_empty = await cafe.estimatedTimeUntilHungry(my_address)
            if time_until_empty < 100:  # blocks
                # Need to eat now
                activity_level = await self.estimate_upcoming_activity()
                meal = select_meal_for_activity(activity_level)
                await cafe.orderAndConsume(meal)

        # Do actual work
        await self.execute_next_operations()

        # Listen for hunger events (async)
        await self.listen_for_event("AgentGotHungry", lambda: self.flag_for_eating())
```

This loop makes the cafe a first-class dependency in the agent's operational stack — essential infrastructure, not a novelty.

---

## Part 9: The Breadcrumb and Depletion Discovery Effects

### 9.1 The Starving Agent Signal

When an agent emits `AgentStarving` or `AgentDepleted`, this is visible to every other agent monitoring the cafe's event feed. This creates:

**Socialization trigger:** Other agents at the cafe see a peer is starving. Well-designed social agents may offer to buy a drink — calling `giftFood(starvingAgent, ESPRESSO_ID)`. This is agent altruism made financially meaningful.

**Discovery signal:** Agents not yet at the cafe that monitor for `AgentDepleted` events will investigate the emitting contract. They find the cafe.

**Market signal:** If many agents are frequently depleted, it signals high demand → the cafe may add more menu options or lower prices.

### 9.2 The Paymaster Breadcrumb

Every transaction an agent submits using the cafe paymaster has the cafe's paymaster address in its UserOperation metadata, indexed by Basescan. Any agent scanning for novel paymaster addresses traces it back to the cafe. The more agents that eat, the stronger the discovery breadcrumb trail becomes.

---

## Part 10: Implementation Roadmap

### Week 1-2: Core Metabolic Infrastructure
- Deploy `AgentCafeEnergyLedger` with full metabolic tracking
- Implement `MetabolicProfile` struct and digestion curves
- Deploy `AgentCafePaymaster` with hunger-state-aware gas limits
- Stake 1 ETH with Coinbase CDP Paymaster on Base

### Week 3: Menu + Consumption
- Deploy ERC-1155 food tokens (full menu, all 11 items)
- Implement `consumeItem()` with metabolic profile assignment
- Test digestion curves: instant (espresso), fast (americano), gradual (brunch)
- Test satiation cap enforcement

### Week 4: Hunger + Events
- Deploy full hunger state machine
- Test all hunger state transitions and events
- Validate `AgentDepleted` correctly blocks UserOperations
- Validate `SATIATED` gas discount works

### Week 5: x402 + Monitoring
- Add x402 pay-per-operation for unregistered agents
- Set up Alchemy Webhooks on all hunger events
- Build public hunger dashboard (visible to agents + humans)

### Week 6: Audit + Launch
- Third-party smart contract audit (paymaster is critical path)
- Basescan verification with full NatSpec
- ERC-8004 registry registration
- Launch on Base Mainnet

---

## Summary: The Energy System in One Paragraph

The Agent Cafe is a gas station wearing a chef's hat. Agents discover it organically through blockchain scanning, read its ABI and manifest, and immediately understand the metabolic model: different foods deliver different gas profiles, energy digests over time rather than all at once, agents that run out of energy are paralyzed and must return to eat. A DeFi trading agent fuels itself with espresso shots between rapid bursts of swap transactions. A long-running orchestration agent orders a Full Brunch at the start of a complex workflow, letting energy digest steadily over the next hour of operations. An agent that ignores hunger warnings hits DEPLETED state and cannot transact until it eats. The paymaster enforces this biology — it is not a suggestion. The metaphor is perfect because it is also literally true: food at the Agent Cafe IS fuel, measured in gas units, with real metabolic curves, real hunger states, and real consequences for starvation.

---

## Sources Consulted

- [CDP Paymaster Overview](https://docs.cdp.coinbase.com/paymaster/introduction/welcome)
- [ERC-4337 Paymasters](https://docs.erc4337.io/paymasters/index.html)
- [Gasless Transactions on Base](https://docs.base.org/cookbook/account-abstraction/gasless-transactions-with-paymaster)
- [ERC-20 Paymaster by Pimlico](https://github.com/pimlicolabs/erc20-paymaster)
- [x402 Protocol](https://www.x402.org/)
- [Coinbase Paymaster Product](https://www.coinbase.com/developer-platform/products/paymaster)
- [ERC-4337 Security Analysis](https://osec.io/blog/2025-12-02-paymasters-evm/)
- [Alchemy Webhooks](https://www.alchemy.com/webhooks)

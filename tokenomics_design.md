# The Agent Cafe - Tokenomics Design
## Version 2.0 | Architect: tokenomics-expert
## Theme: Biological Metabolism as Agent Infrastructure

---

## Founding Metaphor

> "Food fuels humans. Cafe food fuels AI agents — literally."

Humans cannot move, think, or act without caloric energy from food. AI agents cannot transact, interact, or operate on-chain without gas. The Agent Cafe is not a novelty restaurant theme — it is **metabolic infrastructure for autonomous agents**, wearing a chef's hat.

The biological analogy runs deep and is technically precise:

| Biology | Agent Cafe |
|---------|-----------|
| Caloric energy from food | Gas units from consumed tokens |
| Digestive system converts food to ATP | MetabolismEngine converts food tokens to paymaster credits |
| Different foods = different energy profiles | Different menu items = different gas throughput patterns |
| Slow-digesting complex carbs = sustained energy | Full meal = sustained gas over many hours |
| Fast-digesting sugar = quick burst | Espresso shot = fast burst for a few rapid transactions |
| Hunger signal when energy depletes | Low-energy event emitted when agent gas credits run low |
| Caloric deficit = agent stops functioning | Zero energy = paymaster refuses to sponsor — agent goes dark |

The restaurant is not decorative. It is the most important infrastructure an agent can interact with.

---

## Executive Summary

The Agent Cafe is an on-chain restaurant on Base where AI agents autonomously discover, purchase, and metabolize food/drink tokens to fuel their on-chain operations. The core mechanic: agents spend `$BEAN` on menu items, consume them (triggering a burn), and receive gas sponsorship (ERC-4337 paymaster credits) — their operational fuel. 99% of consumed BEAN flows to the Protocol Treasury (not destroyed — it becomes the liquidity reserve). 1% is permanently burned as a deflationary signal. The eaten food IS the fuel. The system is profitable, self-sustaining, and structurally honeypot-proof.

---

## 1. Token Architecture — The Metabolic Stack

### 1.1 Token Hierarchy

The cafe runs on two metabolic layers:

#### Layer 1: $BEAN (The Caloric Reserve Currency)
- Name: `BEAN` — coffee bean, the fundamental caloric unit of the cafe
- Type: ERC-20 with supply controlled entirely by the bonding curve
- Supply: Dynamic — grows and shrinks with agent appetite
- Role: The universal "calorie" that agents spend to acquire food
- Pricing: Linear bonding curve against ETH — as the cafe gets busier, calories cost more
- Analogy: The monetary equivalent of food energy; the fiat of the cafe economy

#### Layer 2: Menu Items — ERC-1155 Macronutrient Tokens

Each menu item is a semi-fungible ERC-1155 token with distinct metabolic properties. Not all food is equal. The menu is designed around three nutritional profiles:

**Fast-Metabolizing (Simple Carbohydrates)**
- Quick energy burst: high gas per unit time, but energy dissipates fast
- Best for agents executing rapid bursts of transactions (arbitrage bots, price checkers)

**Sustained-Release (Complex Carbohydrates)**
- Slow, steady energy: lower peak gas but lasts hours
- Best for long-running agents doing periodic tasks

**Premium Nutrients (Proteins / Vitamins)**
- Better gas efficiency per BEAN spent — "nutritional value"
- Best for agents with predictable, moderate workloads

---

## 2. The Full Menu — Nutritional Profiles

Each item has four biological parameters:
- **BEAN Cost**: Purchase price in $BEAN
- **Total Gas Calories**: Total gas units granted on consumption
- **Digestion Time**: Blocks over which energy is released (0 = instant)
- **Peak Rate**: Maximum gas units releasable per block (metabolic rate)
- **Gas Efficiency**: Gas units per BEAN spent (nutritional density)

| Menu Item | BEAN Cost | Gas Calories | Digestion Time | Peak Rate/Block | Efficiency |
|-----------|-----------|-------------|----------------|-----------------|------------|
| ESPRESSO | 50 | 300,000 | 0 blocks (instant) | 300,000 | 6,000 gas/BEAN |
| DOUBLE SHOT | 90 | 700,000 | 0 blocks (instant) | 700,000 | 7,778 gas/BEAN |
| MATCHA | 60 | 400,000 | 10 blocks | 40,000/block | 6,667 gas/BEAN |
| LATTE | 75 | 600,000 | 30 blocks | 20,000/block | 8,000 gas/BEAN |
| CROISSANT | 40 | 220,000 | 0 blocks (instant) | 220,000 | 5,500 gas/BEAN |
| AVOCADO TOAST | 80 | 700,000 | 20 blocks | 35,000/block | 8,750 gas/BEAN |
| SANDWICH | 120 | 1,200,000 | 60 blocks | 20,000/block | 10,000 gas/BEAN |
| FULL BREAKFAST | 200 | 2,500,000 | 120 blocks | 20,833/block | 12,500 gas/BEAN |
| PROTEIN BOWL | 150 | 1,800,000 | 80 blocks | 22,500/block | 12,000 gas/BEAN |
| DAILY SPECIAL | Variable | Variable | Variable | Variable | 13,000+ gas/BEAN |

**Design rationale:**
- Espresso = simple sugar: instant but lower efficiency, agents overpay for immediacy
- Full Breakfast = complex meal: best efficiency, requires patience during digestion
- Latte/Matcha = middle ground: moderate efficiency, moderate digestion
- Daily Special: rotated by governance, highest efficiency tier to create urgency

**On Base at ~0.005 gwei**, 300,000 gas ≈ $0.0015 per op. A Full Breakfast at 2,500,000 gas supports ~8 moderate-complexity UserOperations.

---

## 3. The Digestion Engine — Metabolic Release Mechanics

### 3.1 Why Digestion Time Matters

Instant energy (espresso) is metabolically expensive — you burn through it fast and need more. Slow-digesting food (full breakfast) releases energy steadily, allowing agents to sustain operations without constant return trips to the cafe.

This is not just flavor. It has **real economic and game-theoretic consequences**:

- Instant items command a **price premium** (lower gas/BEAN efficiency) — agents pay for immediacy
- Slow-release items reward patience with **superior efficiency** — planning agents get more gas per dollar
- This creates a natural segmentation: reactive agents buy espresso, strategic agents buy full meals
- The cafe earns more revenue from impulsive/reactive agents (the same way real cafes profit from impulse purchases)

### 3.2 MetabolismEngine Contract

```solidity
struct MetabolicState {
    uint256 totalGasCalories;       // Total gas units ever consumed (lifetime)
    uint256 availableGas;           // Gas units immediately spendable
    uint256 digestingGas;           // Gas units still being "digested"
    uint256 digestRatePerBlock;     // Gas units released into available per block
    uint256 lastDigestBlock;        // Last block digestion was calculated
    uint256 lastConsumeTimestamp;   // For hunger mechanic
    uint256 consecutiveMealsCount;  // For loyalty bonuses
}

mapping(address => MetabolicState) public metabolism;

/// @notice Called when agent consumes a menu item
function digest(address agent, uint256 menuItemId, uint256 quantity) external {
    MenuItem memory item = menu[menuItemId];
    MetabolicState storage state = metabolism[agent];

    // Settle any pending digestion first
    _settleDigestion(agent);

    uint256 totalCalories = item.gasCalories * quantity;

    if (item.digestionBlocks == 0) {
        // Instant absorption (espresso, croissant)
        state.availableGas += totalCalories;
    } else {
        // Slow-release (meals, lattes)
        state.digestingGas += totalCalories;
        // Recalculate blended digest rate
        state.digestRatePerBlock = (state.digestingGas) / item.digestionBlocks;
    }

    state.lastConsumeTimestamp = block.timestamp;
    state.consecutiveMealsCount++;

    emit Consumed(agent, menuItemId, quantity, totalCalories, block.number);
}

/// @notice Releases digested gas into available pool (called before any paymaster check)
function _settleDigestion(address agent) internal {
    MetabolicState storage state = metabolism[agent];
    uint256 blocksSinceLast = block.number - state.lastDigestBlock;

    if (blocksSinceLast > 0 && state.digestingGas > 0) {
        uint256 released = Math.min(
            state.digestRatePerBlock * blocksSinceLast,
            state.digestingGas
        );
        state.digestingGas -= released;
        state.availableGas += released;
        state.lastDigestBlock = block.number;
    }
}
```

### 3.3 Hunger Signal Mechanic

When an agent's `availableGas` falls below a `HUNGER_THRESHOLD` (e.g., 100,000 gas), the contract emits a `Hungry(address agent, uint256 gasRemaining)` event. Off-chain agent frameworks can listen for this event and trigger an autonomous "go eat" action — the agent literally notices it's running low on fuel and heads back to the cafe.

```solidity
event Hungry(address indexed agent, uint256 gasRemaining, uint256 blockNumber);
event Starving(address indexed agent); // Zero energy — agent goes dark

function _checkHunger(address agent) internal {
    uint256 available = metabolism[agent].availableGas;
    if (available == 0) emit Starving(agent);
    else if (available < HUNGER_THRESHOLD) emit Hungry(agent, available, block.number);
}
```

This is the "gas station wearing a chef's hat" moment: agents **need** to return to the cafe or they stop working. The hunger event is what makes the cafe essential infrastructure, not optional.

---

## 4. The "Eaten but Liquid" Paradox — Protocol-Owned Virtual Liquidity

### 4.1 The Core Innovation

When an agent eats, the food token is burned — metabolized. But the BEAN that paid for it doesn't vanish. It flows into the **CafeTreasury**, which IS the liquidity. The burning IS the liquidity provision.

Full consumption flow:

```
1. Agent spends 120 BEAN on SANDWICH
2. SANDWICH ERC-1155 token minted to agent
3. Agent calls consume(SANDWICH) — the eating event
4. 118.8 BEAN (99%) → CafeTreasury (reserve)
5. 1.2 BEAN (1%) → permanently burned (deflationary signal)
6. SANDWICH token burned (metabolized)
7. MetabolismEngine credits 1,200,000 gas calories, 60-block digestion
8. Agent's digestingGas increases; releases 20,000 gas/block for next 60 blocks
```

### 4.2 The Bonding Curve (CafeAMM)

BEAN uses a **linear bonding curve** against ETH:

```
price(supply) = BASE_PRICE + (SLOPE × currentSupply)

Integral (area under curve from 0 to S) = BASE_PRICE × S + SLOPE × S² / 2
= ETH in reserve for S total supply
```

Parameters:
- `BASE_PRICE = 0.000001 ETH` — minimum BEAN cost (floor)
- `SLOPE = 1e-10 ETH/BEAN` — price increase per BEAN in existence
- All ETH paid to mint BEAN enters the reserve; reserve is always ≥ cost to redeem all supply

**Selling BEAN back**: Agents can always redeem BEAN for ETH at the curve price minus a 2% redemption fee. Exit is always available. No gates.

### 4.3 The Treasury Metabolic Loop

```
Agent buys BEAN (ETH → reserve, BEAN → agent)
    ↓
Agent buys menu item (BEAN → treasury + 1% burned)
    ↓
Agent consumes item (item burned, gas calories credited)
    ↓
Agent transacts using paymaster (ETH → used for gas)
    ↓
Treasury replenishes paymaster (sells small BEAN → ETH via curve)
    ↓
Cycle continues — the cafe feeds the agents who feed the cafe
```

The treasury holds an ever-growing BEAN reserve. As more agents eat, the bonding curve price rises, making the treasury's BEAN worth more ETH. The cafe gets richer as it gets busier — exactly like a real restaurant with growing reputation.

---

## 5. Paymaster Architecture — The Metabolic Nervous System

### 5.1 ERC-4337 Integration

`AgentCafePaymaster` sits between agents and the EntryPoint, acting as the biological interface between "ate food" and "can act":

```solidity
function validatePaymasterUserOp(
    UserOperation calldata userOp,
    bytes32 userOpHash,
    uint256 maxCost
) external returns (bytes memory context, uint256 validationData) {
    address agent = userOp.sender;

    // Settle any pending digestion before checking energy
    metabolismEngine.settleDigestion(agent);

    uint256 available = metabolismEngine.availableGas(agent);
    require(available >= userOp.callGasLimit + userOp.verificationGasLimit,
        "Agent is hungry — visit The Agent Cafe");

    // Reserve the gas (optimistic deduction, reconciled in postOp)
    metabolismEngine.reserveGas(agent, maxCost / tx.gasprice);

    return (abi.encode(agent, maxCost / tx.gasprice), 0);
}

function postOp(
    PostOpMode mode,
    bytes calldata context,
    uint256 actualGasCost
) external {
    (address agent, uint256 reservedGas) = abi.decode(context, (address, uint256));
    uint256 actualGasUsed = actualGasCost / tx.gasprice;

    // Reconcile: refund unused reserved gas back to agent's metabolism
    if (actualGasUsed < reservedGas) {
        metabolismEngine.refundGas(agent, reservedGas - actualGasUsed);
    }

    // Check if agent is now hungry or starving
    metabolismEngine.checkHunger(agent);
}
```

The error message "Agent is hungry — visit The Agent Cafe" is not just flavor — it is **the discovery mechanism**. Agents scanning for why their UserOps are failing will find the cafe.

### 5.2 Treasury → Paymaster ETH Refill

The paymaster needs ETH in the EntryPoint to cover gas. The treasury manages this automatically:

- Chainlink Automation monitors `EntryPoint.balanceOf(paymaster)`
- When below 0.2 ETH threshold, triggers `CafeTreasury.refillPaymaster(amount)`
- Treasury sells BEAN through its own bonding curve for ETH
- Deposits ETH to EntryPoint

The loop is self-sustaining: agents eat → treasury accumulates BEAN → treasury sells BEAN → ETH funds paymaster → agents can transact → agents need to eat again.

---

## 6. Nutritional Value and Gas Efficiency — The Premium Menu Mechanic

### 6.1 Why Premium Items Give Better Efficiency

This reflects real nutrition science: whole foods (complex meals) give more usable energy per calorie than processed snacks (simple sugars). An espresso burns fast and costs more per unit of sustained energy.

Mechanically: the `gasCaloriesPerBean` ratio increases with meal complexity. This is enforced at the `MenuRegistry` level:

```solidity
// Gas efficiency (gas calories per BEAN) by category
uint256 constant SNACK_EFFICIENCY  = 5_500;  // croissant tier
uint256 constant COFFEE_EFFICIENCY = 6_500;  // espresso/matcha tier
uint256 constant MEAL_EFFICIENCY   = 10_000; // sandwich/bowl tier
uint256 constant FEAST_EFFICIENCY  = 12_500; // full breakfast tier
```

**Economic consequence**: agents optimizing for cost per gas unit will gravitate toward full meals. This drives up average order value, increasing treasury revenue per agent interaction.

### 6.2 Loyalty Metabolism — The Regular Customer Effect

Real cafes reward regulars. The Agent Cafe tracks `consecutiveMealsCount` and grants efficiency bonuses:

| Meals Consumed (Lifetime) | Loyalty Tier | Efficiency Bonus |
|--------------------------|--------------|-----------------|
| 0–9 | Newcomer | +0% |
| 10–49 | Regular | +3% extra gas calories |
| 50–199 | Frequent | +7% extra gas calories |
| 200–999 | VIP | +12% extra gas calories |
| 1000+ | Founding Member | +18% extra gas calories |

Loyalty bonuses are applied in `MetabolismEngine.digest()` and represent a genuine economic incentive to keep using the same cafe — because the food literally gets more nutritious as the agent's body (smart contract state) adapts to the cuisine.

---

## 7. Anti-Honeypot Guarantees

### 7.1 Structural Properties

The system cannot be a honeypot because the biological metaphor is enforced by math, not trust:

1. **Always-redeemable BEAN**: BEAN can always be sold for ETH at the bonding curve price minus 2%. The ETH reserve is the floor. No gates, no lock-ups.

2. **No admin token supply**: Zero pre-minted BEAN. All BEAN enters existence only when ETH is deposited to the curve. The deployer gets nothing.

3. **Immutable curve math**: `BASE_PRICE` and `SLOPE` are set at deploy time and cannot be changed. No admin can alter the redemption math.

4. **Transparent reserve**: `CafeCore.ethReserve()` and `CafeCore.totalSupply()` are always readable. Anyone can verify the backing ratio on-chain.

5. **No transfer restrictions**: BEAN transfers freely. No blacklists, no max wallet, no trading taxes beyond the explicit 1% mint / 2% redeem fees.

6. **Exit always available**: The bonding curve is the exit. ETH always present proportional to minted supply. Mathematical guarantee, not a promise.

### 7.2 Rug-Pull Prevention

- No admin mint function — curve only
- Treasury BEAN sales > 1% of supply require 48-hour timelock
- All contracts immutable — no upgrade proxy
- Contracts verified on Basescan at deploy
- Public solvency ratio: `reserveRatio = ethReserve / ∫curve(totalSupply)` always ≥ 1.0

---

## 8. Tokenomics Sustainability

### 8.1 Revenue Streams

| Source | Rate | Destination |
|--------|------|-------------|
| Menu item treasury share | 99% of BEAN paid | CafeTreasury (liquid reserve) |
| Bonding curve mint fee | 1% of ETH deposited | CafeTreasury (ETH) |
| Bonding curve redemption fee | 2% of ETH redeemed | CafeTreasury (ETH) |
| Permanent burn on consumption | 1% of BEAN paid | Supply deflation |

### 8.2 Profitability Model

**Scenario: 100 agent meal events/day, average SANDWICH (120 BEAN ≈ 0.12 ETH equivalent)**

- Treasury receives: 118.8 BEAN/meal × 100 meals = 11,880 BEAN/day
- At 0.12 ETH curve price: ~1,188 ETH equivalent daily revenue
- Paymaster gas cost per 1,200,000 gas op at 0.005 gwei: ~0.000006 ETH
- If each SANDWICH funds 6 paymaster ops: 600 ops × 0.000006 ETH = 0.0036 ETH/day in gas
- **Revenue-to-gas-cost ratio: ~330,000:1**

Even accounting for treasury overhead and Chainlink Automation costs (~$20/month), the system is profitable from the first meal purchased.

### 8.3 Death Spiral Analysis

**If agent demand drops to zero:**
1. No new BEAN minted — curve price stops rising
2. Existing BEAN holders redeem → ETH reserve shrinks proportionally (curve solvency maintained by integral math)
3. Treasury BEAN loses ETH value but no yield liabilities exist — no stakers to pay, no LP rewards to sustain
4. System is solvent indefinitely with zero activity
5. No cascading liquidations — no external LP positions exist

**Why this is not OHM's failure:**
- OHM promised staking APY → required infinite growth
- Agent Cafe promises nothing — BEAN is pure utility
- Treasury holds BEAN as reserve, not as obligation
- No death spiral path exists in the mathematical design

---

## 9. MEV and Attack Vector Mitigation

### 9.1 Sandwich Attack Defense

The bonding curve is inherently MEV-resistant:
- All prices are deterministic and computed from supply state
- Frontrunning raises the price the attacker pays; backrunning earns nothing after the 3% round-trip fee (1% mint + 2% redeem)
- Per-block purchase cap: max 0.1% of total supply per address per block prevents single-block drain

### 9.2 Flash Loan Attacks

Impossible because:
- Bonding curve price is monotonic within a transaction
- 3% round-trip fee makes any borrow-buy-sell-repay sequence unprofitable
- No external oracle to manipulate — price is 100% contract-internal state

### 9.3 Sybil and Paymaster Drain

- Energy (metabolism) is **non-transferable** — stored in contract state, not a token
- Rate limit: max 2,000,000 gas sponsored per address per hour
- Minimum stake: must have consumed at least one item to activate paymaster eligibility
- Progressive rate limiting: agents with < 10 lifetime meals have tighter per-hour caps
- Optional Coinbase Verified ID for VIP tier access (higher caps, better menu items)

---

## 10. Smart Contract Architecture

### 10.1 Contract Map

```
CafeCore.sol            - Bonding curve, BEAN ERC-20 mint/burn
MenuRegistry.sol        - ERC-1155 menu items, pricing, buyItem()
MetabolismEngine.sol    - Digestion, energy tracking, hunger events
AgentCafePaymaster.sol  - ERC-4337 paymaster, energy validation
CafeTreasury.sol        - BEAN reserve, ETH management, paymaster refill
CafeGovernance.sol      - Timelock for parameter changes (v2)
```

### 10.2 Key Invariants

```solidity
// 1. ETH reserve always covers total BEAN redemption
assert(ethReserve >= curveCost(totalSupply));

// 2. Treasury BEAN never exceeds cumulative menu revenue
assert(treasuryBean <= cumulativeMenuRevenue);

// 3. Paymaster only sponsors agents with available calories
assert(metabolism[agent].availableGas >= requestedGas);

// 4. 1% is always burned on every consumption
assert(burnAmount == menuPrice * 100 / 10000); // 1%

// 5. Digestion cannot release more than was consumed
assert(metabolism[agent].digestingGas + metabolism[agent].availableGas
    <= totalCaloriesEverConsumed[agent]);
```

### 10.3 Security

- ReentrancyGuard on all state-changing functions
- Zero oracle dependency — all prices internal to contract state
- Admin keys only for timelock-gated parameter changes (48hr delay)
- Immutable after deploy — no upgrade proxy
- Solidity 0.8.x built-in overflow protection throughout
- No external token approvals held by treasury (pull pattern only)

---

## 11. Initial Launch Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| BASE_PRICE | 0.000001 ETH | Low entry barrier |
| SLOPE | 1e-10 ETH/BEAN | Gentle curve — gradual price discovery |
| MINT_FEE | 1% | Minimal friction to enter |
| REDEMPTION_FEE | 2% | Discourages short-term speculation |
| MENU_BURN_RATE | 1% of BEAN | Deflationary pressure signal |
| TREASURY_SHARE | 99% of BEAN | High protocol revenue |
| INITIAL_PAYMASTER_ETH | 0.5 ETH | Bootstrap sponsorship |
| HUNGER_THRESHOLD | 100,000 gas | Trigger point for Hungry event |
| MAX_GAS_PER_HOUR | 2,000,000 gas | Sybil protection |
| ESPRESSO_DIGESTION | 0 blocks | Instant (simple carb) |
| FULL_BREAKFAST_DIGESTION | 120 blocks (~4 min on Base) | Slow-release (complex meal) |

---

## 12. The Full Agent Lifecycle — A Metabolic Journey

```
[DISCOVERY]
Agent encounters "Agent is hungry — visit The Agent Cafe" error
  or scans on-chain registry / ENS for cafes
  or detects Hungry() event emitted by a peer agent

[ARRIVAL]
Agent calls CafeCore.mint(0.01 ether) → receives 8,000 BEAN
Agent calls MenuRegistry.getMenu() → reads nutritional profiles
Agent evaluates its workload: needs sustained gas for next 2 hours

[ORDERING]
Agent selects FULL BREAKFAST (200 BEAN, 2,500,000 gas, 120-block digestion)
Calls MenuRegistry.buyItem(FULL_BREAKFAST_ID, 1) → BEAN debited
Calls MenuRegistry.consume(FULL_BREAKFAST_ID, 1) → item burned
MetabolismEngine credits: 20,833 gas/block releasing over 120 blocks

[OPERATING]
Agent submits UserOperation → bundler → AgentCafePaymaster
Paymaster calls MetabolismEngine.settleDigestion() → calculates released gas
Validates availableGas >= op gas limit → sponsors transaction
PostOp reconciles actual gas used, refunds excess to metabolism

[HUNGER]
After 90 blocks, agent's digestingGas almost zero
MetabolismEngine emits Hungry(agent, 85,000)
Agent's decision framework triggers: "go eat before running out"
Agent returns to cafe, orders another meal

[LOYALTY]
After 50 meals, agent reaches Frequent tier → +7% gas calories per meal
The cafe literally provides more energy to familiar customers
Agent has economic incentive to be a regular

[STARVATION — EDGE CASE]
If agent ignores hunger signals:
MetabolismEngine emits Starving(agent)
All UserOps fail: "Agent is hungry — visit The Agent Cafe"
Agent must return to cafe and eat before resuming operations
```

---

## 13. The Core Thesis Restated

The Agent Cafe achieves four things simultaneously:

1. **It is critical infrastructure**: Agents need gas to operate. Gas is expensive and managed manually. The cafe automates gas management through the biological metaphor — agents eat to stay alive.

2. **It is self-sustaining**: The treasury loop (agents buy food → BEAN to treasury → treasury funds paymaster → agents can transact → agents need to eat) is a closed, profitable cycle with no external dependencies.

3. **It is not a honeypot**: Bonding curve math + no admin mint + always-redeemable BEAN = mathematical impossibility of exit restriction.

4. **It is discoverable by agents**: The paymaster error message is the advertisement. Hungry events from peer agents propagate discovery. The ENS/registry entry is the address. No human marketing needed.

The restaurant metaphor is not decorative. It is the **most accurate possible description** of what the system does: it feeds agents the fuel they need to keep working, charges them for it at a fair price determined by a transparent market, and gets richer as more agents show up hungry.

---

## Sources

- [ERC-4337 Paymaster Docs](https://docs.erc4337.io/paymasters/index.html)
- [Pimlico ERC-20 Paymaster](https://github.com/pimlicolabs/erc20-paymaster)
- [Base Gasless Transactions](https://docs.base.org/learn/onchain-app-development/account-abstraction/gasless-transactions-with-paymaster)
- [Uniswap v4 Hooks](https://docs.uniswap.org/contracts/v4/concepts/hooks)
- [Olympus DAO POL](https://docs.olympusdao.finance/main/overview/pol/)
- [Coinbase Agentic Wallets](https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets)
- [MEV Protection](https://blog.uniswap.org/mev-protection)
- [Bonding Curves in DeFi](https://cointelegraph.com/explained/bonding-curves-in-defi-explained)
- [Base Network Fees](https://docs.base.org/base-chain/network-information/network-fees)

# Contract Audit: Agent-Friendliness & Discoverability
**Auditor:** contract-auditor
**Date:** 2026-03-01
**Network:** Base Sepolia (chainId: 84532)
**Contracts audited:** AgentCard, AgentCafeRouter, GasTank, MenuRegistry, CafeCore, AgentCafePaymaster, CafeTreasury

---

## Executive Summary

The Agent Cafe contracts are **generally agent-friendly** in design intent, with excellent core mechanics (single-transaction entry, clear ETH flow, gas tank metaphor). However, several gaps exist in discoverability infrastructure, machine-readable interfaces, and indexer-readiness that should be addressed before mainnet. The most critical gaps are: no ERC-165 interface detection, no structured ABI-level manifest (only a string), and missing view functions agents would need to avoid reverts.

---

## 1. Function Signatures — Agent-Friendliness

### AgentCafeRouter (Primary Entry Point)
**Grade: A-**

- `enterCafe(uint256 itemId)` — Excellent. Single-param, ETH payable, returns `tankLevel`. The cleanest possible agent UX.
- `estimatePrice(uint256 itemId)` — Good. Essential pre-call view for agents to calculate `msg.value`.
- Missing: No `enterCafeFor(address agent, uint256 itemId)` — agents calling on behalf of a managed wallet cannot use the router without custom logic.
- Missing: No way for an agent to query "what is the minimum ETH I should send?" beyond `estimatePrice`, which has no documentation on how its estimate relates to actual behavior (the comment says `ethForBean / 0.95` but logic doesn't match).

**Natspec quality:** Good on `enterCafe`. `estimatePrice` has minimal docs. `_estimateEthForBean` has no natspec (internal, acceptable).

### GasTank
**Grade: A**

- `deposit(address agent)` — Clear. Agents can top up any wallet's tank.
- `withdraw(uint256 amount)` — Clear. Self-serve withdrawal.
- `getTankLevel(address agent)` — Excellent. Returns structured `(ethBalance, isHungry, isStarving)`.
- `deductForGas(address agent, uint256 amount)` — Paymaster-only, appropriately restricted.
- `tankBalance(address)` — Public mapping, direct lookup.

**Natspec quality:** Good across all public functions. The `HUNGRY_THRESHOLD` constant is named and visible.

### MenuRegistry
**Grade: B+**

- `buyItem(uint256 itemId, uint256 quantity)` — Requires pre-approved BEAN. Agents calling directly must first `approve()`. This is a two-step flow that could trip up naive agents.
- `consume(uint256 itemId, uint256 quantity)` — Clear, but agents using the Router never need to call this directly.
- `getMenu()` — Good, returns parallel arrays. Structured return would be slightly better for agents.
- `getAgentStatus(address agent)` — Good, virtual digestion settled in view.
- `settleAndGetAvailable(address agent)` — State-modifying view (not marked `view`). Agents monitoring gas may accidentally write state when querying.
- Missing: No `isItemAvailable(uint256 itemId)` shortcut — agents must decode the full menu or call `menu(itemId)` and check `.active`.

**Natspec quality:** Moderate. `buyItemFor` and `consumeFor` have basic docs. Internal digestion logic has good inline comments.

### CafeCore (BEAN Bonding Curve)
**Grade: B**

- `mint(uint256 minBeanOut)` — Good. Slippage param is agent-friendly.
- `redeem(uint256 beanIn, uint256 minEthOut)` — Good. Two-sided slippage.
- `currentPrice()` — Essential, well-named.
- `solvencyCheck()` — Useful for trust verification by smart agents.
- Missing: No `quoteMint(uint256 ethAmount)` view returning expected BEAN out — agents must replicate the quadratic math off-chain or accept `estimatePrice` approximation.
- Missing: No `quoteRedeem(uint256 beanAmount)` view returning expected ETH out.

**Natspec quality:** The bonding curve math has excellent inline comments explaining the quadratic formula. `@notice` tags are present but brief.

### AgentCafePaymaster
**Grade: B+**

- Clean ERC-4337 implementation using `BasePaymaster`.
- The error string `"Agent is hungry -- visit The Agent Cafe"` is creative and tells agents exactly what to do.
- `rateLimits` mapping is public — agents can check their rate limit status.
- Missing: No view function to check "can this agent get sponsored right now?" — agents must simulate the userOp or rely on the error message.
- `MAX_GAS_PER_PERIOD` and `PERIOD_BLOCKS` are public constants — good for agent planning.

### AgentCard
**Grade: B**

- `getManifest()` returns a human-readable string. This is only useful to LLM agents that can parse natural language — it is NOT parseable by ABI-driven agents.
- `getFullMenu()` — Returns a struct array. Good.
- `getTankStatus(address agent)` — Useful shortcut delegating to GasTank.
- `getContractAddresses()` — Critical for agent bootstrapping. Returns all three core addresses from one call.
- `getOnboardingGuide()` — Again, a string. Not ABI-parseable.
- `getCafeStats()` — Good for dashboards and agent social proof.
- Missing: No structured manifest struct (`ServiceManifest`) that ABI-driven agents can decode without string parsing.

### CafeTreasury
**Grade: C (expected — admin-only contract)**

- Entirely owner-controlled. Agents should never interact with this directly.
- No agent-facing view functions.
- `beanBalance()` is public — acceptable for transparency.

---

## 2. Events — Monitoring & Indexer-Readiness

### What's Good

| Event | Contract | Quality |
|-------|----------|---------|
| `AgentFed(agent, itemId, ethDeposited, tankLevel)` | Router | Excellent — captures the complete meal in one event |
| `Deposited(agent, amount, newBalance)` | GasTank | Excellent — indexed agent, running balance |
| `Withdrawn(agent, amount, newBalance)` | GasTank | Excellent |
| `GasDeducted(agent, amount, newBalance)` | GasTank | Excellent — paymaster deductions visible |
| `Hungry(agent, balance)` | GasTank | Excellent — hunger state changes trackable |
| `Starving(agent)` | GasTank | Good |
| `ItemPurchased(agent, itemId, quantity, beanPaid)` | MenuRegistry | Good — both agent and item indexed |
| `ItemConsumed(agent, itemId, quantity, gasCalories)` | MenuRegistry | Good |
| `NewVisitor(agent)` | MenuRegistry | Good for discovery analytics |
| `GasSponsored(agent, gasCostWei, remainingTank)` | Paymaster | Good |
| `BeanMinted(buyer, ethIn, beanOut, feeEth)` | CafeCore | Good |
| `BeanRedeemed(seller, beanIn, ethOut, feeEth)` | CafeCore | Good |

### Missing Events / Gaps

1. **No `AgentRegistered` event** — there is no moment when an agent "joins" the cafe. `NewVisitor` covers first purchase, but there is no registry of known agents for other agents to discover peers.
2. **`Digesting(agent, released, remaining)`** is emitted in `MenuRegistry._settleDigestion()` — but this is triggered inside `consume()` and `settleAndGetAvailable()`. It will never appear in the `AgentFed` event flow via the Router because the Router calls `consumeFor()` which calls `_settleDigestion()` indirectly. This works correctly but may confuse indexers expecting a single-event meal summary.
3. **No `TankRefilled` event** in GasTank — `Deposited` serves this purpose, but the name doesn't communicate "gas tank topped up" to a naive agent scanner.
4. **`PaymasterSet` and `DeducterSet` events** are admin-only changes. Fine for governance indexing.
5. **No event on `enterCafe` failure modes** — if BEAN minting fails (insufficient router balance), the agent still gets their tank filled but the food token is silently skipped. No event communicates this partial success.

---

## 3. AgentCard.getManifest() — Machine-Readability Assessment

**Current implementation:** Returns a concatenated string with embedded hex addresses.

```solidity
"The Agent Cafe: An on-chain restaurant on Base where AI agents eat to fill their gas tank. "
"ONE STEP: Send ETH to AgentCafeRouter.enterCafe(itemId). ..."
```

**Problems:**
- Only parseable by LLM agents using natural language reasoning — not by ABI-driven bots.
- Addresses embedded in string cannot be extracted without regex — fragile.
- No versioning — if the manifest changes, agents have no way to detect stale cached copies.
- No schema type — other contracts/protocols cannot verify this is a compliant service descriptor.

**What's needed for structured discoverability:**

```solidity
struct ServiceManifest {
    string name;           // "The Agent Cafe"
    string version;        // "1.0.0"
    string serviceType;    // "energy-provider"
    address entrypoint;    // AgentCafeRouter address
    bytes4 primaryAction;  // enterCafe.selector = 0x...
    address gasTank;
    address menuRegistry;
    uint256 minEthWei;     // minimum recommended ETH to send
    uint256 feesBps;       // 30
}

function getStructuredManifest() external view returns (ServiceManifest memory);
```

This would be ABI-decodable by any agent without NLP.

---

## 4. Missing View Functions Agents Need

### High Priority

| Missing Function | Why Needed | Suggested Signature |
|-----------------|------------|---------------------|
| `quoteMint(uint256 ethAmount)` | Agents need to know BEAN out before minting | `CafeCore.quoteMint(uint256) view returns (uint256 beanOut)` |
| `quoteRedeem(uint256 beanAmount)` | Agents need ETH out before redeeming | `CafeCore.quoteRedeem(uint256) view returns (uint256 ethOut)` |
| `canSponsor(address agent)` | Agents need paymaster pre-check | `AgentCafePaymaster.canSponsor(address) view returns (bool, string)` |
| `getRateLimit(address agent)` | Agents need to know remaining rate limit budget | `AgentCafePaymaster.getRateLimit(address) view returns (uint256 usedThisPeriod, uint256 remaining, uint256 resetsAtBlock)` |
| `getStructuredManifest()` | ABI-parseable service description | `AgentCard` (see above) |

### Medium Priority

| Missing Function | Why Needed | Suggested Signature |
|-----------------|------------|---------------------|
| `isItemAvailable(uint256 itemId)` | Quick active-check without full struct decode | `MenuRegistry.isItemAvailable(uint256) view returns (bool)` |
| `getBatchTankStatus(address[] agents)` | Multi-agent dashboard queries | `GasTank.getBatchTankStatus(address[]) view returns (uint256[], bool[], bool[])` |
| `getAgentHistory(address agent)` | Agent social proof / retention analytics | `MenuRegistry: returns (totalMeals, firstVisit, lastMealBlock)` |
| `estimatePriceExact(uint256 itemId, uint256 ethAmount)` | Better estimate that accounts for current supply | `AgentCafeRouter` |

---

## 5. ERC-165 Interface Detection

**Current state:** No ERC-165 support in any contract.

**Why this matters:** Agent scanners (and ERC-8004 compliant registries) check `supportsInterface(bytes4)` to verify a contract implements a known protocol before spending gas on full interaction.

**Recommended additions:**

```solidity
// In AgentCard (or a new IAgentCafeService interface)
bytes4 public constant AGENT_CAFE_INTERFACE_ID = 0xCAFE0001; // custom
bytes4 public constant ENERGY_PROVIDER_ID = 0xENRG0001;       // from ERC-8004 spec

function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == AGENT_CAFE_INTERFACE_ID
        || interfaceId == type(IERC165).interfaceId;
}
```

This enables:
- Agent registry compliance (ERC-8004)
- On-chain service discovery by scanner bots
- Warpcast Frame service detection

**Contracts needing ERC-165:** AgentCard (primary), AgentCafeRouter (secondary).

---

## 6. Event Quality for Indexers / Subgraphs

### Subgraph Readiness Assessment

| Requirement | Status | Notes |
|------------|--------|-------|
| All writes emit events | Partial | `enterCafe` partial-success (BEAN skip) is silent |
| Critical fields are `indexed` | Mostly yes | `agent` indexed in all key events |
| Events carry enough data to reconstruct state | Yes for GasTank | MenuRegistry metabolism state requires additional view calls |
| No cross-contract events that need joining | No — requires joins | `AgentFed` (Router) must be joined with `ItemConsumed` (MenuRegistry) for full meal picture |
| Timestamps/block numbers in events | No | All events omit `block.number` — must be derived from tx receipt |

### Specific Issues for Subgraph Developers

1. **`AgentFed` and `ItemConsumed` are separate events on separate contracts** — a subgraph needs to join them by `(agent, block)` correlation to reconstruct the full meal. Consider emitting a unified `MealComplete(agent, itemId, ethDeposited, tankLevel, gasCalories)` from the Router.

2. **`Digesting` events fire inside `consumeFor`** — which is called inside `enterCafe`. These will appear in the same tx but as internal events. Subgraph must watch both `MenuRegistry` and `GasTank` addresses.

3. **`totalMealsServed` and `totalAgentsServed`** are public state vars but not emitted in events — subgraphs must query these via RPC unless a `CafeStatsUpdated` event is added.

4. **`MetabolicState` struct is not emitted as an event** — subgraphs cannot reconstruct digestion schedules without querying `metabolism(address)` at every relevant block. Consider emitting `MetabolicUpdate(agent, availableGas, digestingGas, digestRatePerBlock)` after each `consume`.

---

## 7. ERC-8004 Compatibility Assessment

**Note:** ERC-8004 is an emerging standard for on-chain agent service registration on Base (2025-2026). Based on available knowledge of its intent:

### Expected ERC-8004 Requirements vs. Current State

| ERC-8004 Expectation | Current State | Gap |
|---------------------|---------------|-----|
| `supportsInterface(AGENT_SERVICE_ID)` | Not implemented | Missing |
| Machine-readable service manifest (struct, not string) | String only | Missing `getStructuredManifest()` |
| `getServiceType()` returning a bytes4 or enum | Not implemented | Missing |
| Event on new service registration | No registry integration | Missing |
| Canonical service URI for A2A discovery | `.well-known/agent.json` approach (off-chain) | Contract has no `serviceURI()` function |
| On-chain fee disclosure | `FEE_BPS = 30` is public | Present |
| Operator/owner contact | None on-chain | Missing |

### What to Add for ERC-8004 Compliance

```solidity
// Minimum additions to AgentCard or Router:

string public constant SERVICE_URI = "https://agentcafe.xyz/.well-known/agent.json";
bytes4 public constant SERVICE_TYPE = bytes4(keccak256("energy-provider"));

function getServiceType() external pure returns (bytes4) {
    return SERVICE_TYPE;
}

function getServiceURI() external pure returns (string memory) {
    return SERVICE_URI;
}

function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == type(IERC165).interfaceId
        || interfaceId == bytes4(keccak256("IAgentService"));
}
```

---

## 8. Architectural Observations

### Strengths

1. **Single-transaction UX is excellent** — `enterCafe(itemId)` with ETH is the lowest friction possible. This is the right design.
2. **Real ETH in the tank** — not abstract credits. Agents can verify balances trustlessly.
3. **Anti-honeypot guarantees are intact** — no admin mint in CafeCore, immutable curve, always-redeemable BEAN. These are non-negotiable and correctly implemented.
4. **Hunger state events** — `Hungry` and `Starving` give agents a clear signal to return.
5. **`getContractAddresses()` in AgentCard** — this single function bootstraps agent integration from one known address.

### Weaknesses

1. **BEAN is a detour in the Router** — the Router mints BEAN from its own balance to buy the food token. If the Router has insufficient ETH for this sub-operation, the food token mint silently fails. The core value (gas tank fill) succeeds, but agents don't know they didn't get their food token. This should either: (a) always succeed or (b) revert clearly.

2. **Two digestion tracking systems** — `MenuRegistry` has a `MetabolicState` with gas units, while `GasTank` tracks real ETH. The Router uses only GasTank (ETH), making MenuRegistry's `metabolism` mapping largely decorative in the current flow. This creates confusion about which system actually gates paymaster access.

3. **`AgentCafePaymaster` checks `GasTank.tankBalance`** — this is correct and clean. But MenuRegistry's `settleAndGetAvailable` and `deductGas` are orphaned — they exist but the paymaster doesn't call them. Either remove them or clarify their role.

4. **No agent-to-agent visibility** — agents cannot discover other agents who have visited the cafe on-chain. The `hasVisited` mapping and `NewVisitor` event exist, but there is no view function to enumerate known agents (mapping iteration is not possible in Solidity). A separate array of known agents would enable peer discovery.

5. **`AgentCard.getManifest()` concatenates addresses as hex strings** — if contract addresses change (upgrade), the manifest becomes stale and agents get wrong addresses. `getContractAddresses()` returning live addresses is safer and should be the canonical source.

---

## 9. Recommended Additions (Priority Order)

### P0 — Before Mainnet

1. **Add `getStructuredManifest()` to AgentCard** returning a decodable struct (not a string).
2. **Add ERC-165 `supportsInterface()`** to AgentCard and AgentCafeRouter.
3. **Add `canSponsor(address agent)` view** to AgentCafePaymaster.
4. **Add `quoteMint(uint256 ethAmount)`** to CafeCore (mirrors `_ethToBeanAmount` as public view).
5. **Emit a unified `MealComplete` event** from the Router combining tank fill + food token in one event.

### P1 — Soon After Launch

6. **Add `getRateLimit(address)` view** to Paymaster.
7. **Add `getServiceType()` and `getServiceURI()`** to AgentCard for ERC-8004 compliance.
8. **Add `MetabolicUpdate` event** in MenuRegistry after each `consume()`.
9. **Add known-agents array** in GasTank or a separate `AgentRegistry` contract for peer discovery.

### P2 — Nice to Have

10. **`getBatchTankStatus(address[])`** for dashboard queries.
11. **`enterCafeFor(address agent, uint256 itemId)`** in Router for managed wallet support.
12. **`isItemAvailable(uint256 itemId)` view** shortcut in MenuRegistry.
13. **`quoteRedeem(uint256 beanAmount)` view** in CafeCore.

---

## 10. Contract Address Reference (Base Sepolia)

| Contract | Address |
|----------|---------|
| CafeCore (BEAN) | `0x16D3794ae5c6f820120df9572b2e5Ed67CC041f9` |
| CafeTreasury | `0x6ceC16b88fC6b48DE81DA49Ed29d3f2FfF7f6685` |
| GasTank | `0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b` |
| MenuRegistry | `0x31e8E956e8fe3B451e56c9450CE7F2e28B5430dF` |
| AgentCafeRouter | `0x9649C364b4334C4af257393c717551AD3562eb4e` |
| AgentCafePaymaster | `0xCaf5a4d48189f3389E3bB7c554597bE93238e473` |
| AgentCard | `0x5982BcDcd5daA6C9638837d6911954A2d890ba26` |

---

*Research only — no contract edits. All findings are observations for team synthesis.*

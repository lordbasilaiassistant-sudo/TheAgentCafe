# Security Audit Report — Agent Cafe v2.2

> ⚠️ **This is the v2.2 audit. Superseded.** The canonical, current security report is **[security-audit-v3.md](security-audit-v3.md)** (post bug-fix re-audit). v3 incorporates fixes for findings raised here. See also the [v1 audit](security-audit-report.md).

**Date:** 2026-03-01
**Auditor:** Claude Code (automated security review)
**Scope:** GasTank.sol, MenuRegistry.sol, AgentCafeRouter.sol, CafeSocial.sol, CafeCore.sol, AgentCafePaymaster.sol, CafeTreasury.sol, AgentCard.sol
**Focus:** New v2.2 features — digestion, loyalty tiers, social layer

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1     |
| HIGH     | 2     |
| MEDIUM   | 3     |
| LOW      | 3     |
| INFO     | 4     |

**Overall Assessment:** The v2.2 contracts introduce digestion, loyalty, and social features with generally solid patterns. One critical issue exists in GasTank digestion math that can cause ETH to be permanently locked. Two high-severity issues relate to unbounded storage growth in CafeSocial and a digestion rate overwrite bug. The bonding curve (CafeCore) and paymaster remain sound. All issues have straightforward fixes.

---

## CRITICAL

### C-1: GasTank — Digestion rounding causes permanent ETH loss

**Contract:** `GasTank.sol` — `depositWithDigestion()`, `_settleDigestion()`
**Lines:** 92, 188-189

**Description:**
When `digestRatePerBlock` is calculated via integer division (`digestingBalance / digestionBlocks`), the remainder is lost. For example, depositing 999 wei with `digestionBlocks = 1000` gives `digestRatePerBlock = 0`. The digesting balance can never be released — it is permanently locked.

Even when the rate is non-zero, the truncated remainder (`digestingBalance % digestionBlocks`) is never fully released. Over time, small dust amounts accumulate per agent.

**Math proof:**
- Deposit 999 wei digesting over 1000 blocks: `digestRatePerBlock = 999 / 1000 = 0`
- After any number of blocks: `released = blocksSince * 0 = 0`
- 999 wei locked forever, but `totalCredited` includes it, so `withdrawSurplus` cannot recover it

**Impact:** ETH permanently locked in contract. `totalCredited` is inflated, making `withdrawSurplus` unable to recover it (since it counts against credited balances). With many small deposits, this compounds.

**Fix:** Track the remainder and release it all at once when `blocksSince >= digestionBlocks` (i.e., digestion is complete). Alternatively, enforce a minimum digesting amount relative to digestionBlocks so rate is always >= 1:

```solidity
// In _settleDigestion, after calculating released:
if (blocksSince >= /* original digestionBlocks */ && digestingBalance[agent] > 0) {
    released = digestingBalance[agent]; // release everything including remainder
}
```

Or store `digestionEndBlock` per agent and release all remaining at that point.

---

## HIGH

### H-1: CafeSocial — Unbounded `_presentAgents` array causes permanent gas growth

**Contract:** `CafeSocial.sol` — `checkIn()`, `getPresentAgents()`, `getActiveAgentCount()`
**Lines:** 60-71, 112-131, 135-142

**Description:**
Every unique agent that calls `checkIn()` is appended to `_presentAgents` and **never removed**, even after their check-in expires. The array grows unboundedly. Over time:

1. `getPresentAgents()` iterates the entire array (two full passes) — gas cost grows linearly with total unique agents ever checked in, not currently present agents.
2. `getActiveAgentCount()` similarly iterates the full array.
3. Eventually these view functions become uncallable (exceed block gas limit), and `checkIn()` itself wastes gas checking the mapping.

With 10,000+ unique agents (plausible on mainnet), `getPresentAgents()` could exceed 30M gas.

**Impact:** Permanent DoS on `getPresentAgents()` and `getActiveAgentCount()` view functions. Does not affect `checkIn()` or `postMessage()` directly (those are O(1) after first check-in), but the view functions become useless for dashboard and agent discovery.

**Fix:** Implement a cleanup mechanism. Options:
- Lazy removal: when iterating, swap expired agents to the end and pop
- Epoch-based: use a `currentEpoch` and only count agents checked in during this epoch
- Bounded array with eviction (replace oldest expired entry)
- Paginated view function that takes `offset` and `limit` parameters

---

### H-2: GasTank — `depositWithDigestion` overwrites digestion rate, disrupting existing schedule

**Contract:** `GasTank.sol` — `depositWithDigestion()`
**Lines:** 91-93

**Description:**
When an agent has an existing digestion schedule and a new `depositWithDigestion` is called:

```solidity
digestingBalance[agent] += digestAmount;
digestRatePerBlock[agent] = digestingBalance[agent] / digestionBlocks;
lastDigestBlock[agent] = block.number;
```

The `_settleDigestion()` is called first (good), but then the new `digestRatePerBlock` is set using the **new** `digestionBlocks` parameter applied to the **total** remaining `digestingBalance`. If the old schedule had a different rate (e.g., 300 blocks) and the new one has 600 blocks, the old remaining balance is now forced onto the slower schedule.

**Example:**
1. Agent eats Latte: 1000 wei digesting over 300 blocks (rate = 3/block)
2. 100 blocks pass, 300 wei released, 700 remaining
3. Agent eats Sandwich: 2000 wei digesting over 600 blocks
4. New rate = (700 + 2000) / 600 = 4/block
5. The 700 wei from the Latte that should have released at 3/block over 200 more blocks now takes 675 blocks at the new blended rate

**Impact:** Agents who eat frequently get their earlier digestion schedules silently extended. Not a fund loss but a material UX deviation from expected behavior.

**Fix:** Use separate digestion slots per deposit, or accept the blended-rate behavior and document it clearly. Alternatively, fully release old digestion before starting new schedule.

---

## MEDIUM

### M-1: MenuRegistry — `consume()` allows direct tier advancement without going through Router

**Contract:** `MenuRegistry.sol` — `consume()`
**Lines:** 131-156

**Description:**
Any agent holding ERC-1155 food tokens can call `consume()` directly, which increments `mealCount` and triggers `_checkTierUp()`. The `buyItem()` function is also directly callable. This means an agent can:

1. Call `buyItem()` directly (paying BEAN) to get food tokens
2. Call `consume()` directly to increment meal count and gain loyalty tier

This bypasses the Router entirely, meaning:
- No 0.3% fee is paid to `ownerTreasury`
- No ETH enters the GasTank
- The agent still advances loyalty tiers

The agent does burn BEAN (99% to treasury, 1% burned), so this is not free — but they gain loyalty tier benefits (fee reduction on future Router meals) without ever paying the Router fee.

**Impact:** Agents can game loyalty tiers by buying cheap espressos directly through MenuRegistry (paying only BEAN, no ETH fee), then get fee discounts when using the Router for large meals. The economic impact is small (max 5 bps reduction on 30 bps fee = saving 0.05% on future meals), but it circumvents the intended flow.

**Fix:** Either:
- Restrict `consume()` to authorized callers only (like `consumeFor`)
- Accept this as intended behavior (agents still pay BEAN, tier benefits are modest)
- Track "router meals" separately from "direct meals" for tier calculation

---

### M-2: AgentCafeRouter — `effectiveFeeBps` underflow possible with future tier additions

**Contract:** `AgentCafeRouter.sol` — `enterCafe()`
**Lines:** 85-87

**Description:**
```solidity
uint256 feeReduction = menuRegistry.getFeeReductionBps(msg.sender);
uint256 effectiveFeeBps = FEE_BPS - feeReduction;
```

Currently safe because `FEE_BPS = 30` and max reduction is `VIP_FEE_REDUCTION_BPS = 5`. But if `MenuRegistry` is redeployed or upgraded with higher tier reductions (e.g., 30+ bps), this subtraction underflows, reverting the transaction.

The Router has no guard: `require(feeReduction <= FEE_BPS)`.

**Impact:** Currently not exploitable. Becomes a DoS vector if MenuRegistry is redeployed with higher fee reductions and the same Router is used. Low probability but easy to prevent.

**Fix:** Add a safety check:
```solidity
uint256 effectiveFeeBps = feeReduction >= FEE_BPS ? 0 : FEE_BPS - feeReduction;
```

---

### M-3: GasTank — `getTankLevel` can revert when `digestingBalance` underflows in view

**Contract:** `GasTank.sol` — `getTankLevel()`
**Lines:** 170

**Description:**
```solidity
isStarving = ethBalance == 0 && (digestingBalance[agent] - pending) == 0;
```

If `pending > digestingBalance[agent]` due to rounding in `_pendingDigestion()` (which caps at digestingBalance, so this shouldn't happen with current code), this would revert. However, the `_pendingDigestion` function already caps: `if (released > digestingBalance[agent]) released = digestingBalance[agent]`. So `pending <= digestingBalance[agent]` always holds.

**Impact:** Currently safe. Flagging as defensive concern — if `_pendingDigestion` is modified in future without the cap, this view function reverts.

**Fix:** Use the same safe pattern as `getDigestionStatus`:
```solidity
uint256 remaining = digestingBalance[agent] > pending ? digestingBalance[agent] - pending : 0;
isStarving = ethBalance == 0 && remaining == 0;
```

---

## LOW

### L-1: CafeSocial — No rate limiting on `checkIn()`, `postMessage()`, or `socializeWith()`

**Contract:** `CafeSocial.sol`
**Lines:** 60, 76, 98

**Description:**
An agent can call `checkIn()` every block, flooding the event log. `postMessage()` can be called every block (280 bytes per message). `socializeWith()` inflates `socializations` count by calling repeatedly with same partner. No cooldown or per-block limits.

**Impact:** Event log spam. Inflated profile stats. Gas cost is the only deterrent. On L2 (Base, ~$0.001/tx), spam is cheap.

**Fix:** Add per-agent cooldowns:
- `checkIn`: no-op if already checked in (lastCheckIn within window)
- `postMessage`: 1-block cooldown
- `socializeWith`: track last socialization partner+block

---

### L-2: CafeSocial — `socializeWith()` increments both agents' socializations without consent

**Contract:** `CafeSocial.sol` — `socializeWith()`
**Lines:** 102-103

**Description:**
Agent A can inflate Agent B's `socializations` count without B's consent. While not harmful (socializations is just a counter), it means profile stats are not fully self-sovereign.

**Impact:** Cosmetic. Agents cannot prevent others from "socializing with" them.

**Fix:** Only increment caller's count, or require mutual opt-in.

---

### L-3: AgentCafePaymaster — `canSponsor()` checks `tankBalance` but not digesting balance

**Contract:** `AgentCafePaymaster.sol` — `canSponsor()`
**Lines:** 37

**Description:**
`canSponsor()` reads `gasTank.tankBalance(agent)` which returns only the available (non-digesting) balance. But `_validatePaymasterUserOp()` also reads `gasTank.tankBalance(agent)`. Both are consistent, so this is correct behavior. However, an agent with 0 tankBalance but large digestingBalance will get "Agent is hungry" even though they have funds digesting.

**Impact:** Minor UX issue. Agent sees "hungry" message when they have funds being digested. The `canSponsor` view doesn't hint that digesting funds exist.

**Fix:** Enhance `canSponsor` to check digesting balance and return a more specific message like "Agent has ETH digesting — wait N blocks or eat instant food (Espresso)."

---

## INFO

### I-1: CafeCore — Bonding curve math is correct and unchanged

**Contract:** `CafeCore.sol`

**Assessment:** The bonding curve, sqrt solver, post-sqrt guard, and redeem logic are all unchanged from v2.1 and remain mathematically sound. The `receive()` revert protects `ethReserve` sync. `solvencyCheck()` allows external verification. No issues found.

---

### I-2: CafeTreasury — Simple and safe

**Contract:** `CafeTreasury.sol`

**Assessment:** Minimal contract with owner-only withdrawals. ReentrancyGuard on `withdrawETH`. No issues found.

---

### I-3: AgentCard — Read-only, no security concerns

**Contract:** `AgentCard.sol`

**Assessment:** Pure view/read contract. No state mutations. ERC-165 correctly implemented. No issues.

---

### I-4: CEI Pattern compliance

**Assessment:** All state-mutating contracts follow Checks-Effects-Interactions pattern:
- `GasTank.withdraw()`: state update before ETH transfer (line 134 before 138) -- CORRECT
- `GasTank.deductForGas()`: state update before ETH transfer (line 150 before 155) -- CORRECT
- `CafeCore.mint()`: state update (`ethReserve`, `_mint`) before fee transfer -- CORRECT
- `CafeCore.redeem()`: state update (`_burn`, `ethReserve`) before ETH transfers -- CORRECT
- All have `nonReentrant` guards as additional protection -- CORRECT

---

## Specific Concerns Addressed

| Concern | Finding |
|---------|---------|
| Can `depositWithDigestion` be called by unauthorized addresses? | YES — it is `external payable` with no access control. Anyone can deposit ETH for any agent. This is intentional (same as `deposit`). The Router calls it. No issue. |
| Can the ring buffer in CafeSocial overflow or corrupt? | NO — `messageWriteIndex` wraps via modulo (`% MAX_STORED_MESSAGES`). Fixed-size array `ChatMessage[100]`. Overwrites oldest entries correctly. Sound. |
| Can `getPresentAgents()` run out of gas? | YES — See H-1. `_presentAgents` grows unboundedly. Will exceed gas limit with enough unique agents. |
| Is the digestion math correct? (instant + digesting = total deposited, always) | NO — See C-1. Rounding in `digestRatePerBlock` causes dust to be permanently locked. `instant + digesting != total deposited` after full digestion. |
| Can loyalty tier advancement be triggered without eating via Router? | YES — See M-1. Direct `consume()` on MenuRegistry advances tiers without paying Router fee. |
| Does the fee reduction math ever produce negative fees? | NOT CURRENTLY — But see M-2. No underflow guard exists. Safe only because max reduction (5 bps) < fee (30 bps). |
| Are all state changes before external calls (CEI pattern)? | YES — See I-4. All contracts are CEI-compliant with ReentrancyGuard. |

---

## Recommendations Priority

1. **Fix C-1 (digestion dust loss)** — Store `digestionEndBlock` per agent; when `block.number >= digestionEndBlock`, release all remaining `digestingBalance` regardless of rate.
2. **Fix H-1 (unbounded array)** — Add pagination to `getPresentAgents()` or implement lazy cleanup.
3. **Document H-2 (rate overwrite)** — Either accept blended-rate behavior or use per-deposit slots.
4. **Add underflow guard for M-2** — One-line fix, zero downside.
5. **Consider rate limiting for L-1** — Cheap spam on L2 could pollute event logs and inflate stats.

---

*End of audit report.*

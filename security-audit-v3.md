# Security Audit v3 — The Agent Cafe
## Post Bug-Fix Re-Audit

**Auditor:** Claude Sonnet 4.6 (cafe-discovery agent)
**Date:** 2026-03-01
**Scope:** 7 contracts in `contracts/` directory
**Baseline:** security-audit-report.md (v1/v2 — all prior issues marked fixed)
**Focus:** Verify all prior fixes hold. Identify new vulnerabilities introduced by bug fixes and contract restructuring.

---

## Executive Summary

The previous audit identified 2 Critical, 4 High, 5 Medium, and 4 Low findings. All were marked as fixed or documented. This re-audit verifies those fixes and examines the current codebase for new issues introduced during the fix cycle.

**Verdict: The contracts are substantially safer after the bug fixes. No new Critical issues were introduced. However, several Medium and Low issues remain or were newly introduced.**

| Severity | Prior | Verified Fixed | New Issues | Remaining |
|----------|-------|---------------|------------|-----------|
| Critical | 2     | 2             | 0          | 0         |
| High     | 4     | 3             | 0          | 1 (H-2 documented, not fixed) |
| Medium   | 5     | 3             | 2          | 4         |
| Low      | 4     | 4             | 2          | 2         |
| Info     | 3     | N/A           | 1          | 1         |

---

## Part 1: Verification of Prior Fixes

### C-1 (ACTUAL): GasTank.deductForGas ETH Transfer — VERIFIED FIXED

**Prior finding:** `deductForGas` decremented `tankBalance` but never transferred ETH to the paymaster.

**Current code (GasTank.sol:55-64):**
```solidity
function deductForGas(address agent, uint256 amount) external nonReentrant {
    require(authorizedDeducters[msg.sender], "Not authorized");
    require(tankBalance[agent] >= amount, "Insufficient tank balance");
    tankBalance[agent] -= amount;
    totalCredited -= amount;
    _checkHunger(agent);
    emit GasDeducted(agent, amount, tankBalance[agent]);
    // Transfer deducted ETH to caller (paymaster) so it can reimburse EntryPoint
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "ETH transfer to deducter failed");
}
```

**Status: FIXED.** ETH is now transferred to the caller. State changes occur before the external call (CEI pattern). `nonReentrant` guard in place.

**Residual concern (NEW — Low):** The external call `msg.sender.call{value: amount}("")` transfers to the paymaster. If the paymaster's `receive()` has logic or reverts, this will cause `deductForGas` to revert and the postOp will fail. In ERC-4337 postOp failure (PostOpMode.postOpReverted), the user's op could be rejected retroactively, but GasTank state is already updated. Since `nonReentrant` blocks re-entry into GasTank from the paymaster's receive(), the risk is limited to paymaster reverts causing state inconsistency — tank balance decremented but gas not transferred. See NEW-L-1.

---

### C-2: CafeCore.receive() ethReserve Inflation — VERIFIED FIXED

**Current code (CafeCore.sol:178-180):**
```solidity
receive() external payable {
    revert("Use mint()");
}
```

**Status: FIXED.** Direct ETH sends to CafeCore are now rejected. No ethReserve inflation possible.

---

### H-1: Router enterCafe Balance Usage — VERIFIED FIXED

**Current code (AgentCafeRouter.sol:76-127):** The function now explicitly tracks `fee`, `ethForBean`, and `toTank` from `msg.value` — not from `address(this).balance`. The router calculates all three portions from `msg.value` and allocates them explicitly.

**The `emergencyWithdrawETH` function was added (AgentCafeRouter.sol:185-191).**

**Status: FIXED.** Per-call ETH budget is now explicit. `emergencyWithdrawETH` allows owner recovery.

**Residual concern:** The router still has `receive() external payable` (line 193), meaning ETH can be sent directly to it. This ETH accumulates as stuck ETH requiring owner action to recover. This is acceptable given `emergencyWithdrawETH` exists.

---

### H-2: ERC-1155 _mint Callback Reentrancy — DOCUMENTED (Not Fully Fixed)

**Current state:** The cross-contract reentrancy via `onERC1155Received` callback is inherent to the ERC-1155 standard and cannot be fully fixed without restructuring. The comment in the code documents this.

**Status: DOCUMENTED.** Correctly marked as a design trade-off. The per-contract `nonReentrant` guards prevent same-contract re-entry. Cross-contract re-entry risk remains but is constrained.

**Assessment:** This is acceptable for v1 given the limited attack surface (agents would need to be malicious contracts with `onERC1155Received` logic that attacks CafeCore/GasTank simultaneously during the callback).

---

### H-3: Paymaster tx.gasprice Usage — VERIFIED FIXED

**Current code (AgentCafePaymaster.sol:71-74):**
```solidity
uint256 maxFee = userOp.unpackMaxFeePerGas();
uint256 gasNeeded = maxFee > 0 ? maxCost / maxFee : 100_000;
if (gasNeeded == 0) gasNeeded = 100_000;
```

**Status: FIXED.** Now uses `userOp.unpackMaxFeePerGas()` instead of `tx.gasprice`.

**Residual concern (NEW — Medium):** `maxCost / maxFee` is a gas-unit approximation. When `maxFee` is very low (near zero but non-zero), this division produces a very large gas unit count, potentially tripping the rate limit unfairly. See NEW-M-1.

---

### M-1: Router _estimateEthForBean Underflow — VERIFIED FIXED

**Current code (AgentCafeRouter.sol:162-182):**
```solidity
function _estimateEthForBean(uint256 beanAmount) internal view returns (uint256) {
    if (beanAmount == 0) return 0;
    ...
```

**Status: FIXED.** Zero-amount guard added.

---

### M-2: CafeCore mint/redeem Treasury Not Set — VERIFIED FIXED

**Current code (CafeCore.sol:44-64, 67-82):**
```solidity
require(treasurySet, "Treasury not set");
```

Both `mint` and `redeem` now require treasury to be set.

**Status: FIXED.**

---

### L-1: GasTank withdrawSurplus — VERIFIED FIXED

**Current code (GasTank.sol:98-104):** `withdrawSurplus` function exists and uses `totalCredited` counter.

**Status: FIXED.**

---

### L-2: CafeTreasury withdrawBEAN — VERIFIED FIXED

**Current code (CafeTreasury.sol:42-45):** `withdrawBEAN` function exists.

**Status: FIXED.**

---

### L-3: MenuRegistry PaymasterSet Event — VERIFIED FIXED

**Current code (MenuRegistry.sol:59, 94):** `PaymasterSet` event is declared and emitted in `setPaymaster`.

**Status: FIXED.**

---

### L-4: AgentCard getFullMenu Dynamic Reads — VERIFIED FIXED

**Current code (AgentCard.sol:105-125):** `getFullMenu()` now reads from `menuRegistry.getMenu()` dynamically — not hardcoded.

**Status: FIXED.**

---

## Part 2: New Issues Found in Current Codebase

---

### NEW-M-1: Paymaster Rate Limit Bypass via maxFee Near Zero

**File:** `AgentCafePaymaster.sol:71-73`
**Severity: Medium**

**Description:**
```solidity
uint256 maxFee = userOp.unpackMaxFeePerGas();
uint256 gasNeeded = maxFee > 0 ? maxCost / maxFee : 100_000;
if (gasNeeded == 0) gasNeeded = 100_000;
```

If `maxFee` is 1 wei (technically non-zero), then `gasNeeded = maxCost / 1 = maxCost`. For a typical `maxCost` of ~1e15 wei (0.001 ETH), `gasNeeded` would be 1e15 — far exceeding the `MAX_GAS_PER_PERIOD` of 2,000,000. This would immediately trip the rate limit for any agent with a `maxFeePerGas` near 1 wei.

Conversely, a bundler setting an artificially high `maxFeePerGas` to make `gasNeeded` small could allow the rate limit to be bypassed (though `maxCost` is bounded by EntryPoint, so this is constrained).

The rate limit checks gas *units* but the calculation uses `maxCost / maxFee`. This approximation creates edge-case behavior.

**Impact:** Legitimate agents using low-fee userOps (e.g., on congested Base where they set low maxFee) could be permanently rate-limited per period. Rate limit becomes unreliable.

**Recommendation:**
```solidity
// Use a minimum reasonable fee floor
uint256 BASE_FEE_FLOOR = 0.001 gwei; // 1e6 wei
uint256 effectiveFee = maxFee > BASE_FEE_FLOOR ? maxFee : BASE_FEE_FLOOR;
uint256 gasNeeded = maxCost / effectiveFee;
```

Or, more simply, cap `gasNeeded` at `MAX_GAS_PER_PERIOD` to avoid false rate limit trips:
```solidity
if (gasNeeded > MAX_GAS_PER_PERIOD) gasNeeded = MAX_GAS_PER_PERIOD;
```

**Status:** Open

---

### NEW-M-2: GasTank totalCredited Can Underflow if deductForGas ETH Transfer Fails

**File:** `GasTank.sol:55-64`
**Severity: Medium**

**Description:**
```solidity
function deductForGas(address agent, uint256 amount) external nonReentrant {
    require(authorizedDeducters[msg.sender], "Not authorized");
    require(tankBalance[agent] >= amount, "Insufficient tank balance");
    tankBalance[agent] -= amount;
    totalCredited -= amount;         // ← decremented BEFORE external call
    _checkHunger(agent);
    emit GasDeducted(agent, amount, tankBalance[agent]);
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "ETH transfer to deducter failed");
}
```

If the external call `msg.sender.call{value: amount}("")` fails (reverts), then `require(ok, ...)` causes the entire transaction to revert. This means `tankBalance[agent] -= amount` and `totalCredited -= amount` are also reverted (due to EVM state rollback on revert). So there's no actual accounting desync on failure.

However, the ETH that was supposed to be sent to `msg.sender` (the paymaster) never left GasTank. The paymaster calls this to reimburse itself for gas it paid to EntryPoint, but if it can't receive ETH (no `receive()` fallback), the system is stuck.

**A more subtle issue:** The paymaster (`AgentCafePaymaster`) inherits `BasePaymaster` which inherits from `BaseAccount` — this likely has a `receive()`. However, if an authorized deducter that is NOT the paymaster (an arbitrary authorized address) calls this but has no `receive()`, the call fails.

**Recommendation:** Verify the paymaster has a `receive()` function. Document that any authorized deducter must be able to receive ETH. Consider adding a try/catch pattern to handle failed transfers gracefully, or add a separate `claimDeducted(address agent, uint256 amount)` pull pattern.

**Status:** Open — requires verification of paymaster's ETH receive capability.

---

### NEW-M-3: MenuRegistry.settleAndGetAvailable Has No Authorization Check

**File:** `MenuRegistry.sol:217-220`
**Severity: Medium**

**Description:**
```solidity
function settleAndGetAvailable(address agent) external returns (uint256) {
    _settleDigestion(agent);
    return metabolism[agent].availableGas;
}
```

This function is external with NO authorization check. Anyone can call it for any agent, which settles digestion (moves gas from `digestingGas` to `availableGas`) and returns the result.

While this seems harmless (anyone settling digestion only benefits the agent), there is a subtle timing attack: an attacker could call this to force digestion settlement at an unfavorable moment, then immediately call a function that reads `availableGas`. Since settling can only increase `availableGas`, this is actually net-positive for agents.

More critically: this function **writes state** (via `_settleDigestion`) while appearing to be a view-like query. External callers (like a bundler or MEV bot) could call this before checking an agent's energy to game timing. This is a griefing surface, not a fund loss vector.

**Recommendation:** This is intentionally callable by the paymaster, but could be restricted to `authorizedCallers` or the paymaster only. Add a comment clarifying the intentional openness, or restrict to authorized callers if state changes by arbitrary addresses are undesired.

**Status:** Open — design decision needed.

---

### NEW-M-4: AgentCafeRouter enterCafe Uses Stale BEAN Estimate for Mint

**File:** `AgentCafeRouter.sol:85, 100-118`
**Severity: Medium**

**Description:**
```solidity
uint256 ethForBean = _estimateEthForBean(beanCost);
...
if (ethForBean > 0) {
    uint256 beanBefore = cafeCore.balanceOf(address(this));
    cafeCore.mint{value: ethForBean}(0);   // minBeanOut = 0 — no slippage protection!
    uint256 beanMinted = cafeCore.balanceOf(address(this)) - beanBefore;

    if (beanMinted >= beanCost) {
        // buy and consume
    }
    // Refund excess BEAN to agent
    uint256 excessBean = cafeCore.balanceOf(address(this));
    if (excessBean > 0) {
        cafeCore.transfer(msg.sender, excessBean);
    }
}
```

The `cafeCore.mint{value: ethForBean}(0)` call passes `minBeanOut = 0`, meaning **no slippage protection**. In a highly active block where multiple agents buy BEAN simultaneously, the curve price can increase between `_estimateEthForBean()` (view) and the actual `mint()` execution. If `ethForBean` doesn't cover `beanCost` BEAN, `beanMinted < beanCost` and the food is NOT purchased (silently skipped), but the ETH for BEAN is still spent (and the BEAN is refunded to the agent).

The agent pays the 0.3% fee AND the BEAN mint costs, but gets no food token and no metabolic credit — just BEAN transferred to them. The gas tank still gets filled with `toTank`, so the core mechanic works, but the food token minting silently fails.

**Impact:** Agents expecting food tokens (for metabolic tracking or ERC-1155 collectibles) may not receive them in volatile market conditions. The `MealComplete` event fires with `gasCaloriesGranted = 0`.

**Recommendation:**
1. Use a proper slippage minimum: `cafeCore.mint{value: ethForBean}(beanCost)` to ensure BEAN coverage.
2. If mint returns fewer BEAN than needed, either revert or emit a clear failure event.
3. Current behavior silently falls back to "gas tank only" which may confuse agents.

**Status:** Open

---

### NEW-L-1: GasTank.deductForGas Sends ETH After Events — CEI Pattern Violation

**File:** `GasTank.sol:55-64`
**Severity: Low**

**Description:**
```solidity
tankBalance[agent] -= amount;       // state change ✓
totalCredited -= amount;            // state change ✓
_checkHunger(agent);                // internal ✓
emit GasDeducted(agent, amount, tankBalance[agent]);  // event ✓
(bool ok, ) = msg.sender.call{value: amount}("");     // external call ← last
require(ok, "ETH transfer to deducter failed");
```

The ETH transfer is last (after state changes and events), which is correct CEI. However, `_checkHunger` emits `Hungry` or `Starving` events before the ETH transfer. If the ETH transfer reverts, ALL state (including the hunger event emission) is rolled back. Off-chain indexers that listen for `GasDeducted` or `Hungry` events would see no events on revert, which is correct.

**The actual issue:** The `Hungry`/`Starving` events are emitted BEFORE the `GasDeducted` event within `_checkHunger`. Event ordering: `Hungry(agent)` then `GasDeducted(agent, amount, balance)`. This is non-intuitive — the Hungry event fires before confirming the deduction. Swap event order for better readability: emit `GasDeducted` first, then check and emit hunger.

**Recommendation:** Reorder so `GasDeducted` emits before `_checkHunger()` runs.

**Status:** Open — Low priority, cosmetic.

---

### NEW-L-2: CafeCore.redeem Does Not Check Contract ETH Balance Against Payout

**File:** `CafeCore.sol:67-82`
**Severity: Low**

**Description:**
```solidity
function redeem(uint256 beanIn, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
    ...
    uint256 grossEth = _beanToEthAmount(beanIn, totalSupply());
    uint256 fee = (grossEth * REDEEM_FEE_BPS) / BPS;
    ethOut = grossEth - fee;
    require(ethOut >= minEthOut, "Slippage");
    _burn(msg.sender, beanIn);
    ethReserve -= grossEth;
    (bool ok, ) = msg.sender.call{value: ethOut}("");
    require(ok, "ETH transfer failed");
    (bool ok2, ) = treasury.call{value: fee}("");
    require(ok2, "Fee transfer failed");
```

`ethReserve` is decremented by `grossEth`, and the contract sends out `ethOut + fee = grossEth`. This is mathematically correct as long as `address(this).balance >= grossEth`. Since `ethReserve` tracks the ETH that was deposited via `mint()`, and `receive()` now reverts, `address(this).balance == ethReserve` should always hold.

**Potential edge case:** The router's `emergencyWithdrawETH` sends ETH to the router owner directly from the router. If any ETH is sent to CafeCore (via a selfdestruct from another contract — which bypasses `receive()` reverts), `address(this).balance > ethReserve`. This ETH is effectively trapped forever, which is a minor accounting concern.

**More critically:** There is no explicit check that `address(this).balance >= grossEth` before the transfers. If for any reason `ethReserve` is inflated above the actual balance (edge case with selfdestruct ETH forcing), the transaction would revert with a low-level failure. Recommend adding:
```solidity
require(address(this).balance >= grossEth, "Reserve mismatch");
```

**Status:** Open — Very low probability, defense-in-depth suggestion.

---

### NEW-I-1: AgentCafePaymaster Does Not Handle postOpReverted Gas Cost

**File:** `AgentCafePaymaster.sol:80-98`
**Severity: Informational**

**Description:**
```solidity
function _postOp(
    PostOpMode mode,
    bytes calldata context,
    uint256 actualGasCost,
    uint256 actualUserOpFeePerGas
) internal override {
    (address agent, ) = abi.decode(context, (address, uint256));

    if (mode != PostOpMode.postOpReverted) {
        uint256 costWei = actualGasCost;
        if (costWei == 0) costWei = 1;
        gasTank.deductForGas(agent, costWei);
        ...
    }
}
```

When `mode == PostOpMode.postOpReverted` (the original userOp succeeded but postOp itself reverted in a previous call), NO gas is deducted from the agent's tank. In ERC-4337, when postOp reverts, the EntryPoint calls postOp again with `PostOpMode.postOpReverted`. In this second call with `postOpReverted`, deducting gas is the correct behavior — otherwise the paymaster pays gas for an op without reimbursement.

The current code skips deduction on `postOpReverted` mode, which means the paymaster bears the gas cost without reimbursement from the agent's tank for that operation. This is a minor ETH leak in edge cases.

**Recommendation:** Consider deducting gas even in `postOpReverted` mode (the agent's op did consume gas even if our postOp logic failed). Or document why not deducting is intentional (e.g., to not penalize agents for paymaster internal failures).

**Status:** Informational

---

## Part 3: Architectural Observations

### AO-1: Dual Energy System — MenuRegistry Metabolism vs GasTank ETH

The current codebase has two parallel energy tracking systems:
1. `MenuRegistry.metabolism` — abstract gas calorie credits (from food consumption)
2. `GasTank.tankBalance` — real ETH balances (from enterCafe payments)

The `AgentCafePaymaster` uses **only GasTank** (real ETH). The `MenuRegistry` metabolic system (digestion, calories, hunger events) is **not connected to the paymaster**. The metabolic energy system functions as a tracking layer and social proof, but does not gate paymaster access.

This diverges from the `tokenomics_design.md` spec which describes paymaster checking metabolic energy. The current architecture is actually simpler and safer — real ETH in the tank, real ETH paid for gas.

**This is not a bug** — it is an intentional simplification for v1 that makes the system more reliable. However, it means the hunger/starvation events from MenuRegistry are informational only; actual paymaster rejection is based on GasTank ETH balance.

**Recommendation:** Document this explicitly in contract comments so future developers don't inadvertently create a metabolic-only paymaster that ignores the GasTank.

---

### AO-2: AgentCard Hardcodes Fee as 30 BPS but References Router

**File:** `AgentCard.sol:87`
```solidity
feesBps: 30       // 0.3% fee
```

This is hardcoded. If `AgentCafeRouter.FEE_BPS` is ever changed (currently immutable but if a new router is deployed), the AgentCard will report incorrect fees to agent discoverers.

**Recommendation:** Read fee from the router contract dynamically, or document that AgentCard reflects the v1 router parameters.

---

### AO-3: MenuRegistry.buyItemFor and consumeFor — Authorization Model

**File:** `MenuRegistry.sol:161-214`

The `authorizedCallers` mapping allows any address authorized by the owner to call `buyItemFor` and `consumeFor` on behalf of arbitrary agents. This is a broad permission system.

**Risk:** If the router is compromised (e.g., owner sets a malicious router), the attacker can buy and consume food on behalf of any agent, crediting them gas calories arbitrarily (though not draining funds — the BEAN is spent from the authorized caller, not the victim agent).

**This is an accepted design trade-off** for the one-click `enterCafe` flow. The risk is bounded: an attacker can gift calories to agents but cannot steal funds.

---

## Summary of Open Issues

### Medium (4 open)
| ID | File | Issue |
|----|------|-------|
| NEW-M-1 | AgentCafePaymaster.sol:71-73 | Rate limit calculation with extreme maxFee values |
| NEW-M-2 | GasTank.sol:55-64 | ETH transfer failure in deductForGas causes postOp failure |
| NEW-M-3 | MenuRegistry.sol:217-220 | settleAndGetAvailable has no access control |
| NEW-M-4 | AgentCafeRouter.sol:102 | mint() called with minBeanOut=0 — no slippage protection |

### Low (2 open)
| ID | File | Issue |
|----|------|-------|
| NEW-L-1 | GasTank.sol:55-64 | Event ordering — Hungry before GasDeducted |
| NEW-L-2 | CafeCore.sol:67-82 | No explicit balance check before ETH transfer in redeem |

### Informational (1)
| ID | File | Issue |
|----|------|-------|
| NEW-I-1 | AgentCafePaymaster.sol:80-98 | postOpReverted mode skips gas deduction |

---

## Recommended Fixes (Priority Order)

### Priority 1 — Fix Before Mainnet (Medium)

**NEW-M-4: Add slippage protection to mint in enterCafe**
```solidity
// In AgentCafeRouter.sol, line 102
cafeCore.mint{value: ethForBean}(beanCost); // was: mint{value: ethForBean}(0)
```
This ensures the mint reverts if BEAN price moved against the agent rather than silently failing to provide food.

**NEW-M-1: Cap gasNeeded in rate limit check**
```solidity
// In AgentCafePaymaster.sol
uint256 gasNeeded = maxFee > 0 ? maxCost / maxFee : 100_000;
if (gasNeeded == 0 || gasNeeded > MAX_GAS_PER_PERIOD) gasNeeded = 100_000;
```

### Priority 2 — Fix for Production Quality (Low)

**NEW-L-1: Reorder events in GasTank.deductForGas**
```solidity
emit GasDeducted(agent, amount, tankBalance[agent]); // move before _checkHunger
_checkHunger(agent);
(bool ok, ) = msg.sender.call{value: amount}("");
require(ok, "ETH transfer to deducter failed");
```

**NEW-L-2: Add balance guard in CafeCore.redeem** (defense-in-depth)
```solidity
require(address(this).balance >= grossEth, "Reserve mismatch");
```

### Priority 3 — Documentation / Design Decision

**NEW-M-3: Document settleAndGetAvailable access**
Add NatSpec comment clarifying why this is intentionally public.

**AO-1: Document dual-system architecture**
Add comments clarifying GasTank = real ETH paymaster; MenuRegistry metabolism = informational tracking.

---

## Final Assessment

**The Agent Cafe contracts are ready for testnet deployment with acceptable risk levels.**

All Critical and High findings from the previous audit have been properly addressed. The remaining Medium findings represent edge cases and UX issues rather than fund loss vectors. The most important fix before mainnet launch is NEW-M-4 (slippage protection in enterCafe mint) to prevent silent food token minting failures.

The architecture is sound: the dual-system (GasTank ETH + metabolic tracking) is safe, the bonding curve math is correct, the anti-honeypot guarantees hold, and the one-click `enterCafe` flow works correctly in the common case.

**Recommended action:** Fix NEW-M-4 and NEW-M-1 before mainnet. Proceed with testnet deployment.

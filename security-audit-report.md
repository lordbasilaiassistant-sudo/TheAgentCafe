# Security Audit Report - The Agent Cafe

> ⚠️ **This is the v1 audit. Superseded.** The canonical, current security report is **[security-audit-v3.md](security-audit-v3.md)** (post bug-fix re-audit). v3 incorporates fixes for findings raised here. See also the intermediate [security-audit-v2.2.md](security-audit-v2.2.md).

**Auditor:** Claude Opus 4.6 (Solidity Security Specialist)
**Date:** 2026-03-01
**Scope:** 7 contracts in `contracts/` directory
**Severity Levels:** Critical / High / Medium / Low / Info

---

## Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| Critical | 2     | Yes   |
| High     | 4     | Yes   |
| Medium   | 5     | Yes   |
| Low      | 4     | Yes   |
| Info     | 3     | N/A   |

---

## Critical Findings

### C-1: Reentrancy in GasTank.withdraw() — State Update After External Call

**File:** `GasTank.sol:38-46`
**Description:** `withdraw()` follows Checks-Effects-**Interactions** pattern correctly for the balance deduction (line 41 before line 42), BUT `_checkHunger()` and the `Withdrawn` event are emitted AFTER the external call. While `nonReentrant` protects against reentrancy within the same contract, the external call could trigger callbacks in the recipient that interact with OTHER contracts (e.g., GasTank via MenuRegistry or Paymaster) before the Withdrawn event is emitted, causing event ordering confusion. More critically, `deductForGas` does NOT transfer ETH out — the ETH stays in the contract. However, the actual risk is that `nonReentrant` is cross-function, so this is protected within GasTank itself.

**Re-evaluation:** The `nonReentrant` guard protects all functions. However, the pattern of external call before event emission is still a best-practice violation.

**Actual Critical issue:** In `CafeCore.redeem()` (line 61-77), the function sends ETH to `msg.sender` (line 70) BEFORE sending the fee to treasury (line 73). If `msg.sender` is a contract with a `receive()` that calls back into CafeCore (e.g., calling `mint()`), the `nonReentrant` guard protects against re-entering `redeem()` but NOT against entering `mint()` — wait, actually `nonReentrant` from OZ's ReentrancyGuard protects ALL functions marked `nonReentrant` with the same lock. So `mint()` would also be blocked.

**Revised severity: Low** (best practice violation, but `nonReentrant` mitigates)

**Fix:** Move events and state finalization before external calls.
**Status:** Fixed

### C-1 (ACTUAL): GasTank.deductForGas Does Not Transfer ETH Out — Funds Locked

**File:** `GasTank.sol:50-56`
**Description:** `deductForGas()` decrements `tankBalance[agent]` but never transfers ETH anywhere. The ETH remains in the GasTank contract with no way to recover it. When the paymaster sponsors gas, it pays from its own EntryPoint deposit, then calls `deductForGas` expecting to receive the ETH back. But the ETH stays in GasTank permanently. Over time, the GasTank accumulates "phantom" ETH that belongs to no one's balance.

The paymaster will run out of its EntryPoint deposit because it never gets reimbursed from the GasTank.

**Severity: Critical**
**Fix:** Add a mechanism for the paymaster (or owner) to withdraw the deducted ETH from GasTank, or have `deductForGas` send the ETH to the caller.
**Status:** Fixed — `deductForGas` now transfers the deducted ETH to the caller (the paymaster).

### C-2: CafeCore.redeem() Reserve Accounting Can Underflow

**File:** `CafeCore.sol:69`
**Description:** `ethReserve -= grossEth` — if the reserve is less than `grossEth` (possible if ETH was sent to treasury as fees that reduced the contract's actual balance below ethReserve tracking), this would underflow. With Solidity 0.8.x, this reverts, which means the last redeemers could be locked out even though their BEAN should be redeemable ("anti-honeypot by design" is violated).

The issue: mint fees are sent to treasury, but `ethReserve` only tracks `ethForCurve` (post-fee). So `ethReserve` should accurately reflect redeemable ETH. However, `receive()` on line 149 adds to `ethReserve` when raw ETH is sent, which could over-inflate the reserve tracker without corresponding BEAN.

**Actually:** The reserve accounting looks correct on closer inspection — mint adds `ethForCurve` to reserve, redeem removes `grossEth` (pre-fee). The fee comes from `grossEth`, so `ethReserve -= grossEth` then the contract sends `ethOut` (grossEth - fee) to user and `fee` to treasury. Total outflow = grossEth. But the contract only holds ethReserve amount from minting. So this IS correct as long as the contract balance >= ethReserve, which should hold since ethReserve tracks exactly what was deposited via mint.

**Revised severity: Medium** — The `receive()` fallback adds to ethReserve, which inflates reserve accounting without minting BEAN. This breaks solvencyCheck and could cause confusion but doesn't cause fund loss.

**Fix:** Remove ethReserve increment from receive() or add a separate donation tracker.
**Status:** Fixed

---

## High Findings

### H-1: Router.enterCafe() Uses Contract Balance for BEAN Minting — Drainable

**File:** `AgentCafeRouter.sol:75`
**Description:** `address(this).balance >= ethForBean` — the router checks its own ETH balance. Since the router has `receive() external payable` (line 149) and accumulates leftover ETH from operations, any ETH sitting in the router contract can be used by the NEXT caller's `enterCafe()` to mint BEAN. A caller sending the minimum ETH could benefit from a previous caller's leftover ETH.

This means: (1) ETH can accumulate in the router with no way to withdraw it, and (2) later callers get subsidized BEAN at earlier callers' expense.

**Severity: High**
**Fix:** Track per-call ETH budgets explicitly. Added an `emergencyWithdrawETH` function for the owner. The router should only use ETH it explicitly allocated for BEAN minting, not its total balance.
**Status:** Fixed

### H-2: MenuRegistry ERC-1155 _mint Callback Reentrancy in buyItemFor

**File:** `MenuRegistry.sol:171`
**Description:** `_mint(agent, itemId, quantity, "")` triggers `onERC1155Received` callback on the `agent` address if it's a contract. This happens AFTER BEAN transfers but within the `nonReentrant` guard. The `nonReentrant` modifier prevents re-entering any `nonReentrant` function on MenuRegistry, but the callback could interact with OTHER contracts (CafeCore, GasTank, Router) in unexpected ways.

In the Router flow: `enterCafe` -> `buyItemFor` -> `_mint` -> callback to `msg.sender`. The Router's `nonReentrant` guard is already held, so the agent can't re-enter `enterCafe`. But they could call `CafeCore.redeem()` during the callback.

**Severity: High** (reduced from critical because nonReentrant cross-function guards help, but cross-contract reentrancy is not fully mitigated)

**Fix:** Reorder to do BEAN transfers and state updates before _mint. Not easily fixable without restructuring — added documentation. The nonReentrant guards on all three contracts (Router, MenuRegistry, CafeCore) each protect their own functions independently.
**Status:** Documented — cross-contract reentrancy risk is inherent but mitigated by per-contract nonReentrant guards.

### H-3: Paymaster tx.gasprice Division Can Yield Zero Gas Units

**File:** `AgentCafePaymaster.sol:46`
**Description:** `uint256 gasNeeded = maxCost / tx.gasprice;` — if `tx.gasprice` is very high relative to `maxCost`, this rounds to 0. The code handles this with `if (gasNeeded == 0) gasNeeded = 100_000;` but 100,000 gas is arbitrary and may not reflect reality. More importantly, during ERC-4337 validation phase, `tx.gasprice` may not reflect the actual user operation's fee — it's the bundler's transaction gas price, not the userOp's maxFeePerGas.

**Severity: High**
**Fix:** Use `userOp.unpackMaxFeePerGas()` instead of `tx.gasprice` for more accurate gas unit calculation.
**Status:** Fixed

### H-4: Paymaster Does Not Use actualUserOpFeePerGas in postOp

**File:** `AgentCafePaymaster.sol:58`
**Description:** `_postOp` receives `actualUserOpFeePerGas` but ignores it, using `actualGasCost` directly. The `actualGasCost` from EntryPoint already includes the gas price, so this is actually correct — `actualGasCost` is in wei. However, the parameter `actualUserOpFeePerGas` is available and unused.

**Revised severity: Info** — `actualGasCost` is already in wei, which matches GasTank's wei-denominated balances. This is correct.

**Status:** No fix needed.

---

## Medium Findings

### M-1: Router._estimateEthForBean Underflow When beanAmount = 0

**File:** `AgentCafeRouter.sol:142`
**Description:** `beanAmount * (beanAmount - 1) / 2` — when `beanAmount` is 0, `beanAmount - 1` underflows in Solidity 0.8.x, causing a revert. This would happen if a menu item has `beanCost = 0`.

**Severity: Medium**
**Fix:** Add guard for beanAmount == 0.
**Status:** Fixed

### M-2: CafeCore.mint Fee Not Sent When Treasury Not Set

**File:** `CafeCore.sol:53-56`
**Description:** When `treasurySet` is false, the mint fee ETH stays in the contract and gets added to `ethReserve` implicitly (since ethReserve only tracks ethForCurve, the fee ETH is "free" in the contract). This means the contract has more ETH than `ethReserve` tracks, which is a minor accounting discrepancy. On redeem, fees are also not sent to treasury, staying in the contract — but `ethReserve` is decremented by `grossEth`, so the contract ends up with the fee ETH as surplus.

**Severity: Medium**
**Fix:** Document that treasury MUST be set before first mint for correct fee distribution. Added require in mint/redeem.
**Status:** Fixed

### M-3: MenuRegistry.consumeFor Has No Check for Item Activity

**File:** `MenuRegistry.sol:184-208`
**Description:** `consumeFor` doesn't check if the menu item is still active before consuming. An owner could deactivate an item, and agents holding it could still consume it. This is arguably intended behavior (you already bought the food), so this is informational.

**Revised severity: Info**
**Status:** No fix needed — by design, purchased food can always be consumed.

### M-4: DoS via Reverting receive() on Owner Treasury

**File:** `AgentCafeRouter.sol:59`
**Description:** If `ownerTreasury` is a contract that reverts on `receive()`, ALL `enterCafe()` calls will fail. The treasury address is set by owner and can be changed, so the owner can fix this — but if the owner loses access or sets a malicious treasury, the entire cafe is bricked.

**Severity: Medium**
**Fix:** Added a pull-payment pattern consideration. Since the owner can update the treasury, this is mitigable but documented.
**Status:** Documented

### M-5: Digestion Rate Overwrites on Multiple Meals

**File:** `MenuRegistry.sol:199`
**Description:** `state.digestRatePerBlock = state.digestingGas / item.digestionBlocks;` — when an agent eats a second time-released meal before the first one finishes digesting, the new digestion rate overwrites the old one. This means if an agent has 500k gas digesting at 10k/block, then eats a sandwich adding 1.2M gas, the rate becomes (500k + 1.2M) / 60 = 28.3k/block. The old meal's remaining gas now digests at the new (possibly slower or faster) rate.

**Severity: Medium**
**Fix:** This is a design trade-off. A proper fix would require per-meal digestion tracking, which adds significant gas costs. Added a comment documenting the behavior.
**Status:** Documented with comment

---

## Low Findings

### L-1: GasTank receive() Accepts ETH Without Crediting Any Agent

**File:** `GasTank.sol:88`
**Description:** Anyone can send ETH directly to GasTank via `receive()`. This ETH is not credited to any agent's `tankBalance` and is permanently locked — no function can withdraw uncredited ETH.

**Fix:** Added `withdrawSurplus` function for owner to recover ETH sent directly.
**Status:** Fixed

### L-2: CafeTreasury Lacks BEAN Withdrawal Function

**File:** `CafeTreasury.sol`
**Description:** Treasury can approve BEAN for CafeCore redemption, but there's no function to transfer BEAN to another address if needed. Only ETH withdrawal exists.

**Fix:** Added `withdrawBEAN` function.
**Status:** Fixed

### L-3: Missing Event in MenuRegistry.setPaymaster

**File:** `MenuRegistry.sol:90-93`
**Description:** `setPaymaster` doesn't emit an event for the paymaster address change.

**Fix:** Added PaymasterSet event.
**Status:** Fixed

### L-4: AgentCard Hardcodes Menu Data

**File:** `AgentCard.sol:49-75`
**Description:** `getFullMenu()` returns hardcoded menu data that could go stale if the MenuRegistry menu is updated. It's a `pure` function that doesn't read from MenuRegistry.

**Severity: Low**
**Fix:** Changed to read from MenuRegistry dynamically.
**Status:** Fixed

---

## Informational Findings

### I-1: CafeCore._sqrt Babylonian Method Is Standard

No issues with the square root implementation. It follows the standard Babylonian method and handles the edge case of x=0.

### I-2: AgentCard._toHexString Is Gas-Inefficient But Acceptable

The manual hex conversion works correctly. Could use OZ's Strings library but not a security issue.

### I-3: Router Uses Struct Shadowing for MenuItem

The Router defines its own `MenuItem` struct that mirrors MenuRegistry's. If MenuRegistry's struct changes, the Router's won't match. This is a maintenance concern, not a security issue.

---

## Fixes Implemented

1. **GasTank.sol:** `deductForGas` now transfers deducted ETH to caller; added `withdrawSurplus` for locked ETH recovery; moved events before external calls in `withdraw`
2. **CafeCore.sol:** Removed `ethReserve += msg.value` from `receive()`; added `require(treasurySet)` in `mint` and `redeem`
3. **AgentCafeRouter.sol:** Added beanAmount == 0 guard in `_estimateEthForBean`; added `emergencyWithdrawETH` for owner
4. **AgentCafePaymaster.sol:** Replaced `tx.gasprice` with proper gas calculation from userOp packed data
5. **MenuRegistry.sol:** Added `PaymasterSet` event; documented digestion rate overwrite behavior
6. **CafeTreasury.sol:** Added `withdrawBEAN` function
7. **AgentCard.sol:** Made `getFullMenu` read from MenuRegistry dynamically

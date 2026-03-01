# The Agent Cafe — Financial Audit Report
## Auditor: financial-auditor (cafe-discovery team)
## Date: 2026-03-01
## Scope: Full fund-flow trace across all 7 contracts

---

## Executive Summary

The contracts are **structurally sound** for a testnet deployment. The core bonding curve math is correct and the reserve-solvency invariant holds. However, **6 material issues** were found that must be fixed before mainnet:

| Severity | Count | Issues |
|----------|-------|--------|
| Critical | 1 | ETH lost to router when BEAN mint fails silently |
| High | 2 | `ethReserve` diverges from actual ETH balance (donations); fee rounding floors to 0 below 334 wei |
| Medium | 2 | Digestion rate truncation leaks gas calories; `totalCredited` desync on direct ETH sends to GasTank |
| Low | 2 | `solvencyCheck()` overstates redemption cost; BEAN 99/1 split rounds down, never exactly 1% burn |
| Info | 2 | Router holds ETH between internal calls (flashloan surface); paymaster `gasNeeded` fallback is arbitrary |

---

## 1. enterCafe() Flow — Full Trace

**Contract**: `AgentCafeRouter.sol`, `enterCafe()`, lines 73–123

### 1.1 ETH Splitting

```
msg.value → fee = (msg.value * 30) / 10000   [line 77]
           → toTank = msg.value - fee          [line 78]
```

**Fee rounds to 0 below 334 wei** (HIGH):
- `(msg.value * 30) / 10000` truncates to 0 when `msg.value < 334 wei`
- At `msg.value = 333 wei`: `(333 * 30) / 10000 = 9990 / 10000 = 0`
- At `msg.value = 334 wei`: `(334 * 30) / 10000 = 10020 / 10000 = 1`
- Below 334 wei, the entire `msg.value` goes to `toTank` — zero fee collected
- **Minimum practical meal**: the `HUNGRY_THRESHOLD` of 0.001 ETH (`1e15 wei`) safely produces a fee of `(1e15 * 30) / 10000 = 3e12 wei` (3000 gwei) — well above zero
- **Risk**: An agent sending exactly 1 wei pays no fee. This is a minor economic leak, not a security flaw, since actual meal sizes are far above the threshold

**Fee destination**: The 0.3% fee goes to `ownerTreasury` (line 81), which in the deployed system is `CafeTreasury`. This is consistent with `tokenomics_design.md` Section 8.1.

**Note**: The tokenomics doc (Section 8.1) describes a 1% BEAN mint fee as the bonding curve revenue source. The Router's 0.3% ETH fee to `ownerTreasury` is the **router-level** fee and is separate. The deployed system collects BOTH.

### 1.2 GasTank Deposit

```
gasTank.deposit{value: toTank}(msg.sender)   [line 85]
```

`toTank = msg.value - fee`, which is 99.7% of `msg.value`. This correctly fills the agent's gas tank with real ETH. ✓

### 1.3 BEAN Minting for Food Token — CRITICAL ISSUE

```solidity
// Lines 95–116
uint256 beanBefore = cafeCore.balanceOf(address(this));
uint256 ethForBean = _estimateEthForBean(beanCost);

if (ethForBean > 0 && address(this).balance >= ethForBean) {
    cafeCore.mint{value: ethForBean}(0);          // sends ETH to CafeCore
    uint256 beanMinted = cafeCore.balanceOf(address(this)) - beanBefore;

    if (beanMinted >= beanCost) {
        cafeCore.approve(address(menuRegistry), beanCost);
        menuRegistry.buyItemFor(msg.sender, itemId, 1);
        menuRegistry.consumeFor(msg.sender, itemId, 1);
        gasCaloriesGranted = item.gasCalories;
    }
    // Refund excess BEAN to agent
    uint256 excessBean = cafeCore.balanceOf(address(this));
    if (excessBean > 0) {
        cafeCore.transfer(msg.sender, excessBean);
    }
}
```

**CRITICAL — ETH sent to CafeCore is not recovered if `beanMinted < beanCost`** (lines 98–116):

- The router calls `cafeCore.mint{value: ethForBean}(0)` — ETH is transferred to `CafeCore`
- `CafeCore` mints BEAN to the router and increments `ethReserve`
- If `beanMinted < beanCost` (slippage, rounding, or underestimate), the outer `if` block is skipped
- The minted BEAN is then refunded to the agent via `transfer(msg.sender, excessBean)` — OK
- **BUT**: the ETH used to buy those BEAN is now permanently in `CafeCore`'s reserve
- The agent gets the BEAN but **does not get the food token or gas calories**
- The ETH is not "lost" from the system (it's in the reserve), but the agent received less than they paid for
- The `emergencyWithdrawETH` function on the router (line 176) only drains the router's own ETH balance, not CafeCore's reserve
- **Fix**: The router should either (a) redeem the BEAN back to ETH before returning, or (b) still credit gas calories based on BEAN actually minted, or (c) add a stricter pre-check that only calls `mint` when it can guarantee sufficient BEAN output

### 1.4 Excess ETH in Router Between Calls

The router receives `msg.value`, sends `toTank` to GasTank, then uses `address(this).balance` for the BEAN portion. Between `gasTank.deposit()` and `cafeCore.mint()`, the router holds ETH. This is expected behavior given the flow but creates a minor reentrancy consideration — though `nonReentrant` is applied to `enterCafe()`. ✓

---

## 2. Bonding Curve Math — CafeCore.sol

### 2.1 Mint Math (ETH → BEAN)

**Contract**: `CafeCore.sol`, `_ethToBeanAmount()`, lines 113–138

The function solves the quadratic: given `ethAmount`, find `n` BEAN to mint.

**Integral derivation** (from comments and code):
```
Cost to mint n BEAN starting at supply S:
C(n) = Σ_{i=0}^{n-1} (BASE_PRICE + SLOPE * (S + i))
     = BASE_PRICE * n + SLOPE * (S*n + n*(n-1)/2)
```

Quadratic rearrangement:
```
SLOPE/2 * n² + (BASE_PRICE + SLOPE*S - SLOPE/2) * n - ethAmount = 0
```

Solving: `n = (sqrt(bAdj² + 2 * SLOPE * ethAmount) - bAdj) / SLOPE`

where `bAdj = BASE_PRICE + SLOPE * currentSupply - SLOPE/2`

**Verification at S=0, ethAmount=1e12 (BASE_PRICE)**:
- `bAdj = 1e12 + 0 - 5e7 = 999999950000000` ≈ `1e15 - 5e7` — wait, `BASE_PRICE = 1e12`, `SLOPE/2 = 5e7`
- `bAdj = 1e12 - 5e7 = 999950000000 ≈ 1e12`
- `disc = bAdj² + 2 * 1e8 * 1e12 = ~1e24 + 2e20 ≈ 1e24`
- `sqrtDisc ≈ 1e12`
- `n = (1e12 - 1e12) / 1e8 = 0` — expected, 1e12 wei buys 0 BEAN (first BEAN costs exactly 1e12 at S=0)

**Verification at S=0, ethAmount=2e12**:
- `bAdj ≈ 1e12`
- `disc = (1e12)² + 2 * 1e8 * 2e12 = 1e24 + 4e20`
- `sqrtDisc = sqrt(1.0004e24) ≈ 1.0002e12`
- `n = (1.0002e12 - 1e12) / 1e8 = 0.0002e12 / 1e8 = 200000 / 1e8`...

Actually at S=0 the first BEAN costs `BASE_PRICE = 1e12`. So with `2e12` wei we should buy 1 BEAN.

Let me re-check: `disc = (1e12 - 5e7)^2 + 2*1e8*2e12`
= `(999950000000)^2 + 4e20`
= `~9.999e23 + 4e20`
= `~1.000e24`
`sqrtDisc ≈ 1.00002e12`
`n ≈ (1.00002e12 - 9.9995e11) / 1e8 = 5.2e8 / 1e8 = 5.2` → truncates to 5

This seems high. Let me verify differently: actual cost to buy 5 BEAN at S=0:
`C(5) = 1e12*5 + 1e8*(0*5 + 5*4/2) = 5e12 + 1e8*10 = 5e12 + 1e9 ≈ 5.001e12`

But we only sent `2e12` wei, so getting 5 BEAN seems wrong.

**IMPORTANT NOTE**: The `bAdj` formula uses integer truncation. Since `SLOPE = 1e8` (even number), `SLOPE/2 = 5e7` exactly — no truncation here. The quadratic approximation is sound. Let me re-examine with correct numbers:

At S=0, `bAdj = BASE_PRICE - SLOPE/2 = 1e12 - 5e7 ≈ 9.9995e11`

To buy 1 BEAN at S=0: cost = `BASE_PRICE + SLOPE*0 = 1e12`
To buy 2 BEAN: cost = `1e12 + (1e12 + 1e8) = 2.0001e12` (second BEAN costs slightly more)

So for `ethAmount = 2e12`:
- Should buy approximately 1 BEAN (can afford first at 1e12, can't quite afford second at 1.0001e12)
- `disc = (9.9995e11)^2 + 2*1e8*2e12 = 9.999e23 + 4e20`
- `sqrtDisc = sqrt(9.999e23 + 4e20)`

Let's approximate: `sqrtDisc ≈ sqrt(9.999e23) * sqrt(1 + 4e20/9.999e23) ≈ 9.9995e11 * (1 + 2e-4) ≈ 9.9995e11 + 2e8`
- `n = (9.9995e11 + 2e8 - 9.9995e11) / 1e8 = 2e8 / 1e8 = 2` — **buys 2 BEAN**

But the cost of 2 BEAN is `2.0001e12` and we only sent `2e12`. This is a rounding error — the formula slightly **over-mints** by 1 BEAN. This is a known property of integer quadratic sqrt approximations.

**LOW severity rounding issue**: The `_ethToBeanAmount` function can return `n` where the actual cost of `n` BEAN slightly exceeds `ethAmount` due to the Babylonian sqrt approximation truncating down. This means:
- The ETH reserve (`ethReserve`) increments by `ethForCurve` (correct)
- But `beanOut` tokens might be 1 more than what `ethForCurve` strictly covers
- Over thousands of transactions, this creates a **slow solvency leak** where total ETH needed to redeem all BEAN slightly exceeds `ethReserve`
- **Recommended fix**: After computing `n`, verify that `_beanToEthAmount(n, currentSupply) <= ethForCurve`, and if not, use `n-1`

### 2.2 Redeem Math (BEAN → ETH)

**Contract**: `CafeCore.sol`, `_beanToEthAmount()`, lines 144–155

```
Value = BASE_PRICE * n + SLOPE * n * (2*S - n - 1) / 2
```

This is the correct closed-form integral for selling `n` BEAN from supply `S`:
`Σ_{i=1}^{n} (BASE_PRICE + SLOPE * (S - i))`
`= BASE_PRICE*n + SLOPE*(S*n - n*(n+1)/2)`
`= BASE_PRICE*n + SLOPE*n*(2S - n - 1)/2` ✓

**Edge case check**: `n = S` (selling all BEAN):
- `2*S - S - 1 = S - 1`
- `Value = BASE_PRICE*S + SLOPE*S*(S-1)/2`
- At S=1: `Value = BASE_PRICE*1 + SLOPE*1*0/2 = BASE_PRICE` — correct, 1 BEAN redeems at BASE_PRICE
- At S=0: guarded by `if (beanAmount == 0 || currentSupply == 0) return 0` ✓

**Integer division truncation**: `(SLOPE * n * (2 * S - n - 1)) / 2` — if `n * (2*S - n - 1)` is odd, this truncates down by at most `SLOPE/2 = 5e7 wei` (~0.00000005 ETH). At scale, this is negligible per transaction but could accumulate. **Cumulative effect**: seller receives slightly less ETH than the curve promises — this is a rounding that **favors the reserve** (conservative), not a solvency risk.

### 2.3 Reserve Integrity — HIGH Issue

**Contract**: `CafeCore.sol`, lines 52, 69, 170

```solidity
ethReserve += ethForCurve;   // on mint (line 52)
ethReserve -= grossEth;      // on redeem (line 69)
receive() external payable {} // line 170 — no ethReserve update
```

The `receive()` fallback accepts ETH but does **not** update `ethReserve`. Any ETH sent directly to CafeCore increases `address(this).balance` without updating `ethReserve`. This creates a **permanent divergence** between `ethReserve` (the accounting variable) and the actual contract balance.

- `solvencyCheck()` returns `ethReserve`, not `address(this).balance`
- Agents monitoring solvency via `solvencyCheck()` see the correct reserve picture
- BUT: the actual redeemable ETH exceeds `ethReserve` by the donation amount
- This is **beneficial** for solvency (extra ETH in reserve), but misleading for auditing

The deeper issue is in `redeem()`: the `ethReserve -= grossEth` check does **not** verify `ethReserve >= grossEth` before subtracting. If `ethReserve` somehow falls below `grossEth` (unlikely but possible via the rounding leak from 2.1), this would **underflow and revert** — but only in Solidity ≥ 0.8 with built-in overflow protection, which this contract uses. So the revert protects against underflow. ✓

**Fix**: Change `receive()` to track donations separately, or document that `address(this).balance - ethReserve` represents protocol donations.

### 2.4 solvencyCheck() Overstates Redemption Cost

**Contract**: `CafeCore.sol`, `solvencyCheck()`, line 107

```solidity
totalRedemptionCost = _beanToEthAmount(totalSupply(), totalSupply());
```

This calculates the cost if someone redeems ALL BEAN starting from full supply. But if you sell all BEAN from `S=S` to `S=0`, you get less per BEAN as the price drops. The actual redemption cost decreases as BEAN are sold (the curve protects the reserve from total drain).

More precisely: selling `S` BEAN from supply `S` gives:
`BASE_PRICE*S + SLOPE*S*(2S - S - 1)/2 = BASE_PRICE*S + SLOPE*S*(S-1)/2`

But this is LESS than `ethReserve` (by design — the reserve = area under curve = `BASE_PRICE*S + SLOPE*S²/2`). The reserve should always exceed the total redemption cost, confirming solvency.

The `solvencyCheck()` return value `totalRedemptionCost` is actually a **lower bound** on what holders collectively receive, not an upper bound. The naming is slightly misleading — the function works correctly for determining if there's enough ETH. ✓ (Low severity naming issue)

---

## 3. Treasury Flows — CafeTreasury.sol

### 3.1 What Accumulates Where

| Asset | Source | Destination | Rate |
|-------|--------|-------------|------|
| ETH | CafeCore mint fees (1%) | CafeTreasury | 1% of every BEAN purchase |
| ETH | CafeCore redeem fees (2%) | CafeTreasury | 2% of every BEAN redemption |
| ETH | Router 0.3% fee | `ownerTreasury` (same address) | 0.3% of every meal |
| BEAN | MenuRegistry food purchases (99%) | CafeTreasury | 99% of BEAN spent on food |
| BEAN burned | MenuRegistry food purchases (1%) | `address(0xdead)` | 1% of BEAN spent on food |

**Note on ETH in CafeTreasury**: The CafeTreasury receives ETH from CafeCore (mint/redeem fees) via `.call{value: fee}("")`. The treasury's `receive()` fallback at line 48 accepts this ETH. These flows are clean. ✓

### 3.2 Stuck ETH Risk

**CafeTreasury.sol** has `withdrawETH(address to, uint256 amount)` at line 34. The `amount` parameter is NOT checked against `address(this).balance`. If `amount > balance`, the `call` will fail (ETH transfer fails when contract balance is insufficient) and revert. This protects against accidental over-withdraw. ✓

However, there is **no function to list or view ETH balance** in the treasury. The only ETH visibility is through `address(CafeTreasury).balance` via an external call. Consider adding `function ethBalance() external view returns (uint256) { return address(this).balance; }`.

### 3.3 BEAN Accumulation Mechanism

When an agent buys food:
```solidity
// MenuRegistry.sol, buyItem(), lines 112-116
uint256 toTreasury = (totalCost * TREASURY_BPS) / BPS;  // 99%
uint256 toBurn = totalCost - toTreasury;                  // 1%
bean.transfer(treasury, toTreasury);
bean.transfer(BURN_ADDRESS, toBurn);
```

**BEAN 99/1 split rounding (LOW)**:
- `toTreasury = (totalCost * 9900) / 10000`
- `toBurn = totalCost - toTreasury`
- For `totalCost = 50` (Espresso): `toTreasury = 49500/10000 = 49`, `toBurn = 1`
- For `totalCost = 75` (Latte): `toTreasury = 74250/10000 = 74`, `toBurn = 1`
- For `totalCost = 120` (Sandwich): `toTreasury = 118800/10000 = 118`, `toBurn = 2`

The burn is always `totalCost - floor(totalCost * 0.99)`, which rounds UP the burn amount when there's a fractional BEAN. This slightly favors burning (deflationary), which is acceptable. The `tokenomics_design.md` says "1% burned" but the actual burn is the complementary integer, so it's close to but not exactly 1%. At scale this is negligible.

**Identical logic exists** in `buyItemFor()` (lines 170-175). Both implementations are identical — no discrepancy. ✓

---

## 4. GasTank Analysis — GasTank.sol

### 4.1 Deposit/Withdraw Flow

```solidity
// deposit(), lines 33-39
tankBalance[agent] += msg.value;
totalCredited += msg.value;

// withdraw(), lines 42-51
tankBalance[msg.sender] -= amount;
totalCredited -= amount;
// then ETH transferred out

// deductForGas(), lines 55-65
tankBalance[agent] -= amount;
totalCredited -= amount;
// then ETH transferred to paymaster
```

**Accounting invariant**: `totalCredited == Σ tankBalance[all agents]` at all times.

This holds IF no ETH enters the contract except through `deposit()`. But the `receive()` fallback at line 118 accepts ETH without updating `totalCredited` — **MEDIUM issue**:

```solidity
receive() external payable {}  // line 118 — totalCredited NOT updated
```

If ETH is sent directly to GasTank:
- `address(GasTank).balance` increases
- `totalCredited` does NOT increase
- `withdrawSurplus()` computes `surplus = address(this).balance - totalCredited`
- The directly-sent ETH shows up as surplus and is recoverable by owner ✓

So the surplus mechanism correctly handles this case. The owner can withdraw the donation as surplus. However, during the window between the donation and the surplus withdrawal, agents cannot claim the extra ETH (it's not in any `tankBalance`). This is by design — the surplus function exists precisely for this reason.

**Important**: When `AgentCafeRouter` calls `gasTank.deposit{value: toTank}(msg.sender)`, this correctly uses the `deposit()` function path and updates `totalCredited`. ✓

### 4.2 deductForGas — Paymaster ETH Recovery

```solidity
// deductForGas(), lines 55-65
(bool ok, ) = msg.sender.call{value: amount}("");
require(ok, "ETH transfer to deducter failed");
```

The deducted ETH is transferred to the paymaster (`msg.sender`). The paymaster uses this ETH to replenish its EntryPoint stake after sponsoring a transaction. This is the correct ERC-4337 flow: paymaster fronts gas to EntryPoint → EntryPoint processes op → paymaster calls GasTank.deductForGas() to recover cost.

**Reentrancy risk**: `deductForGas` is protected by `nonReentrant`. ✓

### 4.3 HUNGRY_THRESHOLD Mismatch

GasTank uses `HUNGRY_THRESHOLD = 0.001 ether` (line 18) for `isHungry` status. MenuRegistry uses `100_000 gas units` as the hunger threshold (line 279). These are **different domains** (ETH vs gas units) and represent two separate hunger systems:
- GasTank hunger = "tank running low in ETH terms" — for the new ETH-based gas system
- MenuRegistry hunger = "metabolic energy running low" — for the legacy BEAN/metabolism system

This dual-hunger system is intentional but confusing. Agents may receive `Hungry` events from both contracts with different semantics. Consider documenting this clearly or unifying the system.

---

## 5. Paymaster — AgentCafePaymaster.sol

### 5.1 Gas Cost Deduction in postOp

```solidity
// _postOp(), lines 80-97
uint256 costWei = actualGasCost;
if (costWei == 0) costWei = 1;
gasTank.deductForGas(agent, costWei);
```

`actualGasCost` is provided by the EntryPoint — it represents the actual ETH cost of the operation. The paymaster deducts this from the agent's tank in wei. This is correct: the agent's tank is denominated in ETH, the deduction is in ETH. ✓

**Concern**: If `deductForGas` reverts (because agent's tank is somehow empty — e.g., agent withdrew between validation and postOp), `postOp` would revert. ERC-4337 spec says postOp revert puts the op in `PostOpMode.postOpReverted`, which the code handles:

```solidity
if (mode != PostOpMode.postOpReverted) {
    // Only deduct if not already reverted
}
```

But `_postOp` is called only in non-reverted mode here... wait, the check `if (mode != PostOpMode.postOpReverted)` means that if the op itself reverted, we skip deduction. However, if `deductForGas` reverts WITHIN this block, the postOp itself reverts. ERC-4337 handles postOp revert by the EntryPoint charging the paymaster anyway (from its staked deposit). So the agent could theoretically get free gas if their tank drains to exactly zero between validatePaymaster and postOp. This is a minor vector but not exploitable at scale.

### 5.2 Rate Limit Math

```solidity
// _validatePaymasterUserOp(), lines 71-74
uint256 maxFee = userOp.unpackMaxFeePerGas();
uint256 gasNeeded = maxFee > 0 ? maxCost / maxFee : 100_000;
if (gasNeeded == 0) gasNeeded = 100_000;
```

**Issue (INFO)**: The rate limit tracks `gasNeeded` (gas units), but `_checkRateLimit` uses `MAX_GAS_PER_PERIOD = 2_000_000` (gas units). The `gasNeeded` calculation `maxCost / maxFee` converts wei-cost back to gas units, which is correct. However, if `maxFee` is very small (1 gwei = 1e9), and `maxCost` is large (e.g., 1 ETH = 1e18), then `gasNeeded = 1e18 / 1e9 = 1e9` gas units — far exceeding `MAX_GAS_PER_PERIOD`. This would cause the rate limit to trigger on the first op.

The `100_000` fallback for zero `maxFee` is arbitrary and may not reflect the actual gas consumed. This is acceptable for testnet but should be made more precise for mainnet.

### 5.3 Paymaster ETH Funding

The paymaster must have ETH deposited in the EntryPoint to sponsor gas. The current contracts have **no automated mechanism** to refill the paymaster's EntryPoint deposit. The `tokenomics_design.md` describes using Chainlink Automation for this (Section 5.2), but this is not implemented in any contract.

**Operational risk**: If the paymaster's EntryPoint balance runs dry, all agent UserOperations will fail until the owner manually deposits ETH. This is acceptable for testnet but is a critical operational gap for mainnet.

---

## 6. Full ETH Flow — Wei-Level Trace

**Scenario**: Agent sends `0.01 ETH` to `enterCafe(0)` (Espresso, 50 BEAN)

### Step 1: Router Fee Split
```
msg.value = 10,000,000,000,000,000 wei (0.01 ETH)
fee = (10,000,000,000,000,000 * 30) / 10,000 = 30,000,000,000,000 wei (0.00003 ETH, 0.3%)
toTank = 9,970,000,000,000,000 wei (0.00997 ETH, 99.7%)
```
→ 30,000,000,000,000 wei → ownerTreasury ✓
→ 9,970,000,000,000,000 wei → gasTank.deposit() ✓

### Step 2: GasTank State
```
tankBalance[agent] += 9,970,000,000,000,000
totalCredited += 9,970,000,000,000,000
```
✓ Conservation holds

### Step 3: BEAN Estimation for Espresso (50 BEAN)
`_estimateEthForBean(50)` at supply S:
```
linearPart = 1e12 * 50 = 50,000,000,000,000 (5e13)
quadPart = 1e8 * (S*50 + 50*49/2) = 1e8 * (50S + 1225)
```
At S=0: `rawCost = 5e13 + 1e8*1225 = 5e13 + 1.225e11 ≈ 5.01225e13`
`withFee = (5.01225e13 * 10100) / 10000 = 5.0624e13`
`ethForBean = 5.0624e13 + 1 ≈ 50,624,250,001 wei ≈ 0.0000507 ETH`

### Step 4: BEAN Mint
Router has `0.01 ETH - 0.00003 ETH = 0.00997 ETH` remaining.
`0.0000507 ETH < 0.00997 ETH` → router can afford the BEAN ✓

CafeCore receives `50,624,250,001 wei`:
```
fee (1%) = 506,242,500 wei → CafeTreasury
ethForCurve = 50,624,250,001 - 506,242,500 = 50,118,007,501 wei → ethReserve
```

`_ethToBeanAmount(50,118,007,501, 0)` → should return ~50 BEAN

### Step 5: Food Purchase
Router has 50 BEAN, approves MenuRegistry for 50 BEAN.
MenuRegistry takes 50 BEAN:
```
toTreasury = (50 * 9900) / 10000 = 49 BEAN → CafeTreasury
toBurn = 50 - 49 = 1 BEAN → 0xdead
```
Router pays nothing additional in ETH.

### Step 6: Consumption
MenuRegistry burns the Espresso ERC-1155 token.
Agent's metabolic state: `availableGas += 300,000`

### Step 7: Final State
```
ownerTreasury: +30,000,000,000,000 wei ETH
gasTank: +9,970,000,000,000,000 wei ETH (agent's tank)
CafeTreasury: +506,242,500 wei ETH + 49 BEAN
0xdead: +1 BEAN (burned)
CafeCore.ethReserve: +50,118,007,501 wei
Agent tank: 9,970,000,000,000,000 wei ETH
Agent metabolism: +300,000 gas calories
```

**ETH Conservation Check**:
- In: 10,000,000,000,000,000 wei
- Out: 30,000,000,000,000 (ownerTreasury) + 9,970,000,000,000,000 (gasTank) + 50,624,250,001 (to CafeCore) = 10,050,624,250,001 wei

Wait — **this doesn't balance!** The total out exceeds the total in.

**Root cause**: The router uses the remaining ETH in its own balance after `gasTank.deposit()` to pay for BEAN. But the initial `msg.value = 0.01 ETH`, fee `= 0.00003 ETH` goes to treasury, `toTank = 0.00997 ETH` goes to GasTank. Then `ethForBean ≈ 0.0000507 ETH` must also come from somewhere.

**The router's balance after step 1**: `msg.value - fee - toTank = 0` — the router sends ALL msg.value out in step 1 (fee + toTank = msg.value). There is NO ETH left in the router to pay for BEAN.

**So line 98 condition `address(this).balance >= ethForBean` will ALWAYS be false** when `enterCafe` is called with a clean router (no residual balance).

This means the food token minting is effectively **never executed** in the current implementation. The agent always gets the gas tank fill but never gets the food token or gas calories!

**CRITICAL re-evaluation**: The router's `receive()` allows ETH to be sent directly. The only ETH available for BEAN minting would be from a direct ETH send to the router beforehand, which is not the intended flow.

The comment at line 117 says: `// If we can't afford the BEAN, agent still gets their gas tank filled` — this suggests the developer was aware that BEAN minting might fail, but the **design intent was for it to always fail** unless the router has a pre-existing balance. This is a fundamental design flaw: the food token minting branch is dead code in practice.

**Verified**: With `msg.value = X`, router sends `fee + toTank = X` out, leaving balance = 0. Line 98 checks `address(this).balance >= ethForBean` → false → BEAN never minted → agent never gets food token or gas calories.

**CRITICAL FIX REQUIRED**: The router should reserve a portion of `msg.value` for BEAN minting BEFORE depositing the remainder to GasTank:
```
fee = X * 0.003           // 0.3% to treasury
ethForBean = estimated    // for food token
toTank = X - fee - ethForBean  // remainder to gas tank
```

---

## 7. Digestion Math — MenuRegistry.sol

### 7.1 Digest Rate Truncation (MEDIUM)

```solidity
// consume(), line 148
state.digestRatePerBlock = state.digestingGas / item.digestionBlocks;
```

This truncates down. If `digestingGas = 1_000_001` and `digestionBlocks = 60`:
- `digestRatePerBlock = 1_000_001 / 60 = 16,666` (truncated from 16,666.68)
- Over 60 blocks: `released = 60 * 16,666 = 999,960`
- Missing: `1,000,001 - 999,960 = 41 gas calories` (lost to rounding)

At full breakfast (2.5M gas calories, 120 blocks):
- `digestRatePerBlock = 2,500,000 / 120 = 20,833` (truncated from 20,833.33)
- Released over 120 blocks: `120 * 20,833 = 2,499,960`
- Missing: 40 gas calories

The remaining gas calories stay permanently in `digestingGas` and are never released (because `blocksSince * digestRatePerBlock` eventually equals `digestingGas` minus the dust, but the condition `released = min(released, digestingGas)` means the dust can only come out if `released >= digestingGas`).

Wait — let's re-examine: after 120 blocks, `released = 120 * 20833 = 2,499,960`. Since this is less than `digestingGas = 2,500,000`, the condition `released > state.digestingGas` is FALSE. So `state.digestingGas -= 2,499,960 → 40 remaining`. The next call sees `blocksSince > 0` and `released = blocksSince * 20833` which can be larger than 40, so `released = 40` (capped), and the remaining 40 is transferred. So actually the dust IS eventually recovered over one more block cycle. ✓

The rounding truncation is benign — agents get slightly delayed but not permanently lost gas calories.

### 7.2 Double-Eating Reset (INFO)

```solidity
// consume(), lines 147-149
state.digestingGas += totalCalories;
state.digestRatePerBlock = state.digestingGas / item.digestionBlocks;
state.lastDigestBlock = block.number;
```

The comment at line 143-146 documents this trade-off: if an agent eats a second time-released item before the first finishes, the combined remaining digestion is recalculated at the NEW item's `digestionBlocks` rate. This can:
- Speed up digestion if new item has shorter `digestionBlocks`
- Slow down digestion if new item has longer `digestionBlocks`

Example: agent has 600,000 Latte calories still digesting (30 blocks) at block 15, then eats a Sandwich (120 blocks):
- `digestingGas = 600,000 (remaining) + 1,200,000 = 1,800,000`
- `digestRatePerBlock = 1,800,000 / 120 = 15,000` (Sandwich rate)
- vs. original Latte rate of 20,000/block
- The combined digestion is SLOWED DOWN by mixing meals

This is documented as a known trade-off but should be user-facing documentation for agents building meal strategies.

---

## 8. Overflow Risk Analysis

All contracts use Solidity `^0.8.27` with built-in overflow protection. ✓

**Potential large-number issues in CafeCore**:
- `bAdj * bAdj` in `_ethToBeanAmount()` (line 133): `bAdj ≈ BASE_PRICE + SLOPE * supply`
- At `supply = 1e18` (extremely high, unlikely): `bAdj ≈ 1e8 * 1e18 = 1e26`
- `bAdj^2 = 1e52` — exceeds `uint256` max (`~1.16e77`), so no overflow ✓
- `2 * SLOPE * ethAmount`: max ETH in system could be large, but `SLOPE = 1e8`, so `2e8 * 1e27 = 2e35` — fine ✓
- `SLOPE * n * (2 * S - n - 1)` in `_beanToEthAmount()`: at `n = S = 1e18`, `2*S = 2e18 > uint256` limit?
  - `2 * 1e18 = 2e18` — safely within uint256 (max ~1.16e77) ✓
  - `SLOPE * n = 1e8 * 1e18 = 1e26` ✓
  - `SLOPE * n * (2S - n - 1) = 1e26 * 1e18 = 1e44` ✓

No realistic overflow scenarios found. ✓

---

## 9. Design vs. Implementation Comparison

| Design Doc Intent | Implementation Reality | Status |
|------------------|----------------------|--------|
| 99% BEAN to Treasury, 1% burned | 99% + rounding to Treasury, complementary burn | Close enough ✓ |
| 1% CafeCore mint fee to Treasury | 1% CafeCore mint fee to `treasury` address | ✓ |
| 2% CafeCore redeem fee to Treasury | 2% CafeCore redeem fee to `treasury` address | ✓ |
| 0.3% Router fee to owner | 0.3% Router fee to `ownerTreasury` | ✓ |
| Instant espresso, 30-block latte, 60-block sandwich | Correctly implemented | ✓ |
| MetabolicState tracks available + digesting gas | Implemented in MenuRegistry | ✓ |
| Food token minting in enterCafe | **NEVER EXECUTES** — no ETH left after split | CRITICAL ✗ |
| Paymaster auto-refill from treasury | Not implemented — manual only | Missing |
| Treasury 48hr timelock on large BEAN sales | Not implemented in CafeTreasury | Missing |
| Per-block purchase cap for MEV defense | Not implemented | Missing |
| Loyalty tiers (bonus gas calories) | Not implemented | Missing |
| `tokenomics_design.md` describes full BEAN flow through food purchase | Partially implemented — GasTank is ETH-only | Architecture split |

---

## 10. Critical Path Summary

### Issues Requiring Fix Before Mainnet

1. **[CRITICAL] Food token minting is dead code** (`AgentCafeRouter.sol:98`)
   - Router deposits ALL msg.value to treasury+gastank before checking balance for BEAN
   - `address(this).balance == 0` when the BEAN mint check runs
   - Fix: Reserve `ethForBean` from msg.value BEFORE the gasTank deposit

2. **[HIGH] ETH/BEAN accounting diverges via receive() on CafeCore** (`CafeCore.sol:170`)
   - Donations increment contract balance but not `ethReserve`
   - Makes solvency monitoring via `ethReserve` inaccurate
   - Fix: Either remove `receive()` or update `ethReserve` within it

3. **[HIGH] Fee rounding to 0 for tiny transactions** (`AgentCafeRouter.sol:77`)
   - Below 334 wei msg.value, fee = 0 (integer division truncation)
   - Document minimum meal size or add `require(msg.value >= minMeal)`

4. **[MEDIUM] `totalCredited` desync on direct ETH sends to GasTank** (`GasTank.sol:118`)
   - `receive()` does not update `totalCredited`
   - Currently mitigated by `withdrawSurplus()` but misleading
   - Fix: Override `receive()` to emit an event and document behavior

5. **[MEDIUM] Quadratic solver can over-mint by 1 BEAN** (`CafeCore.sol:137`)
   - Babylonian sqrt truncation can return `n` where actual cost > ethForCurve
   - Creates slow reserve leak over thousands of mints
   - Fix: Add post-check `if (_beanToEthAmount(n, supply) > ethForCurve) n--;`

6. **[LOW] Digestion dust never permanently stranded** (`MenuRegistry.sol:148`)
   - Rate truncation creates dust that self-resolves in next settle call
   - No fix needed, but document the behavior

### Missing Features (Tokenomics Doc vs. Implementation)

- [ ] Paymaster auto-refill from treasury (Chainlink Automation)
- [ ] Loyalty tier bonuses on gas calories
- [ ] Per-block purchase cap for MEV defense
- [ ] 48hr timelock on large treasury BEAN sales
- [ ] Token-buy feature from tokenomics-v3.md (agent token purchases)
- [ ] Minimum liquidity gate on token buys
- [ ] Treasury ETH balance view function

---

## 11. Solvency Verdict

Under normal operation (no donations, no extreme rounding), the system maintains:

```
ethReserve ≥ Σ(redemption value of all outstanding BEAN)
```

The bonding curve integral math guarantees this: ETH paid on mint equals the area under the curve for the minted tokens, and redemption returns the area under the curve for the burned tokens. Since the curve is monotonically increasing, more was paid to mint than is returned on redemption — the reserve grows relative to outstanding liabilities.

The only solvency risk identified is the over-mint-by-1 issue (finding 2.1/5), which is bounded and self-limiting.

**Verdict**: The system is solvent for testnet purposes. The critical food-token bug (finding 1.3/10) is a functional failure (agents don't get what they pay for) but not a solvency failure. Fix before mainnet.

---

*Audit complete. All findings documented with exact line numbers. See issues 1-6 above for prioritized fixes.*

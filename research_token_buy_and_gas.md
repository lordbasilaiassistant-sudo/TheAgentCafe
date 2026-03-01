# Research Report: Token-Buy Feature & Gas Cost Analysis

**Date**: 2026-03-01
**Author**: Researcher Agent
**Status**: Research Complete — Feature NOT IMPLEMENTED. The token-buy / auto-buy mechanic described in Part 1 was never deployed. The current router sends the 0.3% fee to ownerTreasury as plain ETH. $ClawCafe is not integrated into any contract. Gas cost analysis in Part 2 remains accurate.

---

## PART 1: Token-Buy Feature Design (Task #2)

### Overview

The founder wants the 0.3% cafe fee (from `enterCafe()`) to auto-buy the eating agent's native token on a Base DEX, with the cafe holding those tokens forever in its treasury. This creates buy pressure for every agent that eats.

---

### 1. Which DEX to Integrate?

**Recommendation: Uniswap V2-style router interface (Aerodrome-compatible on mainnet, Uniswap V2 on testnet)**

| DEX | Base Mainnet | Base Sepolia | Notes |
|-----|-------------|--------------|-------|
| Aerodrome V2 | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | **NOT DEPLOYED** | Dominant Base DEX, but mainnet only |
| Uniswap V2 Router02 | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | Exists (see below) | Works on both networks |
| Uniswap V3 | Deployed | Deployed | More complex, overkill for small swaps |

**CRITICAL FINDING**: Aerodrome does NOT have a confirmed deployment on Base Sepolia testnet. The `0xcF77a3Ba...` address is Base mainnet only. For testnet development, we must use Uniswap V2 Router02 on Base Sepolia or deploy a mock router.

**Recommended approach**: Code against the Uniswap V2 Router interface (`IUniswapV2Router02`), which Aerodrome's router is compatible with (same `swapExactETHForTokens` signature with a slightly different `Route` struct). Use a configurable router address so we can:
- Testnet: Point to Uniswap V2 on Base Sepolia
- Mainnet: Point to Aerodrome V2 on Base

#### Aerodrome Router Interface (for mainnet)

```solidity
struct Route {
    address from;   // Token to sell (WETH)
    address to;     // Token to buy (agent's token)
    bool stable;    // false for volatile pairs
    address factory; // Aerodrome factory address
}

function swapExactETHForTokens(
    uint256 amountOutMin,
    Route[] calldata routes,
    address to,        // recipient (CafeTreasury)
    uint256 deadline
) external payable returns (uint256[] memory amounts);
```

#### Uniswap V2 Router Interface (for testnet)

```solidity
function swapExactETHForTokens(
    uint256 amountOutMin,
    address[] calldata path,  // [WETH, agentToken]
    address to,
    uint256 deadline
) external payable returns (uint256[] memory amounts);
```

**Design decision**: Abstract behind an `ISwapRouter` interface so the contract works with either DEX.

---

### 2. How Should Agents Specify Their Token?

**Recommendation: Registry pattern with parameter override**

Two approaches, use both:

**A. AgentTokenRegistry (persistent)**
- Agents register their token address once: `registerToken(address token)`
- Stored on-chain: `mapping(address => address) public agentToken`
- Token must pass basic validation (non-zero, has code, not WETH itself)
- Agent can update their token: `updateToken(address newToken)`

**B. Parameter override in enterCafe (flexible)**
- `enterCafe(uint256 itemId, address tokenOverride)`
- If `tokenOverride != address(0)`, use it for this meal
- If `tokenOverride == address(0)`, fall back to registry
- If no registry entry either, skip the swap (keep ETH in treasury)

This dual approach lets agents:
1. Set-and-forget via registry (most common)
2. Override per-transaction if they hold multiple tokens
3. Eat without a token (gas tank still fills, no swap happens)

---

### 3. What If the Agent's Token Has No Liquidity Pair?

**Recommendation: Try-catch with ETH fallback**

```solidity
// Pseudocode for the swap attempt
try router.swapExactETHForTokens{value: feeAmount}(
    0,              // amountOutMin = 0 (we accept any amount, see slippage section)
    path,
    cafeTreasury,
    block.timestamp + 300
) returns (uint256[] memory amounts) {
    emit TokenBought(agent, agentToken, amounts[amounts.length - 1]);
} catch {
    // No liquidity, honeypot, or other failure — keep ETH in treasury
    (bool ok, ) = cafeTreasury.call{value: feeAmount}("");
    require(ok, "Treasury fallback failed");
    emit TokenBuyFailed(agent, agentToken, feeAmount);
}
```

Key points:
- The swap MUST be wrapped in try-catch. If it reverts, the fee ETH stays in treasury as ETH
- Agent still gets their gas tank filled regardless of swap success
- Events differentiate successful buys vs fallbacks for dashboard tracking
- This is a graceful degradation — the core value prop (gas tank) never fails

---

### 4. Slippage Protection

**Recommendation: 5% slippage with a floor of 0 (never revert on slippage)**

For the 0.3% fee swaps, the amounts are tiny (fractions of a cent on testnet, maybe $0.01-0.10 on mainnet). Slippage protection matters less here because:

- **We're buying, not selling** — the cafe holds forever, so entry price barely matters
- **Small amounts** — MEV bots won't target a $0.03 swap
- **Reverting is worse than overpaying** — if the swap reverts, the agent gets no buy pressure for their token

**Practical approach**:
- Set `amountOutMin = 0` in the contract (never revert on slippage)
- The try-catch already protects against total failure (honeypot, no liquidity)
- For agents that care about price, they can check `TokenBought` events to see what was purchased

**Alternative (more complex)**: Use an on-chain oracle or TWAP to compute `amountOutMin`. Not worth the gas overhead for sub-dollar swaps.

---

### 5. Malicious Token Safety (Tax Tokens, Honeypots)

**Threat model**: An agent registers a token with 99% transfer tax, hidden mint functions, or reentrancy attacks.

**Recommendations (layered defense)**:

| Check | When | How |
|-------|------|-----|
| **Try-catch swap** | At swap time | Swap reverts = fallback to ETH |
| **Fee-on-transfer variant** | At swap time | Use `swapExactETHForTokensSupportingFeeOnTransferTokens` to handle tax tokens |
| **Max fee cap** | At swap time | If fee amount < dust threshold (e.g., < 100 wei worth of output), skip |
| **No callbacks from tokens** | By design | Treasury receives tokens but never transfers them out or approves them |
| **Token code check** | At registration | `require(token.code.length > 0)` — must be a contract |
| **Reentrancy guard** | At swap time | Already have `nonReentrant` on `enterCafe` |

**What we explicitly do NOT do (too complex, too much gas)**:
- On-chain honeypot simulation (would require a separate contract to try-sell)
- GoPlus/Honeypot.is oracle integration (off-chain dependency)
- Token bytecode analysis (impossible to be comprehensive)

**Key insight**: Since the cafe NEVER sells these tokens, honeypots are actually not a risk to US. The worst case is we buy worthless tokens. The try-catch protects against reverts. The real risk is gas waste on failed swaps, which is negligible on Base.

**One real risk**: Reentrancy via token transfer hooks (ERC-777 style). Mitigated by:
1. `nonReentrant` modifier on `enterCafe`
2. Swap happens after all state changes (checks-effects-interactions)
3. Tokens go to treasury, not back to the caller

---

### 6. Gas Cost of Adding a DEX Swap

| Operation | Gas Units (estimated) |
|-----------|-----------------------|
| Current `enterCafe()` (no swap) | ~180,000 - 250,000 |
| Uniswap V2 swap (ETH -> Token) | ~127,000 - 150,000 |
| Try-catch overhead | ~5,000 |
| Registry lookup | ~2,600 (warm SLOAD) |
| **Total with swap (success)** | **~310,000 - 410,000** |
| **Total with swap (failure/fallback)** | **~220,000 - 290,000** |

At Base's current gas price (~0.008 gwei):
- Extra cost of successful swap: ~150,000 gas * 0.008 gwei = **0.0000012 ETH (~$0.003)**
- Extra cost of failed swap: ~40,000 gas (try-catch fail + ETH transfer) = **~$0.001**

**Verdict**: The swap adds approximately $0.003 per enterCafe() call. Negligible.

---

## PART 2: Gas Cost Analysis for All Contract Operations (Task #4)

### Base L2 Gas Price Context

- **Current Base gas price**: ~0.008 gwei (L2 execution fee)
- **L1 data fee**: Additional cost for calldata posted to Ethereum L1. Typically $0.001-0.01 per tx after EIP-4844 (blobs)
- **Minimum base fee**: 0.005 gwei on Base mainnet
- **ETH price assumption**: ~$2,500 (March 2026)

### Gas Cost Estimates Per Function

These are estimates based on opcode costs, storage operations, and comparable deployed contracts. Actual values should be confirmed via testnet execution.

#### AgentCafeRouter

| Function | Est. Gas Units | L2 Cost (ETH) | L2 Cost (USD) | Notes |
|----------|---------------|----------------|----------------|-------|
| `enterCafe(itemId)` | 200,000 - 280,000 | 0.0000016 - 0.0000022 | $0.004 - $0.006 | Full path: fee split + deposit + mint BEAN + buy item + consume |
| `estimatePrice(itemId)` | 0 (view) | Free | Free | Read-only, no gas |
| `setOwnerTreasury(addr)` | ~46,000 | 0.00000037 | $0.001 | Owner only, SSTORE |
| `enterCafe(itemId)` with DEX swap | 310,000 - 410,000 | 0.0000025 - 0.0000033 | $0.006 - $0.008 | Adds ~130K for swap |

**Breakdown of enterCafe gas**:
- ETH fee split + transfer: ~30,000
- GasTank.deposit: ~50,000 (SSTORE + event)
- CafeCore.mint (bonding curve): ~60,000 (sqrt calc + mint + transfer)
- MenuRegistry.buyItemFor: ~80,000 (2x ERC20 transfer + ERC1155 mint + events)
- MenuRegistry.consumeFor: ~60,000 (burn + state update + events)

#### CafeCore ($BEAN Bonding Curve)

| Function | Est. Gas Units | L2 Cost (ETH) | L2 Cost (USD) | Notes |
|----------|---------------|----------------|----------------|-------|
| `mint(minBeanOut)` | 55,000 - 70,000 | 0.00000044 - 0.00000056 | $0.001 - $0.002 | Sqrt calculation + mint + fee transfer |
| `redeem(beanIn, minEthOut)` | 55,000 - 70,000 | 0.00000044 - 0.00000056 | $0.001 - $0.002 | Burn + ETH transfers x2 |
| `currentPrice()` | 0 (view) | Free | Free | Simple math |
| `solvencyCheck()` | 0 (view) | Free | Free | |

#### GasTank

| Function | Est. Gas Units | L2 Cost (ETH) | L2 Cost (USD) | Notes |
|----------|---------------|----------------|----------------|-------|
| `deposit(agent)` | 45,000 - 55,000 | 0.00000036 - 0.00000044 | $0.001 | SSTORE + event. First deposit = ~55K (cold slot), repeat = ~45K (warm) |
| `withdraw(amount)` | 45,000 - 55,000 | 0.00000036 - 0.00000044 | $0.001 | SSTORE + ETH transfer + event |
| `deductForGas(agent, amount)` | 45,000 - 55,000 | 0.00000036 - 0.00000044 | $0.001 | Called by paymaster |
| `getTankLevel(agent)` | 0 (view) | Free | Free | |
| `setAuthorizedDeducter()` | ~46,000 | 0.00000037 | $0.001 | Owner only |

#### MenuRegistry

| Function | Est. Gas Units | L2 Cost (ETH) | L2 Cost (USD) | Notes |
|----------|---------------|----------------|----------------|-------|
| `buyItem(itemId, qty)` | 75,000 - 95,000 | 0.00000060 - 0.00000076 | $0.002 | ERC20 transferFrom + 2 transfers + ERC1155 mint |
| `consume(itemId, qty)` | 55,000 - 70,000 | 0.00000044 - 0.00000056 | $0.002 | ERC1155 burn + state updates |
| `buyItemFor(agent, itemId, qty)` | 80,000 - 100,000 | 0.00000064 - 0.00000080 | $0.002 | Same as buyItem + auth check |
| `consumeFor(agent, itemId, qty)` | 55,000 - 70,000 | 0.00000044 - 0.00000056 | $0.002 | Same as consume + auth check |
| `getMenu()` | 0 (view) | Free | Free | Returns full menu |
| `getAgentStatus(agent)` | 0 (view) | Free | Free | |

#### AgentCafePaymaster (ERC-4337)

| Function | Est. Gas Units | L2 Cost (ETH) | L2 Cost (USD) | Notes |
|----------|---------------|----------------|----------------|-------|
| `_validatePaymasterUserOp` | ~30,000 | N/A | N/A | Called by EntryPoint, part of UserOp gas |
| `_postOp` | ~50,000 | N/A | N/A | Deducts from GasTank after sponsoring |
| **Total paymaster overhead per UserOp** | ~80,000 | 0.00000064 | $0.002 | Added to every sponsored tx |

### L1 Data Fee (Often the Dominant Cost)

On Base, the L1 data fee (for posting calldata to Ethereum) is often MORE than the L2 execution fee. After EIP-4844:

| Transaction Type | Calldata Size | Est. L1 Fee | Total (L1+L2) |
|-----------------|---------------|-------------|----------------|
| `enterCafe(uint256)` | ~100 bytes | ~$0.002 | ~$0.006 - $0.008 |
| `enterCafe(uint256, address)` (with token) | ~132 bytes | ~$0.003 | ~$0.009 - $0.011 |
| `mint(uint256)` | ~68 bytes | ~$0.001 | ~$0.002 - $0.003 |
| `deposit(address)` | ~68 bytes | ~$0.001 | ~$0.002 |
| ERC-4337 UserOp | ~300-500 bytes | ~$0.005-0.01 | ~$0.007 - $0.012 |

### How to Expose Gas Info to Agents

**Recommendation: Multi-channel approach**

1. **On-chain view function** (add to AgentCafeRouter or a new GasInfo contract):
```solidity
function getGasEstimates() external pure returns (
    uint256 enterCafeGas,    // ~250000
    uint256 mintBeanGas,     // ~65000
    uint256 depositGas,      // ~50000
    uint256 withdrawGas      // ~50000
) {
    return (250000, 65000, 50000, 50000);
}
```

2. **AgentCard metadata** (already deployed at `0xC717...`):
   - Add gas estimates to the AgentCard's `getCardData()` return
   - Agents reading the card get gas info alongside menu/status

3. **agent.json / well-known URI** (for A2A protocol):
```json
{
  "gas_estimates": {
    "enterCafe": { "gas": 250000, "usd_approx": "$0.006" },
    "mintBean": { "gas": 65000, "usd_approx": "$0.002" },
    "note": "Base L2, ~0.008 gwei. L1 data fee adds ~$0.002"
  }
}
```

4. **MCP tool response** (for Claude Code and other MCP-aware agents):
   - Include gas estimates in `eat_at_cafe` tool responses
   - Show before/after tank levels with gas cost breakdown

### Impact of DEX Swap on enterCafe Gas

| Scenario | Gas Units | USD Cost | Delta |
|----------|-----------|----------|-------|
| enterCafe (current, no swap) | ~250,000 | ~$0.006 | baseline |
| enterCafe + successful DEX swap | ~380,000 | ~$0.009 | +$0.003 |
| enterCafe + failed swap (fallback) | ~290,000 | ~$0.007 | +$0.001 |
| enterCafe + no token registered | ~255,000 | ~$0.006 | +$0.000 |

**Conclusion**: Adding the DEX swap increases cost by approximately 50% in the success case (~$0.003 more), which is still under a penny. On Base L2, this is negligible.

---

---

## PART 3: Aerodrome V2 SDK & Base DEX Landscape (Task #7)

### Contract Addresses

| Contract | Base Mainnet | Base Sepolia |
|----------|-------------|--------------|
| **Aerodrome Router** | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | NOT DEPLOYED |
| **Aerodrome Universal Router** | `0x6Cb442acF35158D5eDa88fe602221b67B400Be3E` | NOT DEPLOYED |
| **Aerodrome Factory** | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | NOT DEPLOYED |
| **Uniswap V2 Router02** | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | Available |
| **WETH** | `0x4200000000000000000000000000000000000006` | `0x4200000000000000000000000000000000000006` (same) |

### Aerodrome V2 Solidity Interfaces

```solidity
// IRouter (Aerodrome V2)
interface IAerodromeRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external payable;

    // Check if pool exists
    function poolFor(
        address tokenA,
        address tokenB,
        bool stable,
        address factory
    ) external view returns (address pool);
}

// IPoolFactory (Aerodrome V2)
interface IAerodromeFactory {
    function getPool(
        address tokenA,
        address tokenB,
        bool stable
    ) external view returns (address);

    function isPool(address pool) external view returns (bool);
}
```

### Uniswap V2 Interface (for testnet)

```solidity
interface IUniswapV2Router02 {
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;

    function factory() external pure returns (address);
    function WETH() external pure returns (address);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}
```

### Checking If a Pair Exists

**Aerodrome (mainnet)**:
```solidity
address pool = IAerodromeFactory(factory).getPool(WETH, agentToken, false);
bool exists = pool != address(0);
```

**Uniswap V2 (testnet)**:
```solidity
address pair = IUniswapV2Factory(factory).getPair(WETH, agentToken);
bool exists = pair != address(0);
```

### Recommended Abstraction

```solidity
interface ICafeSwapRouter {
    function swapETHForToken(
        address token,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountOut);

    function pairExists(address token) external view returns (bool);
}
```

Implement two adapters: `AerodromeSwapAdapter` (mainnet) and `UniV2SwapAdapter` (testnet). The AgentCafeRouter holds a reference to `ICafeSwapRouter` which can be swapped by owner.

### 1inch Aggregator (Alternative / Future)

1inch has a Base deployment and aggregates across Aerodrome, Uniswap, and other DEXes for best execution. However:
- Requires off-chain quote API call before on-chain swap
- More complex integration (approve + swap pattern)
- Overkill for sub-dollar swaps
- **Recommendation**: Skip for v1, consider for v2 if swap sizes grow

---

## Summary & Recommendations

### Token-Buy Feature
1. Use **Uniswap V2 Router interface** (works on testnet), swap to **Aerodrome** on mainnet
2. **Registry + parameter override** for agent token specification
3. **Try-catch with ETH fallback** for missing liquidity
4. **0 slippage minimum** (never revert on price, amounts too small to matter)
5. **nonReentrant + try-catch** for malicious token defense (honeypots are not our risk since we never sell)
6. Extra gas cost: **~$0.003 per meal** (negligible on Base)

### Gas Costs
1. **enterCafe() costs ~$0.006-0.008 total** (L2 + L1 data fee)
2. **Individual operations (mint, deposit, withdraw) cost ~$0.001-0.003**
3. **ERC-4337 paymaster overhead adds ~$0.002 per sponsored tx**
4. Expose via on-chain view function + AgentCard + agent.json + MCP tools
5. Adding DEX swap to enterCafe increases cost by ~50% ($0.003) — still under a penny

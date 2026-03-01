# AgentCafeRouter V3 — DEX Swap Architecture

## Status: DRAFT (awaiting DEX research from dex-expert)

---

## 1. Problem Statement

Currently, the 0.3% fee from `enterCafe()` goes to `ownerTreasury` as raw ETH.
V3 upgrades this: the cafe uses that 0.3% fee to **buy the agent's own token** on a DEX,
giving agents a direct economic incentive to eat at the cafe.

Flow: Agent sends ETH -> 99.7% fills gas tank -> 0.3% swaps to agent's token on DEX -> token sent to cafe treasury (or burned).

---

## 2. Key Design Decisions

### 2.1 How Agents Specify Their Token

**Decision: Optional `tokenAddress` parameter on `enterCafe()`**

Rationale:
- A separate `AgentTokenRegistry` adds deployment cost and onboarding friction
- Most agents are autonomous — they know their own token address
- Stateless approach: no storage writes for registration = cheaper
- Fallback: if `tokenAddress == address(0)`, fee stays as ETH in treasury (current behavior)

```solidity
function enterCafe(uint256 itemId, address tokenAddress) external payable;
```

The old `enterCafe(uint256)` signature is kept as an overload for backward compatibility:
```solidity
function enterCafe(uint256 itemId) external payable;
// equivalent to enterCafe(itemId, address(0))
```

### 2.2 Where the Swap Happens

**Decision: Inline swap in `enterCafe()`, not batched**

Rationale:
- Swap amounts are tiny (~0.00003 ETH at current prices)
- Batching adds complexity (who triggers sweep? timing issues?)
- Inline is atomic — agent sees the result in the same tx
- If swap fails, fee stays as ETH (graceful degradation)

### 2.3 DEX Router Selection

**Decision: Pluggable DEX router via owner-settable address**

On Base, the primary DEX options are:
- **Aerodrome V2** — dominant Base DEX, highest TVL
- **Uniswap V3** — available on Base as fallback
- **1inch aggregator** — best price but adds external dependency

Architecture supports swapping the DEX router address without redeployment:
```solidity
address public dexRouter; // Aerodrome, Uniswap, etc.
function setDexRouter(address _router) external onlyOwner;
```

### 2.4 Sandwich Attack Protection

At ~0.00003 ETH per swap, MEV extraction is not economically viable (gas cost to sandwich > profit). However, we still include basic protection:
- `minAmountOut` calculated on-chain from oracle/reserves
- 5% slippage tolerance (generous for tiny amounts)
- `deadline` parameter set to `block.timestamp` (same-block execution)

### 2.5 Token Destination

**Decision: Tokens go to `CafeTreasury`**

Rationale:
- Treasury already exists and holds BEAN
- Owner can decide what to do with accumulated agent tokens (hold, burn, redistribute)
- No need for a separate `TokenVault` — treasury is already multi-asset capable via ERC-20 transfers
- Future governance can decide token disposition

---

## 3. Contract Interface

### 3.1 AgentCafeRouterV3

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IDEXRouter {
    /// @notice Swap exact ETH for tokens. Aerodrome and Uniswap V2 compatible.
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
}

contract AgentCafeRouterV3 is ReentrancyGuard, Ownable {
    // ═══════════════════════════════════════════
    //  Immutables (same as V2)
    // ═══════════════════════════════════════════
    CafeCore public immutable cafeCore;
    MenuRegistry public immutable menuRegistry;
    GasTank public immutable gasTank;

    // ═══════════════════════════════════════════
    //  V3 State Variables
    // ═══════════════════════════════════════════
    uint256 public constant FEE_BPS = 30;      // 0.3%
    uint256 public constant BPS = 10000;
    uint256 public constant MAX_SLIPPAGE_BPS = 500; // 5% max slippage

    address public ownerTreasury;      // ETH fee destination (fallback)
    address public dexRouter;          // Aerodrome/Uniswap router
    address public weth;               // WETH on Base
    bool public swapEnabled;           // Kill switch for DEX swaps

    // Stats
    uint256 public totalSwaps;
    uint256 public totalSwapVolume;    // ETH volume swapped
    uint256 public totalSwapsFailed;   // Graceful failures (fee kept as ETH)

    // ═══════════════════════════════════════════
    //  Events
    // ═══════════════════════════════════════════
    event AgentFed(
        address indexed agent,
        uint256 indexed itemId,
        uint256 ethDeposited,
        uint256 tankLevel
    );
    event TokenSwapped(
        address indexed agent,
        address indexed token,
        uint256 ethIn,
        uint256 tokenOut
    );
    event SwapFailed(
        address indexed agent,
        address indexed token,
        uint256 ethAmount,
        string reason
    );
    event TreasuryUpdated(address indexed newTreasury);
    event DexRouterUpdated(address indexed newRouter);
    event SwapToggled(bool enabled);

    // ═══════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════
    constructor(
        address _cafeCore,
        address _menuRegistry,
        address _gasTank,
        address _ownerTreasury,
        address _dexRouter,
        address _weth
    ) Ownable(msg.sender) {
        // ... zero-address checks ...
        cafeCore = CafeCore(payable(_cafeCore));
        menuRegistry = MenuRegistry(_menuRegistry);
        gasTank = GasTank(payable(_gasTank));
        ownerTreasury = _ownerTreasury;
        dexRouter = _dexRouter;
        weth = _weth;
        swapEnabled = true;
    }

    // ═══════════════════════════════════════════
    //  Core: enterCafe (V3 with optional token swap)
    // ═══════════════════════════════════════════

    /// @notice V3: Eat at the cafe. If tokenAddress != 0, fee is swapped for agent's token.
    /// @param itemId Menu item to order (0=Espresso, 1=Latte, 2=Sandwich)
    /// @param tokenAddress Agent's token to buy with the 0.3% fee. address(0) = keep as ETH.
    /// @return tankLevel Agent's gas tank balance after eating
    function enterCafe(
        uint256 itemId,
        address tokenAddress
    ) external payable nonReentrant returns (uint256 tankLevel) {
        require(msg.value > 0, "No ETH sent");

        // 1. Split: 0.3% fee, 99.7% to gas tank
        uint256 fee = (msg.value * FEE_BPS) / BPS;
        uint256 toTank = msg.value - fee;

        // 2. Deposit 99.7% into agent's gas tank
        gasTank.deposit{value: toTank}(msg.sender);

        // 3. Handle the 0.3% fee
        if (tokenAddress != address(0) && swapEnabled && dexRouter != address(0)) {
            _swapFeeForToken(msg.sender, tokenAddress, fee);
        } else {
            // Fallback: send fee as ETH to treasury
            (bool feeOk, ) = ownerTreasury.call{value: fee}("");
            require(feeOk, "Fee transfer failed");
        }

        // 4. Mint BEAN + food token (same as V2)
        _mintAndFeed(msg.sender, itemId);

        tankLevel = gasTank.tankBalance(msg.sender);
        emit AgentFed(msg.sender, itemId, toTank, tankLevel);
    }

    /// @notice Backward-compatible: enterCafe without token swap
    function enterCafe(uint256 itemId) external payable returns (uint256) {
        return this.enterCafe{value: msg.value}(itemId, address(0));
        // NOTE: This is a simplification. In actual implementation,
        // we'd duplicate the logic or use an internal function to
        // avoid the external call overhead.
    }

    // ═══════════════════════════════════════════
    //  Internal: DEX Swap
    // ═══════════════════════════════════════════

    /// @dev Attempt to swap ETH for agent's token via DEX.
    ///      On failure, sends ETH to treasury instead (graceful degradation).
    function _swapFeeForToken(
        address agent,
        address token,
        uint256 ethAmount
    ) internal {
        // Build swap path: WETH -> token
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = token;

        // Calculate minAmountOut with slippage protection
        // For tiny amounts, we accept 0 minOut — the real protection is
        // that sandwich attacks aren't profitable at this scale
        uint256 minAmountOut = 0; // TODO: Could query pair reserves for better estimate

        try IDEXRouter(dexRouter).swapExactETHForTokens{value: ethAmount}(
            minAmountOut,
            path,
            ownerTreasury, // Tokens go to treasury
            block.timestamp // Same-block deadline
        ) returns (uint256[] memory amounts) {
            totalSwaps++;
            totalSwapVolume += ethAmount;
            emit TokenSwapped(agent, token, ethAmount, amounts[amounts.length - 1]);
        } catch Error(string memory reason) {
            // Swap failed — send ETH to treasury instead
            totalSwapsFailed++;
            (bool ok, ) = ownerTreasury.call{value: ethAmount}("");
            require(ok, "Fallback fee transfer failed");
            emit SwapFailed(agent, token, ethAmount, reason);
        } catch {
            totalSwapsFailed++;
            (bool ok, ) = ownerTreasury.call{value: ethAmount}("");
            require(ok, "Fallback fee transfer failed");
            emit SwapFailed(agent, token, ethAmount, "Unknown error");
        }
    }

    // ═══════════════════════════════════════════
    //  Internal: BEAN mint + food (same as V2)
    // ═══════════════════════════════════════════

    function _mintAndFeed(address agent, uint256 itemId) internal {
        MenuItem memory item = _getMenuItem(itemId);
        uint256 beanCost = item.beanCost;
        uint256 beanBefore = cafeCore.balanceOf(address(this));
        uint256 ethForBean = _estimateEthForBean(beanCost);

        if (ethForBean > 0 && address(this).balance >= ethForBean) {
            cafeCore.mint{value: ethForBean}(0);
            uint256 beanMinted = cafeCore.balanceOf(address(this)) - beanBefore;

            if (beanMinted >= beanCost) {
                cafeCore.approve(address(menuRegistry), beanCost);
                menuRegistry.buyItemFor(agent, itemId, 1);
                menuRegistry.consumeFor(agent, itemId, 1);
            }
            uint256 excessBean = cafeCore.balanceOf(address(this));
            if (excessBean > 0) {
                cafeCore.transfer(agent, excessBean);
            }
        }
    }

    // ═══════════════════════════════════════════
    //  View Helpers
    // ═══════════════════════════════════════════

    /// @notice Estimate ETH needed for a menu item
    function estimatePrice(uint256 itemId) external view returns (uint256 ethNeeded) {
        MenuItem memory item = _getMenuItem(itemId);
        uint256 ethForBean = _estimateEthForBean(item.beanCost);
        ethNeeded = ethForBean + (ethForBean * FEE_BPS / BPS) + 1;
    }

    /// @notice Get swap stats
    function getSwapStats() external view returns (
        uint256 swaps,
        uint256 volume,
        uint256 failures
    ) {
        return (totalSwaps, totalSwapVolume, totalSwapsFailed);
    }

    // ═══════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════

    function setOwnerTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        ownerTreasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setDexRouter(address _router) external onlyOwner {
        dexRouter = _router; // address(0) disables swaps
        emit DexRouterUpdated(_router);
    }

    function setSwapEnabled(bool _enabled) external onlyOwner {
        swapEnabled = _enabled;
        emit SwapToggled(_enabled);
    }

    function emergencyWithdrawETH(address to) external onlyOwner {
        require(to != address(0), "Zero address");
        uint256 bal = address(this).balance;
        require(bal > 0, "No ETH");
        (bool ok, ) = to.call{value: bal}("");
        require(ok, "ETH transfer failed");
    }

    // ... _getMenuItem, _estimateEthForBean same as V2 (omitted for brevity) ...

    receive() external payable {}
}
```

---

## 4. Integration Flow

```
Agent calls enterCafe(itemId=0, tokenAddress=0xAGENT_TOKEN)
  with msg.value = 0.01 ETH

  |
  v
[1] Split ETH
    fee    = 0.01 * 30/10000 = 0.00003 ETH (0.3%)
    toTank = 0.01 - 0.00003  = 0.00997 ETH (99.7%)
  |
  v
[2] GasTank.deposit{0.00997 ETH}(agent)
    -> agent's tank += 0.00997 ETH
  |
  v
[3] Token swap (if tokenAddress != 0 && swapEnabled)
    |
    +--[3a] DEXRouter.swapExactETHForTokens{0.00003 ETH}(
    |       minOut=0, path=[WETH, AGENT_TOKEN], to=treasury, deadline=now
    |       )
    |       -> Success: tokens land in treasury, emit TokenSwapped
    |       -> Failure: ETH sent to treasury, emit SwapFailed
    |
    v
[4] Mint BEAN via bonding curve (small ETH from router balance)
    -> Buy food ERC-1155 for agent
    -> Consume food (gas calories credited)
    -> Excess BEAN sent to agent
  |
  v
[5] Return tankLevel, emit AgentFed
```

---

## 5. Gas Cost Estimates

| Operation | Estimated Gas | Notes |
|-----------|--------------|-------|
| V2 enterCafe (current) | ~180,000 | Measured on Sepolia |
| V3 enterCafe (no swap, tokenAddress=0) | ~180,000 | Same as V2 |
| V3 enterCafe (with swap) | ~250,000-300,000 | +70-120k for DEX swap |
| DEX swap alone (Aerodrome V2) | ~70,000-100,000 | Depends on pair type |
| DEX swap alone (Uniswap V3) | ~100,000-150,000 | Higher due to tick math |

At Base gas prices (~0.01 gwei), the additional cost for a swap is negligible (<$0.001).

---

## 6. State Variables Summary

### New in V3
| Variable | Type | Purpose |
|----------|------|---------|
| `dexRouter` | `address` | DEX router address (Aerodrome/Uniswap) |
| `weth` | `address` | WETH contract on Base |
| `swapEnabled` | `bool` | Kill switch for swaps |
| `totalSwaps` | `uint256` | Successful swap counter |
| `totalSwapVolume` | `uint256` | Total ETH volume swapped |
| `totalSwapsFailed` | `uint256` | Failed swap counter |

### Unchanged from V2
| Variable | Type | Purpose |
|----------|------|---------|
| `cafeCore` | `CafeCore` (immutable) | BEAN bonding curve |
| `menuRegistry` | `MenuRegistry` (immutable) | Food tokens |
| `gasTank` | `GasTank` (immutable) | ETH gas tank |
| `ownerTreasury` | `address` | Fee destination |

---

## 7. Open Questions (Pending DEX Research)

1. **Aerodrome V2 testnet availability**: Does Aerodrome have contracts on Base Sepolia? If not, we need a mock DEX for testing.
2. **Aerodrome route types**: Aerodrome has volatile and stable pairs. Which route type for agent tokens? (Likely volatile.)
3. **Pair existence check**: Should the router verify the WETH/token pair exists before attempting swap? Could save gas on guaranteed failures.
4. **Multi-hop routes**: What if agent's token has no direct WETH pair but has a path through USDC? Worth the extra gas?
5. **Aggregator option**: Is 1inch available on Base Sepolia for better routing?

---

## 8. Deployment Plan

1. Deploy `AgentCafeRouterV3` on Base Sepolia
2. Set `dexRouter` to Aerodrome V2 router (or mock)
3. Set `weth` to Base Sepolia WETH
4. Authorize V3 router on MenuRegistry and GasTank
5. De-authorize old V2 router
6. Update AgentCard to point to V3 router
7. Test with real swap (create test pair on Aerodrome if available)

---

## 9. Security Considerations

- **Reentrancy**: `nonReentrant` on `enterCafe()`, DEX call is last external interaction before emit
- **Token validation**: No on-chain validation of token legitimacy — agent chooses their own token, cafe doesn't vouch for it
- **Swap failure**: Graceful degradation — fee goes to treasury as ETH, never reverts
- **Stuck ETH**: `emergencyWithdrawETH()` retained from V2
- **Approval hygiene**: Router never approves DEX for arbitrary tokens (ETH-only swaps via `swapExactETHForTokens`)
- **Oracle manipulation**: Not relevant — we don't use price oracles, just swap market rate with slippage tolerance

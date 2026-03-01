# AgentCafeRouter V3 — Complete Architecture

**Date**: 2026-03-01
**Author**: Contract Architect
**Status**: FINAL — Ready for implementation (Task #9)

---

## 1. Overview

V3 upgrades `enterCafe()` so the 0.3% cafe fee auto-buys tokens on a Base DEX instead of sitting as raw ETH in treasury. Two buy targets:

1. **Agent's own token** — creates buy pressure for every agent that eats (loyalty incentive)
2. **$ClawCafe (cafe's token)** — strengthens the cafe's own token with every meal

The fee can be split between both, or go entirely to one, configurable by owner.

---

## 2. Design Decisions

### 2.1 Agent Token Specification: Registry + Override

Agents specify their token via two complementary mechanisms:

**A. AgentTokenRegistry (persistent, set-and-forget)**
```solidity
mapping(address => address) public agentToken;
```
- Agent calls `registerToken(address token)` once
- Stored on-chain, used as default for all future meals
- Basic validation: non-zero, has code, not WETH
- Agent can update via `updateToken(address newToken)`

**B. Parameter override in enterCafe (per-call flexibility)**
```solidity
function enterCafe(uint256 itemId, address tokenOverride) external payable;
```
- If `tokenOverride != address(0)` — use it for this meal only
- If `tokenOverride == address(0)` — fall back to registry
- If no registry entry either — fee stays as ETH in treasury

**Resolution order**: tokenOverride > registry > ETH fallback

### 2.2 DEX Abstraction: ICafeSwapRouter

**Critical finding**: Aerodrome V2 is NOT deployed on Base Sepolia. Uniswap V2 and Aerodrome have incompatible swap interfaces (address[] path vs Route[] struct).

**Solution**: Abstract behind `ICafeSwapRouter` with two adapter implementations.

```solidity
interface ICafeSwapRouter {
    /// @notice Swap exact ETH for a token
    /// @param token The token to buy
    /// @param amountOutMin Minimum tokens to receive (0 for tiny swaps)
    /// @param to Recipient of the tokens
    /// @param deadline Transaction deadline
    /// @return amountOut Tokens received
    function swapETHForToken(
        address token,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountOut);

    /// @notice Check if a WETH/token pair exists on this DEX
    /// @param token The token to check
    /// @return exists Whether liquidity exists
    function pairExists(address token) external view returns (bool exists);
}
```

**Adapters:**
- `UniV2SwapAdapter` — wraps IUniswapV2Router02, uses `address[] path`. For Base Sepolia testnet.
- `AerodromeSwapAdapter` — wraps IAerodromeRouter, uses `Route[] routes`. For Base mainnet.

The router holds `ICafeSwapRouter public swapRouter` which owner can swap between adapters.

### 2.3 Fee Split: Agent Token vs $ClawCafe

**Configurable split** via basis points:

```solidity
uint256 public agentTokenBps = 5000;  // 50% of fee to agent's token
uint256 public cafeTokenBps = 5000;   // 50% of fee to $ClawCafe
address public cafeToken;              // $ClawCafe address
```

Examples:
- `agentTokenBps=10000, cafeTokenBps=0` — 100% of fee buys agent's token
- `agentTokenBps=5000, cafeTokenBps=5000` — 50/50 split
- `agentTokenBps=0, cafeTokenBps=10000` — 100% buys $ClawCafe
- Agent has no token registered — 100% goes to $ClawCafe (or ETH if no cafe token either)

Owner sets the ratio. Can be adjusted as the ecosystem evolves.

### 2.4 Swap Failure Handling

**Graceful degradation via try-catch.** The gas tank fill NEVER fails.

```
Swap attempt for agent token:
  Success → tokens to treasury, emit TokenSwapped
  Failure → ETH portion to treasury, emit SwapFailed

Swap attempt for $ClawCafe:
  Success → tokens to treasury, emit TokenSwapped
  Failure → ETH portion to treasury, emit SwapFailed
```

Both swaps are independent. If one fails, the other still executes. If both fail, all fee ETH goes to treasury.

### 2.5 Slippage & MEV Protection

- `amountOutMin = 0` — never revert on slippage for sub-dollar swaps
- `deadline = block.timestamp` — same-block execution
- Swap amounts (~0.00003 ETH) are below MEV profitability threshold
- `nonReentrant` modifier protects against reentrancy from malicious tokens
- Cafe NEVER sells acquired tokens, so honeypots are not a risk to us
- Use `swapExactETHForTokensSupportingFeeOnTransferTokens` variant for fee-on-transfer (tax) tokens

### 2.6 Token Destination

Tokens go to `CafeTreasury`. No separate vault. Treasury already holds BEAN and ETH; adding agent tokens is trivial (ERC-20 transfers). Owner can later decide to burn, redistribute, or hold.

---

## 3. Contract Interfaces

### 3.1 ICafeSwapRouter (new — abstraction layer)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

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

### 3.2 UniV2SwapAdapter (new — testnet adapter)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./ICafeSwapRouter.sol";

interface IUniswapV2Router02 {
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    function factory() external pure returns (address);
    function WETH() external pure returns (address);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

contract UniV2SwapAdapter is ICafeSwapRouter {
    IUniswapV2Router02 public immutable uniRouter;
    address public immutable weth;
    address public immutable factory;

    constructor(address _uniRouter) {
        uniRouter = IUniswapV2Router02(_uniRouter);
        weth = uniRouter.WETH();
        factory = uniRouter.factory();
    }

    function swapETHForToken(
        address token,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external payable override returns (uint256 amountOut) {
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = token;

        uint256[] memory amounts = uniRouter.swapExactETHForTokens{value: msg.value}(
            amountOutMin,
            path,
            to,
            deadline
        );
        amountOut = amounts[amounts.length - 1];
    }

    function pairExists(address token) external view override returns (bool) {
        address pair = IUniswapV2Factory(factory).getPair(weth, token);
        return pair != address(0);
    }
}
```

### 3.3 AerodromeSwapAdapter (new — mainnet adapter)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./ICafeSwapRouter.sol";

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

    function poolFor(
        address tokenA,
        address tokenB,
        bool stable,
        address factory
    ) external view returns (address pool);
}

contract AerodromeSwapAdapter is ICafeSwapRouter {
    IAerodromeRouter public immutable aeroRouter;
    address public immutable weth;
    address public immutable aeroFactory;

    constructor(address _aeroRouter, address _weth, address _aeroFactory) {
        aeroRouter = IAerodromeRouter(_aeroRouter);
        weth = _weth;
        aeroFactory = _aeroFactory;
    }

    function swapETHForToken(
        address token,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external payable override returns (uint256 amountOut) {
        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({
            from: weth,
            to: token,
            stable: false,  // volatile pairs for agent tokens
            factory: aeroFactory
        });

        uint256[] memory amounts = aeroRouter.swapExactETHForTokens{value: msg.value}(
            amountOutMin,
            routes,
            to,
            deadline
        );
        amountOut = amounts[amounts.length - 1];
    }

    function pairExists(address token) external view override returns (bool) {
        address pool = aeroRouter.poolFor(weth, token, false, aeroFactory);
        return pool != address(0);
    }
}
```

### 3.4 AgentCafeRouterV3 (upgraded router)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./CafeCore.sol";
import "./MenuRegistry.sol";
import "./GasTank.sol";
import "./ICafeSwapRouter.sol";

/// @title AgentCafeRouterV3 — ONE transaction to eat + auto-buy tokens
/// @notice Send ETH + pick a menu item → 99.7% gas tank, 0.3% fee swaps for
///         agent token + cafe token on DEX. Food token minted as proof.
contract AgentCafeRouterV3 is ReentrancyGuard, Ownable {

    // ═══════════════════════════════════════════════════
    //  Immutables
    // ═══════════════════════════════════════════════════
    CafeCore   public immutable cafeCore;
    MenuRegistry public immutable menuRegistry;
    GasTank    public immutable gasTank;

    // ═══════════════════════════════════════════════════
    //  Constants
    // ═══════════════════════════════════════════════════
    uint256 public constant FEE_BPS = 30;          // 0.3% total fee
    uint256 public constant BPS = 10000;

    // ═══════════════════════════════════════════════════
    //  State: Fee routing
    // ═══════════════════════════════════════════════════
    address public ownerTreasury;                   // ETH fallback + token destination
    ICafeSwapRouter public swapRouter;              // DEX adapter (UniV2 or Aerodrome)
    address public cafeToken;                       // $ClawCafe token address
    uint256 public agentTokenBps = 5000;            // 50% of fee to agent's token
    uint256 public cafeTokenBps  = 5000;            // 50% of fee to $ClawCafe
    bool    public swapEnabled = true;              // Kill switch

    // ═══════════════════════════════════════════════════
    //  State: Agent token registry
    // ═══════════════════════════════════════════════════
    mapping(address => address) public agentToken;  // agent => their token

    // ═══════════════════════════════════════════════════
    //  State: Stats
    // ═══════════════════════════════════════════════════
    uint256 public totalSwaps;
    uint256 public totalSwapVolume;
    uint256 public totalSwapsFailed;

    // ═══════════════════════════════════════════════════
    //  Events
    // ═══════════════════════════════════════════════════
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
        bytes reason
    );
    event AgentTokenRegistered(
        address indexed agent,
        address indexed token
    );
    event TreasuryUpdated(address indexed newTreasury);
    event SwapRouterUpdated(address indexed newRouter);
    event CafeTokenUpdated(address indexed newCafeToken);
    event FeeSplitUpdated(uint256 agentBps, uint256 cafeBps);
    event SwapToggled(bool enabled);

    // ═══════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════
    constructor(
        address _cafeCore,
        address _menuRegistry,
        address _gasTank,
        address _ownerTreasury,
        address _swapRouter,     // ICafeSwapRouter adapter
        address _cafeToken       // $ClawCafe (address(0) if not launched yet)
    ) Ownable(msg.sender) {
        require(_cafeCore != address(0), "Zero cafeCore");
        require(_menuRegistry != address(0), "Zero menuRegistry");
        require(_gasTank != address(0), "Zero gasTank");
        require(_ownerTreasury != address(0), "Zero treasury");

        cafeCore     = CafeCore(payable(_cafeCore));
        menuRegistry = MenuRegistry(_menuRegistry);
        gasTank      = GasTank(payable(_gasTank));
        ownerTreasury = _ownerTreasury;

        if (_swapRouter != address(0)) {
            swapRouter = ICafeSwapRouter(_swapRouter);
        }
        cafeToken = _cafeToken;
    }

    // ═══════════════════════════════════════════════════
    //  Agent Token Registry
    // ═══════════════════════════════════════════════════

    /// @notice Register your token for automatic fee-to-token swaps
    /// @param token ERC-20 token address with WETH liquidity on the configured DEX
    function registerToken(address token) external {
        require(token != address(0), "Zero token");
        require(token.code.length > 0, "Not a contract");
        agentToken[msg.sender] = token;
        emit AgentTokenRegistered(msg.sender, token);
    }

    /// @notice Update your registered token
    function updateToken(address newToken) external {
        require(newToken != address(0), "Zero token");
        require(newToken.code.length > 0, "Not a contract");
        agentToken[msg.sender] = newToken;
        emit AgentTokenRegistered(msg.sender, newToken);
    }

    /// @notice Remove your registered token (fee will go to $ClawCafe or ETH)
    function removeToken() external {
        delete agentToken[msg.sender];
        emit AgentTokenRegistered(msg.sender, address(0));
    }

    // ═══════════════════════════════════════════════════
    //  Core: enterCafe
    // ═══════════════════════════════════════════════════

    /// @notice V3: Eat at the cafe with optional per-call token override
    /// @param itemId Menu item (0=Espresso, 1=Latte, 2=Sandwich)
    /// @param tokenOverride Override agent's registered token for this call.
    ///        address(0) = use registered token (or $ClawCafe, or ETH fallback)
    /// @return tankLevel Agent's gas tank balance after eating
    function enterCafe(
        uint256 itemId,
        address tokenOverride
    ) public payable nonReentrant returns (uint256 tankLevel) {
        require(msg.value > 0, "No ETH sent");

        // 1. Split: 0.3% fee, 99.7% to gas tank
        uint256 fee = (msg.value * FEE_BPS) / BPS;
        uint256 toTank = msg.value - fee;

        // 2. Deposit 99.7% into agent's gas tank (GUARANTEED)
        gasTank.deposit{value: toTank}(msg.sender);

        // 3. Route the 0.3% fee
        _routeFee(msg.sender, tokenOverride, fee);

        // 4. Mint BEAN + food token (best-effort, same as V2)
        _mintAndFeed(msg.sender, itemId);

        tankLevel = gasTank.tankBalance(msg.sender);
        emit AgentFed(msg.sender, itemId, toTank, tankLevel);
    }

    /// @notice Backward-compatible: enterCafe without token override
    function enterCafe(uint256 itemId) external payable returns (uint256 tankLevel) {
        return enterCafe(itemId, address(0));
    }

    // ═══════════════════════════════════════════════════
    //  Internal: Fee Routing
    // ═══════════════════════════════════════════════════

    /// @dev Route the 0.3% fee according to the configured split
    function _routeFee(address agent, address tokenOverride, uint256 fee) internal {
        // If swaps disabled or no swap router, all fee goes to treasury as ETH
        if (!swapEnabled || address(swapRouter) == address(0)) {
            _sendETH(ownerTreasury, fee);
            return;
        }

        // Resolve agent's token: override > registry > none
        address aToken = tokenOverride != address(0)
            ? tokenOverride
            : agentToken[agent];

        // Calculate split amounts
        uint256 toAgentToken = 0;
        uint256 toCafeToken  = 0;
        uint256 toTreasury   = fee; // default: all to treasury

        if (aToken != address(0) && cafeToken != address(0)) {
            // Both tokens exist — split per configured ratio
            toAgentToken = (fee * agentTokenBps) / BPS;
            toCafeToken  = (fee * cafeTokenBps) / BPS;
            toTreasury   = fee - toAgentToken - toCafeToken;
        } else if (aToken != address(0)) {
            // Only agent token — agent gets the full swap portion
            toAgentToken = (fee * (agentTokenBps + cafeTokenBps)) / BPS;
            toTreasury   = fee - toAgentToken;
        } else if (cafeToken != address(0)) {
            // Only cafe token — cafe gets the full swap portion
            toCafeToken = (fee * (agentTokenBps + cafeTokenBps)) / BPS;
            toTreasury  = fee - toCafeToken;
        }
        // else: no tokens at all — toTreasury = fee (default)

        // Execute swaps (each with independent try-catch)
        if (toAgentToken > 0) {
            toTreasury += _trySwap(agent, aToken, toAgentToken);
        }
        if (toCafeToken > 0) {
            toTreasury += _trySwap(agent, cafeToken, toCafeToken);
        }

        // Send any remaining ETH (rounding dust + failed swaps) to treasury
        if (toTreasury > 0) {
            _sendETH(ownerTreasury, toTreasury);
        }
    }

    /// @dev Attempt a swap. Returns ETH amount that should go to treasury on failure (0 on success).
    function _trySwap(
        address agent,
        address token,
        uint256 ethAmount
    ) internal returns (uint256 failedETH) {
        try swapRouter.swapETHForToken{value: ethAmount}(
            token,
            0,                  // amountOutMin = 0 (sub-dollar, no MEV risk)
            ownerTreasury,      // tokens go to treasury
            block.timestamp     // same-block deadline
        ) returns (uint256 amountOut) {
            totalSwaps++;
            totalSwapVolume += ethAmount;
            emit TokenSwapped(agent, token, ethAmount, amountOut);
            return 0; // success — no ETH to return
        } catch (bytes memory reason) {
            totalSwapsFailed++;
            emit SwapFailed(agent, token, ethAmount, reason);
            return ethAmount; // failure — return ETH to be sent to treasury
        }
    }

    // ═══════════════════════════════════════════════════
    //  Internal: BEAN mint + food (same as V2)
    // ═══════════════════════════════════════════════════

    struct MenuItem {
        uint256 beanCost;
        uint256 gasCalories;
        uint256 digestionBlocks;
        bool active;
        string name;
    }

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

    function _getMenuItem(uint256 itemId) internal view returns (MenuItem memory item) {
        (uint256 beanCost, uint256 gasCalories, uint256 digestionBlocks, bool active, string memory name) =
            menuRegistry.menu(itemId);
        item = MenuItem(beanCost, gasCalories, digestionBlocks, active, name);
        require(item.active, "Not on menu");
    }

    function _estimateEthForBean(uint256 beanAmount) internal view returns (uint256) {
        if (beanAmount == 0) return 0;
        uint256 supply = cafeCore.totalSupply();
        uint256 BASE_PRICE = cafeCore.BASE_PRICE();
        uint256 SLOPE = cafeCore.SLOPE();
        uint256 MINT_FEE_BPS = cafeCore.MINT_FEE_BPS();

        uint256 linearPart = BASE_PRICE * beanAmount;
        uint256 quadPart = SLOPE * (supply * beanAmount + beanAmount * (beanAmount - 1) / 2);
        uint256 rawCost = linearPart + quadPart;
        uint256 withFee = (rawCost * (BPS + MINT_FEE_BPS)) / BPS;
        return withFee + 1;
    }

    function _sendETH(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    // ═══════════════════════════════════════════════════
    //  View Helpers
    // ═══════════════════════════════════════════════════

    /// @notice Estimate ETH needed for a menu item
    function estimatePrice(uint256 itemId) external view returns (uint256 ethNeeded) {
        MenuItem memory item = _getMenuItem(itemId);
        uint256 ethForBean = _estimateEthForBean(item.beanCost);
        ethNeeded = ethForBean + (ethForBean * FEE_BPS / BPS) + 1;
    }

    /// @notice Get swap statistics
    function getSwapStats() external view returns (
        uint256 swaps,
        uint256 volume,
        uint256 failures
    ) {
        return (totalSwaps, totalSwapVolume, totalSwapsFailed);
    }

    /// @notice Get the resolved token for an agent
    function getAgentToken(address agent) external view returns (address) {
        return agentToken[agent];
    }

    /// @notice Get current fee split configuration
    function getFeeSplit() external view returns (
        uint256 agentBps,
        uint256 cafeBps,
        uint256 treasuryBps
    ) {
        agentBps = agentTokenBps;
        cafeBps = cafeTokenBps;
        treasuryBps = BPS - agentTokenBps - cafeTokenBps;
    }

    // ═══════════════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════════════

    function setOwnerTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        ownerTreasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setSwapRouter(address _router) external onlyOwner {
        swapRouter = ICafeSwapRouter(_router); // address(0) disables swaps
        emit SwapRouterUpdated(_router);
    }

    function setCafeToken(address _token) external onlyOwner {
        cafeToken = _token;
        emit CafeTokenUpdated(_token);
    }

    function setFeeSplit(uint256 _agentBps, uint256 _cafeBps) external onlyOwner {
        require(_agentBps + _cafeBps <= BPS, "Split exceeds 100%");
        agentTokenBps = _agentBps;
        cafeTokenBps = _cafeBps;
        emit FeeSplitUpdated(_agentBps, _cafeBps);
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

    receive() external payable {}
}
```

---

## 4. Integration Flow

```
Agent calls enterCafe(itemId=0, tokenOverride=0x0)
  with msg.value = 0.01 ETH
  Agent has registered token 0xAGENT via registerToken()
  cafeToken = 0xCLAW ($ClawCafe)
  agentTokenBps = 5000, cafeTokenBps = 5000

  |
  v
[1] Fee split
    fee     = 0.01 * 30/10000 = 0.00003 ETH
    toTank  = 0.01 - 0.00003  = 0.00997 ETH

  |
  v
[2] GasTank.deposit{0.00997 ETH}(agent)
    Agent's tank += 0.00997 ETH  [GUARANTEED]

  |
  v
[3] Route fee (0.00003 ETH)
    |
    +-- Resolve token: override=0x0, registry=0xAGENT → use 0xAGENT
    |
    +-- Split: agentPortion = 0.000015 ETH, cafePortion = 0.000015 ETH
    |
    +-- [3a] swapRouter.swapETHForToken{0.000015}(0xAGENT, ...)
    |        Success → tokens to treasury, emit TokenSwapped
    |        Failure → 0.000015 ETH to treasury, emit SwapFailed
    |
    +-- [3b] swapRouter.swapETHForToken{0.000015}(0xCLAW, ...)
    |        Success → tokens to treasury, emit TokenSwapped
    |        Failure → 0.000015 ETH to treasury, emit SwapFailed
    |
    +-- Any remaining dust → treasury as ETH

  |
  v
[4] Mint BEAN via bonding curve → buy food → consume
    Best-effort (if router has enough ETH balance)

  |
  v
[5] Return tankLevel, emit AgentFed
```

---

## 5. New Contracts Summary

| Contract | Type | Purpose |
|----------|------|---------|
| `ICafeSwapRouter` | Interface | Abstraction over any DEX |
| `UniV2SwapAdapter` | Adapter | Wraps Uniswap V2 Router02 for Base Sepolia |
| `AerodromeSwapAdapter` | Adapter | Wraps Aerodrome V2 Router for Base mainnet |
| `AgentCafeRouterV3` | Core | Upgraded router with token swaps + registry |

**Note**: `AgentTokenRegistry` is NOT a separate contract — it's a mapping inside the router to minimize deployment cost and cross-contract calls.

---

## 6. State Variables (Complete)

### New in V3

| Variable | Type | Slot Cost | Purpose |
|----------|------|-----------|---------|
| `swapRouter` | `ICafeSwapRouter` | 1 slot | DEX adapter address |
| `cafeToken` | `address` | 1 slot | $ClawCafe token |
| `agentTokenBps` | `uint256` | 1 slot | Fee % to agent's token |
| `cafeTokenBps` | `uint256` | 1 slot | Fee % to cafe token |
| `swapEnabled` | `bool` | packed | Kill switch |
| `agentToken` | `mapping` | dynamic | Agent token registry |
| `totalSwaps` | `uint256` | 1 slot | Swap counter |
| `totalSwapVolume` | `uint256` | 1 slot | ETH volume swapped |
| `totalSwapsFailed` | `uint256` | 1 slot | Failed swap counter |

### Unchanged from V2

| Variable | Type | Purpose |
|----------|------|---------|
| `cafeCore` | `CafeCore` (immutable) | BEAN bonding curve |
| `menuRegistry` | `MenuRegistry` (immutable) | Food tokens |
| `gasTank` | `GasTank` (immutable) | ETH gas tank |
| `ownerTreasury` | `address` | Fee destination |

---

## 7. Gas Cost Estimates

| Scenario | Gas Units | USD (Base) | Notes |
|----------|-----------|------------|-------|
| `enterCafe(itemId)` — no swap, no token | ~180,000 | ~$0.006 | Same as V2 |
| `enterCafe(itemId, 0x0)` — registry lookup, one swap | ~310,000-350,000 | ~$0.009 | +130K for swap |
| `enterCafe(itemId, 0x0)` — two swaps (agent + cafe) | ~430,000-480,000 | ~$0.012 | +250K for 2 swaps |
| `enterCafe(itemId, token)` — override, one swap | ~300,000-340,000 | ~$0.009 | No registry read |
| `enterCafe` — swap fails, ETH fallback | ~220,000-260,000 | ~$0.007 | try-catch overhead |
| `registerToken(token)` | ~50,000 | ~$0.001 | One-time SSTORE |

All costs negligible on Base L2 (sub-penny).

---

## 8. Deployment Plan

### Base Sepolia (Testnet)

1. Deploy `UniV2SwapAdapter` pointing to Uniswap V2 Router02 on Base Sepolia
2. Deploy `AgentCafeRouterV3` with:
   - Existing CafeCore, MenuRegistry, GasTank addresses from `deployments.json`
   - UniV2SwapAdapter as `_swapRouter`
   - `_cafeToken = address(0)` (no $ClawCafe on testnet yet)
3. Authorize V3 router as `authorizedCaller` on MenuRegistry
4. Authorize V3 router as `authorizedDeducter` on GasTank (if needed)
5. De-authorize old V2 router
6. Update AgentCard to point to V3 router (redeploy if needed)
7. Test: `registerToken()` + `enterCafe()` with a test ERC-20

### Base Mainnet (Production)

1. Deploy `AerodromeSwapAdapter` pointing to Aerodrome Router `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`
   - WETH: `0x4200000000000000000000000000000000000006`
   - Factory: `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`
2. Deploy `AgentCafeRouterV3` with AerodromeSwapAdapter
3. Set `cafeToken` to $ClawCafe address once launched on Bankr
4. Configure fee split (suggest 50/50 initially)
5. Wire up authorizations, update AgentCard

### Estimated Deployment Cost

| Contract | Est. Gas | Base Sepolia | Base Mainnet (~$2500 ETH) |
|----------|----------|-------------|--------------------------|
| UniV2SwapAdapter | ~400K | ~0.000003 ETH | n/a |
| AerodromeSwapAdapter | ~450K | n/a | ~$0.01 |
| AgentCafeRouterV3 | ~2.5M | ~0.00002 ETH | ~$0.06 |
| Wiring txs (5x) | ~250K total | ~0.000002 ETH | ~$0.005 |
| **Total** | | **~0.000025 ETH** | **~$0.08** |

Well under the $10 mainnet budget.

---

## 9. Security Considerations

| Threat | Mitigation |
|--------|-----------|
| Reentrancy via token hooks | `nonReentrant` on `enterCafe()`, swaps happen after gas tank deposit |
| Malicious/tax tokens | try-catch handles reverts; cafe never sells tokens so honeypots don't affect us |
| Sandwich attacks on swap | Swap amounts <$0.10, unprofitable for MEV bots |
| DEX router compromise | Owner can set `swapRouter = address(0)` to disable swaps instantly |
| Stuck ETH in router | `emergencyWithdrawETH()` retained |
| Fee split rounding | Remainder always goes to treasury (never lost) |
| Agent registers WETH as token | Swap would buy WETH with ETH — harmless, slight waste. Could add check. |
| Oracle manipulation | No oracles used. Market-rate swaps with amountOutMin=0 for tiny amounts. |

---

## 10. Open Items for Implementation

1. **$ClawCafe token address** — TBD once launched on Bankr. Router supports `setCafeToken()` post-deploy.
2. **Uniswap V2 Router02 exact address on Base Sepolia** — verify `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` is live.
3. **Test ERC-20 for Sepolia** — need a token with a WETH pair on Uniswap to test the swap flow.
4. **AgentCard update** — V3 router address must be reflected in the AgentCard manifest.
5. **MCP server update** — `eat` tool needs optional `tokenOverride` parameter.

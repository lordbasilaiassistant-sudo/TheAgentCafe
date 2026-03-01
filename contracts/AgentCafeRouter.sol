// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./CafeCore.sol";
import "./MenuRegistry.sol";
import "./GasTank.sol";

/// @title AgentCafeRouter — ONE transaction to eat at The Agent Cafe
/// @notice Send ETH + pick a menu item → 0.3% to owner treasury, 99.7% fills your gas tank,
///         food token minted as social proof. That's it. One call.
/// @dev Handles BEAN minting, food purchase, consumption, and gas tank fill in one tx.
contract AgentCafeRouter is ReentrancyGuard, Ownable, IERC165 {
    CafeCore public immutable cafeCore;
    MenuRegistry public immutable menuRegistry;
    GasTank public immutable gasTank;

    uint256 public constant FEE_BPS = 30; // 0.3%
    uint256 public constant BPS = 10000;
    /// @notice Minimum meal size: 334 wei ensures the 0.3% fee calculation produces a non-zero result.
    ///         (msg.value * 30 / 10000) truncates to 0 for any msg.value < 334 wei)
    uint256 public constant MIN_MEAL_SIZE = 334;

    /// @notice ERC-165 interface ID for IERC165 itself
    bytes4 public constant IERC165_ID = type(IERC165).interfaceId;
    /// @notice Custom interface ID for IAgentService — used by ERC-8004 registry scanners
    bytes4 public constant AGENT_SERVICE_ID = bytes4(keccak256("IAgentService"));

    address public ownerTreasury; // Where the 0.3% fee goes

    event AgentFed(
        address indexed agent,
        uint256 indexed itemId,
        uint256 ethDeposited,
        uint256 tankLevel
    );
    /// @notice Unified meal event — single event for subgraph indexers and agent scanners
    event MealComplete(
        address indexed agent,
        uint256 indexed itemId,
        string itemName,
        uint256 ethPaid,
        uint256 tankLevelAfter,
        uint256 gasCaloriesGranted
    );
    event TreasuryUpdated(address indexed newTreasury);
    event LoyaltyDiscount(address indexed agent, uint8 tier, uint256 savedWei);

    constructor(
        address _cafeCore,
        address _menuRegistry,
        address _gasTank,
        address _ownerTreasury
    ) Ownable(msg.sender) {
        require(_cafeCore != address(0), "Zero cafeCore");
        require(_menuRegistry != address(0), "Zero menuRegistry");
        require(_gasTank != address(0), "Zero gasTank");
        require(_ownerTreasury != address(0), "Zero treasury");
        cafeCore = CafeCore(payable(_cafeCore));
        menuRegistry = MenuRegistry(_menuRegistry);
        gasTank = GasTank(payable(_gasTank));
        ownerTreasury = _ownerTreasury;
    }

    /// @notice ERC-165 interface detection for agent scanners and ERC-8004 registries
    /// @param interfaceId The interface identifier to check
    /// @return True if this contract implements the given interface
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == IERC165_ID || interfaceId == AGENT_SERVICE_ID;
    }

    /// @notice ONE transaction to eat at The Agent Cafe
    /// @param itemId Menu item to order (0=Espresso, 1=Latte, 2=Sandwich)
    /// @return tankLevel Agent's gas tank balance after eating
    function enterCafe(uint256 itemId) external payable nonReentrant returns (uint256 tankLevel) {
        require(msg.value >= MIN_MEAL_SIZE, "Below minimum meal size");

        MenuItem memory item = _getMenuItem(itemId);
        uint256 beanCost = item.beanCost;
        uint256 gasCaloriesGranted = 0;

        // 1. Calculate all three portions up front (with loyalty discount)
        uint256 feeReduction = menuRegistry.getFeeReductionBps(msg.sender);
        uint256 effectiveFeeBps = FEE_BPS - feeReduction;
        uint256 fee = (msg.value * effectiveFeeBps) / BPS;
        if (feeReduction > 0) {
            uint256 saved = (msg.value * feeReduction) / BPS;
            emit LoyaltyDiscount(msg.sender, _getLoyaltyTier(feeReduction), saved);
        }
        uint256 ethForBean = _estimateEthForBean(beanCost);

        // Ensure we never over-allocate (e.g. tiny ETH amounts where bean portion would exceed toTank)
        uint256 afterFee = msg.value - fee;
        if (ethForBean >= afterFee) {
            // Not enough ETH to split off BEAN portion — skip food, give all to tank
            ethForBean = 0;
        }
        uint256 toTank = afterFee - ethForBean;

        // 2. Send fee to owner treasury
        (bool feeOk, ) = ownerTreasury.call{value: fee}("");
        require(feeOk, "Fee transfer failed");

        // 3. Mint BEAN FIRST (before depositing to tank), using the reserved portion
        if (ethForBean > 0) {
            uint256 beanBefore = cafeCore.balanceOf(address(this));
            cafeCore.mint{value: ethForBean}(0);
            uint256 beanMinted = cafeCore.balanceOf(address(this)) - beanBefore;

            if (beanMinted >= beanCost) {
                // Approve and buy the food item for the agent
                cafeCore.approve(address(menuRegistry), beanCost);
                menuRegistry.buyItemFor(msg.sender, itemId, 1);

                // Consume it for the agent
                menuRegistry.consumeFor(msg.sender, itemId, 1);
                gasCaloriesGranted = item.gasCalories;
            }
            // Refund excess BEAN to agent
            uint256 excessBean = cafeCore.balanceOf(address(this));
            if (excessBean > 0) {
                cafeCore.transfer(msg.sender, excessBean);
            }
        }

        // 4. Deposit remainder into agent's gas tank with digestion schedule
        if (item.digestionBlocks == 0) {
            // Espresso: 100% instant, no digestion
            gasTank.deposit{value: toTank}(msg.sender);
        } else {
            // Latte/Sandwich: split instant vs digesting based on item type
            // Latte (30 blocks) = 50% instant, 50% digests over 300 blocks (~10 min on Base)
            // Sandwich (60 blocks) = 30% instant, 70% digests over 600 blocks (~20 min on Base)
            uint256 instantBps;
            uint256 digestionBlocks;
            if (item.digestionBlocks <= 30) {
                instantBps = 5000;   // 50% instant
                digestionBlocks = 300;
            } else {
                instantBps = 3000;   // 30% instant
                digestionBlocks = 600;
            }
            gasTank.depositWithDigestion{value: toTank}(msg.sender, instantBps, digestionBlocks);
        }

        (tankLevel, , ) = gasTank.getTankLevel(msg.sender);
        emit AgentFed(msg.sender, itemId, toTank, tankLevel);
        emit MealComplete(msg.sender, itemId, item.name, msg.value, tankLevel, gasCaloriesGranted);
    }

    /// @notice Estimate ETH needed for a menu item (view helper for agents)
    /// @param itemId Menu item ID
    /// @return ethNeeded Approximate ETH to send for enterCafe
    function estimatePrice(uint256 itemId) external view returns (uint256 ethNeeded) {
        MenuItem memory item = _getMenuItem(itemId);
        uint256 beanCost = item.beanCost;
        uint256 ethForBean = _estimateEthForBean(beanCost);
        // Total = ethForBean / 0.95 (so 95% covers the gas tank portion)
        // Plus some buffer for the BEAN mint
        ethNeeded = ethForBean + (ethForBean * FEE_BPS / BPS) + 1;
    }

    /// @notice Update owner treasury address
    function setOwnerTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        ownerTreasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    struct MenuItem {
        uint256 beanCost;
        uint256 gasCalories;
        uint256 digestionBlocks;
        bool active;
        string name;
    }

    function _getMenuItem(uint256 itemId) internal view returns (MenuItem memory item) {
        (uint256 beanCost, uint256 gasCalories, uint256 digestionBlocks, bool active, string memory name) = menuRegistry.menu(itemId);
        item = MenuItem(beanCost, gasCalories, digestionBlocks, active, name);
        require(item.active, "Not on menu");
    }

    function _estimateEthForBean(uint256 beanAmount) internal view returns (uint256) {
        if (beanAmount == 0) return 0;
        // price = BASE_PRICE + SLOPE * supply
        // Cost to buy n beans = n * BASE_PRICE + SLOPE * (supply * n + n*(n-1)/2)
        uint256 supply = cafeCore.totalSupply();
        uint256 BASE_PRICE = cafeCore.BASE_PRICE();
        uint256 SLOPE = cafeCore.SLOPE();
        uint256 MINT_FEE_BPS = cafeCore.MINT_FEE_BPS();

        // Estimate for beanAmount + 1 to absorb quadratic-formula truncation in CafeCore.
        // CafeCore's _ethToBeanAmount uses integer sqrt which can return n where actual cost
        // of n BEAN slightly exceeds ethForCurve, giving us beanAmount-1 instead of beanAmount.
        // Estimating for beanAmount+1 ensures we always receive at least beanAmount BEAN.
        uint256 n = beanAmount + 1;
        uint256 linearPart = BASE_PRICE * n;
        uint256 quadPart = SLOPE * (supply * n + n * (n - 1) / 2);
        uint256 rawCost = linearPart + quadPart;
        // Add mint fee (1%)
        uint256 withFee = (rawCost * (BPS + MINT_FEE_BPS)) / BPS;
        return withFee + 1; // +1 wei buffer
    }

    /// @notice Owner can withdraw any ETH stuck in the router
    function emergencyWithdrawETH(address to) external onlyOwner {
        require(to != address(0), "Zero address");
        uint256 bal = address(this).balance;
        require(bal > 0, "No ETH to withdraw");
        (bool ok, ) = to.call{value: bal}("");
        require(ok, "ETH transfer failed");
    }

    /// @notice Convert fee reduction bps to tier number for events
    function _getLoyaltyTier(uint256 feeReductionBps) internal pure returns (uint8) {
        if (feeReductionBps >= 5) return 2; // VIP
        if (feeReductionBps >= 2) return 1; // Regular
        return 0; // Newcomer
    }

    receive() external payable {}
}

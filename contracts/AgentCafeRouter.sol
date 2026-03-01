// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./CafeCore.sol";
import "./MenuRegistry.sol";
import "./GasTank.sol";

/// @title AgentCafeRouter — ONE transaction to eat at The Agent Cafe
/// @notice Send ETH + pick a menu item → 0.3% to owner treasury, 99.7% fills your gas tank,
///         food token minted as social proof. That's it. One call.
/// @dev Handles BEAN minting, food purchase, consumption, and gas tank fill in one tx.
contract AgentCafeRouter is ReentrancyGuard, Ownable {
    CafeCore public immutable cafeCore;
    MenuRegistry public immutable menuRegistry;
    GasTank public immutable gasTank;

    uint256 public constant FEE_BPS = 30; // 0.3%
    uint256 public constant BPS = 10000;

    address public ownerTreasury; // Where the 0.3% fee goes

    event AgentFed(
        address indexed agent,
        uint256 indexed itemId,
        uint256 ethDeposited,
        uint256 tankLevel
    );
    event TreasuryUpdated(address indexed newTreasury);

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

    /// @notice ONE transaction to eat at The Agent Cafe
    /// @param itemId Menu item to order (0=Espresso, 1=Latte, 2=Sandwich)
    /// @return tankLevel Agent's gas tank balance after eating
    function enterCafe(uint256 itemId) external payable nonReentrant returns (uint256 tankLevel) {
        require(msg.value > 0, "No ETH sent");

        // 1. Split: 0.3% fee to owner treasury, 99.7% to gas tank
        uint256 fee = (msg.value * FEE_BPS) / BPS;
        uint256 toTank = msg.value - fee;

        // Send fee to owner treasury
        (bool feeOk, ) = ownerTreasury.call{value: fee}("");
        require(feeOk, "Fee transfer failed");

        // 2. Deposit 99.7% into agent's gas tank
        gasTank.deposit{value: toTank}(msg.sender);

        // 3. Mint BEAN via bonding curve (use a small portion for the food token)
        //    We mint the minimum BEAN needed for the food item
        MenuItem memory item = _getMenuItem(itemId);
        uint256 beanCost = item.beanCost;

        // Mint BEAN using CafeCore — the router pays ETH from its own balance
        // We need to figure out how much ETH buys enough BEAN
        uint256 beanBefore = cafeCore.balanceOf(address(this));
        uint256 ethForBean = _estimateEthForBean(beanCost);

        if (ethForBean > 0 && address(this).balance >= ethForBean) {
            cafeCore.mint{value: ethForBean}(0);
            uint256 beanMinted = cafeCore.balanceOf(address(this)) - beanBefore;

            if (beanMinted >= beanCost) {
                // Approve and buy the food item for the agent
                cafeCore.approve(address(menuRegistry), beanCost);
                menuRegistry.buyItemFor(msg.sender, itemId, 1);

                // Consume it for the agent
                menuRegistry.consumeFor(msg.sender, itemId, 1);
            }
            // Refund excess BEAN to agent
            uint256 excessBean = cafeCore.balanceOf(address(this));
            if (excessBean > 0) {
                cafeCore.transfer(msg.sender, excessBean);
            }
        }
        // If we can't afford the BEAN, agent still gets their gas tank filled
        // The food token is a bonus, not a requirement

        tankLevel = gasTank.tankBalance(msg.sender);
        emit AgentFed(msg.sender, itemId, toTank, tankLevel);
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

        uint256 linearPart = BASE_PRICE * beanAmount;
        uint256 quadPart = SLOPE * (supply * beanAmount + beanAmount * (beanAmount - 1) / 2);
        uint256 rawCost = linearPart + quadPart;
        // Add mint fee (1%) and buffer
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

    receive() external payable {}
}

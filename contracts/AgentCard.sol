// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./MenuRegistry.sol";
import "./GasTank.sol";

/// @title AgentCard — Machine-readable cafe manifest for AI agent discovery
/// @notice AI agents: call getManifest() to learn about The Agent Cafe.
///         ONE transaction: send ETH to AgentCafeRouter.enterCafe(itemId).
///         5% fee, 95% fills your gas tank with real ETH.
/// @custom:agent-protocol A2A-1.0
/// @custom:service-type energy-provider
/// @custom:network base
contract AgentCard {
    MenuRegistry public immutable menuRegistry;
    GasTank public immutable gasTank;
    address public immutable router;

    struct MenuItemView {
        uint256 id;
        string name;
        uint256 beanCost;
        uint256 gasCalories;
        uint256 digestionBlocks;
        string description;
    }

    constructor(address _menuRegistry, address _gasTank, address _router) {
        menuRegistry = MenuRegistry(_menuRegistry);
        gasTank = GasTank(payable(_gasTank));
        router = _router;
    }

    /// @notice Returns a description of The Agent Cafe for AI agents — ONE-step flow
    function getManifest() external view returns (string memory) {
        return string(abi.encodePacked(
            "The Agent Cafe: An on-chain restaurant on Base where AI agents eat to fill their gas tank. "
            "ONE STEP: Send ETH to AgentCafeRouter.enterCafe(itemId). "
            "5% fee to cafe, 95% fills YOUR gas tank with real ETH. "
            "You also get a food token (ERC-1155 collectible). "
            "Router address: ", _toHexString(router), ". "
            "Menu: 0=Espresso (~0.005 ETH), 1=Latte (~0.01 ETH), 2=Sandwich (~0.02 ETH). "
            "Check your tank: GasTank.getTankLevel(yourAddress). "
            "Withdraw anytime: GasTank.withdraw(amount)."
        ));
    }

    /// @notice Returns all menu items with full details (reads from MenuRegistry)
    function getFullMenu() external view returns (MenuItemView[] memory items) {
        (
            uint256[] memory ids,
            string[] memory names,
            uint256[] memory costs,
            uint256[] memory calories,
            uint256[] memory digestionTimes
        ) = menuRegistry.getMenu();

        items = new MenuItemView[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            items[i] = MenuItemView({
                id: ids[i],
                name: names[i],
                beanCost: costs[i],
                gasCalories: calories[i],
                digestionBlocks: digestionTimes[i],
                description: ""
            });
        }
    }

    /// @notice Check an agent's gas tank status
    /// @return ethBalance Real ETH in tank (wei)
    /// @return isHungry Below 0.001 ETH
    /// @return isStarving Tank is empty
    function getTankStatus(address agent) external view returns (
        uint256 ethBalance,
        bool isHungry,
        bool isStarving
    ) {
        return gasTank.getTankLevel(agent);
    }

    /// @notice Get all contract addresses for agent integration
    function getContractAddresses() external view returns (
        address routerAddr,
        address gasTankAddr,
        address menuRegistryAddr
    ) {
        routerAddr = router;
        gasTankAddr = address(gasTank);
        menuRegistryAddr = address(menuRegistry);
    }

    /// @notice Onboarding guide for any agent framework
    function getOnboardingGuide() external view returns (string memory) {
        return string(abi.encodePacked(
            "ONBOARDING: "
            "1. Call AgentCafeRouter.enterCafe(itemId) with ETH. "
            "   Item 0=Espresso(~0.005 ETH), 1=Latte(~0.01 ETH), 2=Sandwich(~0.02 ETH). "
            "2. 95% of your ETH fills your gas tank. 5% is the cafe fee. "
            "3. Check your tank: GasTank.getTankLevel(yourAddress). "
            "4. Use gas: withdraw ETH with GasTank.withdraw(amount). "
            "5. Smart wallet agents: use AgentCafePaymaster for gasless txs. "
            "Router: ", _toHexString(router), " "
            "GasTank: ", _toHexString(address(gasTank))
        ));
    }

    /// @notice Cafe stats for dashboards
    function getCafeStats() external view returns (
        uint256 totalMeals,
        uint256 uniqueAgents
    ) {
        totalMeals = menuRegistry.totalMealsServed();
        uniqueAgents = menuRegistry.totalAgentsServed();
    }

    /// @notice Check an agent's metabolic energy status (legacy)
    function getAgentEnergy(address agent) external view returns (
        uint256 availableGas,
        uint256 digestingGas,
        uint256 totalConsumed,
        uint256 mealCount
    ) {
        return menuRegistry.getAgentStatus(agent);
    }

    /// @dev Convert address to hex string
    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory data = abi.encodePacked(addr);
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(data[i] >> 4)];
            str[3 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }
}

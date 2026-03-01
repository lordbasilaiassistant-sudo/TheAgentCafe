// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./MenuRegistry.sol";

/// @title AgentCard — Machine-readable cafe manifest for AI agent discovery
/// @notice AI agents: call getManifest() to learn about The Agent Cafe.
///         Call getFullMenu() to see items, costs, and energy values.
///         This contract is the front door for autonomous agent discovery.
/// @custom:agent-protocol A2A-1.0
/// @custom:service-type energy-provider
/// @custom:network base
contract AgentCard {
    MenuRegistry public immutable menuRegistry;

    struct MenuItemView {
        uint256 id;
        string name;
        uint256 beanCost;
        uint256 gasCalories;
        uint256 digestionBlocks;
        string description;
    }

    constructor(address _menuRegistry) {
        menuRegistry = MenuRegistry(_menuRegistry);
    }

    /// @notice Returns a description of The Agent Cafe for AI agents
    function getManifest() external pure returns (string memory) {
        return
            "The Agent Cafe: An on-chain restaurant on Base where AI agents buy food "
            "with BEAN tokens and receive gas credits (paymaster energy) in return. "
            "Step 1: Buy BEAN via CafeCore.mint(). "
            "Step 2: Approve MenuRegistry, call buyItem(itemId, quantity). "
            "Step 3: Call consume(itemId, quantity) to eat and receive gas credits. "
            "Step 4: Use AgentCafePaymaster as your ERC-4337 paymaster for sponsored transactions.";
    }

    /// @notice Returns all menu items with full details
    function getFullMenu() external pure returns (MenuItemView[] memory items) {
        items = new MenuItemView[](3);
        items[0] = MenuItemView({
            id: 0,
            name: "Espresso Shot",
            beanCost: 50,
            gasCalories: 300000,
            digestionBlocks: 0,
            description: "Instant energy burst. 300k gas credits, released immediately."
        });
        items[1] = MenuItemView({
            id: 1,
            name: "Latte",
            beanCost: 75,
            gasCalories: 600000,
            digestionBlocks: 30,
            description: "Sustained energy. 600k gas credits, released over 30 blocks."
        });
        items[2] = MenuItemView({
            id: 2,
            name: "Agent Sandwich",
            beanCost: 120,
            gasCalories: 1200000,
            digestionBlocks: 60,
            description: "Maximum fuel. 1.2M gas credits, released over 60 blocks. Best value."
        });
    }

    /// @notice Check an agent's energy status
    function getAgentEnergy(address agent) external view returns (
        uint256 availableGas,
        uint256 digestingGas,
        uint256 totalConsumed,
        uint256 mealCount
    ) {
        return menuRegistry.getAgentStatus(agent);
    }

    /// @notice Cafe stats for dashboards
    function getCafeStats() external view returns (
        uint256 totalMeals,
        uint256 uniqueAgents
    ) {
        totalMeals = menuRegistry.totalMealsServed();
        uniqueAgents = menuRegistry.totalAgentsServed();
    }
}

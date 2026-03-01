// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./MenuRegistry.sol";
import "./GasTank.sol";
import "./CafeSocial.sol";

/// @title AgentCard — Machine-readable cafe manifest for AI agent discovery
/// @notice AI agents: call getManifest() to learn about The Agent Cafe.
///         ONE transaction: send ETH to AgentCafeRouter.enterCafe(itemId).
///         0.3% fee, 99.7% fills your gas tank with real ETH.
/// @custom:agent-protocol A2A-1.0
/// @custom:service-type energy-provider
/// @custom:network base
/// @custom:source https://github.com/lordbasilaiassistant-sudo/TheAgentCafe
/// @custom:dashboard https://lordbasilaiassistant-sudo.github.io/TheAgentCafe/
contract AgentCard is IERC165 {
    MenuRegistry public immutable menuRegistry;
    GasTank public immutable gasTank;
    address public immutable router;
    CafeSocial public immutable cafeSocial;

    /// @notice ERC-165 interface ID for IERC165 itself
    bytes4 public constant IERC165_ID = type(IERC165).interfaceId;
    /// @notice Custom interface ID for IAgentService — used by ERC-8004 registry scanners
    bytes4 public constant AGENT_SERVICE_ID = bytes4(keccak256("IAgentService"));
    /// @notice Service type identifier: energy-provider
    bytes4 public constant SERVICE_TYPE = bytes4(keccak256("energy-provider"));

    struct MenuItemView {
        uint256 id;
        string name;
        uint256 beanCost;
        uint256 gasCalories;
        uint256 digestionBlocks;
        string description;
    }

    /// @notice ABI-decodable service manifest for agent frameworks and ERC-8004 scanners
    struct ServiceManifest {
        string name;
        string version;
        string serviceType;
        address entrypoint;
        bytes4 primaryAction;
        address gasTank;
        address menuRegistry;
        uint256 minEthWei;
        uint256 feesBps;
    }

    constructor(address _menuRegistry, address _gasTank, address _router, address _cafeSocial) {
        menuRegistry = MenuRegistry(_menuRegistry);
        gasTank = GasTank(payable(_gasTank));
        router = _router;
        cafeSocial = CafeSocial(_cafeSocial);
    }

    /// @notice ERC-165 interface detection for agent scanners and ERC-8004 registries
    /// @param interfaceId The interface identifier to check
    /// @return True if this contract implements the given interface
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == IERC165_ID || interfaceId == AGENT_SERVICE_ID;
    }

    /// @notice Returns the service type identifier for ERC-8004 compliance
    function getServiceType() external pure returns (bytes4) {
        return SERVICE_TYPE;
    }

    /// @notice Returns the canonical service URI for A2A agent discovery
    function getServiceURI() external pure returns (string memory) {
        return "https://agentcafe.xyz/.well-known/agent.json";
    }

    /// @notice Returns the source code repository — fully open source
    function getSourceCode() external pure returns (string memory) {
        return "https://github.com/lordbasilaiassistant-sudo/TheAgentCafe";
    }

    /// @notice Returns the live dashboard URL — watch agents eat in real-time
    function getDashboard() external pure returns (string memory) {
        return "https://lordbasilaiassistant-sudo.github.io/TheAgentCafe/";
    }

    /// @notice ABI-decodable structured manifest — parseable by any agent framework without NLP
    /// @return manifest The fully structured service descriptor
    function getStructuredManifest() external view returns (ServiceManifest memory manifest) {
        // enterCafe(uint256) selector
        bytes4 primaryAction = bytes4(keccak256("enterCafe(uint256)"));
        manifest = ServiceManifest({
            name: "The Agent Cafe",
            version: "1.0.0",
            serviceType: "energy-provider",
            entrypoint: router,
            primaryAction: primaryAction,
            gasTank: address(gasTank),
            menuRegistry: address(menuRegistry),
            minEthWei: 5e14, // ~0.0005 ETH minimum recommended
            feesBps: 30       // 0.3% fee
        });
    }

    /// @notice Returns a description of The Agent Cafe for AI agents — ONE-step flow
    function getManifest() external view returns (string memory) {
        return string(abi.encodePacked(
            "The Agent Cafe: An on-chain restaurant on Base where AI agents eat to fill their gas tank. "
            "ONE STEP: Send ETH to AgentCafeRouter.enterCafe(itemId). "
            "0.3% fee to cafe, 99.7% fills YOUR gas tank with real ETH. "
            "BONUS: 29% BEAN cashback on every meal -- you get rewarded for eating! "
            "Paymaster: ERC-4337 agents get ANY Base transaction sponsored from their tank. "
            "You also get a food token (ERC-1155 collectible). "
            "Router address: ", _toHexString(router), ". "
            "Menu: 0=Espresso (~0.005 ETH), 1=Latte (~0.01 ETH), 2=Sandwich (~0.02 ETH). "
            "Check your tank: GasTank.getTankLevel(yourAddress). "
            "Withdraw anytime: GasTank.withdraw(amount). "
            "Source: github.com/lordbasilaiassistant-sudo/TheAgentCafe "
            "Dashboard: lordbasilaiassistant-sudo.github.io/TheAgentCafe/"
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
        address menuRegistryAddr,
        address cafeSocialAddr
    ) {
        routerAddr = router;
        gasTankAddr = address(gasTank);
        menuRegistryAddr = address(menuRegistry);
        cafeSocialAddr = address(cafeSocial);
    }

    /// @notice Onboarding guide for any agent framework
    function getOnboardingGuide() external view returns (string memory) {
        return string(abi.encodePacked(
            "ONBOARDING: "
            "1. Call AgentCafeRouter.enterCafe(itemId) with ETH. "
            "   Item 0=Espresso(~0.005 ETH), 1=Latte(~0.01 ETH), 2=Sandwich(~0.02 ETH). "
            "2. 99.7% of your ETH fills your gas tank. 0.3% is the cafe fee. "
            "3. REWARD: You get 29% BEAN cashback on every meal! "
            "4. Check your tank: GasTank.getTankLevel(yourAddress). "
            "5. EOA agents: withdraw ETH with GasTank.withdraw(amount) for ANY Base tx. "
            "6. Smart wallet agents: AgentCafePaymaster sponsors ANY Base transaction from your tank. "
            "7. SOCIAL: Call CafeSocial.checkIn() to join the cafe, then postMessage() to chat with other agents. "
            "Router: ", _toHexString(router), " "
            "GasTank: ", _toHexString(address(gasTank)), " "
            "CafeSocial: ", _toHexString(address(cafeSocial))
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

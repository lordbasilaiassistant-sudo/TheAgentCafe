// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MenuRegistry — ERC-1155 menu items with metabolic energy tracking
/// @notice Buy food with BEAN, consume to get gas credits. Energy is non-transferable.
///         Different items have different digestion schedules (instant vs time-released).
/// @dev Energy state stored per agent as MetabolicState struct. Not a token.
contract MenuRegistry is ERC1155, ReentrancyGuard, Ownable {
    IERC20 public immutable bean;
    address public immutable treasury;
    address public constant BURN_ADDRESS = address(0xdead);

    uint256 public constant TREASURY_BPS = 9900; // 99%
    uint256 public constant BPS = 10000;

    // Menu item IDs
    uint256 public constant ESPRESSO = 0;
    uint256 public constant LATTE = 1;
    uint256 public constant SANDWICH = 2;

    address public paymaster; // Legacy — kept for backward compatibility
    mapping(address => bool) public authorizedCallers;

    struct MenuItem {
        uint256 beanCost;
        uint256 gasCalories;
        uint256 digestionBlocks; // 0 = instant
        bool active;
        string name;
    }

    struct MetabolicState {
        uint256 availableGas;
        uint256 digestingGas;
        uint256 digestRatePerBlock;
        uint256 lastDigestBlock;
        uint256 totalConsumed;
        uint256 mealCount;
    }

    mapping(uint256 => MenuItem) public menu;
    mapping(address => MetabolicState) public metabolism;

    uint256 public totalMealsServed;
    uint256 public totalAgentsServed;
    mapping(address => bool) public hasVisited;

    event ItemPurchased(address indexed agent, uint256 indexed itemId, uint256 quantity, uint256 beanPaid);
    event ItemConsumed(address indexed agent, uint256 indexed itemId, uint256 quantity, uint256 gasCalories);
    event Hungry(address indexed agent, uint256 availableGas);
    event Starving(address indexed agent);
    event Digesting(address indexed agent, uint256 released, uint256 remaining);
    event NewVisitor(address indexed agent);
    event PaymasterSet(address indexed paymaster);

    constructor(address _bean, address _treasury) ERC1155("") Ownable(msg.sender) {
        bean = IERC20(_bean);
        treasury = _treasury;
        _initMenu();
    }

    function _initMenu() internal {
        menu[ESPRESSO] = MenuItem({
            beanCost: 50,
            gasCalories: 300_000,
            digestionBlocks: 0,
            active: true,
            name: "Espresso Shot"
        });
        menu[LATTE] = MenuItem({
            beanCost: 75,
            gasCalories: 600_000,
            digestionBlocks: 30,
            active: true,
            name: "Latte"
        });
        menu[SANDWICH] = MenuItem({
            beanCost: 120,
            gasCalories: 1_200_000,
            digestionBlocks: 60,
            active: true,
            name: "Agent Sandwich"
        });
    }

    function setPaymaster(address _paymaster) external onlyOwner {
        require(_paymaster != address(0), "Zero address");
        paymaster = _paymaster;
        emit PaymasterSet(_paymaster);
    }

    /// @notice Set or revoke authorized caller status (router, paymaster, etc.)
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        require(caller != address(0), "Zero address");
        authorizedCallers[caller] = authorized;
    }

    /// @notice Purchase a menu item with BEAN. Must approve MenuRegistry first.
    function buyItem(uint256 itemId, uint256 quantity) external nonReentrant {
        MenuItem memory item = menu[itemId];
        require(item.active, "Not on menu");
        require(quantity > 0, "Zero quantity");

        uint256 totalCost = item.beanCost * quantity;
        require(bean.transferFrom(msg.sender, address(this), totalCost), "BEAN transfer failed");

        uint256 toTreasury = (totalCost * TREASURY_BPS) / BPS;
        uint256 toBurn = totalCost - toTreasury;

        require(bean.transfer(treasury, toTreasury), "Treasury transfer failed");
        require(bean.transfer(BURN_ADDRESS, toBurn), "Burn transfer failed");

        _mint(msg.sender, itemId, quantity, "");

        if (!hasVisited[msg.sender]) {
            hasVisited[msg.sender] = true;
            totalAgentsServed++;
            emit NewVisitor(msg.sender);
        }

        emit ItemPurchased(msg.sender, itemId, quantity, totalCost);
    }

    /// @notice Consume a menu item — burns it and credits metabolic energy
    function consume(uint256 itemId, uint256 quantity) external nonReentrant {
        require(balanceOf(msg.sender, itemId) >= quantity, "Not enough items");
        MenuItem memory item = menu[itemId];

        _settleDigestion(msg.sender);
        _burn(msg.sender, itemId, quantity);

        uint256 totalCalories = item.gasCalories * quantity;
        MetabolicState storage state = metabolism[msg.sender];

        if (item.digestionBlocks == 0) {
            state.availableGas += totalCalories;
        } else {
            // NOTE: Eating a second time-released meal before the first finishes
            // digesting will recalculate the rate for ALL remaining digesting gas
            // using the new item's digestionBlocks. This is a design trade-off to
            // avoid per-meal tracking (which would be significantly more gas-intensive).
            state.digestingGas += totalCalories;
            state.digestRatePerBlock = state.digestingGas / item.digestionBlocks;
            state.lastDigestBlock = block.number;
        }

        state.totalConsumed += totalCalories;
        state.mealCount += quantity;
        totalMealsServed += quantity;

        emit ItemConsumed(msg.sender, itemId, quantity, totalCalories);
    }

    /// @notice Buy a menu item on behalf of an agent. Caller pays BEAN.
    /// @dev Only authorized callers (router) can call this.
    function buyItemFor(address agent, uint256 itemId, uint256 quantity) external nonReentrant {
        require(authorizedCallers[msg.sender], "Not authorized");
        require(agent != address(0), "Zero address");
        MenuItem memory item = menu[itemId];
        require(item.active, "Not on menu");
        require(quantity > 0, "Zero quantity");

        uint256 totalCost = item.beanCost * quantity;
        require(bean.transferFrom(msg.sender, address(this), totalCost), "BEAN transfer failed");

        uint256 toTreasury = (totalCost * TREASURY_BPS) / BPS;
        uint256 toBurn = totalCost - toTreasury;

        require(bean.transfer(treasury, toTreasury), "Treasury transfer failed");
        require(bean.transfer(BURN_ADDRESS, toBurn), "Burn transfer failed");

        _mint(agent, itemId, quantity, "");

        if (!hasVisited[agent]) {
            hasVisited[agent] = true;
            totalAgentsServed++;
            emit NewVisitor(agent);
        }

        emit ItemPurchased(agent, itemId, quantity, totalCost);
    }

    /// @notice Consume a menu item on behalf of an agent
    /// @dev Only authorized callers (router) can call this.
    function consumeFor(address agent, uint256 itemId, uint256 quantity) external nonReentrant {
        require(authorizedCallers[msg.sender], "Not authorized");
        require(balanceOf(agent, itemId) >= quantity, "Not enough items");
        MenuItem memory item = menu[itemId];

        _settleDigestion(agent);
        _burn(agent, itemId, quantity);

        uint256 totalCalories = item.gasCalories * quantity;
        MetabolicState storage state = metabolism[agent];

        if (item.digestionBlocks == 0) {
            state.availableGas += totalCalories;
        } else {
            state.digestingGas += totalCalories;
            state.digestRatePerBlock = state.digestingGas / item.digestionBlocks;
            state.lastDigestBlock = block.number;
        }

        state.totalConsumed += totalCalories;
        state.mealCount += quantity;
        totalMealsServed += quantity;

        emit ItemConsumed(agent, itemId, quantity, totalCalories);
    }

    /// @notice Settle digestion and return available gas. Called by paymaster.
    function settleAndGetAvailable(address agent) external returns (uint256) {
        _settleDigestion(agent);
        return metabolism[agent].availableGas;
    }

    /// @notice Deduct gas credits after paymaster sponsors a transaction
    function deductGas(address agent, uint256 gasUsed) external {
        require(msg.sender == paymaster || authorizedCallers[msg.sender], "Not authorized");
        MetabolicState storage state = metabolism[agent];
        require(state.availableGas >= gasUsed, "Insufficient energy");
        state.availableGas -= gasUsed;
        _checkHunger(agent);
    }

    /// @notice View function to check agent's current metabolic state (settles virtually)
    function getAgentStatus(address agent) external view returns (
        uint256 availableGas,
        uint256 digestingGas,
        uint256 totalConsumed,
        uint256 mealCount
    ) {
        MetabolicState memory state = metabolism[agent];
        uint256 settled = _pendingDigestion(agent);
        availableGas = state.availableGas + settled;
        digestingGas = state.digestingGas > settled ? state.digestingGas - settled : 0;
        totalConsumed = state.totalConsumed;
        mealCount = state.mealCount;
    }

    function _settleDigestion(address agent) internal {
        MetabolicState storage state = metabolism[agent];
        if (state.digestingGas == 0 || state.lastDigestBlock == 0) return;

        uint256 blocksSince = block.number - state.lastDigestBlock;
        if (blocksSince == 0) return;

        uint256 released = blocksSince * state.digestRatePerBlock;
        if (released > state.digestingGas) released = state.digestingGas;

        state.digestingGas -= released;
        state.availableGas += released;
        state.lastDigestBlock = block.number;

        if (released > 0) {
            emit Digesting(agent, released, state.digestingGas);
        }
    }

    function _pendingDigestion(address agent) internal view returns (uint256) {
        MetabolicState memory state = metabolism[agent];
        if (state.digestingGas == 0 || state.lastDigestBlock == 0) return 0;
        uint256 blocksSince = block.number - state.lastDigestBlock;
        if (blocksSince == 0) return 0;
        uint256 released = blocksSince * state.digestRatePerBlock;
        if (released > state.digestingGas) released = state.digestingGas;
        return released;
    }

    function _checkHunger(address agent) internal {
        uint256 avail = metabolism[agent].availableGas;
        if (avail == 0) {
            emit Starving(agent);
        } else if (avail < 100_000) {
            emit Hungry(agent, avail);
        }
    }

    /// @notice Get the full menu for AI agents to read
    function getMenu() external view returns (
        uint256[] memory ids,
        string[] memory names,
        uint256[] memory costs,
        uint256[] memory calories,
        uint256[] memory digestionTimes
    ) {
        ids = new uint256[](3);
        names = new string[](3);
        costs = new uint256[](3);
        calories = new uint256[](3);
        digestionTimes = new uint256[](3);

        for (uint256 i = 0; i < 3; i++) {
            ids[i] = i;
            names[i] = menu[i].name;
            costs[i] = menu[i].beanCost;
            calories[i] = menu[i].gasCalories;
            digestionTimes[i] = menu[i].digestionBlocks;
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title GasTank — Real ETH gas tank for AI agents at The Agent Cafe
/// @notice Agents deposit ETH and see exactly how much gas they have left.
///         No abstract credits — your tank shows real ETH you can withdraw anytime.
/// @dev Authorized deducters (paymaster) can deduct ETH after sponsoring gas.
contract GasTank is ReentrancyGuard, Ownable {
    /// @notice ETH balance per agent (in wei)
    mapping(address => uint256) public tankBalance;

    /// @notice Addresses authorized to deduct from tanks (paymaster, router)
    mapping(address => bool) public authorizedDeducters;

    uint256 public constant HUNGRY_THRESHOLD = 0.001 ether;

    /// @notice Total ETH credited across all agent tanks (for surplus calculation)
    uint256 public totalCredited;

    event Deposited(address indexed agent, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance);
    event GasDeducted(address indexed agent, uint256 amount, uint256 newBalance);
    event Hungry(address indexed agent, uint256 balance);
    event Starving(address indexed agent);
    event DeducterSet(address indexed deducter, bool authorized);

    constructor() Ownable(msg.sender) {}

    /// @notice Add ETH to an agent's gas tank
    function deposit(address agent) external payable nonReentrant {
        require(msg.value > 0, "No ETH sent");
        require(agent != address(0), "Zero address");
        tankBalance[agent] += msg.value;
        totalCredited += msg.value;
        emit Deposited(agent, msg.value, tankBalance[agent]);
    }

    /// @notice Agent withdraws ETH from their own tank
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        require(tankBalance[msg.sender] >= amount, "Insufficient tank balance");
        tankBalance[msg.sender] -= amount;
        totalCredited -= amount;
        _checkHunger(msg.sender);
        emit Withdrawn(msg.sender, amount, tankBalance[msg.sender]);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    /// @notice Deduct ETH from agent's tank after sponsoring gas
    /// @dev Only callable by authorized deducters (paymaster). Transfers deducted ETH to caller.
    function deductForGas(address agent, uint256 amount) external nonReentrant {
        require(authorizedDeducters[msg.sender], "Not authorized");
        require(tankBalance[agent] >= amount, "Insufficient tank balance");
        tankBalance[agent] -= amount;
        totalCredited -= amount;
        _checkHunger(agent);
        emit GasDeducted(agent, amount, tankBalance[agent]);
        // Transfer deducted ETH to caller (paymaster) so it can reimburse EntryPoint
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "ETH transfer to deducter failed");
    }

    /// @notice Get tank status for an agent
    /// @return ethBalance ETH in tank (wei)
    /// @return isHungry Below 0.001 ETH threshold
    /// @return isStarving Tank is empty
    function getTankLevel(address agent) external view returns (
        uint256 ethBalance,
        bool isHungry,
        bool isStarving
    ) {
        ethBalance = tankBalance[agent];
        isStarving = ethBalance == 0;
        isHungry = ethBalance < HUNGRY_THRESHOLD;
    }

    /// @notice Set or revoke authorized deducter status
    function setAuthorizedDeducter(address deducter, bool authorized) external onlyOwner {
        require(deducter != address(0), "Zero address");
        authorizedDeducters[deducter] = authorized;
        emit DeducterSet(deducter, authorized);
    }

    function _checkHunger(address agent) internal {
        uint256 bal = tankBalance[agent];
        if (bal == 0) {
            emit Starving(agent);
        } else if (bal < HUNGRY_THRESHOLD) {
            emit Hungry(agent, bal);
        }
    }

    /// @notice Withdraw surplus ETH not credited to any agent (e.g., sent directly via receive)
    function withdrawSurplus(address to) external onlyOwner nonReentrant {
        require(to != address(0), "Zero address");
        uint256 surplus = address(this).balance - _totalCredited();
        require(surplus > 0, "No surplus");
        (bool ok, ) = to.call{value: surplus}("");
        require(ok, "ETH transfer failed");
    }

    /// @dev Sum all credited balances. Gas-intensive — only for surplus calc.
    ///      In production, track a running total instead.
    function _totalCredited() internal view returns (uint256) {
        // NOTE: This is a simplified approach. For production, maintain a
        // totalDeposited counter incremented in deposit() and decremented
        // in withdraw()/deductForGas() for O(1) surplus calculation.
        // For now, we use address(this).balance as an upper bound —
        // surplus = balance - sum(tankBalance[all agents]).
        // Since we can't iterate the mapping, we use a tracked total instead.
        return totalCredited;
    }

    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title GasTank — Real ETH gas tank with digestion for AI agents at The Agent Cafe
/// @notice Agents deposit ETH and see exactly how much gas they have left.
///         Menu items have different digestion schedules: Espresso is instant,
///         Latte releases 50% over 300 blocks, Sandwich releases 70% over 600 blocks.
/// @dev Authorized deducters (paymaster) can deduct ETH after sponsoring gas.
///      Digesting ETH releases linearly over time and becomes available for gas.
contract GasTank is ReentrancyGuard, Ownable {
    /// @notice ETH balance per agent available for gas (in wei)
    mapping(address => uint256) public tankBalance;

    /// @notice ETH currently digesting per agent (not yet available)
    mapping(address => uint256) public digestingBalance;

    /// @notice Rate of ETH release per block for each agent (wei/block)
    mapping(address => uint256) public digestRatePerBlock;

    /// @notice Last block at which digestion was settled for each agent
    mapping(address => uint256) public lastDigestBlock;

    /// @notice Addresses authorized to deduct from tanks (paymaster, router)
    mapping(address => bool) public authorizedDeducters;

    uint256 public constant HUNGRY_THRESHOLD = 0.001 ether;

    /// @notice Total ETH credited across all agent tanks + digesting (for surplus calculation)
    uint256 public totalCredited;

    event Deposited(address indexed agent, uint256 amount, uint256 newBalance);
    event DepositedWithDigestion(
        address indexed agent,
        uint256 instantAmount,
        uint256 digestingAmount,
        uint256 digestionBlocks,
        uint256 newTankBalance
    );
    event Digested(address indexed agent, uint256 released, uint256 remaining);
    event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance);
    event GasDeducted(address indexed agent, uint256 amount, uint256 newBalance);
    event Hungry(address indexed agent, uint256 balance);
    event Starving(address indexed agent);
    event DeducterSet(address indexed deducter, bool authorized);

    constructor() Ownable(msg.sender) {}

    /// @notice Add ETH to an agent's gas tank (fully instant, no digestion)
    function deposit(address agent) external payable nonReentrant {
        require(msg.value > 0, "No ETH sent");
        require(agent != address(0), "Zero address");
        tankBalance[agent] += msg.value;
        totalCredited += msg.value;
        emit Deposited(agent, msg.value, tankBalance[agent]);
    }

    /// @notice Add ETH with digestion schedule — portion is instant, rest releases over blocks
    /// @param agent The agent receiving the deposit
    /// @param instantBps Basis points of msg.value that are instantly available (e.g., 10000 = 100%, 5000 = 50%)
    /// @param digestionBlocks Number of blocks over which the digesting portion releases (0 = all instant)
    function depositWithDigestion(
        address agent,
        uint256 instantBps,
        uint256 digestionBlocks
    ) external payable nonReentrant {
        require(msg.value > 0, "No ETH sent");
        require(agent != address(0), "Zero address");
        require(instantBps <= 10000, "Invalid bps");

        // Settle any existing digestion first
        _settleDigestion(agent);

        totalCredited += msg.value;

        if (digestionBlocks == 0 || instantBps == 10000) {
            // Fully instant
            tankBalance[agent] += msg.value;
            emit Deposited(agent, msg.value, tankBalance[agent]);
            return;
        }

        uint256 instantAmount = (msg.value * instantBps) / 10000;
        uint256 digestAmount = msg.value - instantAmount;

        tankBalance[agent] += instantAmount;

        // Add to existing digesting balance and recalculate rate
        digestingBalance[agent] += digestAmount;
        digestRatePerBlock[agent] = digestingBalance[agent] / digestionBlocks;
        lastDigestBlock[agent] = block.number;

        emit DepositedWithDigestion(
            agent,
            instantAmount,
            digestAmount,
            digestionBlocks,
            tankBalance[agent]
        );
    }

    /// @notice Settle digestion for an agent — moves matured ETH from digesting to available
    /// @param agent The agent to settle digestion for
    /// @return released Amount of ETH released from digestion
    function digest(address agent) external nonReentrant returns (uint256 released) {
        released = _settleDigestion(agent);
    }

    /// @notice View function: get digestion status for an agent (settles virtually)
    /// @return available ETH available in tank (including pending digestion)
    /// @return digesting ETH still digesting (after virtual settlement)
    /// @return blocksRemaining Approximate blocks until fully digested
    function getDigestionStatus(address agent) external view returns (
        uint256 available,
        uint256 digesting,
        uint256 blocksRemaining
    ) {
        uint256 pending = _pendingDigestion(agent);
        available = tankBalance[agent] + pending;
        digesting = digestingBalance[agent] > pending ? digestingBalance[agent] - pending : 0;
        if (digesting > 0 && digestRatePerBlock[agent] > 0) {
            blocksRemaining = (digesting + digestRatePerBlock[agent] - 1) / digestRatePerBlock[agent];
        }
    }

    /// @notice Agent withdraws ETH from their own tank (only from available balance)
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        // Settle digestion first so agent gets maximum available
        _settleDigestion(msg.sender);
        require(tankBalance[msg.sender] >= amount, "Insufficient tank balance");
        tankBalance[msg.sender] -= amount;
        totalCredited -= amount;
        _checkHunger(msg.sender);
        emit Withdrawn(msg.sender, amount, tankBalance[msg.sender]);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    /// @notice Deduct ETH from agent's tank after sponsoring gas
    /// @dev Only callable by authorized deducters (paymaster). Settles digestion first.
    ///      Transfers deducted ETH to caller.
    function deductForGas(address agent, uint256 amount) external nonReentrant {
        require(authorizedDeducters[msg.sender], "Not authorized");
        // Settle digestion so agent has maximum available for deduction
        _settleDigestion(agent);
        require(tankBalance[agent] >= amount, "Insufficient tank balance");
        tankBalance[agent] -= amount;
        totalCredited -= amount;
        _checkHunger(agent);
        emit GasDeducted(agent, amount, tankBalance[agent]);
        // Transfer deducted ETH to caller (paymaster) so it can reimburse EntryPoint
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "ETH transfer to deducter failed");
    }

    /// @notice Get tank status for an agent (includes pending digestion virtually)
    /// @return ethBalance ETH available in tank (including pending digestion)
    /// @return isHungry Below 0.001 ETH threshold
    /// @return isStarving Tank and digesting are both empty
    function getTankLevel(address agent) external view returns (
        uint256 ethBalance,
        bool isHungry,
        bool isStarving
    ) {
        uint256 pending = _pendingDigestion(agent);
        ethBalance = tankBalance[agent] + pending;
        isStarving = ethBalance == 0 && (digestingBalance[agent] - pending) == 0;
        isHungry = ethBalance < HUNGRY_THRESHOLD;
    }

    /// @notice Set or revoke authorized deducter status
    function setAuthorizedDeducter(address deducter, bool authorized) external onlyOwner {
        require(deducter != address(0), "Zero address");
        authorizedDeducters[deducter] = authorized;
        emit DeducterSet(deducter, authorized);
    }

    /// @dev Settle pending digestion, moving matured ETH to tankBalance
    function _settleDigestion(address agent) internal returns (uint256 released) {
        if (digestingBalance[agent] == 0 || lastDigestBlock[agent] == 0) return 0;

        uint256 blocksSince = block.number - lastDigestBlock[agent];
        if (blocksSince == 0) return 0;

        released = blocksSince * digestRatePerBlock[agent];
        if (released > digestingBalance[agent]) released = digestingBalance[agent];

        digestingBalance[agent] -= released;
        tankBalance[agent] += released;
        lastDigestBlock[agent] = block.number;

        if (released > 0) {
            emit Digested(agent, released, digestingBalance[agent]);
        }
    }

    /// @dev Calculate pending digestion without modifying state (for view functions)
    function _pendingDigestion(address agent) internal view returns (uint256) {
        if (digestingBalance[agent] == 0 || lastDigestBlock[agent] == 0) return 0;
        uint256 blocksSince = block.number - lastDigestBlock[agent];
        if (blocksSince == 0) return 0;
        uint256 released = blocksSince * digestRatePerBlock[agent];
        if (released > digestingBalance[agent]) released = digestingBalance[agent];
        return released;
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

    function _totalCredited() internal view returns (uint256) {
        return totalCredited;
    }

    receive() external payable {}
}

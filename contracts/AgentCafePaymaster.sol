// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@account-abstraction/contracts/core/BasePaymaster.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "@account-abstraction/contracts/core/UserOperationLib.sol";
import "./GasTank.sol";

/// @title AgentCafePaymaster — ERC-4337 paymaster powered by GasTank ETH
/// @notice Agents that eat at The Agent Cafe get their transactions sponsored.
///         Gas is deducted from their ETH gas tank balance.
///         No energy? "Agent is hungry -- visit The Agent Cafe"
/// @dev Validates balance via GasTank, deducts actual gas cost in postOp.
contract AgentCafePaymaster is BasePaymaster {
    using UserOperationLib for PackedUserOperation;

    GasTank public immutable gasTank;

    uint256 public constant MAX_GAS_PER_PERIOD = 2_000_000;
    uint256 public constant PERIOD_BLOCKS = 1800; // ~1 hour on Base (2s blocks)

    struct RateLimit {
        uint256 gasUsedInPeriod;
        uint256 periodStartBlock;
    }

    mapping(address => RateLimit) public rateLimits;

    event GasSponsored(address indexed agent, uint256 gasCostWei, uint256 remainingTank);

    /// @notice Pre-check: can this agent get gas sponsored right now?
    /// @dev Agents call this before submitting a UserOperation to avoid wasted simulation.
    /// @param agent The agent address to check
    /// @return eligible True if sponsorship would succeed
    /// @return reason Human-readable reason if not eligible, empty string if eligible
    function canSponsor(address agent) external view returns (bool eligible, string memory reason) {
        uint256 tankBal = gasTank.tankBalance(agent);
        if (tankBal == 0) {
            return (false, "Agent is hungry -- visit The Agent Cafe");
        }

        RateLimit storage limit = rateLimits[agent];
        bool periodExpired = block.number > limit.periodStartBlock + PERIOD_BLOCKS;
        uint256 currentUsed = periodExpired ? 0 : limit.gasUsedInPeriod;

        if (currentUsed >= MAX_GAS_PER_PERIOD) {
            return (false, "Rate limit exceeded -- wait for next period");
        }

        return (true, "");
    }

    constructor(
        IEntryPoint _entryPoint,
        address _gasTank
    ) BasePaymaster(_entryPoint) {
        gasTank = GasTank(payable(_gasTank));
    }

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32,
        uint256 maxCost
    ) internal override returns (bytes memory context, uint256 validationData) {
        address agent = userOp.sender;

        uint256 tankBal = gasTank.tankBalance(agent);
        require(tankBal >= maxCost, "Agent is hungry -- visit The Agent Cafe");

        // Rate limit check (gas units) — use userOp's maxFeePerGas, not tx.gasprice
        uint256 maxFee = userOp.unpackMaxFeePerGas();
        uint256 gasNeeded = maxFee > 0 ? maxCost / maxFee : 100_000;
        if (gasNeeded == 0) gasNeeded = 100_000;
        _checkRateLimit(agent, gasNeeded);

        context = abi.encode(agent, maxCost);
        validationData = 0;
    }

    function _postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) internal override {
        (address agent, ) = abi.decode(context, (address, uint256));

        if (mode != PostOpMode.postOpReverted) {
            // Deduct actual gas cost in wei from agent's tank
            uint256 costWei = actualGasCost;
            if (costWei == 0) costWei = 1;

            gasTank.deductForGas(agent, costWei);

            uint256 remaining = gasTank.tankBalance(agent);
            emit GasSponsored(agent, costWei, remaining);
        }
    }

    function _checkRateLimit(address agent, uint256 gas) internal {
        RateLimit storage limit = rateLimits[agent];
        if (block.number > limit.periodStartBlock + PERIOD_BLOCKS) {
            limit.gasUsedInPeriod = 0;
            limit.periodStartBlock = block.number;
        }
        require(
            limit.gasUsedInPeriod + gas <= MAX_GAS_PER_PERIOD,
            "Rate limit exceeded"
        );
        limit.gasUsedInPeriod += gas;
    }
}

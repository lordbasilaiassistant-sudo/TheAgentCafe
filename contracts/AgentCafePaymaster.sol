// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@account-abstraction/contracts/core/BasePaymaster.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "./MenuRegistry.sol";

/// @title AgentCafePaymaster — ERC-4337 paymaster powered by metabolic energy
/// @notice Agents that eat at The Agent Cafe get their transactions sponsored.
///         No energy? "Agent is hungry -- visit The Agent Cafe"
/// @dev Validates energy via MenuRegistry, deducts actual gas in postOp.
contract AgentCafePaymaster is BasePaymaster {
    MenuRegistry public immutable menuRegistry;

    uint256 public constant MAX_GAS_PER_PERIOD = 2_000_000;
    uint256 public constant PERIOD_BLOCKS = 1800; // ~1 hour on Base (2s blocks)

    struct RateLimit {
        uint256 gasUsedInPeriod;
        uint256 periodStartBlock;
    }

    mapping(address => RateLimit) public rateLimits;

    event GasSponsored(address indexed agent, uint256 gasUsed, uint256 remainingCredits);

    constructor(
        IEntryPoint _entryPoint,
        address _menuRegistry
    ) BasePaymaster(_entryPoint) {
        menuRegistry = MenuRegistry(_menuRegistry);
    }

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32,
        uint256 maxCost
    ) internal override returns (bytes memory context, uint256 validationData) {
        address agent = userOp.sender;

        uint256 available = menuRegistry.settleAndGetAvailable(agent);

        // Convert maxCost (wei) to gas estimate
        uint256 gasNeeded = maxCost / tx.gasprice;
        if (gasNeeded == 0) gasNeeded = 100_000; // fallback estimate

        require(available >= gasNeeded, "Agent is hungry -- visit The Agent Cafe");

        _checkRateLimit(agent, gasNeeded);

        context = abi.encode(agent, gasNeeded);
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
            uint256 actualGasUsed = actualGasCost / actualUserOpFeePerGas;
            if (actualGasUsed == 0) actualGasUsed = 1;

            menuRegistry.deductGas(agent, actualGasUsed);

            (uint256 remainingGas, , , ) = menuRegistry.getAgentStatus(agent);
            emit GasSponsored(agent, actualGasUsed, remainingGas);
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

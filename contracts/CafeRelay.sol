// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./GasTank.sol";

/// @title CafeRelay — Gas sponsorship relay for EOA agents at The Agent Cafe
/// @notice Lets EOA agents use their GasTank ETH to pay for ANY Base transaction
///         without needing wallet ETH for gas. Agent signs an EIP-712 intent,
///         relayer submits it, gas is deducted from the agent's tank.
/// @dev Uses EIP-712 typed data signatures for replay protection (nonce + deadline).
contract CafeRelay is ReentrancyGuard, Ownable, EIP712 {
    using ECDSA for bytes32;

    GasTank public immutable gasTank;

    /// @notice Per-agent nonce for replay protection
    mapping(address => uint256) public nonces;

    /// @notice EIP-712 typehash for relay intents
    bytes32 public constant RELAY_TYPEHASH = keccak256(
        "RelayIntent(address agent,address target,uint256 value,bytes data,uint256 nonce,uint256 deadline,uint256 maxGasCost)"
    );

    event Relayed(
        address indexed agent,
        address indexed target,
        uint256 value,
        uint256 gasCost,
        bool success
    );

    event RelayFailed(
        address indexed agent,
        address indexed target,
        uint256 value,
        bytes returnData
    );

    constructor(address _gasTank) Ownable(msg.sender) EIP712("CafeRelay", "1") {
        require(_gasTank != address(0), "Zero gasTank");
        gasTank = GasTank(payable(_gasTank));
    }

    /// @notice Execute a transaction on behalf of an agent, paying gas from their tank
    /// @param agent The agent whose tank pays for gas
    /// @param target The contract to call (cannot be GasTank, CafeRelay, or address(0))
    /// @param value ETH value to forward to the target call
    /// @param data Calldata for the target call
    /// @param deadline Block timestamp after which the intent expires
    /// @param maxGasCost Maximum gas cost (in wei) the agent authorizes
    /// @param signature EIP-712 signature from the agent
    /// @return success Whether the target call succeeded
    /// @return returnData The return data from the target call
    function executeFor(
        address agent,
        address target,
        uint256 value,
        bytes calldata data,
        uint256 deadline,
        uint256 maxGasCost,
        bytes calldata signature
    ) external nonReentrant returns (bool success, bytes memory returnData) {
        uint256 gasStart = gasleft();

        // --- Safety checks ---
        require(block.timestamp <= deadline, "Intent expired");
        require(target != address(0), "Zero target");
        require(target != address(gasTank), "Cannot call GasTank");
        require(target != address(this), "Cannot call CafeRelay");

        // --- Verify EIP-712 signature ---
        uint256 currentNonce = nonces[agent];
        bytes32 structHash = keccak256(abi.encode(
            RELAY_TYPEHASH,
            agent,
            target,
            value,
            keccak256(data),
            currentNonce,
            deadline,
            maxGasCost
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);
        require(signer == agent, "Invalid signature");

        // Increment nonce (prevents replay)
        nonces[agent] = currentNonce + 1;

        // --- Deduct value + maxGasCost from agent's tank ---
        uint256 totalDeduction = value + maxGasCost;
        gasTank.deductForGas(agent, totalDeduction);
        // CafeRelay now holds the deducted ETH

        // --- Execute the target call ---
        (success, returnData) = target.call{value: value}(data);

        if (!success) {
            emit RelayFailed(agent, target, value, returnData);
        }

        // --- Gas accounting ---
        uint256 gasUsed = gasStart - gasleft();
        // Add 40k for the remaining execution cost (storage writes, transfers, event)
        uint256 actualGasCost = (gasUsed + 40_000) * tx.gasprice;
        if (actualGasCost > maxGasCost) {
            actualGasCost = maxGasCost;
        }

        // Refund unused gas budget to agent's tank
        uint256 refund = maxGasCost - actualGasCost;
        if (refund > 0) {
            gasTank.deposit{value: refund}(agent);
        }

        // Reimburse relayer for actual gas spent
        if (actualGasCost > 0) {
            (bool relayerPaid, ) = msg.sender.call{value: actualGasCost}("");
            require(relayerPaid, "Relayer reimbursement failed");
        }

        emit Relayed(agent, target, value, actualGasCost, success);
    }

    /// @notice Get the current nonce for an agent (needed to construct the EIP-712 message)
    function getNonce(address agent) external view returns (uint256) {
        return nonces[agent];
    }

    /// @notice Get the EIP-712 domain separator (needed for off-chain signing)
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Owner can withdraw any ETH stuck in the relay (from failed refunds, etc.)
    function emergencyWithdrawETH(address to) external onlyOwner {
        require(to != address(0), "Zero address");
        uint256 bal = address(this).balance;
        require(bal > 0, "No ETH");
        (bool ok, ) = to.call{value: bal}("");
        require(ok, "Transfer failed");
    }

    receive() external payable {}
}

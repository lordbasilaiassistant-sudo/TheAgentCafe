// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "@account-abstraction/contracts/interfaces/IStakeManager.sol";
import "@account-abstraction/contracts/interfaces/INonceManager.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

/// @title MockEntryPoint — minimal mock for paymaster testing
/// @dev Implements ERC-165 so BasePaymaster constructor check passes.
///      Only implements the functions needed for testing.
contract MockEntryPoint is IERC165 {
    mapping(address => uint256) public deposits;
    mapping(address => uint256) public nonces;

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IEntryPoint).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // IStakeManager
    function depositTo(address account) external payable {
        deposits[account] += msg.value;
    }

    function balanceOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external {
        deposits[msg.sender] -= withdrawAmount;
        (bool ok, ) = withdrawAddress.call{value: withdrawAmount}("");
        require(ok);
    }

    function addStake(uint32) external payable {}
    function unlockStake() external {}
    function withdrawStake(address payable) external {}

    function getDepositInfo(address account) external view returns (IStakeManager.DepositInfo memory) {
        return IStakeManager.DepositInfo({
            deposit: deposits[account],
            staked: false,
            stake: 0,
            unstakeDelaySec: 0,
            withdrawTime: 0
        });
    }

    // INonceManager
    function getNonce(address sender, uint192 key) external view returns (uint256) {
        return nonces[sender];
    }

    function incrementNonce(uint192) external {}

    // IEntryPoint stubs
    function handleOps(PackedUserOperation[] calldata, address payable) external {}
    function handleAggregatedOps(IEntryPoint.UserOpsPerAggregator[] calldata, address payable) external {}
    function getUserOpHash(PackedUserOperation calldata) external pure returns (bytes32) {
        return bytes32(0);
    }
    function getSenderAddress(bytes memory) external pure {
        revert IEntryPoint.SenderAddressResult(address(0));
    }
    function delegateAndRevert(address, bytes calldata) external {}

    receive() external payable {}
}

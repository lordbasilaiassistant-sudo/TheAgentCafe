// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CafeTreasury — Holds BEAN revenue from food consumption
/// @notice Receives 99% of BEAN from every menu item purchase.
///         Owner can sell BEAN back to CafeCore for ETH to refill the paymaster.
contract CafeTreasury is Ownable, ReentrancyGuard {
    address public immutable cafeCore;

    event BeanReceived(uint256 amount);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event BeanWithdrawn(address indexed to, uint256 amount);

    constructor(address _cafeCore) Ownable(msg.sender) {
        require(_cafeCore != address(0), "Zero address");
        cafeCore = _cafeCore;
    }

    /// @notice Approve CafeCore to pull BEAN for redemption
    function approveBeanForRedemption(uint256 amount) external onlyOwner {
        IERC20(cafeCore).approve(cafeCore, amount);
    }

    /// @notice Get BEAN balance held by treasury
    function beanBalance() external view returns (uint256) {
        return IERC20(cafeCore).balanceOf(address(this));
    }

    /// @notice Withdraw ETH (from fees or redemption proceeds)
    function withdrawETH(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Zero address");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
        emit ETHWithdrawn(to, amount);
    }

    /// @notice Withdraw BEAN tokens from treasury
    function withdrawBEAN(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Zero address");
        require(IERC20(cafeCore).transfer(to, amount), "BEAN transfer failed");
        emit BeanWithdrawn(to, amount);
    }

    receive() external payable {}
}

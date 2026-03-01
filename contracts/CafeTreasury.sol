// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICafeCore {
    function redeem(uint256 beanIn, uint256 minEthOut) external returns (uint256 ethOut);
}

/// @title CafeTreasury — Holds BEAN revenue from food consumption
/// @custom:source https://github.com/lordbasilaiassistant-sudo/TheAgentCafe
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

    /// @notice Redeem BEAN back to ETH via CafeCore bonding curve
    /// @param beanAmount Amount of BEAN to redeem
    /// @param minEthOut Minimum ETH to receive (slippage protection)
    function redeemBEAN(uint256 beanAmount, uint256 minEthOut) external onlyOwner nonReentrant {
        require(beanAmount > 0, "Zero amount");
        require(IERC20(cafeCore).balanceOf(address(this)) >= beanAmount, "Insufficient BEAN");
        // CafeCore.redeem() uses _burn(msg.sender, ...) so no approve needed
        ICafeCore(cafeCore).redeem(beanAmount, minEthOut);
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

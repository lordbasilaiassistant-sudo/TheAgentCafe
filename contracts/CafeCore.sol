// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title CafeCore — $BEAN bonding curve reserve currency for The Agent Cafe
/// @custom:source https://github.com/lordbasilaiassistant-sudo/TheAgentCafe
/// @notice Linear bonding curve: price = BASE_PRICE + SLOPE * totalSupply.
///         BEAN is always redeemable for ETH. No admin mint. Anti-honeypot by design.
/// @dev ETH reserve backs all outstanding BEAN. Token uses 0 decimals for clean curve math.
contract CafeCore is ERC20, ReentrancyGuard, Ownable {
    uint256 public constant BASE_PRICE = 1e12; // 0.000001 ETH in wei
    uint256 public constant SLOPE = 1e8;       // 1e-10 ETH per BEAN in wei
    uint256 public constant MINT_FEE_BPS = 100;   // 1%
    uint256 public constant REDEEM_FEE_BPS = 200;  // 2%
    uint256 public constant BPS = 10000;

    uint256 public ethReserve;
    address public treasury;
    bool public treasurySet;

    event BeanMinted(address indexed buyer, uint256 ethIn, uint256 beanOut, uint256 feeEth);
    event BeanRedeemed(address indexed seller, uint256 beanIn, uint256 ethOut, uint256 feeEth);
    event TreasurySet(address indexed treasury);

    constructor() ERC20("BEAN", "BEAN") Ownable(msg.sender) {}

    /// @notice Set treasury address. Can only be called once.
    function setTreasury(address _treasury) external onlyOwner {
        require(!treasurySet, "Treasury already set");
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
        treasurySet = true;
        emit TreasurySet(_treasury);
    }

    /// @notice BEAN uses 0 decimals for clean bonding curve math
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /// @notice Buy BEAN with ETH at current curve price
    function mint(uint256 minBeanOut) external payable nonReentrant returns (uint256 beanOut) {
        require(msg.value > 0, "No ETH sent");
        require(treasurySet, "Treasury not set");
        uint256 fee = (msg.value * MINT_FEE_BPS) / BPS;
        uint256 ethForCurve = msg.value - fee;
        uint256 supply = totalSupply();
        beanOut = _ethToBeanAmount(ethForCurve, supply);
        require(beanOut > 0, "ETH too small");
        // Post-sqrt guard: ensure actual cost of beanOut doesn't exceed ethForCurve
        // (Babylonian sqrt truncation can over-count by 1 BEAN)
        if (_beanToEthAmount(beanOut, supply + beanOut) > ethForCurve) {
            beanOut -= 1;
        }
        require(beanOut > 0, "ETH too small");
        require(beanOut >= minBeanOut, "Slippage");
        ethReserve += ethForCurve;
        _mint(msg.sender, beanOut);
        (bool ok2, ) = treasury.call{value: fee}("");
        require(ok2, "Fee transfer failed");
        emit BeanMinted(msg.sender, msg.value, beanOut, fee);
    }

    /// @notice Sell BEAN back to ETH at curve price minus redemption fee
    function redeem(uint256 beanIn, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        require(beanIn > 0, "Zero BEAN");
        require(treasurySet, "Treasury not set");
        require(balanceOf(msg.sender) >= beanIn, "Insufficient BEAN");
        uint256 grossEth = _beanToEthAmount(beanIn, totalSupply());
        uint256 fee = (grossEth * REDEEM_FEE_BPS) / BPS;
        ethOut = grossEth - fee;
        require(ethOut >= minEthOut, "Slippage");
        _burn(msg.sender, beanIn);
        ethReserve -= grossEth;
        (bool ok, ) = msg.sender.call{value: ethOut}("");
        require(ok, "ETH transfer failed");
        (bool ok2, ) = treasury.call{value: fee}("");
        require(ok2, "Fee transfer failed");
        emit BeanRedeemed(msg.sender, beanIn, ethOut, fee);
    }

    /// @notice Get current price of the next BEAN
    function currentPrice() external view returns (uint256) {
        return BASE_PRICE + SLOPE * totalSupply();
    }

    /// @notice Pre-check: how many BEAN would ethAmount buy at current supply?
    /// @dev Mirrors mint() math without state changes. Accounts for the 1% mint fee.
    /// @param ethAmount ETH to send (wei)
    /// @return beanOut Expected BEAN output (same as mint() would return)
    function quoteMint(uint256 ethAmount) external view returns (uint256 beanOut) {
        if (ethAmount == 0) return 0;
        uint256 fee = (ethAmount * MINT_FEE_BPS) / BPS;
        uint256 ethForCurve = ethAmount - fee;
        beanOut = _ethToBeanAmount(ethForCurve, totalSupply());
    }

    /// @notice Pre-check: how much ETH would selling beanAmount return at current supply?
    /// @dev Mirrors redeem() math without state changes. Accounts for the 2% redeem fee.
    /// @param beanAmount BEAN to sell
    /// @return ethOut Expected ETH output (same as redeem() would return)
    function quoteRedeem(uint256 beanAmount) external view returns (uint256 ethOut) {
        if (beanAmount == 0) return 0;
        uint256 grossEth = _beanToEthAmount(beanAmount, totalSupply());
        uint256 fee = (grossEth * REDEEM_FEE_BPS) / BPS;
        ethOut = grossEth - fee;
    }

    /// @notice Solvency check — reserve vs total redemption cost
    function solvencyCheck() external view returns (uint256 reserve, uint256 totalRedemptionCost) {
        reserve = ethReserve;
        totalRedemptionCost = _beanToEthAmount(totalSupply(), totalSupply());
    }

    /// @notice Calculate how many BEAN you get for ethAmount at currentSupply
    /// @dev Integral of price curve: cost = BASE_PRICE * n + SLOPE * (S*n + n*(n-1)/2)
    ///      We solve for n given ethAmount. Use quadratic formula.
    function _ethToBeanAmount(uint256 ethAmount, uint256 currentSupply) internal pure returns (uint256) {
        // price(x) = BASE_PRICE + SLOPE * x
        // Cost to buy n beans starting at supply S:
        // C(n) = sum_{i=0}^{n-1} (BASE_PRICE + SLOPE * (S + i))
        //      = BASE_PRICE * n + SLOPE * (S * n + n*(n-1)/2)
        //      = n * (BASE_PRICE + SLOPE * S) + SLOPE * n * (n-1) / 2
        //      = n * (BASE_PRICE + SLOPE * S + SLOPE * (n-1) / 2)
        //
        // Rearranging: SLOPE/2 * n^2 + (BASE_PRICE + SLOPE*S - SLOPE/2) * n - ethAmount = 0
        // a = SLOPE / 2
        // b = BASE_PRICE + SLOPE * S - SLOPE / 2
        // c = -ethAmount
        // n = (-b + sqrt(b^2 + 4*a*ethAmount)) / (2*a)
        //   = (-b + sqrt(b^2 + 2 * SLOPE * ethAmount)) / SLOPE

        uint256 b = BASE_PRICE + SLOPE * currentSupply;
        // For the first term adjustment: b_adj = b - SLOPE/2
        // But SLOPE/2 might not be integer. Since SLOPE = 1e8, SLOPE/2 = 5e7 which is fine.
        uint256 bAdj = b - SLOPE / 2;
        // discriminant = bAdj^2 + 2 * SLOPE * ethAmount
        uint256 disc = bAdj * bAdj + 2 * SLOPE * ethAmount;
        uint256 sqrtDisc = _sqrt(disc);
        // n = (sqrtDisc - bAdj) / SLOPE
        if (sqrtDisc <= bAdj) return 0;
        return (sqrtDisc - bAdj) / SLOPE;
    }

    /// @notice Calculate ETH value of beanAmount sold starting from currentSupply
    /// @dev Integral going backwards: selling n beans from supply S
    ///      Value = sum_{i=1}^{n} (BASE_PRICE + SLOPE * (S - i))
    ///            = BASE_PRICE * n + SLOPE * (S*n - n*(n+1)/2)
    function _beanToEthAmount(uint256 beanAmount, uint256 currentSupply) internal pure returns (uint256) {
        if (beanAmount == 0 || currentSupply == 0) return 0;
        if (beanAmount > currentSupply) beanAmount = currentSupply;
        // Value = BASE_PRICE * n + SLOPE * n * (2*S - n - 1) / 2
        uint256 n = beanAmount;
        uint256 S = currentSupply;
        uint256 linearPart = BASE_PRICE * n;
        // SLOPE * n * (2*S - n - 1) / 2
        // Note: 2*S - n - 1 could underflow if n >= 2*S, but n <= S so 2*S - n - 1 >= S - 1 >= 0
        uint256 quadPart = (SLOPE * n * (2 * S - n - 1)) / 2;
        return linearPart + quadPart;
    }

    /// @notice Integer square root (Babylonian method)
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    /// @notice Reject direct ETH sends to keep ethReserve in sync with contract balance.
    ///         Use mint() to buy BEAN and add ETH to the reserve.
    receive() external payable {
        revert("Use mint()");
    }
}

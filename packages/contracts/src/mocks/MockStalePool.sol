// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice A deliberately mispriced venue — the arbitrage counterparty in the
///         Grow demo. It quotes a FIXED price that ignores the reference
///         oracle, which is exactly what makes a profitable cycle exist.
/// @dev Labelled "stale" so nobody mistakes it for a real market. Anything
///      routed through it is simulated liquidity and must be presented as such
///      in the UI (MASTER §21).
contract MockStalePool {
    using SafeERC20 for IERC20;

    address public immutable BASE;
    address public immutable QUOTE;

    /// @notice Quote units per base unit, 1e18-scaled. Deliberately stale.
    uint256 public stalePriceE18;

    error MockStalePoolUnsupportedPair(address tokenIn, address tokenOut);

    constructor(address base, address quote, uint256 initialPriceE18) {
        BASE = base;
        QUOTE = quote;
        stalePriceE18 = initialPriceE18;
    }

    function setPrice(uint256 newPriceE18) external {
        stalePriceE18 = newPriceE18;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, address recipient) external {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 amountOut;
        if (tokenIn == BASE && tokenOut == QUOTE) {
            amountOut = (amountIn * stalePriceE18) / 1e18;
        } else if (tokenIn == QUOTE && tokenOut == BASE) {
            amountOut = (amountIn * 1e18) / stalePriceE18;
        } else {
            revert MockStalePoolUnsupportedPair(tokenIn, tokenOut);
        }

        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }

    function fund(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}

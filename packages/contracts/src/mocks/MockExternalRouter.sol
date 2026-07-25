// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Stand-in for the external venue leg of a Grow cycle (in production,
///         a Uniswap API-built transaction). Deterministic by design so the
///         demo and the tests do not depend on live routing.
/// @dev The rate is settable per direction, which is what lets a test create a
///      profitable cycle, a break-even one, or one that is a single unit short.
contract MockExternalRouter {
    using SafeERC20 for IERC20;

    /// @notice outputPerInputE18[tokenIn][tokenOut] — output units per input unit, 1e18-scaled.
    mapping(address tokenIn => mapping(address tokenOut => uint256 rateE18)) public rateE18;

    bool public shouldRevert;
    /// @notice When set, the router delivers this many fewer output units than
    ///         quoted — used to simulate a venue that under-delivers.
    uint256 public shortfall;

    error MockExternalRouterReverted();
    error MockExternalRouterNoRate(address tokenIn, address tokenOut);

    function setRate(address tokenIn, address tokenOut, uint256 newRateE18) external {
        rateE18[tokenIn][tokenOut] = newRateE18;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function setShortfall(uint256 value) external {
        shortfall = value;
    }

    /// @notice Pulls `amountIn` of `tokenIn` from the caller and sends the
    ///         converted amount of `tokenOut` back.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, address recipient) external {
        require(!shouldRevert, MockExternalRouterReverted());
        uint256 rate = rateE18[tokenIn][tokenOut];
        require(rate > 0, MockExternalRouterNoRate(tokenIn, tokenOut));

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 amountOut = (amountIn * rate) / 1e18;
        if (shortfall >= amountOut) {
            amountOut = 0;
        } else {
            amountOut -= shortfall;
        }
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }

    /// @notice Test helper: fund the router so it can pay out.
    function fund(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}

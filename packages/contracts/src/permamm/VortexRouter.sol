// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title VortexRouter — constrained taker entrypoint for the Vortex PermAMM
/// @notice Wraps the v4 unlock/settle dance and enforces taker slippage
///         protection. Exposes both exact-input and exact-output: exact-output
///         is what the Grow compounder needs to produce a precise bridge amount
///         for the external leg.
contract VortexRouter is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable POOL_MANAGER;

    error VortexOnlyPoolManager(address caller);
    error VortexInsufficientOutput(uint256 amountOut, uint256 minAmountOut);
    error VortexExcessiveInput(uint256 amountIn, uint256 maxAmountIn);
    error VortexUnexpectedOutput(uint256 amountOut, uint256 requested);

    struct CallbackData {
        PoolKey key;
        SwapParams params;
        bytes hookData;
        address payer;
        address recipient;
    }

    constructor(IPoolManager poolManager) {
        POOL_MANAGER = poolManager;
    }

    /// @notice Spend exactly `amountIn`, receive at least `minAmountOut`.
    function swapExactInput(
        PoolKey calldata key,
        bool zeroForOne,
        uint128 amountIn,
        uint128 minAmountOut,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData,
        address recipient
    )
        external
        returns (uint256 amountOut)
    {
        BalanceDelta delta = _swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                // negative == exact input
                amountSpecified: -int256(uint256(amountIn)),
                sqrtPriceLimitX96: _resolveLimit(sqrtPriceLimitX96, zeroForOne)
            }),
            hookData,
            recipient
        );

        amountOut = zeroForOne ? uint256(uint128(delta.amount1())) : uint256(uint128(delta.amount0()));
        require(amountOut >= minAmountOut, VortexInsufficientOutput(amountOut, minAmountOut));
    }

    /// @notice Receive exactly `amountOut`, spend at most `maxAmountIn`.
    function swapExactOutput(
        PoolKey calldata key,
        bool zeroForOne,
        uint128 amountOut,
        uint128 maxAmountIn,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData,
        address recipient
    )
        external
        returns (uint256 amountIn)
    {
        BalanceDelta delta = _swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                // positive == exact output
                amountSpecified: int256(uint256(amountOut)),
                sqrtPriceLimitX96: _resolveLimit(sqrtPriceLimitX96, zeroForOne)
            }),
            hookData,
            recipient
        );

        uint256 received = zeroForOne ? uint256(uint128(delta.amount1())) : uint256(uint128(delta.amount0()));
        // A price-limited swap can stop short; the compounder depends on the
        // bridge amount being exact, so refuse a partial fill outright.
        require(received == amountOut, VortexUnexpectedOutput(received, amountOut));

        amountIn = zeroForOne ? uint256(uint128(-delta.amount0())) : uint256(uint128(-delta.amount1()));
        require(amountIn <= maxAmountIn, VortexExcessiveInput(amountIn, maxAmountIn));
    }

    function _swap(
        PoolKey calldata key,
        SwapParams memory params,
        bytes calldata hookData,
        address recipient
    )
        private
        returns (BalanceDelta delta)
    {
        bytes memory result = POOL_MANAGER.unlock(
            abi.encode(
                CallbackData({
                    key: key,
                    params: params,
                    hookData: hookData,
                    payer: msg.sender,
                    recipient: recipient == address(0) ? msg.sender : recipient
                })
            )
        );
        delta = abi.decode(result, (BalanceDelta));
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(POOL_MANAGER), VortexOnlyPoolManager(msg.sender));
        CallbackData memory data = abi.decode(rawData, (CallbackData));

        BalanceDelta delta = POOL_MANAGER.swap(data.key, data.params, data.hookData);

        _resolve(data.key.currency0, delta.amount0(), data.payer, data.recipient);
        _resolve(data.key.currency1, delta.amount1(), data.payer, data.recipient);

        return abi.encode(delta);
    }

    /// @dev Negative delta = we owe the pool: pull from the payer and settle.
    ///      Positive delta = the pool owes us: take it to the recipient.
    function _resolve(Currency currency, int128 amount, address payer, address recipient) private {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            POOL_MANAGER.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransferFrom(payer, address(POOL_MANAGER), owed);
            POOL_MANAGER.settle();
        } else if (amount > 0) {
            POOL_MANAGER.take(currency, recipient, uint256(uint128(amount)));
        }
    }

    /// @dev 0 means "no explicit limit" — use the widest legal bound.
    function _resolveLimit(uint160 sqrtPriceLimitX96, bool zeroForOne) private pure returns (uint160) {
        if (sqrtPriceLimitX96 != 0) return sqrtPriceLimitX96;
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }
}

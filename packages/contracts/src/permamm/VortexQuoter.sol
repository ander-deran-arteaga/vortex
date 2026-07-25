// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title VortexQuoter — simulate-and-revert quoting for the Vortex PermAMM
/// @notice Runs the swap for real inside the PoolManager's unlock, then reverts
///         with the resulting amounts. Because the whole call reverts, nothing
///         settles and the hook's nonce burn is rolled back — quoting never
///         consumes a fee authorization.
/// @dev The quote therefore runs the SAME hook code path as execution
///      (signature check, oracle freshness, deviation, fee clamp), so a quote
///      that succeeds is one the pool would actually honour.
contract VortexQuoter is IUnlockCallback {
    IPoolManager public immutable POOL_MANAGER;

    /// @dev Not an error condition — this is how the result is returned.
    error QuoteResult(uint256 amountIn, uint256 amountOut);

    error VortexOnlyPoolManager(address caller);
    error VortexQuoteFailed(bytes reason);

    struct QuoteParams {
        PoolKey key;
        SwapParams params;
        bytes hookData;
    }

    constructor(IPoolManager poolManager) {
        POOL_MANAGER = poolManager;
    }

    function quoteExactInput(
        PoolKey calldata key,
        bool zeroForOne,
        uint128 amountIn,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData
    )
        external
        returns (uint256 quotedIn, uint256 quotedOut)
    {
        return _quote(key, zeroForOne, -int256(uint256(amountIn)), sqrtPriceLimitX96, hookData);
    }

    function quoteExactOutput(
        PoolKey calldata key,
        bool zeroForOne,
        uint128 amountOut,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData
    )
        external
        returns (uint256 quotedIn, uint256 quotedOut)
    {
        return _quote(key, zeroForOne, int256(uint256(amountOut)), sqrtPriceLimitX96, hookData);
    }

    function _quote(
        PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData
    )
        private
        returns (uint256 quotedIn, uint256 quotedOut)
    {
        QuoteParams memory quoteParams = QuoteParams({
            key: key,
            params: SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: sqrtPriceLimitX96 != 0
                    ? sqrtPriceLimitX96
                    : (zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1)
            }),
            hookData: hookData
        });

        try POOL_MANAGER.unlock(abi.encode(quoteParams)) {
            // unlockCallback always reverts, so reaching here is impossible.
            revert VortexQuoteFailed("");
        } catch (bytes memory reason) {
            return _decodeQuote(reason);
        }
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(POOL_MANAGER), VortexOnlyPoolManager(msg.sender));
        QuoteParams memory quoteParams = abi.decode(rawData, (QuoteParams));

        BalanceDelta delta = POOL_MANAGER.swap(quoteParams.key, quoteParams.params, quoteParams.hookData);

        (uint256 amountIn, uint256 amountOut) = quoteParams.params.zeroForOne
            ? (uint256(uint128(-delta.amount0())), uint256(uint128(delta.amount1())))
            : (uint256(uint128(-delta.amount1())), uint256(uint128(delta.amount0())));

        // Unwind everything: the amounts come back as revert data.
        revert QuoteResult(amountIn, amountOut);
    }

    function _decodeQuote(bytes memory reason) private pure returns (uint256 amountIn, uint256 amountOut) {
        // A genuine failure (bad signature, stale oracle, …) is surfaced as-is
        // rather than being mistaken for a quote.
        if (reason.length != 4 + 64 || bytes4(reason) != QuoteResult.selector) {
            revert VortexQuoteFailed(reason);
        }
        assembly ("memory-safe") {
            amountIn := mload(add(reason, 0x24))
            amountOut := mload(add(reason, 0x44))
        }
    }
}

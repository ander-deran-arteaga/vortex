// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @title VortexLiquidityManager — the sole liquidity provider for the Vortex PermAMM
/// @notice VortexHook rejects `modifyLiquidity` from anyone else, so the pool
///         holds exactly one managed position. That keeps the demo pool's
///         inventory predictable and stops an outsider from adding liquidity on
///         terms the hook did not price.
contract VortexLiquidityManager is IUnlockCallback, Ownable {
    using SafeERC20 for IERC20;

    IPoolManager public immutable POOL_MANAGER;

    error VortexOnlyPoolManager(address caller);

    struct CallbackData {
        PoolKey key;
        ModifyLiquidityParams params;
    }

    constructor(IPoolManager poolManager, address initialOwner) Ownable(initialOwner) {
        POOL_MANAGER = poolManager;
    }

    /// @notice Add (positive delta) or remove (negative) liquidity on the pool.
    function modifyLiquidity(
        PoolKey calldata key,
        ModifyLiquidityParams calldata params
    )
        external
        onlyOwner
        returns (BalanceDelta callerDelta)
    {
        bytes memory result = POOL_MANAGER.unlock(abi.encode(CallbackData({ key: key, params: params })));
        callerDelta = abi.decode(result, (BalanceDelta));
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(POOL_MANAGER), VortexOnlyPoolManager(msg.sender));
        CallbackData memory data = abi.decode(rawData, (CallbackData));

        (BalanceDelta delta,) = POOL_MANAGER.modifyLiquidity(data.key, data.params, "");

        // Negative amounts are owed to the pool; positive amounts are owed to us.
        _resolve(data.key.currency0, delta.amount0());
        _resolve(data.key.currency1, delta.amount1());

        return abi.encode(delta);
    }

    /// @dev v4's settle protocol: `sync` snapshots the pool's balance, the
    ///      tokens are transferred in, then `settle` credits the difference.
    ///      `take` is the reverse and needs no snapshot.
    function _resolve(Currency currency, int128 amount) private {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            POOL_MANAGER.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(POOL_MANAGER), owed);
            POOL_MANAGER.settle();
        } else if (amount > 0) {
            POOL_MANAGER.take(currency, address(this), uint256(uint128(amount)));
        }
    }

    /// @notice Recover tokens sent here for provisioning, or withdrawn liquidity.
    function sweep(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
    }
}

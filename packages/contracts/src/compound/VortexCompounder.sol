// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { AquaApp } from "@1inch/aqua/src/AquaApp.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { VortexRouter } from "../permamm/VortexRouter.sol";
import {
    VortexCompoundRoute,
    VortexCompoundRouteLib,
    VortexGrowDirection,
    VortexGrowStrategy
} from "./VortexCompoundTypes.sol";
import { VortexRouteValidator } from "./VortexRouteValidator.sol";

/// @title VortexCompounder — Vortex Grow, same-asset JIT compounding
/// @notice An Aqua app that temporarily pulls a maker's WBTC, runs a two-leg
///         cycle (Vortex PermAMM ↔ an external venue) inside one transaction,
///         and pushes back MORE WBTC than it took. The maker never holds the
///         bridge asset and never has capital at rest in this contract.
///
/// @dev The security model is a single authoritative check: whatever the route
///      signer claims, the transaction only survives if this contract ends up
///      holding more of the SAME asset than it pulled, by at least the
///      strategy's immutable minimum. A compromised signer can waste gas; it
///      cannot make an unprofitable cycle settle, retarget the external call,
///      exceed the per-execution cap, or replay a route.
contract VortexCompounder is AquaApp, EIP712 {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    /// @notice The PermAMM router used for the Vortex leg.
    VortexRouter public immutable VORTEX_ROUTER;

    mapping(bytes32 strategyHash => mapping(uint64 nonce => bool used)) public usedRouteNonces;

    event VortexGrowExecuted(
        bytes32 indexed strategyHash,
        bytes32 indexed opportunityId,
        address indexed maker,
        address asset,
        uint256 principal,
        uint256 makerReturn,
        uint256 grossProfit,
        uint256 fee
    );

    error VortexRouteNonceUsed(bytes32 strategyHash, uint64 nonce);
    error VortexInsufficientCompoundReturn(uint256 produced, uint256 required);
    error VortexAssetSpentAboveLimit(uint256 spent, uint256 limit);
    error VortexBridgeDustRemains(uint256 dust);
    error VortexExternalCallFailed(bytes reason);

    /// @param aqua      Official Aqua deployment.
    /// @param router    Vortex PermAMM router (Grow is the only place the two
    ///                  products legitimately meet — see MASTER D-015).
    constructor(IAqua aqua, VortexRouter router) AquaApp(aqua) EIP712("Vortex Grow", "1") {
        VORTEX_ROUTER = router;
    }

    struct ExecuteParams {
        VortexGrowStrategy strategy;
        VortexCompoundRoute route;
        bytes routeSignature;
        bytes permHookData;
        bytes externalCalldata;
        PoolKey poolKey;
        bool assetIsCurrency0;
    }

    /// @notice Run one compound cycle. Reverts unless the maker ends up ahead.
    function executeCompound(ExecuteParams calldata params)
        external
        nonReentrantStrategy(
            params.strategy.maker, VortexCompoundRouteLib.strategyHash(params.strategy)
        )
    {
        bytes32 strategyHash = VortexCompoundRouteLib.strategyHash(params.strategy);

        VortexRouteValidator.validateStrategy(params.strategy, strategyHash);
        VortexRouteValidator.validateRoute(
            params.strategy,
            strategyHash,
            params.route,
            params.routeSignature,
            params.externalCalldata,
            params.permHookData,
            _domainSeparatorV4()
        );

        require(
            !usedRouteNonces[strategyHash][params.route.nonce],
            VortexRouteNonceUsed(strategyHash, params.route.nonce)
        );
        usedRouteNonces[strategyHash][params.route.nonce] = true;

        IERC20 asset = IERC20(params.strategy.asset);
        IERC20 bridge = IERC20(params.strategy.bridgeToken);

        // Measure against pre-existing balances so stray donations can never be
        // counted as profit (nor block execution).
        uint256 assetBefore = asset.balanceOf(address(this));
        uint256 bridgeBefore = bridge.balanceOf(address(this));

        // Real tokens move maker → here. Virtual balance drops by the same.
        AQUA.pull(
            params.strategy.maker, strategyHash, params.strategy.asset, params.route.principalAmount, address(this)
        );

        _runCycle(params, asset, bridge);

        uint256 assetProduced = asset.balanceOf(address(this)) - assetBefore;
        uint256 required = VortexRouteValidator.requiredFinalAsset(params.strategy, params.route);
        require(
            assetProduced >= required, VortexInsufficientCompoundReturn(assetProduced, required)
        );

        // The bridge asset is strictly intermediate: none of it may be left.
        uint256 bridgeDust = bridge.balanceOf(address(this)) - bridgeBefore;
        require(bridgeDust == 0, VortexBridgeDustRemains(bridgeDust));

        uint256 grossProfit = assetProduced - params.route.principalAmount;
        uint256 fee = (grossProfit * params.strategy.performanceFeeBps) / BPS;
        uint256 makerReturn = assetProduced - fee;

        // Principal + net profit go back before the fee is paid out, so a
        // failure in the fee transfer can never strand the maker's capital.
        asset.forceApprove(address(AQUA), makerReturn);
        AQUA.push(
            params.strategy.maker, address(this), strategyHash, params.strategy.asset, makerReturn
        );
        asset.forceApprove(address(AQUA), 0);

        if (fee > 0) {
            asset.safeTransfer(params.strategy.feeRecipient, fee);
        }

        emit VortexGrowExecuted(
            strategyHash,
            params.route.opportunityId,
            params.strategy.maker,
            params.strategy.asset,
            params.route.principalAmount,
            makerReturn,
            grossProfit,
            fee
        );
    }

    function _runCycle(ExecuteParams calldata params, IERC20 asset, IERC20 bridge) private {
        if (params.route.direction == uint8(VortexGrowDirection.VORTEX_THEN_EXTERNAL)) {
            // Leg 1: asset → EXACT bridge amount on the PermAMM, so the
            // external leg's calldata (built offchain for a fixed input) is
            // always fed precisely what it expects.
            uint256 assetSpent = _vortexExactOutput(params, asset);
            require(
                assetSpent <= params.route.maxAssetSpent,
                VortexAssetSpentAboveLimit(assetSpent, params.route.maxAssetSpent)
            );
            // Leg 2: bridge → asset on the external venue.
            _externalCall(params, bridge);
        } else {
            // Leg 1: asset → bridge externally, spending at most the cap.
            uint256 assetBeforeExternal = asset.balanceOf(address(this));
            _externalCall(params, asset);
            uint256 assetSpent = assetBeforeExternal - asset.balanceOf(address(this));
            require(
                assetSpent <= params.route.maxAssetSpent,
                VortexAssetSpentAboveLimit(assetSpent, params.route.maxAssetSpent)
            );
            // Leg 2: the bridge proceeds go back to asset on the PermAMM.
            _vortexExactInput(params, bridge);
        }
    }

    /// @dev PermAMM leg producing an exact bridge amount.
    function _vortexExactOutput(
        ExecuteParams calldata params,
        IERC20 asset
    )
        private
        returns (uint256 assetSpent)
    {
        asset.forceApprove(address(VORTEX_ROUTER), params.route.maxAssetSpent);
        // asset → bridge: zeroForOne when the asset is currency0.
        assetSpent = VORTEX_ROUTER.swapExactOutput(
            params.poolKey,
            params.assetIsCurrency0,
            params.route.bridgeAmount,
            params.route.maxAssetSpent,
            0,
            params.permHookData,
            address(this)
        );
        asset.forceApprove(address(VORTEX_ROUTER), 0);
    }

    /// @dev PermAMM leg converting the whole bridge balance back to the asset.
    function _vortexExactInput(ExecuteParams calldata params, IERC20 bridge) private {
        uint256 bridgeAmount = bridge.balanceOf(address(this));
        bridge.forceApprove(address(VORTEX_ROUTER), bridgeAmount);
        VORTEX_ROUTER.swapExactInput(
            params.poolKey,
            // bridge → asset is the opposite direction to asset → bridge.
            !params.assetIsCurrency0,
            uint128(bridgeAmount),
            0, // the authoritative bound is the final same-asset check
            0,
            params.permHookData,
            address(this)
        );
        bridge.forceApprove(address(VORTEX_ROUTER), 0);
    }

    /// @dev The external venue call. The target is fixed by the immutable
    ///      strategy and the calldata is committed to by hash, so this is a
    ///      pre-authorized call, not an arbitrary one.
    function _externalCall(ExecuteParams calldata params, IERC20 spendToken) private {
        uint256 spendBudget = params.route.direction == uint8(VortexGrowDirection.VORTEX_THEN_EXTERNAL)
            ? params.route.bridgeAmount
            : params.route.maxAssetSpent;

        spendToken.forceApprove(params.strategy.externalTarget, spendBudget);
        (bool ok, bytes memory reason) = params.strategy.externalTarget.call(params.externalCalldata);
        if (!ok) revert VortexExternalCallFailed(reason);
        spendToken.forceApprove(params.strategy.externalTarget, 0);
    }
}

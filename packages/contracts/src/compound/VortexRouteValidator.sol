// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {
    VortexCompoundRoute,
    VortexCompoundRouteLib,
    VortexGrowStrategy
} from "./VortexCompoundTypes.sol";

/// @notice Everything that decides whether a signed route may execute at all.
/// @dev Split out of VortexCompounder so the authorization rules are readable
///      on their own and testable in isolation. The rule these encode: a
///      compromised route signer can pick a worse opportunity, but cannot
///      escape the strategy's immutable limits, retarget the external call, or
///      replay a route.
library VortexRouteValidator {
    /// @dev Bounds the calldata a signer may hand to the external venue. Not a
    ///      security boundary by itself (the hash binds the exact bytes) but it
    ///      stops a griefing signer from burning the maker's gas on a payload
    ///      that could never succeed.
    uint256 internal constant MAX_EXTERNAL_CALLDATA_LENGTH = 8_192;

    error VortexStrategyExpired(uint40 strategyDeadline);
    error VortexRouteExpired(uint40 deadline);
    error VortexRouteStrategyMismatch(bytes32 routeStrategyHash, bytes32 expected);
    error VortexPrincipalAboveStrategyCap(uint128 principal, uint128 cap);
    error VortexZeroPrincipal();
    error VortexExternalTargetNotAllowed(address routeTarget, address strategyTarget);
    error VortexExternalValueForbidden(uint256 value);
    error VortexExternalCalldataTooLong(uint256 length);
    error VortexExternalCalldataMismatch();
    error VortexPermHookDataMismatch();
    error VortexBadRouteSignature(address recovered, address expected);
    error VortexUnknownDirection(uint8 direction);
    error VortexInvalidStrategy();

    function validateStrategy(VortexGrowStrategy memory strategy, bytes32 expectedHash) internal view {
        require(
            VortexCompoundRouteLib.strategyHash(strategy) == expectedHash, VortexInvalidStrategy()
        );
        require(
            strategy.maker != address(0) && strategy.asset != address(0)
                && strategy.bridgeToken != address(0) && strategy.asset != strategy.bridgeToken
                && strategy.externalTarget != address(0) && strategy.routeSigner != address(0)
                && strategy.feeRecipient != address(0) && strategy.performanceFeeBps < 10_000,
            VortexInvalidStrategy()
        );
        require(
            block.timestamp <= strategy.strategyDeadline, VortexStrategyExpired(strategy.strategyDeadline)
        );
    }

    /// @dev Verifies the route is (a) fresh, (b) for THIS strategy, (c) within
    ///      the strategy's immutable caps, (d) pointed at the allowlisted
    ///      target, and (e) committed to the exact calldata that will run.
    function validateRoute(
        VortexGrowStrategy memory strategy,
        bytes32 expectedStrategyHash,
        VortexCompoundRoute memory route,
        bytes memory routeSignature,
        bytes memory externalCalldata,
        bytes memory permHookData,
        bytes32 domainSeparator
    )
        internal
        view
    {
        require(block.timestamp <= route.deadline, VortexRouteExpired(route.deadline));
        require(
            route.strategyHash == expectedStrategyHash,
            VortexRouteStrategyMismatch(route.strategyHash, expectedStrategyHash)
        );
        require(route.principalAmount > 0, VortexZeroPrincipal());
        require(
            route.principalAmount <= strategy.maxAmountPerExecution,
            VortexPrincipalAboveStrategyCap(route.principalAmount, strategy.maxAmountPerExecution)
        );
        require(
            route.direction <= uint8(type(VortexGrowDirectionBound).max), VortexUnknownDirection(route.direction)
        );

        // The signer may not choose a venue: the strategy fixed it at ship time.
        require(
            route.externalTarget == strategy.externalTarget,
            VortexExternalTargetNotAllowed(route.externalTarget, strategy.externalTarget)
        );
        // No ETH leaves this contract. The MVP trades ERC-20s only, so a
        // nonzero value could only ever be a drain attempt.
        require(route.externalValue == 0, VortexExternalValueForbidden(route.externalValue));

        require(
            externalCalldata.length <= MAX_EXTERNAL_CALLDATA_LENGTH,
            VortexExternalCalldataTooLong(externalCalldata.length)
        );
        require(
            keccak256(externalCalldata) == route.externalCalldataHash, VortexExternalCalldataMismatch()
        );
        require(keccak256(permHookData) == route.permHookDataHash, VortexPermHookDataMismatch());

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, VortexCompoundRouteLib.hashStruct(route))
        );
        address recovered = ECDSA.recover(digest, routeSignature);
        require(recovered == strategy.routeSigner, VortexBadRouteSignature(recovered, strategy.routeSigner));
    }

    /// @notice Minimum asset the cycle must return: the greater of the signed
    ///         floor and the strategy's own profit requirement. The signer can
    ///         demand MORE profit but never less.
    function requiredFinalAsset(
        VortexGrowStrategy memory strategy,
        VortexCompoundRoute memory route
    )
        internal
        pure
        returns (uint256)
    {
        uint256 strategyFloor = uint256(route.principalAmount)
            + (uint256(route.principalAmount) * strategy.minProfitBps) / 10_000;
        return route.minFinalAsset > strategyFloor ? route.minFinalAsset : strategyFloor;
    }
}

/// @dev Local mirror of VortexGrowDirection's bound, so the validator can
///      range-check `direction` without importing the enum into a library
///      signature.
enum VortexGrowDirectionBound {
    VORTEX_THEN_EXTERNAL,
    EXTERNAL_THEN_VORTEX
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Route direction. Mirrors `COMPOUND_DIRECTION` in
///         packages/shared/src/typedData.ts.
enum VortexGrowDirection {
    /// asset → bridge on Vortex PermAMM, bridge → asset on the external venue
    VORTEX_THEN_EXTERNAL,
    /// asset → bridge on the external venue, bridge → asset on Vortex PermAMM
    EXTERNAL_THEN_VORTEX
}

/// @notice Immutable per-maker strategy. Shipped on Aqua as
///         `abi.encode(strategy)`, so every field below is covered by the
///         strategy hash and cannot change afterwards. Everything that bounds
///         the maker's downside lives HERE, not in the signed route.
struct VortexGrowStrategy {
    address maker;
    /// @notice The single asset pulled and returned (WBTC).
    address asset;
    /// @notice Intermediate asset held only inside one execution (USDC).
    address bridgeToken;
    /// @notice The only external venue this strategy may call.
    address externalTarget;
    address routeSigner;
    address feeRecipient;
    uint128 maxAmountPerExecution;
    uint16 minProfitBps;
    uint16 performanceFeeBps;
    uint40 strategyDeadline;
    uint64 salt;
}

/// @notice Mirrors packages/shared/src/typedData.ts `VortexCompoundRoute`
///         field-for-field, order-for-order (MASTER R-006 / Addendum 2).
///         A signed route selects *which* opportunity to take; it can never
///         widen the limits the strategy already fixed.
struct VortexCompoundRoute {
    bytes32 strategyHash;
    bytes32 opportunityId;
    uint8 direction;
    uint128 principalAmount;
    uint128 bridgeAmount;
    uint128 maxAssetSpent;
    uint128 minFinalAsset;
    address externalTarget;
    uint256 externalValue;
    bytes32 externalCalldataHash;
    bytes32 permHookDataHash;
    uint40 deadline;
    uint64 nonce;
}

library VortexCompoundRouteLib {
    bytes32 internal constant COMPOUND_ROUTE_TYPEHASH = keccak256(
        "VortexCompoundRoute("
        "bytes32 strategyHash,"
        "bytes32 opportunityId,"
        "uint8 direction,"
        "uint128 principalAmount,"
        "uint128 bridgeAmount,"
        "uint128 maxAssetSpent,"
        "uint128 minFinalAsset,"
        "address externalTarget,"
        "uint256 externalValue,"
        "bytes32 externalCalldataHash,"
        "bytes32 permHookDataHash,"
        "uint40 deadline,"
        "uint64 nonce"
        ")"
    );

    function hashStruct(VortexCompoundRoute memory route) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                COMPOUND_ROUTE_TYPEHASH,
                route.strategyHash,
                route.opportunityId,
                route.direction,
                route.principalAmount,
                route.bridgeAmount,
                route.maxAssetSpent,
                route.minFinalAsset,
                route.externalTarget,
                route.externalValue,
                route.externalCalldataHash,
                route.permHookDataHash,
                route.deadline,
                route.nonce
            )
        );
    }

    function strategyHash(VortexGrowStrategy memory strategy) internal pure returns (bytes32) {
        return keccak256(abi.encode(strategy));
    }
}

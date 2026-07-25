// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Mirrors packages/shared/src/typedData.ts `VortexPermFeeAuthorization`
///         field-for-field, order-for-order (MASTER R-006 / Addendum 2). The
///         shared file is the source of truth; this must follow it, never lead.
struct VortexPermFeeAuthorization {
    bytes32 poolId;
    bytes32 quoteId;
    bytes32 oracleSnapshotHash;
    address swapper;
    address tokenIn;
    address tokenOut;
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
    uint24 commercialFeePips;
    uint40 deadline;
    uint64 nonce;
}

/// @notice EIP-712 hashing for the per-swap commercial fee authorization.
/// @dev This is a library, not a deployed verifier: VortexHook verifies inline,
///      so the EIP-712 `verifyingContract` is the hook itself.
library VortexFeeAuthorizationLib {
    bytes32 internal constant FEE_AUTHORIZATION_TYPEHASH = keccak256(
        "VortexPermFeeAuthorization("
        "bytes32 poolId,"
        "bytes32 quoteId,"
        "bytes32 oracleSnapshotHash,"
        "address swapper,"
        "address tokenIn,"
        "address tokenOut,"
        "bool zeroForOne,"
        "int256 amountSpecified,"
        "uint160 sqrtPriceLimitX96,"
        "uint24 commercialFeePips,"
        "uint40 deadline,"
        "uint64 nonce"
        ")"
    );

    function hashStruct(VortexPermFeeAuthorization memory auth) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FEE_AUTHORIZATION_TYPEHASH,
                auth.poolId,
                auth.quoteId,
                auth.oracleSnapshotHash,
                auth.swapper,
                auth.tokenIn,
                auth.tokenOut,
                auth.zeroForOne,
                auth.amountSpecified,
                auth.sqrtPriceLimitX96,
                auth.commercialFeePips,
                auth.deadline,
                auth.nonce
            )
        );
    }
}

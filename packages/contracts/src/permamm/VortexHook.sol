// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { BeforeSwapDelta, BeforeSwapDeltaLibrary } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { IVortexReferenceOracle } from "../interfaces/IVortexReferenceOracle.sol";
import { VortexFeeAuthorizationLib, VortexPermFeeAuthorization } from "./VortexFeeAuthorization.sol";

/// @title VortexHook — signed per-swap dynamic fees for the Vortex PermAMM
/// @notice A real Uniswap v4 hook on a real pool. Each swap carries an
///         offchain-signed *commercial* fee, which the hook clamps into an
///         immutable band and then adds an immutable safety component to. The
///         signer is a commercial optimizer, never a safety authority: no
///         signature, however crafted, can price below
///         `minSafetyFeePips + minCommercialFeePips`.
/// @dev Written at 0.8.30 against v4-core's `^0.8.0` interfaces and libraries.
///      The PoolManager *implementation* is 0.8.26 and is never imported here —
///      see src/v4/V4Deps.sol and docs/dependencies.md.
contract VortexHook is IHooks, EIP712 {
    using LPFeeLibrary for uint24;
    using StateLibrary for IPoolManager;

    uint256 private constant PIPS = 1_000_000;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    IPoolManager public immutable POOL_MANAGER;
    IVortexReferenceOracle public immutable ORACLE;
    /// @notice The only address allowed to provide liquidity (MVP: one managed position).
    address public immutable LIQUIDITY_MANAGER;
    /// @notice The only address allowed to initialize the pool.
    address public immutable INITIALIZER;
    /// @notice Signs commercial fee authorizations. Bounded by the band below.
    address public immutable FEE_SIGNER;

    /// @notice Immutable floor. Added AFTER the commercial clamp, so it is
    ///         unreachable by the signer.
    uint24 public immutable MIN_SAFETY_FEE_PIPS;
    uint24 public immutable MIN_COMMERCIAL_FEE_PIPS;
    uint24 public immutable MAX_COMMERCIAL_FEE_PIPS;
    /// @notice Max tolerated |pool price − oracle mid| before swaps are refused.
    uint16 public immutable MAX_POOL_DEVIATION_BPS;
    uint32 public immutable MAX_ORACLE_AGE;
    uint16 public immutable MAX_ORACLE_SPREAD_BPS;

    Currency public immutable CURRENCY0;
    Currency public immutable CURRENCY1;
    /// @notice True when the oracle's BASE asset (WBTC) is currency0. v4 sorts
    ///         currencies by address, so which side is base is a deployment
    ///         accident — the oracle price must be inverted when it is not.
    bool public immutable BASE_IS_CURRENCY0;

    mapping(address swapper => mapping(uint64 nonce => bool used)) public usedFeeNonces;

    event VortexPermSwap(
        bytes32 indexed poolId,
        bytes32 indexed quoteId,
        address indexed swapper,
        bool zeroForOne,
        int256 amountSpecified,
        int128 amount0,
        int128 amount1,
        uint24 feePips,
        uint256 oracleMidE18
    );

    error VortexOnlyPoolManager(address caller);
    error VortexPoolMustUseDynamicFee(uint24 fee);
    error VortexUnexpectedPair(Currency currency0, Currency currency1);
    error VortexUnauthorizedInitializer(address sender);
    error VortexExternalLiquidityForbidden(address sender);
    error VortexHookDataRequired();
    error VortexAuthorizationExpired(uint40 deadline);
    error VortexAuthorizationNonceUsed(address swapper, uint64 nonce);
    error VortexAuthorizationMismatch();
    error VortexBadFeeSignature(address recovered, address expected);
    error VortexStaleOracle(uint40 updatedAt);
    error VortexFutureOracleTimestamp(uint40 updatedAt);
    error VortexInvalidOraclePrice(uint256 bidE18, uint256 midE18, uint256 askE18);
    error VortexOracleSpreadTooWide(uint256 spreadBps);
    error VortexOracleSnapshotMismatch();
    error VortexPoolDeviationTooLarge(uint256 deviationBps);
    error VortexInvalidFeeBand(uint24 minCommercial, uint24 maxCommercial, uint24 minSafety);

    struct HookConfig {
        IPoolManager poolManager;
        IVortexReferenceOracle oracle;
        address liquidityManager;
        address initializer;
        address feeSigner;
        Currency currency0;
        Currency currency1;
        bool baseIsCurrency0;
        uint24 minSafetyFeePips;
        uint24 minCommercialFeePips;
        uint24 maxCommercialFeePips;
        uint16 maxPoolDeviationBps;
        uint32 maxOracleAge;
        uint16 maxOracleSpreadBps;
    }

    modifier onlyPoolManager() {
        require(msg.sender == address(POOL_MANAGER), VortexOnlyPoolManager(msg.sender));
        _;
    }

    constructor(HookConfig memory config) EIP712("Vortex PermAMM", "1") {
        require(
            config.minCommercialFeePips <= config.maxCommercialFeePips
                && uint256(config.minSafetyFeePips) + config.maxCommercialFeePips < PIPS,
            VortexInvalidFeeBand(
                config.minCommercialFeePips, config.maxCommercialFeePips, config.minSafetyFeePips
            )
        );

        POOL_MANAGER = config.poolManager;
        ORACLE = config.oracle;
        LIQUIDITY_MANAGER = config.liquidityManager;
        INITIALIZER = config.initializer;
        FEE_SIGNER = config.feeSigner;
        CURRENCY0 = config.currency0;
        CURRENCY1 = config.currency1;
        BASE_IS_CURRENCY0 = config.baseIsCurrency0;
        MIN_SAFETY_FEE_PIPS = config.minSafetyFeePips;
        MIN_COMMERCIAL_FEE_PIPS = config.minCommercialFeePips;
        MAX_COMMERCIAL_FEE_PIPS = config.maxCommercialFeePips;
        MAX_POOL_DEVIATION_BPS = config.maxPoolDeviationBps;
        MAX_ORACLE_AGE = config.maxOracleAge;
        MAX_ORACLE_SPREAD_BPS = config.maxOracleSpreadBps;
    }

    /// @notice Permission bits this hook's address must encode.
    function requiredHookFlags() public pure returns (uint160) {
        return Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
            | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    }

    // ===== enabled callbacks =====

    function beforeInitialize(
        address sender,
        PoolKey calldata key,
        uint160 sqrtPriceX96
    )
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        require(key.fee.isDynamicFee(), VortexPoolMustUseDynamicFee(key.fee));
        require(
            Currency.unwrap(key.currency0) == Currency.unwrap(CURRENCY0)
                && Currency.unwrap(key.currency1) == Currency.unwrap(CURRENCY1),
            VortexUnexpectedPair(key.currency0, key.currency1)
        );
        require(sender == INITIALIZER, VortexUnauthorizedInitializer(sender));

        // The starting price must already agree with the reference oracle,
        // otherwise the pool opens arbitrageable against its own hook.
        IVortexReferenceOracle.PriceData memory price = _freshPrice();
        _requireWithinDeviation(sqrtPriceX96, price.midPriceE18);

        return IHooks.beforeInitialize.selector;
    }

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    )
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        require(sender == LIQUIDITY_MANAGER, VortexExternalLiquidityForbidden(sender));
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    )
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        require(sender == LIQUIDITY_MANAGER, VortexExternalLiquidityForbidden(sender));
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    )
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        require(hookData.length > 0, VortexHookDataRequired());
        (VortexPermFeeAuthorization memory auth, bytes memory signature) =
            abi.decode(hookData, (VortexPermFeeAuthorization, bytes));

        uint24 feePips = _authorizedFee(key, params, auth, signature);

        // OVERRIDE_FEE_FLAG makes the PoolManager use this fee for THIS swap
        // only; the pool's stored dynamic fee is untouched.
        return (
            IHooks.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            feePips | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    )
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        (VortexPermFeeAuthorization memory auth,) =
            abi.decode(hookData, (VortexPermFeeAuthorization, bytes));

        emit VortexPermSwap(
            PoolId.unwrap(key.toId()),
            auth.quoteId,
            auth.swapper,
            params.zeroForOne,
            params.amountSpecified,
            delta.amount0(),
            delta.amount1(),
            auth.commercialFeePips + MIN_SAFETY_FEE_PIPS,
            ORACLE.latestPrice().midPriceE18
        );
        return (IHooks.afterSwap.selector, int128(0));
    }

    // ===== disabled callbacks (address flags keep the PoolManager from calling these) =====

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    )
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    )
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    )
        external
        pure
        returns (bytes4)
    {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    )
        external
        pure
        returns (bytes4)
    {
        return IHooks.afterDonate.selector;
    }

    // ===== internals =====

    /// @dev Validates the authorization and returns the final fee. Reverts on
    ///      anything suspicious; never returns a fee below the immutable floor.
    function _authorizedFee(
        PoolKey calldata key,
        SwapParams calldata params,
        VortexPermFeeAuthorization memory auth,
        bytes memory signature
    )
        private
        returns (uint24)
    {
        require(block.timestamp <= auth.deadline, VortexAuthorizationExpired(auth.deadline));
        require(
            !usedFeeNonces[auth.swapper][auth.nonce],
            VortexAuthorizationNonceUsed(auth.swapper, auth.nonce)
        );

        // Bind pool, direction, size and price limit — a signature for one
        // swap must be useless for any other.
        require(
            auth.poolId == PoolId.unwrap(key.toId()) && auth.zeroForOne == params.zeroForOne
                && auth.amountSpecified == params.amountSpecified
                && auth.sqrtPriceLimitX96 == params.sqrtPriceLimitX96,
            VortexAuthorizationMismatch()
        );

        address recovered =
            ECDSA.recover(_hashTypedDataV4(VortexFeeAuthorizationLib.hashStruct(auth)), signature);
        require(recovered == FEE_SIGNER, VortexBadFeeSignature(recovered, FEE_SIGNER));

        IVortexReferenceOracle.PriceData memory price = _freshPrice();
        require(
            auth.oracleSnapshotHash
                == keccak256(abi.encode(price.midPriceE18, price.bidPriceE18, price.askPriceE18, price.updatedAt)),
            VortexOracleSnapshotMismatch()
        );

        (uint160 sqrtPriceX96,,,) = POOL_MANAGER.getSlot0(key.toId());
        _requireWithinDeviation(sqrtPriceX96, price.midPriceE18);

        usedFeeNonces[auth.swapper][auth.nonce] = true;

        // Clamp the signed commercial component, THEN add the immutable safety
        // floor. Order matters: the signer can never reach below the floor.
        uint24 commercial = auth.commercialFeePips;
        if (commercial < MIN_COMMERCIAL_FEE_PIPS) commercial = MIN_COMMERCIAL_FEE_PIPS;
        if (commercial > MAX_COMMERCIAL_FEE_PIPS) commercial = MAX_COMMERCIAL_FEE_PIPS;
        return MIN_SAFETY_FEE_PIPS + commercial;
    }

    function _freshPrice() private view returns (IVortexReferenceOracle.PriceData memory price) {
        price = ORACLE.latestPrice();
        require(uint256(price.updatedAt) <= block.timestamp, VortexFutureOracleTimestamp(price.updatedAt));
        require(
            block.timestamp <= uint256(price.updatedAt) + MAX_ORACLE_AGE, VortexStaleOracle(price.updatedAt)
        );
        require(
            price.bidPriceE18 > 0 && price.bidPriceE18 <= price.midPriceE18
                && price.midPriceE18 <= price.askPriceE18,
            VortexInvalidOraclePrice(price.bidPriceE18, price.midPriceE18, price.askPriceE18)
        );
        uint256 spreadBps =
            (price.askPriceE18 - price.bidPriceE18) * BPS_DENOMINATOR / price.midPriceE18;
        require(spreadBps <= MAX_ORACLE_SPREAD_BPS, VortexOracleSpreadTooWide(spreadBps));
    }

    /// @dev Compares the pool's sqrt price against the oracle mid. Both are
    ///      converted to a comparable 1e18 "currency1 per currency0" scale
    ///      before the deviation is measured.
    function _requireWithinDeviation(uint160 sqrtPriceX96, uint256 oracleMidE18) private view {
        uint256 poolPriceE18 = _sqrtPriceToPriceE18(sqrtPriceX96);
        uint256 referencePriceE18 = _oracleMidInPoolScale(oracleMidE18);

        uint256 diff = poolPriceE18 > referencePriceE18 ? poolPriceE18 - referencePriceE18 : referencePriceE18 - poolPriceE18;
        uint256 deviationBps = referencePriceE18 == 0 ? type(uint256).max : diff * BPS_DENOMINATOR / referencePriceE18;
        require(deviationBps <= MAX_POOL_DEVIATION_BPS, VortexPoolDeviationTooLarge(deviationBps));
    }

    /// @dev price = (sqrtPriceX96 / 2^96)^2, scaled to 1e18. Split into two
    ///      mulDiv-safe halves to avoid overflowing on realistic prices.
    function _sqrtPriceToPriceE18(uint160 sqrtPriceX96) private pure returns (uint256) {
        uint256 p = uint256(sqrtPriceX96);
        return (p * p) >> 192 == 0 ? (p * p * 1e18) >> 192 : ((p * p) >> 192) * 1e18;
    }

    /// @dev The oracle quotes QUOTE per BASE (USDC per WBTC) at 1e18. The pool
    ///      quotes currency1 per currency0 in raw token units. Two adjustments
    ///      are needed: invert when the base is currency1 (v4 sorts by address,
    ///      so that happens roughly half the time), and reconcile the decimals.
    function _oracleMidInPoolScale(uint256 oracleMidE18) private view returns (uint256) {
        uint256 decimalScale0 = 10 ** _decimals(CURRENCY0);
        uint256 decimalScale1 = 10 ** _decimals(CURRENCY1);

        uint256 priceE18 = BASE_IS_CURRENCY0
            ? oracleMidE18
            // currency0 is the quote asset, so the pool's price is 1 / oracle.
            : Math.mulDiv(1e18, 1e18, oracleMidE18);

        return Math.mulDiv(priceE18, decimalScale1, decimalScale0);
    }

    function _decimals(Currency currency) private view returns (uint8) {
        (bool ok, bytes memory data) =
            Currency.unwrap(currency).staticcall(abi.encodeWithSignature("decimals()"));
        return ok && data.length >= 32 ? abi.decode(data, (uint8)) : 18;
    }
}

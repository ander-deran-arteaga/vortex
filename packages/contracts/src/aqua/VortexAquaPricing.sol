// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { SwapQuery, SwapRegisters } from "@1inch/swap-vm/src/libs/VM.sol";

import { IVortexReferenceOracle } from "../interfaces/IVortexReferenceOracle.sol";
import { VortexCoverage } from "../libraries/VortexCoverage.sol";
import { VortexFeeMath } from "../libraries/VortexFeeMath.sol";
import { VortexInventoryMath } from "../libraries/VortexInventoryMath.sol";
import { VortexTokenMath } from "../libraries/VortexTokenMath.sol";

/// @notice Immutable per-strategy configuration, packed into the Extruction
///         instruction args inside order.data — therefore part of the Aqua
///         strategyHash and unchangeable after ship.
struct VortexSwapConfig {
    address baseToken;
    address quoteToken;
    address referenceOracle;
    address rebateSigner;
    uint8 baseDecimals;
    uint8 quoteDecimals;
    uint16 minSafetyFeeBps;
    uint16 defaultCommercialFeeBps;
    uint16 minCommercialFeeBps;
    uint16 maxCommercialFeeBps;
    uint16 inventoryStrengthBps;
    uint16 maxTradeBps;
    uint16 minBaseWeightBps;
    uint16 maxBaseWeightBps;
    uint16 maxOracleSpreadBps;
    uint32 maxOracleAge;
}

library VortexSwapConfigLib {
    uint256 internal constant ENCODED_LENGTH = 104;

    error BadConfigLength(uint256 actual);

    function encode(VortexSwapConfig memory c) internal pure returns (bytes memory) {
        return abi.encodePacked(
            c.baseToken,
            c.quoteToken,
            c.referenceOracle,
            c.rebateSigner,
            c.baseDecimals,
            c.quoteDecimals,
            c.minSafetyFeeBps,
            c.defaultCommercialFeeBps,
            c.minCommercialFeeBps,
            c.maxCommercialFeeBps,
            c.inventoryStrengthBps,
            c.maxTradeBps,
            c.minBaseWeightBps,
            c.maxBaseWeightBps,
            c.maxOracleSpreadBps,
            c.maxOracleAge
        );
    }

    function decode(bytes calldata blob) internal pure returns (VortexSwapConfig memory c) {
        require(blob.length == ENCODED_LENGTH, BadConfigLength(blob.length));
        c.baseToken = address(bytes20(blob[0:20]));
        c.quoteToken = address(bytes20(blob[20:40]));
        c.referenceOracle = address(bytes20(blob[40:60]));
        c.rebateSigner = address(bytes20(blob[60:80]));
        c.baseDecimals = uint8(blob[80]);
        c.quoteDecimals = uint8(blob[81]);
        c.minSafetyFeeBps = uint16(bytes2(blob[82:84]));
        c.defaultCommercialFeeBps = uint16(bytes2(blob[84:86]));
        c.minCommercialFeeBps = uint16(bytes2(blob[86:88]));
        c.maxCommercialFeeBps = uint16(bytes2(blob[88:90]));
        c.inventoryStrengthBps = uint16(bytes2(blob[90:92]));
        c.maxTradeBps = uint16(bytes2(blob[92:94]));
        c.minBaseWeightBps = uint16(bytes2(blob[94:96]));
        c.maxBaseWeightBps = uint16(bytes2(blob[96:98]));
        c.maxOracleSpreadBps = uint16(bytes2(blob[98:100]));
        c.maxOracleAge = uint32(bytes4(blob[100:104]));
    }
}

/// @notice Mirrors packages/shared/src/typedData.ts VortexQuoteAuthorization
///         field-for-field, order-for-order (MASTER R-006 / Addendum 2).
struct VortexQuoteAuthorization {
    bytes32 orderHash;
    bytes32 quoteId;
    bytes32 competitorQuoteHash;
    address taker;
    address tokenIn;
    address tokenOut;
    uint128 amount;
    bool isExactIn;
    uint16 commercialRebateBps;
    uint40 deadline;
    uint64 nonce;
}

/// @title VortexAquaPricing — Vortex Swap oracle/inventory pricing
/// @notice SwapVM Extruction target implementing inventory-aware, oracle-
///         anchored two-way quoting for an Aqua-shipped WBTC/USDC strategy.
///         One code path serves quote() and swap(): the router staticcalls
///         this same function in quote context, so amounts cannot diverge.
///         The only non-static effect is rebate-nonce consumption, gated on
///         `isStaticContext`.
contract VortexAquaPricing is EIP712 {
    using VortexSwapConfigLib for bytes;
    using VortexTokenMath for uint256;

    uint256 private constant BPS = 10_000;

    bytes32 public constant QUOTE_AUTHORIZATION_TYPEHASH = keccak256(
        "VortexQuoteAuthorization("
        "bytes32 orderHash,"
        "bytes32 quoteId,"
        "bytes32 competitorQuoteHash,"
        "address taker,"
        "address tokenIn,"
        "address tokenOut,"
        "uint128 amount,"
        "bool isExactIn,"
        "uint16 commercialRebateBps,"
        "uint40 deadline,"
        "uint64 nonce"
        ")"
    );

    /// @notice The only SwapVM router allowed to drive pricing (and burn nonces).
    address public immutable ROUTER;
    IAqua public immutable AQUA;

    mapping(address taker => mapping(uint64 nonce => bool used)) public usedQuoteNonces;

    struct FeeBreakdown {
        uint16 safetyFeeBps;
        uint16 commercialFeeBps;
        int256 inventoryAdjustmentBps;
        uint16 finalFeeBps;
        uint256 oracleMidE18;
        uint256 amountIn;
        uint256 amountOut;
    }

    event VortexRebateApplied(
        bytes32 indexed quoteId, address indexed taker, uint16 commercialRebateBps, uint64 nonce
    );

    error VortexUnauthorizedCaller(address caller);
    error VortexUnsupportedTokenPair(address tokenIn, address tokenOut);
    error VortexStaleOracle(uint40 updatedAt, uint32 maxOracleAge);
    error VortexInvalidOraclePrice(uint256 bidE18, uint256 midE18, uint256 askE18);
    error VortexOracleSpreadTooWide(uint256 spreadBps, uint16 maxOracleSpreadBps);
    error VortexMaxTradeExceeded(uint256 tradeFractionBps, uint16 maxTradeBps);
    error VortexInventoryBoundBreached(uint256 baseWeightBps, uint16 minBaseWeightBps, uint16 maxBaseWeightBps);
    error VortexInsufficientStrategyBalance(uint256 amountOut, uint256 balanceOut);
    error VortexMakerNotCovered(address token, uint256 required, uint256 executable);
    error VortexZeroAmountOut();
    error VortexRecomputeDetected();
    error VortexRebateExpired(uint40 deadline);
    error VortexRebateMismatch();
    error VortexBadRebateSignature(address recovered, address expected);
    error VortexRebateNonceUsed(address taker, uint64 nonce);

    constructor(address router, IAqua aqua) EIP712("Vortex Swap", "1") {
        ROUTER = router;
        AQUA = aqua;
    }

    /// @notice SwapVM Extruction entrypoint (both IExtruction and
    ///         IStaticExtruction resolve to this selector). Declared non-view
    ///         so the swap path can consume rebate nonces; in static context
    ///         the router staticcalls it and no state is written.
    /// @param args   Packed VortexSwapConfig (the 20-byte target prefix is
    ///               already stripped by the instruction).
    /// @param takerData Empty for un-rebated fills, else
    ///               abi.encode(VortexQuoteAuthorization, bytes signature).
    function extruction(
        bool isStaticContext,
        uint256 nextPC,
        SwapQuery calldata query,
        SwapRegisters calldata swap,
        bytes calldata args,
        bytes calldata takerData
    )
        external
        returns (uint256 updatedNextPC, uint256 choppedLength, SwapRegisters memory updatedSwap)
    {
        require(msg.sender == ROUTER, VortexUnauthorizedCaller(msg.sender));

        VortexSwapConfig memory cfg = args.decode();
        uint16 rebateBps = _consumeRebate(isStaticContext, query, swap, cfg, takerData);

        FeeBreakdown memory bd = _evaluate(
            cfg,
            query.tokenIn,
            query.tokenOut,
            query.isExactIn,
            swap.amountIn,
            swap.amountOut,
            swap.balanceIn,
            swap.balanceOut,
            query.maker,
            query.orderHash,
            rebateBps
        );

        updatedSwap = SwapRegisters({
            balanceIn: swap.balanceIn,
            balanceOut: swap.balanceOut,
            amountIn: bd.amountIn,
            amountOut: bd.amountOut,
            amountNetPulled: swap.amountNetPulled
        });
        return (nextPC, takerData.length, updatedSwap);
    }

    /// @notice Fee/amount preview for lenses, the api, and tests. Pure
    ///         function of the same math extruction runs — no nonce logic.
    function preview(
        bytes calldata configBlob,
        address maker,
        bytes32 strategyHash,
        address tokenIn,
        address tokenOut,
        bool isExactIn,
        uint256 amount,
        uint256 balanceIn,
        uint256 balanceOut,
        uint16 rebateBps
    )
        external
        view
        returns (FeeBreakdown memory)
    {
        return _evaluate(
            configBlob.decode(),
            tokenIn,
            tokenOut,
            isExactIn,
            isExactIn ? amount : 0,
            isExactIn ? 0 : amount,
            balanceIn,
            balanceOut,
            maker,
            strategyHash,
            rebateBps
        );
    }

    function _consumeRebate(
        bool isStaticContext,
        SwapQuery calldata query,
        SwapRegisters calldata swap,
        VortexSwapConfig memory cfg,
        bytes calldata takerData
    )
        private
        returns (uint16)
    {
        if (takerData.length == 0) return 0;

        (VortexQuoteAuthorization memory auth, bytes memory signature) =
            abi.decode(takerData, (VortexQuoteAuthorization, bytes));

        require(block.timestamp <= auth.deadline, VortexRebateExpired(auth.deadline));

        uint256 specifiedAmount = query.isExactIn ? swap.amountIn : swap.amountOut;
        require(
            auth.orderHash == query.orderHash && auth.taker == query.taker && auth.tokenIn == query.tokenIn
                && auth.tokenOut == query.tokenOut && auth.amount == specifiedAmount
                && auth.isExactIn == query.isExactIn,
            VortexRebateMismatch()
        );

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_AUTHORIZATION_TYPEHASH,
                    auth.orderHash,
                    auth.quoteId,
                    auth.competitorQuoteHash,
                    auth.taker,
                    auth.tokenIn,
                    auth.tokenOut,
                    auth.amount,
                    auth.isExactIn,
                    auth.commercialRebateBps,
                    auth.deadline,
                    auth.nonce
                )
            )
        );
        address recovered = ECDSA.recover(digest, signature);
        require(recovered == cfg.rebateSigner, VortexBadRebateSignature(recovered, cfg.rebateSigner));

        require(!usedQuoteNonces[auth.taker][auth.nonce], VortexRebateNonceUsed(auth.taker, auth.nonce));
        if (!isStaticContext) {
            usedQuoteNonces[auth.taker][auth.nonce] = true;
            emit VortexRebateApplied(auth.quoteId, auth.taker, auth.commercialRebateBps, auth.nonce);
        }

        return auth.commercialRebateBps;
    }

    function _evaluate(
        VortexSwapConfig memory cfg,
        address tokenIn,
        address tokenOut,
        bool isExactIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 balanceIn,
        uint256 balanceOut,
        address maker,
        bytes32 strategyHash,
        uint16 rebateBps
    )
        private
        view
        returns (FeeBreakdown memory bd)
    {
        bool isBaseIn = tokenIn == cfg.baseToken;
        require(
            (isBaseIn && tokenOut == cfg.quoteToken) || (tokenIn == cfg.quoteToken && tokenOut == cfg.baseToken),
            VortexUnsupportedTokenPair(tokenIn, tokenOut)
        );
        if (isExactIn) {
            require(amountOut == 0, VortexRecomputeDetected());
        } else {
            require(amountIn == 0, VortexRecomputeDetected());
        }

        IVortexReferenceOracle.PriceData memory price = _freshPrice(cfg);
        bd.oracleMidE18 = price.midPriceE18;

        (uint8 decIn, uint8 decOut) =
            isBaseIn ? (cfg.baseDecimals, cfg.quoteDecimals) : (cfg.quoteDecimals, cfg.baseDecimals);

        // Portfolio value in quote terms at mid.
        (uint256 baseBalE18, uint256 quoteBalE18) = isBaseIn
            ? (balanceIn.toE18(decIn), balanceOut.toE18(decOut))
            : (balanceOut.toE18(decOut), balanceIn.toE18(decIn));
        uint256 baseValE18 = VortexInventoryMath.baseValueE18(baseBalE18, price.midPriceE18);
        uint256 totalValE18 = baseValE18 + quoteBalE18;

        // Trade value in quote terms at mid (from the taker-specified leg).
        uint256 tradeValueE18;
        if (isExactIn) {
            uint256 amtInE18 = amountIn.toE18(decIn);
            tradeValueE18 = isBaseIn ? VortexInventoryMath.baseValueE18(amtInE18, price.midPriceE18) : amtInE18;
        } else {
            uint256 amtOutE18 = amountOut.toE18(decOut);
            tradeValueE18 = isBaseIn ? amtOutE18 : VortexInventoryMath.baseValueE18(amtOutE18, price.midPriceE18);
        }

        uint256 fractionBps = VortexInventoryMath.tradeFractionBps(tradeValueE18, totalValE18);
        require(fractionBps <= cfg.maxTradeBps, VortexMaxTradeExceeded(fractionBps, cfg.maxTradeBps));

        // Fee: immutable safety floor + inventory-aware clamped commercial part.
        bd.safetyFeeBps = cfg.minSafetyFeeBps;
        bd.inventoryAdjustmentBps = VortexInventoryMath.inventoryAdjustmentBps(
            cfg.inventoryStrengthBps, VortexInventoryMath.skewBps(baseValE18, quoteBalE18), fractionBps, isBaseIn
        );
        bd.commercialFeeBps = VortexFeeMath.clampCommercialBps(
            int256(uint256(cfg.defaultCommercialFeeBps)) - int256(uint256(rebateBps)) + bd.inventoryAdjustmentBps,
            cfg.minCommercialFeeBps,
            cfg.maxCommercialFeeBps
        );
        bd.finalFeeBps = VortexFeeMath.composeFeeBps(bd.safetyFeeBps, bd.commercialFeeBps);

        // Execution price: the pool buys base at bid and sells base at ask;
        // rounding always favors the maker (floor what the pool pays, ceil
        // what the pool charges).
        if (isExactIn) {
            bd.amountIn = amountIn;
            uint256 amtInE18 = amountIn.toE18(decIn);
            uint256 grossOutE18 = isBaseIn
                ? amtInE18.mulPriceE18Floor(price.bidPriceE18)
                : amtInE18.divPriceE18Floor(price.askPriceE18);
            bd.amountOut = VortexFeeMath.applyFeeOnOutputFloor(grossOutE18, bd.finalFeeBps).fromE18Floor(decOut);
            require(bd.amountOut > 0, VortexZeroAmountOut());
        } else {
            bd.amountOut = amountOut;
            uint256 grossOutE18 = VortexFeeMath.grossUpForFeeCeil(amountOut.toE18(decOut), bd.finalFeeBps);
            uint256 amtInE18 = isBaseIn
                ? grossOutE18.divPriceE18Ceil(price.bidPriceE18)
                : grossOutE18.mulPriceE18Ceil(price.askPriceE18);
            bd.amountIn = amtInE18.fromE18Ceil(decIn);
        }

        require(bd.amountOut <= balanceOut, VortexInsufficientStrategyBalance(bd.amountOut, balanceOut));

        // Post-trade inventory must stay inside the immutable hard bounds.
        {
            (uint256 newBaseE18, uint256 newQuoteE18) = isBaseIn
                ? ((balanceIn + bd.amountIn).toE18(decIn), (balanceOut - bd.amountOut).toE18(decOut))
                : ((balanceOut - bd.amountOut).toE18(decOut), (balanceIn + bd.amountIn).toE18(decIn));
            uint256 newWeightBps = VortexInventoryMath.baseWeightBps(
                VortexInventoryMath.baseValueE18(newBaseE18, price.midPriceE18), newQuoteE18
            );
            require(
                newWeightBps >= cfg.minBaseWeightBps && newWeightBps <= cfg.maxBaseWeightBps,
                VortexInventoryBoundBreached(newWeightBps, cfg.minBaseWeightBps, cfg.maxBaseWeightBps)
            );
        }

        // Phantom-liquidity guard: virtual balance is not collateral — the
        // maker's wallet + Aqua allowance must actually cover the output.
        (,,, uint256 executable) =
            VortexCoverage.executableBalance(AQUA, maker, ROUTER, strategyHash, tokenOut);
        require(executable >= bd.amountOut, VortexMakerNotCovered(tokenOut, bd.amountOut, executable));
    }

    function _freshPrice(VortexSwapConfig memory cfg)
        private
        view
        returns (IVortexReferenceOracle.PriceData memory price)
    {
        price = IVortexReferenceOracle(cfg.referenceOracle).latestPrice();
        require(
            block.timestamp <= uint256(price.updatedAt) + cfg.maxOracleAge,
            VortexStaleOracle(price.updatedAt, cfg.maxOracleAge)
        );
        require(
            price.bidPriceE18 > 0 && price.bidPriceE18 <= price.midPriceE18
                && price.midPriceE18 <= price.askPriceE18,
            VortexInvalidOraclePrice(price.bidPriceE18, price.midPriceE18, price.askPriceE18)
        );
        uint256 spreadBps = (price.askPriceE18 - price.bidPriceE18) * BPS / price.midPriceE18;
        require(spreadBps <= cfg.maxOracleSpreadBps, VortexOracleSpreadTooWide(spreadBps, cfg.maxOracleSpreadBps));
    }
}

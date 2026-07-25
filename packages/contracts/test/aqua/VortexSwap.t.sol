// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { AquaSwapVMRouter } from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { SwapQuery, SwapRegisters } from "@1inch/swap-vm/src/libs/VM.sol";

import {
    VortexAquaPricing,
    VortexQuoteAuthorization,
    VortexSwapConfig,
    VortexSwapConfigLib
} from "../../src/aqua/VortexAquaPricing.sol";
import { VortexAquaOrderBuilder } from "../../src/aqua/VortexAquaOrderBuilder.sol";
import { VortexAquaLens } from "../../src/aqua/VortexAquaLens.sol";
import { IVortexReferenceOracle } from "../../src/interfaces/IVortexReferenceOracle.sol";
import { MockReferenceOracle } from "../../src/mocks/MockReferenceOracle.sol";
import { MockERC20 } from "../../src/mocks/MockERC20.sol";
import { MockUSDC } from "../../src/mocks/MockUSDC.sol";
import { MockWBTC } from "../../src/mocks/MockWBTC.sol";

/// @notice Phase 2 exit gate: Vortex Swap settles real WBTC/USDC through the
///         official Aqua + AquaSwapVMRouter stack with inventory-aware,
///         oracle-anchored pricing driven by VortexAquaPricing (Extruction).
contract VortexSwapTest is Test {
    using VortexSwapConfigLib for VortexSwapConfig;

    uint256 internal constant MID = 100_000e18;
    uint256 internal constant BID = 99_950e18;
    uint256 internal constant ASK = 100_050e18;

    /// @dev keccak256 of the VortexQuoteAuthorization type string built from
    ///      packages/shared/src/typedData.ts (master-owned source of truth).
    ///      Independently computed with `cast keccak`, NOT copied from the
    ///      contract — this is what pins Solidity to the shared definition.
    bytes32 internal constant CANONICAL_QUOTE_AUTHORIZATION_TYPEHASH =
        0x471f6d550c6ee5b718abd43f88529d1f9e4b53e2947c13b05699d69fdc6b1879;

    Aqua internal aqua;
    AquaSwapVMRouter internal router;
    MockWBTC internal wbtc;
    MockUSDC internal usdc;
    MockERC20 internal weth;
    MockReferenceOracle internal oracle;
    VortexAquaPricing internal pricing;
    VortexAquaOrderBuilder internal builder;
    VortexAquaLens internal lens;

    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");
    address internal rebateSigner;
    uint256 internal rebateSignerKey;

    function setUp() public {
        (rebateSigner, rebateSignerKey) = makeAddrAndKey("rebateSigner");

        aqua = new Aqua();
        wbtc = new MockWBTC();
        usdc = new MockUSDC();
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        router = new AquaSwapVMRouter(address(aqua), address(weth), address(this), "AquaSwapVMRouter", "1.0.1");
        oracle = new MockReferenceOracle(address(this));
        oracle.setPrice(MID, BID, ASK);
        pricing = new VortexAquaPricing(address(router), IAqua(address(aqua)));
        builder = new VortexAquaOrderBuilder(pricing);
        lens = new VortexAquaLens(IAqua(address(aqua)), address(router), pricing);

        wbtc.mint(maker, 10e8);
        usdc.mint(maker, 1_000_000e6);
        wbtc.mint(taker, 10e8);
        usdc.mint(taker, 1_000_000e6);

        vm.startPrank(taker);
        wbtc.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ===== helpers =====

    function _defaultParams() internal view returns (VortexAquaOrderBuilder.VortexSwapStrategyParams memory) {
        return VortexAquaOrderBuilder.VortexSwapStrategyParams({
            maker: maker,
            baseToken: address(wbtc),
            quoteToken: address(usdc),
            referenceOracle: address(oracle),
            rebateSigner: rebateSigner,
            minSafetyFeeBps: 5,
            defaultCommercialFeeBps: 20,
            minCommercialFeeBps: 5,
            maxCommercialFeeBps: 200,
            inventoryStrengthBps: 1_000,
            maxTradeBps: 1_000,
            minBaseWeightBps: 1_000,
            maxBaseWeightBps: 9_000,
            maxOracleSpreadBps: 50,
            maxOracleAge: 1 hours,
            strategyDeadline: uint40(block.timestamp + 1 days),
            salt: 1
        });
    }

    function _ship(
        VortexAquaOrderBuilder.VortexSwapStrategyParams memory params,
        uint256 wbtcAmount,
        uint256 usdcAmount
    )
        internal
        returns (ISwapVM.Order memory order, bytes32 strategyHash)
    {
        (order, strategyHash) = builder.buildOrder(params);
        assertEq(strategyHash, router.hash(order), "builder hash must match router hash");

        address[] memory tokens = new address[](2);
        tokens[0] = address(wbtc);
        tokens[1] = address(usdc);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = wbtcAmount;
        amounts[1] = usdcAmount;

        vm.startPrank(maker);
        wbtc.approve(address(aqua), type(uint256).max);
        usdc.approve(address(aqua), type(uint256).max);
        bytes32 shippedHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
        vm.stopPrank();
        assertEq(shippedHash, strategyHash, "aqua strategy hash equals order hash");
    }

    function _shipDefault() internal returns (ISwapVM.Order memory order, bytes32 strategyHash) {
        return _ship(_defaultParams(), 1e8, 100_000e6);
    }

    function _takerTraitsAndData(bool isExactIn, bytes memory instructionsArgs) internal view returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: taker,
                isExactIn: isExactIn,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: true,
                threshold: "",
                to: address(0),
                deadline: 0,
                hasPreTransferInCallback: false,
                hasPreTransferOutCallback: false,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: instructionsArgs,
                signature: ""
            })
        );
    }

    function _quote(
        ISwapVM.Order memory order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bool isExactIn
    )
        internal
        returns (uint256 amountIn, uint256 amountOut)
    {
        vm.prank(taker);
        (amountIn, amountOut,) = ISwapVM(address(router)).quote(
            order, tokenIn, tokenOut, amount, _takerTraitsAndData(isExactIn, "")
        );
    }

    function _swap(
        ISwapVM.Order memory order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bool isExactIn,
        bytes memory instructionsArgs
    )
        internal
        returns (uint256 amountIn, uint256 amountOut)
    {
        vm.prank(taker);
        (amountIn, amountOut,) =
            router.swap(order, tokenIn, tokenOut, amount, _takerTraitsAndData(isExactIn, instructionsArgs));
    }

    function _configBlob(VortexAquaOrderBuilder.VortexSwapStrategyParams memory params)
        internal
        view
        returns (bytes memory)
    {
        return VortexSwapConfig({
            baseToken: params.baseToken,
            quoteToken: params.quoteToken,
            referenceOracle: params.referenceOracle,
            rebateSigner: params.rebateSigner,
            baseDecimals: 8,
            quoteDecimals: 6,
            minSafetyFeeBps: params.minSafetyFeeBps,
            defaultCommercialFeeBps: params.defaultCommercialFeeBps,
            minCommercialFeeBps: params.minCommercialFeeBps,
            maxCommercialFeeBps: params.maxCommercialFeeBps,
            inventoryStrengthBps: params.inventoryStrengthBps,
            maxTradeBps: params.maxTradeBps,
            minBaseWeightBps: params.minBaseWeightBps,
            maxBaseWeightBps: params.maxBaseWeightBps,
            maxOracleSpreadBps: params.maxOracleSpreadBps,
            maxOracleAge: params.maxOracleAge
        }).encode();
    }

    function _signAuth(VortexQuoteAuthorization memory auth, uint256 key) internal view returns (bytes memory) {
        // Signed with the CANONICAL typehash constant, not the contract's own
        // getter — otherwise a drifted contract would sign and verify with the
        // same wrong hash and the test could never catch it.
        bytes32 structHash = keccak256(
            abi.encode(
                CANONICAL_QUOTE_AUTHORIZATION_TYPEHASH,
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
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Vortex Swap")),
                keccak256(bytes("1")),
                block.chainid,
                address(pricing)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _rebateArgs(
        bytes32 strategyHash,
        address tokenIn,
        address tokenOut,
        uint128 amount,
        bool isExactIn,
        uint16 rebateBps,
        uint64 nonce,
        uint256 key
    )
        internal
        returns (bytes memory)
    {
        VortexQuoteAuthorization memory auth = VortexQuoteAuthorization({
            orderHash: strategyHash,
            quoteId: keccak256(abi.encode("quote", nonce)),
            competitorQuoteHash: keccak256("uniswap-competitor"),
            taker: taker,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amount: amount,
            isExactIn: isExactIn,
            commercialRebateBps: rebateBps,
            deadline: uint40(block.timestamp + 5 minutes),
            nonce: nonce
        });
        return abi.encode(auth, _signAuth(auth, key));
    }

    // ===== §8.2 suite =====

    function test_exactInputSwapMovesRealTokens() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipDefault();

        uint256 makerWbtcBefore = wbtc.balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);
        uint256 takerWbtcBefore = wbtc.balanceOf(taker);
        uint256 takerUsdcBefore = usdc.balanceOf(taker);

        // Sell 0.1 WBTC. Fee = 5 safety + clamp(20 + 50 inventory) = 75 bps.
        // 0.1 * 99,950 = 9,995 USDC gross -> 9,920.0375 USDC net.
        (uint256 amountIn, uint256 amountOut) = _swap(order, address(wbtc), address(usdc), 0.1e8, true, "");

        assertEq(amountIn, 0.1e8);
        assertEq(amountOut, 9_920.0375e6);

        // Real tokens moved: taker -> maker WBTC, maker -> taker USDC.
        assertEq(wbtc.balanceOf(taker), takerWbtcBefore - amountIn);
        assertEq(wbtc.balanceOf(maker), makerWbtcBefore + amountIn);
        assertEq(usdc.balanceOf(maker), makerUsdcBefore - amountOut);
        assertEq(usdc.balanceOf(taker), takerUsdcBefore + amountOut);
        assertEq(wbtc.balanceOf(address(router)), 0, "router holds nothing");
        assertEq(usdc.balanceOf(address(router)), 0, "router holds nothing");

        // Virtual ledger tracked both legs exactly.
        (uint256 virtualWbtc, uint256 virtualUsdc) =
            aqua.safeBalances(maker, address(router), strategyHash, address(wbtc), address(usdc));
        assertEq(virtualWbtc, 1e8 + amountIn);
        assertEq(virtualUsdc, 100_000e6 - amountOut);
    }

    function test_quoteMatchesSwap() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        (uint256 quotedIn, uint256 quotedOut) = _quote(order, address(wbtc), address(usdc), 0.1e8, true);
        (uint256 swappedIn, uint256 swappedOut) = _swap(order, address(wbtc), address(usdc), 0.1e8, true, "");

        assertEq(quotedIn, swappedIn, "quote/swap amountIn identical");
        assertEq(quotedOut, swappedOut, "quote/swap amountOut identical");
    }

    function test_exactOutputSymmetry() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        (, uint256 exactInOut) = _quote(order, address(wbtc), address(usdc), 0.1e8, true);
        (uint256 exactOutIn,) = _quote(order, address(wbtc), address(usdc), exactInOut, false);

        // The two directions price their own declared size (the trade-fraction
        // fee basis differs by ~1 bp), so demand tight closure, not identity...
        assertApproxEqRel(exactOutIn, 0.1e8, 0.0002e18, "exact-out closes within 2 bps of exact-in");

        // ...and no free lunch: replaying the exact-out's input through
        // exact-in can never beat the original output.
        (, uint256 roundtripOut) = _quote(order, address(wbtc), address(usdc), exactOutIn, true);
        assertLe(roundtripOut, exactInOut, "roundtrip never profits the taker");

        // The exact-out leg settles for real too.
        (uint256 execIn, uint256 execOut) = _swap(order, address(wbtc), address(usdc), exactInOut, false, "");
        assertEq(execOut, exactInOut);
        assertEq(execIn, exactOutIn);
    }

    function test_recentringFlowGetsLowerFee() public {
        // Base-heavy book: 1.5 WBTC / 50k USDC -> skew +5000 bps.
        VortexAquaOrderBuilder.VortexSwapStrategyParams memory params = _defaultParams();
        (ISwapVM.Order memory order, bytes32 strategyHash) = _ship(params, 1.5e8, 50_000e6);
        bytes memory blob = _configBlob(params);

        (uint256 balUsdcIn, uint256 balWbtcOut) =
            aqua.safeBalances(maker, address(router), strategyHash, address(usdc), address(wbtc));
        VortexAquaPricing.FeeBreakdown memory recentring = pricing.preview(
            blob, maker, strategyHash, address(usdc), address(wbtc), true, 10_000e6, balUsdcIn, balWbtcOut, 0
        );

        (uint256 balWbtcIn, uint256 balUsdcOut) =
            aqua.safeBalances(maker, address(router), strategyHash, address(wbtc), address(usdc));
        VortexAquaPricing.FeeBreakdown memory worsening = pricing.preview(
            blob, maker, strategyHash, address(wbtc), address(usdc), true, 0.1e8, balWbtcIn, balUsdcOut, 0
        );

        assertLt(recentring.finalFeeBps, worsening.finalFeeBps, "recentring must be cheaper");
        assertLt(recentring.inventoryAdjustmentBps, 0, "recentring earns a discount");
        assertGt(worsening.inventoryAdjustmentBps, 0, "worsening pays a premium");

        // And the discount clamps at the immutable floor, never below.
        assertGe(recentring.finalFeeBps, params.minSafetyFeeBps + params.minCommercialFeeBps);
    }

    function test_worseningFlowGetsHigherFee() public {
        VortexAquaOrderBuilder.VortexSwapStrategyParams memory params = _defaultParams();
        (, bytes32 strategyHash) = _ship(params, 1e8, 100_000e6);
        bytes memory blob = _configBlob(params);

        // Balanced book: any nonzero size pays above the pure default.
        VortexAquaPricing.FeeBreakdown memory small = pricing.preview(
            blob, maker, strategyHash, address(wbtc), address(usdc), true, 0.01e8, 1e8, 100_000e6, 0
        );
        VortexAquaPricing.FeeBreakdown memory large = pricing.preview(
            blob, maker, strategyHash, address(wbtc), address(usdc), true, 0.1e8, 1e8, 100_000e6, 0
        );

        assertGt(large.finalFeeBps, small.finalFeeBps, "larger trades pay more");
        assertGt(
            large.finalFeeBps, params.minSafetyFeeBps + params.defaultCommercialFeeBps, "worsening beats default"
        );
    }

    function test_maxTradeReverts() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        // 0.25 WBTC = 12.5% of the 200k book > 10% cap.
        vm.prank(taker);
        vm.expectRevert(
            abi.encodeWithSelector(VortexAquaPricing.VortexMaxTradeExceeded.selector, 1250, 1000)
        );
        router.swap(order, address(wbtc), address(usdc), 0.25e8, _takerTraitsAndData(true, ""));
    }

    function test_staleReferenceReverts() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(taker);
        vm.expectPartialRevert(VortexAquaPricing.VortexStaleOracle.selector);
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, ""));
    }

    function test_invalidRebateSignatureReverts() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipDefault();

        (, uint256 malloryKey) = makeAddrAndKey("mallory");
        bytes memory badArgs =
            _rebateArgs(strategyHash, address(wbtc), address(usdc), 0.1e8, true, 50, 1, malloryKey);

        vm.prank(taker);
        vm.expectPartialRevert(VortexAquaPricing.VortexBadRebateSignature.selector);
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, badArgs));
    }

    function test_validRebateLowersFeeAndConsumesNonce() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipDefault();

        bytes memory rebateArgs =
            _rebateArgs(strategyHash, address(wbtc), address(usdc), 0.1e8, true, 50, 7, rebateSignerKey);

        (, uint256 plainOut) = _quote(order, address(wbtc), address(usdc), 0.1e8, true);

        assertFalse(pricing.usedQuoteNonces(taker, 7));
        (, uint256 rebatedOut) = _swap(order, address(wbtc), address(usdc), 0.1e8, true, rebateArgs);
        assertTrue(pricing.usedQuoteNonces(taker, 7), "swap path consumes the nonce");

        // Fee drops 75 -> 25 bps: 9,995 * 0.9975 = 9,970.0125 USDC.
        assertEq(rebatedOut, 9_970.0125e6);
        assertGt(rebatedOut, plainOut, "rebate improves the taker's price");
    }

    function test_rebateReplayReverts() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipDefault();

        bytes memory rebateArgs =
            _rebateArgs(strategyHash, address(wbtc), address(usdc), 0.01e8, true, 50, 9, rebateSignerKey);

        _swap(order, address(wbtc), address(usdc), 0.01e8, true, rebateArgs);

        vm.prank(taker);
        vm.expectRevert(
            abi.encodeWithSelector(VortexAquaPricing.VortexRebateNonceUsed.selector, taker, uint64(9))
        );
        router.swap(order, address(wbtc), address(usdc), 0.01e8, _takerTraitsAndData(true, rebateArgs));
    }

    function test_rebateCannotRemoveSafetyFee() public {
        VortexAquaOrderBuilder.VortexSwapStrategyParams memory params = _defaultParams();
        (ISwapVM.Order memory order, bytes32 strategyHash) = _ship(params, 1e8, 100_000e6);

        // An absurd 100% rebate clamps at minCommercial; safety floor stands:
        // fee = 5 + 5 = 10 bps -> 9,995 * 0.999 = 9,985.005 USDC, no more.
        VortexAquaPricing.FeeBreakdown memory bd = pricing.preview(
            _configBlob(params), maker, strategyHash, address(wbtc), address(usdc), true, 0.1e8, 1e8, 100_000e6, 10_000
        );
        assertEq(bd.finalFeeBps, params.minSafetyFeeBps + params.minCommercialFeeBps);

        bytes memory rebateArgs =
            _rebateArgs(strategyHash, address(wbtc), address(usdc), 0.1e8, true, 10_000, 11, rebateSignerKey);
        (, uint256 amountOut) = _swap(order, address(wbtc), address(usdc), 0.1e8, true, rebateArgs);
        assertEq(amountOut, 9_985.005e6, "output capped by the immutable fee floor");
    }

    function test_postTradeHardBoundaryReverts() public {
        VortexAquaOrderBuilder.VortexSwapStrategyParams memory params = _defaultParams();
        params.minBaseWeightBps = 4_500;
        params.maxBaseWeightBps = 5_500;
        params.maxTradeBps = 3_000;
        (ISwapVM.Order memory order,) = _ship(params, 1e8, 100_000e6);

        // 0.3 WBTC in pushes base weight to ~65% > 55% hard cap.
        vm.prank(taker);
        vm.expectPartialRevert(VortexAquaPricing.VortexInventoryBoundBreached.selector);
        router.swap(order, address(wbtc), address(usdc), 0.3e8, _takerTraitsAndData(true, ""));
    }

    function test_roundingFavorsMaker() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        // Exact-out of 1 satoshi. Compare against the FEE-INCLUSIVE ceiling,
        // not raw fair value — the fee alone would mask a rounding regression.
        (uint256 satIn,) = _quote(order, address(usdc), address(wbtc), 1, false);

        // fee here: fraction rounds up to 1 bp, adj = 1000*(0+1)/10000 = 0,
        // so fee = 5 + 20 = 25 bps. Required = ceil(ceil(sat/0.9975) * ask).
        uint256 grossE18 = Math.mulDiv(1e10, 10_000, 10_000 - 25, Math.Rounding.Ceil);
        uint256 requiredE18 = Math.mulDiv(grossE18, ASK, 1e18, Math.Rounding.Ceil);
        uint256 requiredUsdc = Math.ceilDiv(requiredE18, 1e12);
        assertEq(satIn, requiredUsdc, "exact-out charge is the exact fee-inclusive ceiling");

        // Exact-in dust: the delivered sats can never exceed fair value at ask.
        (, uint256 dustOut) = _quote(order, address(usdc), address(wbtc), 2_000, true);
        assertLe(dustOut * ASK / 1e8, 2_000 * 1e12, "exact-in floor never over-delivers");

        // Bid side (WBTC in, USDC out), exact-out: same discipline in reverse —
        // the maker must never hand over base worth less than it charges for.
        (uint256 satsCharged,) = _quote(order, address(wbtc), address(usdc), 1, false);
        uint256 grossQuoteE18 = Math.mulDiv(1e12, 10_000, 10_000 - 25, Math.Rounding.Ceil);
        uint256 requiredSatsE18 = Math.mulDiv(grossQuoteE18, 1e18, BID, Math.Rounding.Ceil);
        assertEq(satsCharged, Math.ceilDiv(requiredSatsE18, 1e10), "bid-side exact-out charge is exact");
    }

    function test_insufficientActualMakerBalanceReverts() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        // Maker still has 1 WBTC virtual, but the wallet is nearly empty.
        // (Read the balance BEFORE pranking — the read call would consume the prank.)
        uint256 drainAmount = wbtc.balanceOf(maker) - 100;
        vm.prank(maker);
        wbtc.transfer(makeAddr("cold-storage"), drainAmount);

        vm.prank(taker);
        vm.expectPartialRevert(VortexAquaPricing.VortexMakerNotCovered.selector);
        router.swap(order, address(usdc), address(wbtc), 0.01e8, _takerTraitsAndData(false, ""));
    }

    function test_insufficientAquaAllowanceReverts() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        vm.prank(maker);
        wbtc.approve(address(aqua), 100);

        vm.prank(taker);
        vm.expectPartialRevert(VortexAquaPricing.VortexMakerNotCovered.selector);
        router.swap(order, address(usdc), address(wbtc), 0.01e8, _takerTraitsAndData(false, ""));
    }

    function test_dockedStrategyQuoteReverts() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipDefault();

        address[] memory tokens = new address[](2);
        tokens[0] = address(wbtc);
        tokens[1] = address(usdc);
        vm.prank(maker);
        aqua.dock(address(router), strategyHash, tokens);

        vm.prank(taker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAqua.SafeBalancesForTokenNotInActiveStrategy.selector,
                maker,
                address(router),
                strategyHash,
                address(wbtc)
            )
        );
        ISwapVM(address(router)).quote(order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, ""));
    }

    function test_typehashMatchesSharedDefinition() public view {
        // Solidity must hash exactly what packages/shared/src/typedData.ts
        // declares — same fields, same types, same ORDER.
        assertEq(
            pricing.QUOTE_AUTHORIZATION_TYPEHASH(),
            CANONICAL_QUOTE_AUTHORIZATION_TYPEHASH,
            "typehash drifted from shared typedData.ts"
        );
    }

    function test_askSideSwapMovesRealTokens() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipDefault();

        uint256 makerWbtcBefore = wbtc.balanceOf(maker);
        uint256 takerUsdcBefore = usdc.balanceOf(taker);

        // Buy WBTC with 10,000 USDC against a balanced 200k book:
        //   trade fraction = 10,000 / 200,000 = 500 bps, skew = 0
        //   inventory adj  = 1000 * (0 + 500) / 10,000       = 50 bps
        //   fee            = 5 safety + clamp(20 + 50)       = 75 bps
        //   gross out      = 10,000 / 100,050 (ask)          = 0.099950024 WBTC
        //   net out        = gross * 0.9925, floored to sats = 9,920,039 sats
        (uint256 amountIn, uint256 amountOut) = _swap(order, address(usdc), address(wbtc), 10_000e6, true, "");

        assertEq(amountIn, 10_000e6);
        assertEq(amountOut, 9_920_039, "hand-computed ask-side output");

        assertEq(usdc.balanceOf(taker), takerUsdcBefore - amountIn);
        assertEq(wbtc.balanceOf(maker), makerWbtcBefore - amountOut);
        assertEq(wbtc.balanceOf(taker), 10e8 + amountOut);

        (uint256 virtualWbtc, uint256 virtualUsdc) =
            aqua.safeBalances(maker, address(router), strategyHash, address(wbtc), address(usdc));
        assertEq(virtualWbtc, 1e8 - amountOut);
        assertEq(virtualUsdc, 100_000e6 + amountIn);
    }

    function test_quoteWithRebateDoesNotConsumeNonce() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipDefault();

        bytes memory rebateArgs =
            _rebateArgs(strategyHash, address(wbtc), address(usdc), 0.1e8, true, 50, 21, rebateSignerKey);

        vm.prank(taker);
        (, uint256 quotedOut,) = ISwapVM(address(router)).quote(
            order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, rebateArgs)
        );
        assertFalse(pricing.usedQuoteNonces(taker, 21), "quote must not burn the nonce");

        (, uint256 swappedOut) = _swap(order, address(wbtc), address(usdc), 0.1e8, true, rebateArgs);
        assertEq(swappedOut, quotedOut, "rebated quote equals rebated fill");
        assertTrue(pricing.usedQuoteNonces(taker, 21), "swap burns the nonce");
    }

    function test_expiredRebateReverts() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipDefault();

        bytes memory rebateArgs =
            _rebateArgs(strategyHash, address(wbtc), address(usdc), 0.1e8, true, 50, 31, rebateSignerKey);

        vm.warp(block.timestamp + 6 minutes); // auth TTL is 5 minutes

        vm.prank(taker);
        vm.expectPartialRevert(VortexAquaPricing.VortexRebateExpired.selector);
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, rebateArgs));
    }

    function test_rebateBoundToSignedAmountAndTaker() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipDefault();

        // Signed for 0.1 WBTC; executing 0.05 must not reuse the authorization.
        bytes memory wrongAmount =
            _rebateArgs(strategyHash, address(wbtc), address(usdc), 0.1e8, true, 50, 41, rebateSignerKey);
        vm.prank(taker);
        vm.expectRevert(VortexAquaPricing.VortexRebateMismatch.selector);
        router.swap(order, address(wbtc), address(usdc), 0.05e8, _takerTraitsAndData(true, wrongAmount));

        // Signed for the wrong direction (tokens swapped).
        bytes memory wrongTokens =
            _rebateArgs(strategyHash, address(usdc), address(wbtc), 0.1e8, true, 50, 42, rebateSignerKey);
        vm.prank(taker);
        vm.expectRevert(VortexAquaPricing.VortexRebateMismatch.selector);
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, wrongTokens));

        // Signed for somebody else: a different taker cannot ride the rebate.
        address otherTaker = makeAddr("otherTaker");
        wbtc.mint(otherTaker, 1e8);
        vm.startPrank(otherTaker);
        wbtc.approve(address(router), type(uint256).max);
        vm.stopPrank();

        bytes memory forOriginalTaker =
            _rebateArgs(strategyHash, address(wbtc), address(usdc), 0.1e8, true, 50, 43, rebateSignerKey);
        vm.prank(otherTaker);
        vm.expectRevert(VortexAquaPricing.VortexRebateMismatch.selector);
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, forOriginalTaker));
    }

    function test_oracleSpreadTooWideReverts() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        // 2% spread against a 50 bps configured maximum.
        oracle.setPrice(MID, 99_000e18, 101_000e18);

        vm.prank(taker);
        vm.expectPartialRevert(VortexAquaPricing.VortexOracleSpreadTooWide.selector);
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, ""));
    }

    function test_futureDatedOracleReverts() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        // A feed stamped in the future would otherwise never look stale.
        IVortexReferenceOracle.PriceData memory future = IVortexReferenceOracle.PriceData({
            midPriceE18: MID,
            bidPriceE18: BID,
            askPriceE18: ASK,
            updatedAt: uint40(block.timestamp + 365 days)
        });
        vm.mockCall(
            address(oracle), abi.encodeWithSelector(IVortexReferenceOracle.latestPrice.selector), abi.encode(future)
        );

        vm.prank(taker);
        vm.expectPartialRevert(VortexAquaPricing.VortexFutureOracleTimestamp.selector);
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, ""));
    }

    function test_invalidOraclePriceOrderingReverts() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        // The mock enforces ordering on write, so forge the read directly.
        IVortexReferenceOracle.PriceData memory broken = IVortexReferenceOracle.PriceData({
            midPriceE18: MID,
            bidPriceE18: MID + 1, // bid above mid
            askPriceE18: ASK,
            updatedAt: uint40(block.timestamp)
        });
        vm.mockCall(
            address(oracle), abi.encodeWithSelector(IVortexReferenceOracle.latestPrice.selector), abi.encode(broken)
        );

        vm.prank(taker);
        vm.expectPartialRevert(VortexAquaPricing.VortexInvalidOraclePrice.selector);
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, ""));
    }

    function test_zeroOutputReverts() public {
        (ISwapVM.Order memory order,) = _shipDefault();

        // 500 micro-USDC buys less than one satoshi; flooring gives 0 out.
        vm.prank(taker);
        vm.expectRevert(VortexAquaPricing.VortexZeroAmountOut.selector);
        router.swap(order, address(usdc), address(wbtc), 500, _takerTraitsAndData(true, ""));
    }

    function test_extructionRejectsNonRouterCaller() public {
        // Only the router may drive pricing — otherwise anyone could burn a
        // taker's rebate nonces by replaying their authorization.
        vm.expectRevert(
            abi.encodeWithSelector(VortexAquaPricing.VortexUnauthorizedCaller.selector, address(this))
        );
        pricing.extruction(false, 0, _emptyQuery(), _emptyRegisters(), _configBlob(_defaultParams()), "");
    }

    function test_unsupportedTokenPairReverts() public {
        VortexAquaOrderBuilder.VortexSwapStrategyParams memory params = _defaultParams();
        (, bytes32 strategyHash) = _ship(params, 1e8, 100_000e6);

        vm.expectRevert(
            abi.encodeWithSelector(
                VortexAquaPricing.VortexUnsupportedTokenPair.selector, address(weth), address(usdc)
            )
        );
        pricing.preview(
            _configBlob(params), maker, strategyHash, address(weth), address(usdc), true, 1e18, 1e8, 100_000e6, 0
        );
    }

    function test_dockedStrategySwapReverts() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipDefault();

        address[] memory tokens = new address[](2);
        tokens[0] = address(wbtc);
        tokens[1] = address(usdc);
        vm.prank(maker);
        aqua.dock(address(router), strategyHash, tokens);

        vm.prank(taker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAqua.SafeBalancesForTokenNotInActiveStrategy.selector,
                maker,
                address(router),
                strategyHash,
                address(wbtc)
            )
        );
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _takerTraitsAndData(true, ""));
    }

    function test_builderRejectsDeadConfigs() public {
        VortexAquaOrderBuilder.VortexSwapStrategyParams memory params = _defaultParams();

        params.quoteToken = params.baseToken;
        vm.expectRevert(
            abi.encodeWithSelector(VortexAquaOrderBuilder.VortexIdenticalTokens.selector, address(wbtc))
        );
        builder.buildOrder(params);

        params = _defaultParams();
        params.maxTradeBps = 0;
        vm.expectRevert(abi.encodeWithSelector(VortexAquaOrderBuilder.VortexBpsOutOfRange.selector, 0, 1_000));
        builder.buildOrder(params);

        params = _defaultParams();
        params.inventoryStrengthBps = 20_000;
        vm.expectRevert(
            abi.encodeWithSelector(VortexAquaOrderBuilder.VortexBpsOutOfRange.selector, 1_000, 20_000)
        );
        builder.buildOrder(params);

        params = _defaultParams();
        params.minCommercialFeeBps = 300; // above default and max
        vm.expectRevert(abi.encodeWithSelector(VortexAquaOrderBuilder.VortexBadFeeBand.selector, 300, 20, 200));
        builder.buildOrder(params);
    }

    function testFuzz_acceptedTradesRespectFeeFloorAndBounds(uint96 rawAmount, bool baseIn) public {
        VortexAquaOrderBuilder.VortexSwapStrategyParams memory params = _defaultParams();
        (, bytes32 strategyHash) = _ship(params, 1e8, 100_000e6);
        bytes memory blob = _configBlob(params);

        (address tokenIn, address tokenOut) =
            baseIn ? (address(wbtc), address(usdc)) : (address(usdc), address(wbtc));
        uint256 amount = bound(rawAmount, 1, baseIn ? 1e8 : 100_000e6);
        (uint256 balanceIn, uint256 balanceOut) = baseIn ? (uint256(1e8), uint256(100_000e6)) : (100_000e6, 1e8);

        try pricing.preview(
            blob, maker, strategyHash, tokenIn, tokenOut, true, amount, balanceIn, balanceOut, 10_000
        ) returns (VortexAquaPricing.FeeBreakdown memory bd) {
            // Whatever the inputs, an ACCEPTED quote respects every floor.
            assertGe(
                bd.finalFeeBps,
                params.minSafetyFeeBps + params.minCommercialFeeBps,
                "safety floor is unreachable by any rebate"
            );
            assertGe(bd.commercialFeeBps, params.minCommercialFeeBps);
            assertLe(bd.commercialFeeBps, params.maxCommercialFeeBps);
            assertGt(bd.amountOut, 0);
            assertLe(bd.amountOut, balanceOut);
        } catch {
            // Rejection is always an acceptable outcome; the invariants above
            // only bind quotes the pool is willing to honour.
        }
    }

    function _emptyQuery() internal view returns (SwapQuery memory) {
        return SwapQuery({
            orderHash: bytes32(0),
            maker: maker,
            taker: taker,
            tokenIn: address(wbtc),
            tokenOut: address(usdc),
            isExactIn: true
        });
    }

    function _emptyRegisters() internal pure returns (SwapRegisters memory) {
        return SwapRegisters({ balanceIn: 1e8, balanceOut: 100_000e6, amountIn: 0.01e8, amountOut: 0, amountNetPulled: 0 });
    }

    function test_lensReportsPhantomLiquidity() public {
        (, bytes32 strategyHash) = _shipDefault();

        VortexAquaLens.StrategyHealth memory healthy =
            lens.strategyHealth(maker, strategyHash, address(wbtc), address(usdc), address(oracle));
        assertTrue(healthy.active);
        assertTrue(healthy.solvent);
        assertEq(healthy.coverageBps, 10_000);
        assertEq(healthy.base.executableBalance, 1e8);
        assertApproxEqAbs(healthy.baseWeightBps, 5_000, 1);

        // Maker quietly drains the wallet below the 1 WBTC virtual balance.
        uint256 drainAmount = wbtc.balanceOf(maker) - 0.25e8;
        vm.prank(maker);
        wbtc.transfer(makeAddr("cold-storage"), drainAmount);

        VortexAquaLens.StrategyHealth memory phantom =
            lens.strategyHealth(maker, strategyHash, address(wbtc), address(usdc), address(oracle));
        assertTrue(phantom.active, "still active on Aqua");
        assertFalse(phantom.solvent, "but no longer fully covered");
        assertEq(phantom.base.virtualBalance, 1e8);
        assertEq(phantom.base.actualBalance, 0.25e8);
        assertEq(phantom.base.executableBalance, 0.25e8);
        assertEq(phantom.coverageBps, 2_500);
    }
}

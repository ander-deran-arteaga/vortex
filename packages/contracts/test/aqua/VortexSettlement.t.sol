// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { ITakerCallbacks } from "@1inch/swap-vm/src/interfaces/ITakerCallbacks.sol";
import { AquaSwapVMRouter } from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { VortexAquaOrderBuilder } from "../../src/aqua/VortexAquaOrderBuilder.sol";
import { VortexAquaPricing } from "../../src/aqua/VortexAquaPricing.sol";
import { MockERC20 } from "../../src/mocks/MockERC20.sol";
import { MockReferenceOracle } from "../../src/mocks/MockReferenceOracle.sol";
import { MockUSDC } from "../../src/mocks/MockUSDC.sol";
import { MockWBTC } from "../../src/mocks/MockWBTC.sol";

/// @notice Taker contract settling through the callback path: instead of the
///         router pulling with transferFrom, the taker pushes tokenIn into the
///         maker's Aqua balance itself during preTransferInCallback.
contract CallbackTaker is ITakerCallbacks {
    Aqua public immutable AQUA;
    address public immutable ROUTER;

    constructor(Aqua aqua, address router) {
        AQUA = aqua;
        ROUTER = router;
    }

    function swap(
        ISwapVM.Order calldata order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bytes calldata takerTraitsAndData
    )
        external
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut,) = ISwapVM(ROUTER).swap(order, tokenIn, tokenOut, amount, takerTraitsAndData);
    }

    function preTransferInCallback(
        address maker,
        address,
        address tokenIn,
        address,
        uint256 amountIn,
        uint256,
        bytes32 orderHash,
        bytes calldata
    )
        external
    {
        require(msg.sender == ROUTER, "only router");
        IERC20(tokenIn).approve(address(AQUA), amountIn);
        AQUA.push(maker, ROUTER, orderHash, tokenIn, amountIn);
    }

    function preTransferOutCallback(
        address,
        address,
        address,
        address,
        uint256,
        uint256,
        bytes32,
        bytes calldata
    )
        external
    { }
}

/// @notice Phase 2 settlement matrix: taker slippage thresholds and the
///         alternate Aqua push-via-callback settlement path. These exercise
///         router behaviour Vortex depends on but that the main pricing suite
///         (which always uses transferFrom + push, no threshold) never hits.
contract VortexSettlementTest is Test {
    uint256 internal constant MID = 100_000e18;
    uint256 internal constant BID = 99_950e18;
    uint256 internal constant ASK = 100_050e18;

    Aqua internal aqua;
    AquaSwapVMRouter internal router;
    MockWBTC internal wbtc;
    MockUSDC internal usdc;
    MockERC20 internal weth;
    MockReferenceOracle internal oracle;
    VortexAquaPricing internal pricing;
    VortexAquaOrderBuilder internal builder;

    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");

    ISwapVM.Order internal order;
    bytes32 internal strategyHash;

    function setUp() public {
        aqua = new Aqua();
        wbtc = new MockWBTC();
        usdc = new MockUSDC();
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        router = new AquaSwapVMRouter(address(aqua), address(weth), address(this), "AquaSwapVMRouter", "1.0.1");
        oracle = new MockReferenceOracle(address(this));
        oracle.setPrice(MID, BID, ASK);
        pricing = new VortexAquaPricing(address(router), IAqua(address(aqua)));
        builder = new VortexAquaOrderBuilder(pricing);

        wbtc.mint(maker, 10e8);
        usdc.mint(maker, 1_000_000e6);
        wbtc.mint(taker, 10e8);
        usdc.mint(taker, 1_000_000e6);

        vm.startPrank(taker);
        wbtc.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);
        vm.stopPrank();

        (order, strategyHash) = _ship();
    }

    function _ship() internal returns (ISwapVM.Order memory shippedOrder, bytes32 hash) {
        VortexAquaOrderBuilder.VortexSwapStrategyParams memory params = VortexAquaOrderBuilder
            .VortexSwapStrategyParams({
            maker: maker,
            baseToken: address(wbtc),
            quoteToken: address(usdc),
            referenceOracle: address(oracle),
            rebateSigner: maker,
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
            salt: 7
        });
        (shippedOrder, hash) = builder.buildOrder(params);

        address[] memory tokens = new address[](2);
        tokens[0] = address(wbtc);
        tokens[1] = address(usdc);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1e8;
        amounts[1] = 100_000e6;

        vm.startPrank(maker);
        wbtc.approve(address(aqua), type(uint256).max);
        usdc.approve(address(aqua), type(uint256).max);
        aqua.ship(address(router), abi.encode(shippedOrder), tokens, amounts);
        vm.stopPrank();
    }

    function _traits(
        address takerAddress,
        bool isExactIn,
        bytes memory threshold,
        bool strictThreshold,
        bool useCallback
    )
        internal
        pure
        returns (bytes memory)
    {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: takerAddress,
                isExactIn: isExactIn,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: strictThreshold,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: !useCallback,
                threshold: threshold,
                to: address(0),
                deadline: 0,
                hasPreTransferInCallback: useCallback,
                hasPreTransferOutCallback: false,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: ""
            })
        );
    }

    // ===== taker slippage protection =====

    function test_exactInMinOutputSatisfied() public {
        // Known-good output for 0.1 WBTC in: 9,920.0375 USDC.
        bytes memory minOut = abi.encode(uint256(9_900e6));

        vm.prank(taker);
        (, uint256 amountOut,) =
            router.swap(order, address(wbtc), address(usdc), 0.1e8, _traits(taker, true, minOut, false, false));
        assertEq(amountOut, 9_920.0375e6);
    }

    function test_exactInBelowMinOutputReverts() public {
        // Demand more than the pool will pay: the ROUTER (not pricing) rejects.
        bytes memory minOut = abi.encode(uint256(9_950e6));

        vm.prank(taker);
        vm.expectRevert(
            abi.encodeWithSelector(
                TakerTraitsLib.TakerTraitsInsufficientMinOutputAmount.selector, 9_920.0375e6, 9_950e6
            )
        );
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _traits(taker, true, minOut, false, false));
    }

    function test_exactOutMaxInputSatisfied() public {
        bytes memory maxIn = abi.encode(uint256(0.2e8));

        vm.prank(taker);
        (uint256 amountIn, uint256 amountOut,) =
            router.swap(order, address(wbtc), address(usdc), 9_920.0375e6, _traits(taker, false, maxIn, false, false));
        assertEq(amountOut, 9_920.0375e6);
        assertLe(amountIn, 0.2e8);
    }

    function test_exactOutAboveMaxInputReverts() public {
        // Refuse to pay more than 0.05 WBTC for ~9,920 USDC (needs ~0.1).
        bytes memory maxIn = abi.encode(uint256(0.05e8));

        vm.prank(taker);
        vm.expectPartialRevert(TakerTraitsLib.TakerTraitsExceedingMaxInputAmount.selector);
        router.swap(order, address(wbtc), address(usdc), 9_920.0375e6, _traits(taker, false, maxIn, false, false));
    }

    function test_strictThresholdRequiresExactAmount() public {
        bytes memory notExact = abi.encode(uint256(9_920e6));

        vm.prank(taker);
        vm.expectPartialRevert(TakerTraitsLib.TakerTraitsNonExactThresholdAmountOut.selector);
        router.swap(order, address(wbtc), address(usdc), 0.1e8, _traits(taker, true, notExact, true, false));

        // The exact expected output passes strict mode.
        bytes memory exact = abi.encode(uint256(9_920.0375e6));
        vm.prank(taker);
        (, uint256 amountOut,) =
            router.swap(order, address(wbtc), address(usdc), 0.1e8, _traits(taker, true, exact, true, false));
        assertEq(amountOut, 9_920.0375e6);
    }

    // ===== alternate Aqua settlement path =====

    function test_callbackPushSettlesAndTracksVirtualBalances() public {
        CallbackTaker callbackTaker = new CallbackTaker(aqua, address(router));
        wbtc.mint(address(callbackTaker), 1e8);

        uint256 makerWbtcBefore = wbtc.balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        // useTransferFromAndAquaPush = false: the router verifies the taker's
        // own push landed (balanceIn >= original + amountIn - amountNetPulled),
        // which is the one place Vortex's amountNetPulled pass-through matters.
        (uint256 amountIn, uint256 amountOut) = callbackTaker.swap(
            order, address(wbtc), address(usdc), 0.1e8, _traits(address(callbackTaker), true, "", false, true)
        );

        assertEq(amountIn, 0.1e8);
        assertEq(amountOut, 9_920.0375e6, "callback path prices identically to the push path");

        // Real tokens moved: taker -> maker WBTC, maker -> taker USDC.
        assertEq(wbtc.balanceOf(maker), makerWbtcBefore + amountIn);
        assertEq(wbtc.balanceOf(address(callbackTaker)), 1e8 - amountIn);
        assertEq(usdc.balanceOf(maker), makerUsdcBefore - amountOut);
        assertEq(usdc.balanceOf(address(callbackTaker)), amountOut);

        (uint256 virtualWbtc, uint256 virtualUsdc) =
            aqua.safeBalances(maker, address(router), strategyHash, address(wbtc), address(usdc));
        assertEq(virtualWbtc, 1e8 + amountIn);
        assertEq(virtualUsdc, 100_000e6 - amountOut);
        assertEq(wbtc.balanceOf(address(router)), 0, "router never holds inventory");
        assertEq(usdc.balanceOf(address(router)), 0, "router never holds inventory");
    }

    function test_callbackThatSkipsPushReverts() public {
        // A taker that does not actually push must not receive output.
        SilentCallbackTaker badTaker = new SilentCallbackTaker(address(router));
        wbtc.mint(address(badTaker), 1e8);

        vm.expectPartialRevert(bytes4(keccak256("AquaBalanceInsufficientAfterTakerPush(uint256,uint256,uint256,uint256)")));
        badTaker.swap(
            order, address(wbtc), address(usdc), 0.1e8, _traits(address(badTaker), true, "", false, true)
        );
    }
}

/// @notice Taker whose callback deliberately does nothing — the router must
///         catch the missing push rather than hand over free output.
contract SilentCallbackTaker is ITakerCallbacks {
    address public immutable ROUTER;

    constructor(address router) {
        ROUTER = router;
    }

    function swap(
        ISwapVM.Order calldata order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bytes calldata takerTraitsAndData
    )
        external
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut,) = ISwapVM(ROUTER).swap(order, tokenIn, tokenOut, amount, takerTraitsAndData);
    }

    function preTransferInCallback(
        address,
        address,
        address,
        address,
        uint256,
        uint256,
        bytes32,
        bytes calldata
    )
        external
    { }

    function preTransferOutCallback(
        address,
        address,
        address,
        address,
        uint256,
        uint256,
        bytes32,
        bytes calldata
    )
        external
    { }
}

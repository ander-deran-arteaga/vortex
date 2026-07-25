// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { IVortexReferenceOracle } from "../../src/interfaces/IVortexReferenceOracle.sol";
import { MockReferenceOracle } from "../../src/mocks/MockReferenceOracle.sol";
import { MockUSDC } from "../../src/mocks/MockUSDC.sol";
import { MockWBTC } from "../../src/mocks/MockWBTC.sol";
import { VortexFeeAuthorizationLib, VortexPermFeeAuthorization } from "../../src/permamm/VortexFeeAuthorization.sol";
import { VortexHook } from "../../src/permamm/VortexHook.sol";
import { VortexLiquidityManager } from "../../src/permamm/VortexLiquidityManager.sol";
import { VortexRouter } from "../../src/permamm/VortexRouter.sol";

/// @notice Phase 5 exit gate: a REAL Uniswap v4 pool with a REAL hook, where a
///         valid signed authorization changes the actual swap fee and invalid
///         ones revert.
/// @dev The PoolManager is the genuine v4-core contract, deployed by artifact
///      (`deployCode`) because it is `pragma 0.8.26` while this file is 0.8.30.
///      No fork and no `vm.etch` — see docs/dependencies.md.
contract VortexHookTest is Test {
    using StateLibrary for IPoolManager;

    uint256 internal constant MID = 100_000e18;
    uint256 internal constant BID = 99_950e18;
    uint256 internal constant ASK = 100_050e18;

    uint24 internal constant MIN_SAFETY_PIPS = 500; // 0.05%
    uint24 internal constant MIN_COMMERCIAL_PIPS = 100; // 0.01%
    uint24 internal constant MAX_COMMERCIAL_PIPS = 20_000; // 2%

    IPoolManager internal poolManager;
    MockWBTC internal wbtc;
    MockUSDC internal usdc;
    MockReferenceOracle internal oracle;
    VortexHook internal hook;
    VortexLiquidityManager internal liquidityManager;
    VortexRouter internal router;

    PoolKey internal key;
    bytes32 internal poolId;

    address internal swapper = makeAddr("swapper");
    address internal feeSigner;
    uint256 internal feeSignerKey;
    uint64 internal nonceCounter;

    /// @dev currency0/currency1 must be sorted by address; WBTC/USDC order
    ///      depends on deployment, so resolve it rather than assume.
    Currency internal currency0;
    Currency internal currency1;
    bool internal wbtcIsCurrency0;

    function setUp() public {
        (feeSigner, feeSignerKey) = makeAddrAndKey("feeSigner");

        poolManager = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(address(this))));

        wbtc = new MockWBTC();
        usdc = new MockUSDC();
        wbtcIsCurrency0 = address(wbtc) < address(usdc);
        (currency0, currency1) = wbtcIsCurrency0
            ? (Currency.wrap(address(wbtc)), Currency.wrap(address(usdc)))
            : (Currency.wrap(address(usdc)), Currency.wrap(address(wbtc)));

        oracle = new MockReferenceOracle(address(this));
        oracle.setPrice(MID, BID, ASK);

        liquidityManager = new VortexLiquidityManager(poolManager, address(this));
        router = new VortexRouter(poolManager);

        hook = _deployHookAtFlaggedAddress();

        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hook
        });
        poolId = PoolId.unwrap(key.toId());

        // The initializer is the liquidity manager's owner (this test).
        poolManager.initialize(key, _oracleSqrtPrice());

        _provisionLiquidity();

        wbtc.mint(swapper, 100e8);
        usdc.mint(swapper, 10_000_000e6);
        vm.startPrank(swapper);
        wbtc.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ===== harness =====

    /// @dev v4 encodes hook permissions in the hook's ADDRESS, so the contract
    ///      must live at an address whose low bits match its callbacks.
    function _deployHookAtFlaggedAddress() internal returns (VortexHook deployed) {
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        );
        address target = address(uint160(0x4444 << 144) | flags);

        VortexHook.HookConfig memory config = VortexHook.HookConfig({
            poolManager: poolManager,
            oracle: oracle,
            liquidityManager: address(liquidityManager),
            initializer: address(this),
            feeSigner: feeSigner,
            currency0: currency0,
            currency1: currency1,
            minSafetyFeePips: MIN_SAFETY_PIPS,
            minCommercialFeePips: MIN_COMMERCIAL_PIPS,
            maxCommercialFeePips: MAX_COMMERCIAL_PIPS,
            maxPoolDeviationBps: 500,
            maxOracleAge: 1 hours,
            maxOracleSpreadBps: 50
        });

        deployCodeTo("VortexHook.sol:VortexHook", abi.encode(config), target);
        deployed = VortexHook(target);
        assertEq(uint160(target) & Hooks.ALL_HOOK_MASK, flags, "hook address must encode its permissions");
    }

    /// @dev sqrt(price) * 2^96 where price is currency1-per-currency0 in raw units.
    function _oracleSqrtPrice() internal view returns (uint160) {
        // WBTC(8) / USDC(6): 1 WBTC = 100_000 USDC =>
        //   1e8 wbtc-units : 100_000e6 usdc-units  =>  price = 1e12/1e8... resolve generically.
        uint256 priceE18 = wbtcIsCurrency0
            ? MID / 1e2 // usdc units per wbtc unit, 1e18-scaled: 100_000e6/1e8 = 1e3 → 1e21? see below
            : 1e36 / (MID / 1e2);
        return _encodeSqrtPrice(priceE18);
    }

    function _encodeSqrtPrice(uint256 priceE18) internal pure returns (uint160) {
        // sqrtPriceX96 = sqrt(price) * 2^96, price given 1e18-scaled.
        uint256 ratio = (priceE18 << 96) / 1e18;
        return uint160(_sqrt(ratio << 96));
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function _provisionLiquidity() internal {
        // Full-range liquidity needs far more than the notional position size;
        // mocks are freely mintable so provision generously.
        wbtc.mint(address(liquidityManager), 1_000_000e8);
        usdc.mint(address(liquidityManager), 100_000_000_000e6);

        liquidityManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(key.tickSpacing),
                tickUpper: TickMath.maxUsableTick(key.tickSpacing),
                liquidityDelta: 1e12,
                salt: bytes32(0)
            })
        );
    }

    function _oracleSnapshotHash() internal view returns (bytes32) {
        IVortexReferenceOracle.PriceData memory p = oracle.latestPrice();
        return keccak256(abi.encode(p.midPriceE18, p.bidPriceE18, p.askPriceE18, p.updatedAt));
    }

    function _auth(
        bool zeroForOne,
        int256 amountSpecified,
        uint24 commercialFeePips
    )
        internal
        returns (VortexPermFeeAuthorization memory auth)
    {
        auth = VortexPermFeeAuthorization({
            poolId: poolId,
            quoteId: keccak256(abi.encode("quote", nonceCounter)),
            oracleSnapshotHash: _oracleSnapshotHash(),
            swapper: swapper,
            tokenIn: zeroForOne ? Currency.unwrap(currency0) : Currency.unwrap(currency1),
            tokenOut: zeroForOne ? Currency.unwrap(currency1) : Currency.unwrap(currency0),
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            commercialFeePips: commercialFeePips,
            deadline: uint40(block.timestamp + 5 minutes),
            nonce: nonceCounter++
        });
    }

    function _sign(VortexPermFeeAuthorization memory auth, uint256 key_) internal view returns (bytes memory) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Vortex PermAMM")),
                keccak256(bytes("1")),
                block.chainid,
                address(hook)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, VortexFeeAuthorizationLib.hashStruct(auth))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key_, digest);
        return abi.encodePacked(r, s, v);
    }

    function _hookData(VortexPermFeeAuthorization memory auth, uint256 key_) internal view returns (bytes memory) {
        return abi.encode(auth, _sign(auth, key_));
    }

    function _swapExactIn(uint128 amountIn, bool zeroForOne, uint24 feePips) internal returns (uint256) {
        VortexPermFeeAuthorization memory auth = _auth(zeroForOne, -int256(uint256(amountIn)), feePips);
        vm.prank(swapper);
        return router.swapExactInput(
            key, zeroForOne, amountIn, 0, 0, _hookData(auth, feeSignerKey), swapper
        );
    }

    /// @dev v4 wraps a reverting hook's error inside `WrappedError`, so a plain
    ///      `vm.expectRevert(selector)` cannot match it. Asserting that the
    ///      specific Vortex selector appears in the revert payload proves the
    ///      NAMED cause fired — a bare `vm.expectRevert()` would pass on any
    ///      revert at all, including an unrelated one.
    function _expectSwapRevert(
        bytes4 expectedSelector,
        bool zeroForOne,
        uint128 amountIn,
        bytes memory hookData
    )
        internal
    {
        vm.prank(swapper);
        (bool ok, bytes memory returndata) = address(router).call(
            abi.encodeCall(
                VortexRouter.swapExactInput, (key, zeroForOne, amountIn, 0, 0, hookData, swapper)
            )
        );
        assertFalse(ok, "expected the swap to revert");
        assertTrue(
            _containsSelector(returndata, expectedSelector),
            "revert did not carry the expected Vortex error"
        );
    }

    function _containsSelector(bytes memory data, bytes4 selector) internal pure returns (bool) {
        if (data.length < 4) return false;
        for (uint256 i = 0; i + 4 <= data.length; i++) {
            if (
                data[i] == selector[0] && data[i + 1] == selector[1] && data[i + 2] == selector[2]
                    && data[i + 3] == selector[3]
            ) return true;
        }
        return false;
    }

    // ===== §8.3 suite =====

    function test_poolMustUseDynamicFee() public {
        PoolKey memory staticKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3_000, // static fee
            tickSpacing: 60,
            hooks: hook
        });

        (bool ok, bytes memory returndata) = address(poolManager).call(
            abi.encodeCall(IPoolManager.initialize, (staticKey, _oracleSqrtPrice()))
        );
        assertFalse(ok, "static-fee pool must not initialize");
        assertTrue(
            _containsSelector(returndata, VortexHook.VortexPoolMustUseDynamicFee.selector),
            "rejected for the wrong reason"
        );
    }

    function test_onlyLiquidityManagerCanAdd() public {
        // The hook rejects modifyLiquidity from anyone but the manager, so a
        // second router-shaped provider cannot add liquidity.
        VortexLiquidityManager rogue = new VortexLiquidityManager(poolManager, address(this));
        wbtc.mint(address(rogue), 1e8);
        usdc.mint(address(rogue), 100_000e6);

        (bool ok, bytes memory returndata) = address(rogue).call(
            abi.encodeCall(
                VortexLiquidityManager.modifyLiquidity,
                (
                    key,
                    ModifyLiquidityParams({
                        tickLower: TickMath.minUsableTick(key.tickSpacing),
                        tickUpper: TickMath.maxUsableTick(key.tickSpacing),
                        liquidityDelta: 1e10,
                        salt: bytes32(0)
                    })
                )
            )
        );
        assertFalse(ok, "outside liquidity must be rejected");
        assertTrue(
            _containsSelector(returndata, VortexHook.VortexExternalLiquidityForbidden.selector),
            "rejected for the wrong reason"
        );
    }

    function test_validAuthorizationOverridesFee() public {
        // Two identical swaps differing ONLY in the signed commercial fee must
        // produce measurably different outputs — that is the fee actually
        // taking effect inside the real pool, not a hook-side calculation.
        uint128 amountIn = wbtcIsCurrency0 ? 0.01e8 : 1_000e6;

        uint256 cheapOut = _swapExactIn(amountIn, true, MIN_COMMERCIAL_PIPS);
        uint256 expensiveOut = _swapExactIn(amountIn, true, 10_000); // 1%

        assertGt(cheapOut, expensiveOut, "higher signed fee must yield less output");

        // And the gap is roughly the fee difference (~0.99%) on the same size.
        uint256 gapBps = (cheapOut - expensiveOut) * 10_000 / cheapOut;
        assertApproxEqAbs(gapBps, 99, 5, "output gap tracks the signed fee delta");
    }

    function test_feeIsClampedIntoTheImmutableBand() public {
        uint128 amountIn = wbtcIsCurrency0 ? 0.01e8 : 1_000e6;

        // A signer asking for zero still pays safety + minimum commercial.
        uint256 zeroFeeOut = _swapExactIn(amountIn, true, 0);
        uint256 floorFeeOut = _swapExactIn(amountIn, true, MIN_COMMERCIAL_PIPS);
        assertApproxEqRel(zeroFeeOut, floorFeeOut, 0.0002e18, "zero request clamps to the floor");

        // And a signer asking for more than the cap pays only the cap.
        uint256 hugeFeeOut = _swapExactIn(amountIn, true, 500_000); // 50%
        uint256 capFeeOut = _swapExactIn(amountIn, true, MAX_COMMERCIAL_PIPS);
        assertApproxEqRel(hugeFeeOut, capFeeOut, 0.0002e18, "excess request clamps to the cap");
    }

    function test_expiredAuthorizationReverts() public {
        VortexPermFeeAuthorization memory auth = _auth(true, -int256(uint256(uint128(0.01e8))), 1_000);
        bytes memory hookData = _hookData(auth, feeSignerKey);

        vm.warp(block.timestamp + 6 minutes);

        _expectSwapRevert(VortexHook.VortexAuthorizationExpired.selector, true, 0.01e8, hookData);
    }

    function test_invalidSignatureReverts() public {
        (, uint256 malloryKey) = makeAddrAndKey("mallory");
        VortexPermFeeAuthorization memory auth = _auth(true, -int256(uint256(uint128(0.01e8))), 1_000);

        _expectSwapRevert(
            VortexHook.VortexBadFeeSignature.selector, true, 0.01e8, _hookData(auth, malloryKey)
        );
    }

    function test_wrongPoolReverts() public {
        VortexPermFeeAuthorization memory auth = _auth(true, -int256(uint256(uint128(0.01e8))), 1_000);
        auth.poolId = keccak256("some other pool");

        _expectSwapRevert(
            VortexHook.VortexAuthorizationMismatch.selector, true, 0.01e8, _hookData(auth, feeSignerKey)
        );
    }

    function test_wrongDirectionReverts() public {
        // Signed for zeroForOne, executed the other way.
        VortexPermFeeAuthorization memory auth = _auth(true, -int256(uint256(uint128(0.01e8))), 1_000);

        _expectSwapRevert(
            VortexHook.VortexAuthorizationMismatch.selector, false, 0.01e8, _hookData(auth, feeSignerKey)
        );
    }

    function test_wrongAmountReverts() public {
        VortexPermFeeAuthorization memory auth = _auth(true, -int256(uint256(uint128(0.01e8))), 1_000);

        _expectSwapRevert(
            VortexHook.VortexAuthorizationMismatch.selector, true, 0.02e8, _hookData(auth, feeSignerKey)
        );
    }

    function test_replayedNonceReverts() public {
        uint128 amountIn = wbtcIsCurrency0 ? 0.01e8 : 1_000e6;
        VortexPermFeeAuthorization memory auth = _auth(true, -int256(uint256(amountIn)), 1_000);
        bytes memory hookData = _hookData(auth, feeSignerKey);

        vm.prank(swapper);
        router.swapExactInput(key, true, amountIn, 0, 0, hookData, swapper);
        assertTrue(hook.usedFeeNonces(swapper, auth.nonce), "nonce consumed");

        _expectSwapRevert(VortexHook.VortexAuthorizationNonceUsed.selector, true, amountIn, hookData);
    }

    function test_staleMockOracleReverts() public {
        // The authorization must OUTLIVE the oracle staleness window, otherwise
        // this test would pass on expiry and never exercise staleness at all.
        VortexPermFeeAuthorization memory auth = _auth(true, -int256(uint256(uint128(0.01e8))), 1_000);
        auth.deadline = uint40(block.timestamp + 3 hours);
        bytes memory hookData = _hookData(auth, feeSignerKey);

        vm.warp(block.timestamp + 2 hours); // > maxOracleAge (1h), < deadline (3h)

        _expectSwapRevert(VortexHook.VortexStaleOracle.selector, true, 0.01e8, hookData);
    }

    function test_excessivePoolDeviationReverts() public {
        // Move the oracle far away from the pool: the hook must refuse to price
        // rather than let the pool trade against a stale internal price.
        oracle.setPrice(MID * 2, (MID * 2) - 50e18, (MID * 2) + 50e18);

        VortexPermFeeAuthorization memory auth = _auth(true, -int256(uint256(uint128(0.01e8))), 1_000);

        _expectSwapRevert(
            VortexHook.VortexPoolDeviationTooLarge.selector, true, 0.01e8, _hookData(auth, feeSignerKey)
        );
    }

    function test_oracleSnapshotMismatchReverts() public {
        VortexPermFeeAuthorization memory auth = _auth(true, -int256(uint256(uint128(0.01e8))), 1_000);
        auth.oracleSnapshotHash = keccak256("a price that was never quoted");

        _expectSwapRevert(
            VortexHook.VortexOracleSnapshotMismatch.selector, true, 0.01e8, _hookData(auth, feeSignerKey)
        );
    }

    function test_missingHookDataReverts() public {
        _expectSwapRevert(VortexHook.VortexHookDataRequired.selector, true, 0.01e8, "");
    }

    function test_typehashMatchesSharedDefinition() public pure {
        // Independently computed with `cast keccak` from the canonical type
        // string in packages/shared/src/typedData.ts (master-owned).
        assertEq(
            VortexFeeAuthorizationLib.FEE_AUTHORIZATION_TYPEHASH,
            0x7fadbd4ee46f77a0b5d5f4244f166ab3918084a5b4722d56204e5a6a6325c2dd,
            "typehash drifted from shared typedData.ts"
        );
    }

    function test_hookRejectsDirectCalls() public {
        // Only the PoolManager may invoke callbacks; otherwise anyone could
        // burn a swapper's nonces or forge observations.
        VortexPermFeeAuthorization memory auth = _auth(true, -int256(uint256(uint128(0.01e8))), 1_000);

        vm.expectRevert(
            abi.encodeWithSelector(VortexHook.VortexOnlyPoolManager.selector, address(this))
        );
        hook.beforeSwap(
            address(this),
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(uint256(uint128(0.01e8))),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            _hookData(auth, feeSignerKey)
        );
    }

    function test_realTokensMoveThroughV4() public {
        uint128 amountIn = wbtcIsCurrency0 ? 0.01e8 : 1_000e6;
        address tokenIn = Currency.unwrap(currency0);
        address tokenOut = Currency.unwrap(currency1);

        uint256 inBefore = IERC20Like(tokenIn).balanceOf(swapper);
        uint256 outBefore = IERC20Like(tokenOut).balanceOf(swapper);
        uint256 pmOutBefore = IERC20Like(tokenOut).balanceOf(address(poolManager));

        uint256 amountOut = _swapExactIn(amountIn, true, 1_000);

        assertEq(IERC20Like(tokenIn).balanceOf(swapper), inBefore - amountIn, "swapper paid exactly amountIn");
        assertEq(IERC20Like(tokenOut).balanceOf(swapper), outBefore + amountOut, "swapper received output");
        assertEq(
            IERC20Like(tokenOut).balanceOf(address(poolManager)),
            pmOutBefore - amountOut,
            "PoolManager released the output"
        );
        assertGt(amountOut, 0);
        assertEq(IERC20Like(tokenIn).balanceOf(address(router)), 0, "router holds nothing");
        assertEq(IERC20Like(tokenOut).balanceOf(address(router)), 0, "router holds nothing");
    }

    function test_exactOutputDeliversExactAmount() public {
        uint128 desiredOut = wbtcIsCurrency0 ? 500e6 : 0.005e8;
        address tokenOut = Currency.unwrap(currency1);

        uint256 outBefore = IERC20Like(tokenOut).balanceOf(swapper);

        VortexPermFeeAuthorization memory auth = _auth(true, int256(uint256(desiredOut)), 1_000);
        vm.prank(swapper);
        uint256 amountIn = router.swapExactOutput(
            key, true, desiredOut, type(uint128).max, 0, _hookData(auth, feeSignerKey), swapper
        );

        // Exactness is what the Grow compounder depends on for its bridge leg.
        assertEq(
            IERC20Like(tokenOut).balanceOf(swapper) - outBefore, desiredOut, "received exactly the requested output"
        );
        assertGt(amountIn, 0);
    }

    function test_poolFeeStateIsUnchangedByOverride() public {
        (,,, uint24 lpFeeBefore) = poolManager.getSlot0(key.toId());
        _swapExactIn(wbtcIsCurrency0 ? 0.01e8 : 1_000e6, true, 15_000);
        (,,, uint24 lpFeeAfter) = poolManager.getSlot0(key.toId());

        // A per-swap override must not mutate the pool's stored dynamic fee.
        assertEq(lpFeeAfter, lpFeeBefore, "override is per-swap only");
    }
}

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
}

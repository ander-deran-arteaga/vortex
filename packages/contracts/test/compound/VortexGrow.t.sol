// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { VortexCompounder } from "../../src/compound/VortexCompounder.sol";
import {
    VortexCompoundRoute,
    VortexCompoundRouteLib,
    VortexGrowDirection,
    VortexGrowStrategy
} from "../../src/compound/VortexCompoundTypes.sol";
import { VortexRouteValidator } from "../../src/compound/VortexRouteValidator.sol";
import { IVortexReferenceOracle } from "../../src/interfaces/IVortexReferenceOracle.sol";
import { MockExternalRouter } from "../../src/mocks/MockExternalRouter.sol";
import { MockReferenceOracle } from "../../src/mocks/MockReferenceOracle.sol";
import { MockUSDC } from "../../src/mocks/MockUSDC.sol";
import { MockWBTC } from "../../src/mocks/MockWBTC.sol";
import { VortexFeeAuthorizationLib, VortexPermFeeAuthorization } from "../../src/permamm/VortexFeeAuthorization.sol";
import { VortexHook } from "../../src/permamm/VortexHook.sol";
import { VortexLiquidityManager } from "../../src/permamm/VortexLiquidityManager.sol";
import { VortexRouter } from "../../src/permamm/VortexRouter.sol";

/// @notice Phase 6 exit gate: a maker's WBTC is pulled from Aqua, cycled
///         through the real Vortex PermAMM and an external venue, and pushed
///         back with MORE WBTC — atomically, with the fee taken from profit
///         only. Grow is the one place PermAMM and Aqua legitimately meet
///         (MASTER D-015).
contract VortexGrowTest is Test {
    uint256 internal constant MID = 100_000e18;
    uint256 internal constant BID = 99_950e18;
    uint256 internal constant ASK = 100_050e18;

    uint128 internal constant PRINCIPAL = 1e8; // 1 WBTC
    uint128 internal constant BRIDGE_AMOUNT = 90_000e6; // USDC produced by leg 1

    Aqua internal aqua;
    IPoolManager internal poolManager;
    MockWBTC internal wbtc;
    MockUSDC internal usdc;
    MockReferenceOracle internal oracle;
    VortexHook internal hook;
    VortexLiquidityManager internal liquidityManager;
    VortexRouter internal permRouter;
    MockExternalRouter internal externalRouter;
    VortexCompounder internal compounder;

    PoolKey internal poolKey;
    bool internal wbtcIsCurrency0;

    address internal maker = makeAddr("maker");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal keeper = makeAddr("keeper");
    address internal routeSigner;
    uint256 internal routeSignerKey;
    address internal feeSigner;
    uint256 internal feeSignerKey;

    VortexGrowStrategy internal strategy;
    bytes32 internal strategyHash;
    uint64 internal nonceCounter;

    function setUp() public {
        (routeSigner, routeSignerKey) = makeAddrAndKey("routeSigner");
        (feeSigner, feeSignerKey) = makeAddrAndKey("feeSigner");

        aqua = new Aqua();
        poolManager = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(address(this))));
        _deployTokens();
        wbtcIsCurrency0 = address(wbtc) < address(usdc);

        oracle = new MockReferenceOracle(address(this));
        oracle.setPrice(MID, BID, ASK);

        liquidityManager = new VortexLiquidityManager(poolManager, address(this));
        permRouter = new VortexRouter(poolManager);
        externalRouter = new MockExternalRouter();
        compounder = new VortexCompounder(IAqua(address(aqua)), permRouter);

        hook = _deployHook();
        poolKey = PoolKey({
            currency0: wbtcIsCurrency0 ? Currency.wrap(address(wbtc)) : Currency.wrap(address(usdc)),
            currency1: wbtcIsCurrency0 ? Currency.wrap(address(usdc)) : Currency.wrap(address(wbtc)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hook
        });
        poolManager.initialize(poolKey, _oracleSqrtPrice());
        _provisionLiquidity();

        // The external venue is deliberately mispriced: it sells WBTC at 95k
        // while the PermAMM marks it at 100k, so buying back the principal
        // there costs less than it fetched. That gap IS the compound profit.
        externalRouter.setRate(address(usdc), address(wbtc), _usdcToWbtcRate(95_000));
        externalRouter.setRate(address(wbtc), address(usdc), 1e18);
        wbtc.mint(address(this), 1_000e8);
        wbtc.approve(address(externalRouter), type(uint256).max);
        externalRouter.fund(address(wbtc), 1_000e8);

        strategy = VortexGrowStrategy({
            maker: maker,
            asset: address(wbtc),
            bridgeToken: address(usdc),
            externalTarget: address(externalRouter),
            routeSigner: routeSigner,
            feeRecipient: feeRecipient,
            maxAmountPerExecution: 2e8,
            minProfitBps: 10, // 0.1%
            performanceFeeBps: 2_000, // 20% of realized profit
            strategyDeadline: uint40(block.timestamp + 30 days),
            salt: 1
        });
        strategyHash = VortexCompoundRouteLib.strategyHash(strategy);

        // Maker ships WBTC into the compounder app.
        wbtc.mint(maker, 10e8);
        vm.startPrank(maker);
        wbtc.approve(address(aqua), type(uint256).max);
        address[] memory tokens = new address[](1);
        tokens[0] = address(wbtc);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 5e8;
        bytes32 shipped = aqua.ship(address(compounder), abi.encode(strategy), tokens, amounts);
        vm.stopPrank();
        assertEq(shipped, strategyHash, "aqua hashes the strategy the same way we do");
    }

    /// @dev Overridden by the inverted-orientation suite. v4 sorts currencies
    ///      by address, so which token is currency0 is a deployment accident —
    ///      MASTER's standing rule (Addendum 9) requires both branches.
    function _deployTokens() internal virtual {
        wbtc = new MockWBTC();
        usdc = new MockUSDC();
    }

    // ===== harness =====

    function _deployHook() internal returns (VortexHook deployed) {
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        );
        address target = address(uint160(0x7777 << 144) | flags);

        VortexHook.HookConfig memory config = VortexHook.HookConfig({
            poolManager: poolManager,
            oracle: IVortexReferenceOracle(address(oracle)),
            liquidityManager: address(liquidityManager),
            initializer: address(this),
            feeSigner: feeSigner,
            currency0: wbtcIsCurrency0 ? Currency.wrap(address(wbtc)) : Currency.wrap(address(usdc)),
            currency1: wbtcIsCurrency0 ? Currency.wrap(address(usdc)) : Currency.wrap(address(wbtc)),
            baseIsCurrency0: wbtcIsCurrency0,
            minSafetyFeePips: 500,
            minCommercialFeePips: 100,
            maxCommercialFeePips: 20_000,
            maxPoolDeviationBps: 500,
            maxOracleAge: 1 hours,
            maxOracleSpreadBps: 50
        });
        deployCodeTo("VortexHook.sol:VortexHook", abi.encode(config), target);
        deployed = VortexHook(target);
    }

    function _oracleSqrtPrice() internal view returns (uint160) {
        uint256 priceE18 = wbtcIsCurrency0 ? MID / 1e2 : 1e36 / (MID / 1e2);
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
        wbtc.mint(address(liquidityManager), 1_000_000e8);
        usdc.mint(address(liquidityManager), 100_000_000_000e6);
        liquidityManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: 1e12,
                salt: bytes32(0)
            })
        );
    }

    /// @dev Satoshis per USDC unit, 1e18-scaled, from a WBTC price quoted in
    ///      WHOLE USDC (e.g. 95_000 → 1 WBTC costs 95,000 USDC). One whole WBTC
    ///      is 1e8 sats and costs `price * 1e6` USDC units.
    function _usdcToWbtcRate(uint256 wholeUsdcPerWbtc) internal pure returns (uint256) {
        return (1e8 * 1e18) / (wholeUsdcPerWbtc * 1e6);
    }

    function _permHookData(int256 amountSpecified) internal returns (bytes memory) {
        IVortexReferenceOracle.PriceData memory p = oracle.latestPrice();
        VortexPermFeeAuthorization memory auth = VortexPermFeeAuthorization({
            poolId: PoolId.unwrap(poolKey.toId()),
            quoteId: keccak256(abi.encode("grow", nonceCounter)),
            oracleSnapshotHash: keccak256(
                abi.encode(p.midPriceE18, p.bidPriceE18, p.askPriceE18, p.updatedAt)
            ),
            swapper: address(compounder),
            tokenIn: address(wbtc),
            tokenOut: address(usdc),
            zeroForOne: wbtcIsCurrency0,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: wbtcIsCurrency0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            commercialFeePips: 1_000,
            deadline: uint40(block.timestamp + 10 minutes),
            nonce: nonceCounter++
        });

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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(feeSignerKey, digest);
        return abi.encode(auth, abi.encodePacked(r, s, v));
    }

    function _externalCalldata(uint256 amountIn) internal view returns (bytes memory) {
        return abi.encodeCall(
            MockExternalRouter.swap, (address(usdc), address(wbtc), amountIn, address(compounder))
        );
    }

    function _signRoute(VortexCompoundRoute memory route) internal view returns (bytes memory) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Vortex Grow")),
                keccak256(bytes("1")),
                block.chainid,
                address(compounder)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, VortexCompoundRouteLib.hashStruct(route))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(routeSignerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Builds a complete, valid, profitable execution.
    function _buildParams() internal returns (VortexCompounder.ExecuteParams memory params) {
        bytes memory permHookData = _permHookData(int256(uint256(BRIDGE_AMOUNT)));
        bytes memory externalCalldata = _externalCalldata(BRIDGE_AMOUNT);

        VortexCompoundRoute memory route = VortexCompoundRoute({
            strategyHash: strategyHash,
            opportunityId: keccak256(abi.encode("opp", nonceCounter)),
            direction: uint8(VortexGrowDirection.VORTEX_THEN_EXTERNAL),
            principalAmount: PRINCIPAL,
            bridgeAmount: BRIDGE_AMOUNT,
            maxAssetSpent: 0.95e8,
            minFinalAsset: 0,
            externalTarget: address(externalRouter),
            externalValue: 0,
            externalCalldataHash: keccak256(externalCalldata),
            permHookDataHash: keccak256(permHookData),
            deadline: uint40(block.timestamp + 10 minutes),
            nonce: nonceCounter
        });

        params = VortexCompounder.ExecuteParams({
            strategy: strategy,
            route: route,
            routeSignature: _signRoute(route),
            permHookData: permHookData,
            externalCalldata: externalCalldata,
            poolKey: poolKey,
            assetIsCurrency0: wbtcIsCurrency0
        });
    }

    function _execute(VortexCompounder.ExecuteParams memory params) internal {
        vm.prank(keeper);
        compounder.executeCompound(params);
    }

    function _expectExecuteRevert(bytes4 selector, VortexCompounder.ExecuteParams memory params) internal {
        vm.prank(keeper);
        (bool ok, bytes memory returndata) =
            address(compounder).call(abi.encodeCall(VortexCompounder.executeCompound, (params)));
        assertFalse(ok, "expected the compound to revert");
        assertTrue(_containsSelector(returndata, selector), "reverted for the wrong reason");
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

    function _virtualAsset() internal view returns (uint256 balance) {
        (uint248 raw,) = aqua.rawBalances(maker, address(compounder), strategyHash, address(wbtc));
        balance = raw;
    }

    // ===== §18.1 Grow suite =====

    function test_successfulCycleReturnsMoreWBTC() public {
        uint256 makerWalletBefore = wbtc.balanceOf(maker);
        uint256 virtualBefore = _virtualAsset();

        (uint256 principal, uint256 makerReturn, uint256 grossProfit, uint256 fee) =
            _executeAndReadAccounting(_buildParams());

        // Print the actual economics so the numbers are auditable, not implied.
        emit log_named_decimal_uint("principal  (WBTC)", principal, 8);
        emit log_named_decimal_uint("makerReturn(WBTC)", makerReturn, 8);
        emit log_named_decimal_uint("grossProfit(WBTC)", grossProfit, 8);
        emit log_named_decimal_uint("fee        (WBTC)", fee, 8);
        assertGt(makerReturn, principal, "maker got back more than was pulled");

        // The maker ends with more real WBTC than they started with, and the
        // virtual balance grew by the same net amount.
        assertGt(wbtc.balanceOf(maker), makerWalletBefore, "maker gained real WBTC");
        assertGt(_virtualAsset(), virtualBefore, "virtual balance grew");
        assertEq(
            _virtualAsset() - virtualBefore,
            wbtc.balanceOf(maker) - makerWalletBefore,
            "virtual and real growth agree"
        );
    }

    function test_virtualBalanceGrowsByNetProfit() public {
        uint256 virtualBefore = _virtualAsset();

        // Compare against the accounting the contract emitted, not against a
        // re-derivation of its own arithmetic.
        (uint256 principal, uint256 makerReturn, uint256 grossProfit, uint256 fee) =
            _executeAndReadAccounting(_buildParams());

        assertEq(principal, PRINCIPAL);
        assertEq(makerReturn, principal + grossProfit - fee, "maker keeps principal + profit - fee");
        assertEq(_virtualAsset() - virtualBefore, makerReturn - principal, "virtual grew by net profit");
    }

    function test_feeOnlyTakenFromProfit() public {
        uint256 recipientBefore = wbtc.balanceOf(feeRecipient);

        (, , uint256 grossProfit, uint256 fee) = _executeAndReadAccounting(_buildParams());
        assertEq(fee, (grossProfit * 2_000) / 10_000, "fee is exactly 20% of gross profit");
        assertEq(wbtc.balanceOf(feeRecipient) - recipientBefore, fee, "recipient received exactly the fee");
        assertLt(fee, grossProfit, "fee never exceeds the profit it came from");
    }

    function test_zeroProfitReverts() public {
        // No mispricing: the external venue marks WBTC at the same 100k as the
        // PermAMM, so after fees the cycle cannot clear the 0.1% profit floor.
        externalRouter.setRate(address(usdc), address(wbtc), _usdcToWbtcRate(100_000));

        _expectExecuteRevert(
            VortexCompounder.VortexInsufficientCompoundReturn.selector, _buildParams()
        );
    }

    function test_oneUnitBelowMinimumReverts() public {
        // Profitable, then shaved by a single satoshi below the required floor.
        VortexCompounder.ExecuteParams memory params = _buildParams();

        // Find the exact produced amount by simulating, then demand one more.
        uint256 snapshot = vm.snapshotState();
        (, , uint256 grossProfit,) = _executeAndReadAccounting(params);
        uint256 produced = PRINCIPAL + grossProfit;
        vm.revertToState(snapshot);

        params = _buildParams();
        params.route.minFinalAsset = uint128(produced + 1);
        params.routeSignature = _signRoute(params.route);

        _expectExecuteRevert(
            VortexCompounder.VortexInsufficientCompoundReturn.selector, params
        );
    }

    function test_wrongExternalTargetReverts() public {
        MockExternalRouter rogue = new MockExternalRouter();
        VortexCompounder.ExecuteParams memory params = _buildParams();
        params.route.externalTarget = address(rogue);
        params.routeSignature = _signRoute(params.route);

        _expectExecuteRevert(VortexRouteValidator.VortexExternalTargetNotAllowed.selector, params);
    }

    function test_wrongCalldataHashReverts() public {
        VortexCompounder.ExecuteParams memory params = _buildParams();
        params.externalCalldata = _externalCalldata(BRIDGE_AMOUNT + 1);

        _expectExecuteRevert(VortexRouteValidator.VortexExternalCalldataMismatch.selector, params);
    }

    function test_wrongPermHookDataHashReverts() public {
        VortexCompounder.ExecuteParams memory params = _buildParams();
        params.permHookData = _permHookData(int256(uint256(BRIDGE_AMOUNT)));

        _expectExecuteRevert(VortexRouteValidator.VortexPermHookDataMismatch.selector, params);
    }

    function test_expiredRouteReverts() public {
        VortexCompounder.ExecuteParams memory params = _buildParams();
        vm.warp(block.timestamp + 11 minutes);

        _expectExecuteRevert(VortexRouteValidator.VortexRouteExpired.selector, params);
    }

    function test_replayedRouteReverts() public {
        VortexCompounder.ExecuteParams memory params = _buildParams();
        _execute(params);

        _expectExecuteRevert(VortexCompounder.VortexRouteNonceUsed.selector, params);
    }

    function test_routeCannotSpendAboveStrategyCap() public {
        VortexCompounder.ExecuteParams memory params = _buildParams();
        params.route.principalAmount = strategy.maxAmountPerExecution + 1;
        params.routeSignature = _signRoute(params.route);

        _expectExecuteRevert(VortexRouteValidator.VortexPrincipalAboveStrategyCap.selector, params);
    }

    function test_badRouteSignatureReverts() public {
        (, uint256 malloryKey) = makeAddrAndKey("mallory");
        VortexCompounder.ExecuteParams memory params = _buildParams();

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Vortex Grow")),
                keccak256(bytes("1")),
                block.chainid,
                address(compounder)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", domainSeparator, VortexCompoundRouteLib.hashStruct(params.route)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(malloryKey, digest);
        params.routeSignature = abi.encodePacked(r, s, v);

        _expectExecuteRevert(VortexRouteValidator.VortexBadRouteSignature.selector, params);
    }

    function test_externalValueMustBeZero() public {
        VortexCompounder.ExecuteParams memory params = _buildParams();
        params.route.externalValue = 1;
        params.routeSignature = _signRoute(params.route);

        _expectExecuteRevert(VortexRouteValidator.VortexExternalValueForbidden.selector, params);
    }

    function test_failedExternalLegRevertsEverything() public {
        externalRouter.setShouldRevert(true);

        uint256 makerWalletBefore = wbtc.balanceOf(maker);
        uint256 virtualBefore = _virtualAsset();

        _expectExecuteRevert(VortexCompounder.VortexExternalCallFailed.selector, _buildParams());

        // Atomicity: the Aqua pull is undone with everything else.
        assertEq(wbtc.balanceOf(maker), makerWalletBefore, "maker wallet untouched");
        assertEq(_virtualAsset(), virtualBefore, "virtual balance untouched");
        assertEq(wbtc.balanceOf(address(compounder)), 0, "no asset stranded");
        assertEq(usdc.balanceOf(address(compounder)), 0, "no bridge stranded");
    }

    function test_failedCycleLeavesAllBalancesUnchanged() public {
        // Under-delivering venue → profit floor not met → whole thing unwinds.
        externalRouter.setShortfall(0.5e8);

        uint256 makerWalletBefore = wbtc.balanceOf(maker);
        uint256 virtualBefore = _virtualAsset();
        uint256 feeRecipientBefore = wbtc.balanceOf(feeRecipient);

        _expectExecuteRevert(
            VortexCompounder.VortexInsufficientCompoundReturn.selector, _buildParams()
        );

        assertEq(wbtc.balanceOf(maker), makerWalletBefore);
        assertEq(_virtualAsset(), virtualBefore);
        assertEq(wbtc.balanceOf(feeRecipient), feeRecipientBefore, "no fee on a failed cycle");
    }

    function test_typehashMatchesSharedDefinition() public pure {
        // Independently computed with `cast keccak` from the canonical type
        // string in packages/shared/src/typedData.ts (master-owned).
        assertEq(
            VortexCompoundRouteLib.COMPOUND_ROUTE_TYPEHASH,
            0x0b511a83fbe94c834aa0f938d544fc0fd5db61ddd3845cee2902c09f634b5ebd,
            "typehash drifted from shared typedData.ts"
        );
    }

    function test_signerCompromiseCannotBreakInvariants() public {
        // The route signer is fully compromised in every test above that
        // re-signs a tampered route. This asserts the summary property: with a
        // valid signature over a route the signer fully controls, the maker
        // still cannot end up worse off, because the final same-asset check is
        // authoritative.
        externalRouter.setRate(address(usdc), address(wbtc), _usdcToWbtcRate(110_000)); // worse than the pool

        VortexCompounder.ExecuteParams memory params = _buildParams();
        params.route.minFinalAsset = 0; // signer waives its own floor
        params.routeSignature = _signRoute(params.route);

        uint256 virtualBefore = _virtualAsset();
        _expectExecuteRevert(
            VortexCompounder.VortexInsufficientCompoundReturn.selector, params
        );
        assertEq(_virtualAsset(), virtualBefore, "maker untouched despite a valid signature");
    }

    /// @notice The reverse leg order: buy the bridge asset externally first,
    ///         then convert back on the PermAMM. Declared supported by the
    ///         validator, so it must be exercised rather than assumed.
    function test_externalThenVortexDirectionCompounds() public {
        // Sell WBTC externally ABOVE the pool's mark (105k vs 100k), then buy
        // it back on the pool — the mirror image of the other direction.
        externalRouter.setRate(address(wbtc), address(usdc), _wbtcToUsdcRate(105_000));
        usdc.mint(address(this), 100_000_000e6);
        usdc.approve(address(externalRouter), type(uint256).max);
        externalRouter.fund(address(usdc), 100_000_000e6);

        uint128 assetToSell = 0.9e8;
        bytes memory externalCalldata = abi.encodeCall(
            MockExternalRouter.swap, (address(wbtc), address(usdc), assetToSell, address(compounder))
        );
        // Leg 2 is exact-input over whatever the external leg produced, so the
        // hook authorization binds that leg's own amount.
        bytes memory permHookData = _permHookDataFor(
            address(usdc), address(wbtc), !wbtcIsCurrency0, -int256(uint256(assetToSell) * 105_000 / 1e2)
        );

        VortexCompoundRoute memory route = VortexCompoundRoute({
            strategyHash: strategyHash,
            opportunityId: keccak256("opp-reverse"),
            direction: uint8(VortexGrowDirection.EXTERNAL_THEN_VORTEX),
            principalAmount: PRINCIPAL,
            bridgeAmount: uint128(uint256(assetToSell) * 105_000 / 1e2),
            maxAssetSpent: assetToSell,
            minFinalAsset: 0,
            externalTarget: address(externalRouter),
            externalValue: 0,
            externalCalldataHash: keccak256(externalCalldata),
            permHookDataHash: keccak256(permHookData),
            deadline: uint40(block.timestamp + 10 minutes),
            nonce: 4242
        });

        VortexCompounder.ExecuteParams memory params = VortexCompounder.ExecuteParams({
            strategy: strategy,
            route: route,
            routeSignature: _signRoute(route),
            permHookData: permHookData,
            externalCalldata: externalCalldata,
            poolKey: poolKey,
            assetIsCurrency0: wbtcIsCurrency0
        });

        uint256 virtualBefore = _virtualAsset();
        (uint256 principal, uint256 makerReturn,,) = _executeAndReadAccounting(params);

        assertEq(principal, PRINCIPAL);
        assertGt(makerReturn, principal, "reverse direction also compounds");
        assertEq(_virtualAsset() - virtualBefore, makerReturn - principal);
        assertEq(usdc.balanceOf(address(compounder)), 0, "no bridge dust either way");
    }

    /// @dev USDC units per satoshi, 1e18-scaled, from a whole-USDC WBTC price.
    function _wbtcToUsdcRate(uint256 wholeUsdcPerWbtc) internal pure returns (uint256) {
        return (wholeUsdcPerWbtc * 1e6 * 1e18) / 1e8;
    }

    /// @dev A fee authorization for an arbitrary leg, rather than the default
    ///      asset -> bridge exact-output one.
    function _permHookDataFor(
        address tokenIn,
        address tokenOut,
        bool zeroForOne,
        int256 amountSpecified
    )
        internal
        returns (bytes memory)
    {
        IVortexReferenceOracle.PriceData memory p = oracle.latestPrice();
        VortexPermFeeAuthorization memory auth = VortexPermFeeAuthorization({
            poolId: PoolId.unwrap(poolKey.toId()),
            quoteId: keccak256(abi.encode("grow-leg", nonceCounter)),
            oracleSnapshotHash: keccak256(
                abi.encode(p.midPriceE18, p.bidPriceE18, p.askPriceE18, p.updatedAt)
            ),
            swapper: address(compounder),
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            commercialFeePips: 1_000,
            deadline: uint40(block.timestamp + 10 minutes),
            nonce: nonceCounter++
        });

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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(feeSignerKey, digest);
        return abi.encode(auth, abi.encodePacked(r, s, v));
    }

    // ===== event helper =====

    /// @dev Executes and returns the accounting the contract itself emitted,
    ///      so assertions compare against the event rather than re-deriving
    ///      the implementation's own arithmetic.
    function _executeAndReadAccounting(VortexCompounder.ExecuteParams memory params)
        internal
        returns (uint256 principal, uint256 makerReturn, uint256 grossProfit, uint256 fee)
    {
        vm.recordLogs();
        _execute(params);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256(
            "VortexGrowExecuted(bytes32,bytes32,address,address,uint256,uint256,uint256,uint256)"
        );
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == topic) {
                (, principal, makerReturn, grossProfit, fee) =
                    abi.decode(logs[i].data, (address, uint256, uint256, uint256, uint256));
                return (principal, makerReturn, grossProfit, fee);
            }
        }
        revert("VortexGrowExecuted not emitted");
    }
}

/// @notice Re-runs the entire Grow suite with the token ordering FLIPPED.
/// @dev MASTER Addendum 9 standing rule: anything whose behaviour depends on
///      address sort order must be tested in both branches. The Phase 5 hook
///      bug (oracle never inverted when the base asset sorted as currency1)
///      was exactly this class, and Grow drives the same pool through the same
///      hook — so the compounder inherits the hazard and must inherit the
///      guard.
contract VortexGrowInvertedOrientationTest is VortexGrowTest {
    function _deployTokens() internal override {
        address lowSlot = address(uint160(0x2222 << 100));
        address highSlot = address(uint160(0x8888 << 100));

        MockWBTC naturalWbtc = new MockWBTC();
        MockUSDC naturalUsdc = new MockUSDC();
        bool naturalWbtcFirst = address(naturalWbtc) < address(naturalUsdc);

        (address wbtcSlot, address usdcSlot) =
            naturalWbtcFirst ? (highSlot, lowSlot) : (lowSlot, highSlot);

        deployCodeTo("MockWBTC.sol:MockWBTC", "", wbtcSlot);
        deployCodeTo("MockUSDC.sol:MockUSDC", "", usdcSlot);

        wbtc = MockWBTC(wbtcSlot);
        usdc = MockUSDC(usdcSlot);

        // Without this the inverted suite could silently degrade into a
        // duplicate of the normal one and look like free coverage.
        require(
            (address(wbtc) < address(usdc)) != naturalWbtcFirst,
            "orientation was not actually flipped"
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { VortexCompounder } from "../src/compound/VortexCompounder.sol";
import {
    VortexCompoundRoute,
    VortexCompoundRouteLib,
    VortexGrowDirection,
    VortexGrowStrategy
} from "../src/compound/VortexCompoundTypes.sol";
import { IVortexReferenceOracle } from "../src/interfaces/IVortexReferenceOracle.sol";
import { MockExternalRouter } from "../src/mocks/MockExternalRouter.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { VortexFeeAuthorizationLib, VortexPermFeeAuthorization } from "../src/permamm/VortexFeeAuthorization.sol";
import { VortexHook } from "../src/permamm/VortexHook.sol";

/// @notice Executes one full Vortex Grow compound cycle against the DEPLOYED
///         compounder, using only the published artifacts (`31337.json` +
///         `31337.grow.json`).
///
/// @dev Same two jobs as ExecuteDemoSwap, for the other product:
///      1. **Reference implementation** for `POST /api/v1/grow/prepare` and
///         `/execute` — the route construction, the two EIP-712 signatures and
///         the calldata binding below are exactly what the API must reproduce.
///      2. **CLI backup** for demo scene 4: pulls a maker's WBTC through Aqua,
///         cycles it, and returns more WBTC, printing the accounting.
///
///      Signing keys default to the anvil accounts the deploy scripts use.
contract ExecuteDemoGrow is Script {
    function run() external {
        string memory deployment = vm.readFile(
            string.concat(
                "../../deployments/",
                vm.envOr("DEPLOY_OUT", string.concat(vm.toString(block.chainid), ".json"))
            )
        );
        string memory grow = vm.readFile(
            string.concat("../../deployments/", vm.toString(block.chainid), ".grow.json")
        );

        VortexCompounder compounder =
            VortexCompounder(vm.parseJsonAddress(deployment, ".contracts.VortexCompounder"));
        MockERC20 wbtc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockWBTC"));
        MockERC20 usdc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockUSDC"));

        VortexGrowStrategy memory strategy = _readStrategy(grow);
        bytes32 growHash = VortexCompoundRouteLib.strategyHash(strategy);
        require(
            growHash == vm.parseJsonBytes32(grow, ".growStrategyHash"),
            "grow: rebuilt strategy hash does not match the published one"
        );

        (uint256 walletBefore, uint256 virtualBefore) =
            _makerBalances(deployment, strategy, growHash, address(compounder), address(wbtc));

        _execute(deployment, grow, compounder, strategy, growHash, address(wbtc), address(usdc));

        (uint256 walletAfter, uint256 virtualAfter) =
            _makerBalances(deployment, strategy, growHash, address(compounder), address(wbtc));

        console.log("--- Vortex Grow compounded through Aqua + Vortex PermAMM ---");
        console.log("maker              %s", strategy.maker);
        console.log("wallet WBTC before %s", walletBefore);
        console.log("wallet WBTC after  %s", walletAfter);
        console.log("virtual WBTC before %s", virtualBefore);
        console.log("virtual WBTC after  %s", virtualAfter);

        require(walletAfter > walletBefore, "maker did not end with more real WBTC");
        require(virtualAfter > virtualBefore, "maker virtual balance did not grow");
        require(
            walletAfter - walletBefore == virtualAfter - virtualBefore,
            "real and virtual growth disagree"
        );
        require(usdc.balanceOf(address(compounder)) == 0, "bridge asset left in the app");
    }

    function _execute(
        string memory deployment,
        string memory grow,
        VortexCompounder compounder,
        VortexGrowStrategy memory strategy,
        bytes32 growHash,
        address wbtc,
        address usdc
    )
        private
    {
        uint128 principal = uint128(vm.envOr("PRINCIPAL", uint256(1e8)));
        // Sized from the pool's own mark, not a fixed number of USDC. The cycle
        // sells WBTC on the pool for exactly `bridgeAmount`, so a bridge fixed
        // at 90k USDC quietly became 1.39 WBTC of principal when the mark moved
        // off 100,000 — over both `maxAssetSpent` and the position itself, so
        // the leg reverted on an allowance rather than saying it was mis-sized.
        // 90% of the principal's value keeps the cycle's shape at any mark.
        uint256 poolMarkWhole = vm.parseJsonUint(grow, ".poolMarkWholeUsdc");
        uint128 defaultBridge = uint128((uint256(principal) * poolMarkWhole * 1e6 * 90) / (1e8 * 100));
        uint128 bridgeAmount = uint128(vm.envOr("BRIDGE_AMOUNT", uint256(defaultBridge)));
        uint64 nonce = uint64(vm.envOr("ROUTE_NONCE", uint256(block.timestamp)));

        PoolKey memory poolKey = _poolKey(deployment);
        bool wbtcIsCurrency0 = wbtc < usdc;

        // Leg 2 calldata: the external venue buys the principal back. Bound by
        // hash in the route, so it cannot be swapped for anything else.
        bytes memory externalCalldata = abi.encodeCall(
            MockExternalRouter.swap, (usdc, wbtc, bridgeAmount, address(compounder))
        );
        // Leg 1: an exact-OUTPUT PermAMM swap producing precisely bridgeAmount,
        // which is why the external calldata above can be built in advance.
        bytes memory permHookData = _permHookData(
            deployment, address(compounder), wbtc, usdc, wbtcIsCurrency0, int256(uint256(bridgeAmount))
        );

        VortexCompoundRoute memory route = VortexCompoundRoute({
            strategyHash: growHash,
            opportunityId: keccak256(abi.encode("cli-demo", nonce)),
            direction: uint8(VortexGrowDirection.VORTEX_THEN_EXTERNAL),
            principalAmount: principal,
            bridgeAmount: bridgeAmount,
            // A fraction of the principal, so it scales with the position
            // rather than pinning a WBTC amount that only fits one mark.
            maxAssetSpent: uint128(vm.envOr("MAX_ASSET_SPENT", (uint256(principal) * 95) / 100)),
            minFinalAsset: 0, // the strategy's own minProfitBps still binds
            externalTarget: vm.parseJsonAddress(grow, ".externalTarget"),
            externalValue: 0,
            externalCalldataHash: keccak256(externalCalldata),
            permHookDataHash: keccak256(permHookData),
            deadline: uint40(block.timestamp + 10 minutes),
            nonce: nonce
        });

        VortexCompounder.ExecuteParams memory params = VortexCompounder.ExecuteParams({
            strategy: strategy,
            route: route,
            routeSignature: _signRoute(address(compounder), route),
            permHookData: permHookData,
            externalCalldata: externalCalldata,
            poolKey: poolKey,
            assetIsCurrency0: wbtcIsCurrency0
        });

        vm.startBroadcast();
        compounder.executeCompound(params);
        vm.stopBroadcast();
    }

    // ===== artifact readers =====

    function _readStrategy(string memory grow) private pure returns (VortexGrowStrategy memory s) {
        s.maker = vm.parseJsonAddress(grow, ".strategy.maker");
        s.asset = vm.parseJsonAddress(grow, ".strategy.asset");
        s.bridgeToken = vm.parseJsonAddress(grow, ".strategy.bridgeToken");
        s.externalTarget = vm.parseJsonAddress(grow, ".strategy.externalTarget");
        s.routeSigner = vm.parseJsonAddress(grow, ".strategy.routeSigner");
        s.feeRecipient = vm.parseJsonAddress(grow, ".strategy.feeRecipient");
        s.maxAmountPerExecution = uint128(vm.parseJsonUint(grow, ".strategy.maxAmountPerExecution"));
        s.minProfitBps = uint16(vm.parseJsonUint(grow, ".strategy.minProfitBps"));
        s.performanceFeeBps = uint16(vm.parseJsonUint(grow, ".strategy.performanceFeeBps"));
        s.strategyDeadline = uint40(vm.parseJsonUint(grow, ".strategy.strategyDeadline"));
        s.salt = uint64(vm.parseJsonUint(grow, ".strategy.salt"));
    }

    /// @dev READS the published PoolKey rather than re-deriving it. Rebuilding
    ///      it means re-deciding the currency sort order, the dynamic-fee flag
    ///      and the tick spacing — four independent chances to disagree with
    ///      what was actually deployed. The poolId cross-check below turns any
    ///      such disagreement into an immediate failure instead of a swap
    ///      against the wrong pool.
    function _poolKey(string memory deployment) private pure returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(vm.parseJsonAddress(deployment, ".permAmmPoolKey.currency0")),
            currency1: Currency.wrap(vm.parseJsonAddress(deployment, ".permAmmPoolKey.currency1")),
            fee: uint24(vm.parseJsonUint(deployment, ".permAmmPoolKey.fee")),
            tickSpacing: int24(vm.parseJsonInt(deployment, ".permAmmPoolKey.tickSpacing")),
            hooks: VortexHook(vm.parseJsonAddress(deployment, ".permAmmPoolKey.hooks"))
        });
        require(
            PoolId.unwrap(key.toId()) == vm.parseJsonBytes32(deployment, ".permAmmPoolId"),
            "grow: published pool key does not hash to the published pool id"
        );
    }

    function _makerBalances(
        string memory deployment,
        VortexGrowStrategy memory strategy,
        bytes32 growHash,
        address compounder,
        address wbtc
    )
        private
        view
        returns (uint256 wallet, uint256 virtualBalance)
    {
        IAqua aqua = IAqua(vm.parseJsonAddress(deployment, ".contracts.Aqua"));
        wallet = MockERC20(wbtc).balanceOf(strategy.maker);
        (uint248 raw,) = aqua.rawBalances(strategy.maker, compounder, growHash, wbtc);
        virtualBalance = raw;
    }

    // ===== the two signatures the API must reproduce =====

    /// @dev PermAMM per-swap fee authorization — domain `Vortex PermAMM`,
    ///      verifyingContract = the hook.
    function _permHookData(
        string memory deployment,
        address compounder,
        address wbtc,
        address usdc,
        bool wbtcIsCurrency0,
        int256 amountSpecified
    )
        private
        view
        returns (bytes memory)
    {
        address hook = vm.parseJsonAddress(deployment, ".contracts.VortexHook");
        IVortexReferenceOracle.PriceData memory p =
            IVortexReferenceOracle(vm.parseJsonAddress(deployment, ".contracts.MockReferenceOracle"))
                .latestPrice();

        VortexPermFeeAuthorization memory auth = VortexPermFeeAuthorization({
            poolId: vm.parseJsonBytes32(deployment, ".permAmmPoolId"),
            quoteId: keccak256(abi.encode("cli-grow-leg", block.timestamp)),
            oracleSnapshotHash: keccak256(
                abi.encode(p.midPriceE18, p.bidPriceE18, p.askPriceE18, p.updatedAt)
            ),
            swapper: compounder,
            tokenIn: wbtc,
            tokenOut: usdc,
            zeroForOne: wbtcIsCurrency0,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: wbtcIsCurrency0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            commercialFeePips: uint24(vm.envOr("COMMERCIAL_FEE_PIPS", uint256(1_000))),
            deadline: uint40(block.timestamp + 10 minutes),
            nonce: uint64(vm.envOr("FEE_NONCE", uint256(block.timestamp)))
        });

        uint256 feeSignerKey = vm.envOr(
            "FEE_SIGNER_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domain("Vortex PermAMM", hook),
                VortexFeeAuthorizationLib.hashStruct(auth)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(feeSignerKey, digest);
        return abi.encode(auth, abi.encodePacked(r, s, v));
    }

    /// @dev Grow route authorization — domain `Vortex Grow`,
    ///      verifyingContract = the compounder.
    function _signRoute(
        address compounder,
        VortexCompoundRoute memory route
    )
        private
        view
        returns (bytes memory)
    {
        uint256 routeSignerKey = vm.envOr(
            "ROUTE_SIGNER_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domain("Vortex Grow", compounder),
                VortexCompoundRouteLib.hashStruct(route)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(routeSignerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _domain(string memory name, address verifyingContract) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                verifyingContract
            )
        );
    }
}

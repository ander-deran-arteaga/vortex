// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { console } from "forge-std/console.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { VortexCompounder } from "../src/compound/VortexCompounder.sol";
import { VortexCompoundRouteLib, VortexGrowStrategy } from "../src/compound/VortexCompoundTypes.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MockExternalRouter } from "../src/mocks/MockExternalRouter.sol";
import { MockReferenceOracle } from "../src/mocks/MockReferenceOracle.sol";
import { MockStalePool } from "../src/mocks/MockStalePool.sol";
import { VortexRouter } from "../src/permamm/VortexRouter.sol";

import { DemoPrice } from "./DemoPrice.sol";

/// @notice Deploys Vortex Grow on the local chain: the compounder, the
///         simulated external venue, and a shipped single-asset WBTC strategy
///         ready to compound.
///
/// @dev Run LAST, after DeployLocal → SeedDemo → DeployPermAMM. It appends to
///      deployments/<chainId>.json without disturbing earlier addresses, and
///      writes the Grow strategy to deployments/<chainId>.grow.json.
///
///      The external venue is `MockExternalRouter` priced BELOW the PermAMM
///      mark — that mispricing is the whole source of compound profit, and it
///      is simulated liquidity. Anything routed through it must be labelled as
///      such in the UI (MASTER §21). The live Uniswap API leg is Phase 7.
contract DeployGrow is Script {
    /// @dev Absolute (not `now + delta`) so the strategy hash is reproducible.
    uint40 internal constant GROW_STRATEGY_DEADLINE = 2_000_000_000;

    uint128 internal constant MAX_PER_EXECUTION = 2e8; // 2 WBTC
    uint16 internal constant MIN_PROFIT_BPS = 10; // 0.1%
    uint16 internal constant PERFORMANCE_FEE_BPS = 2_000; // 20% of realized profit
    uint256 internal constant SHIPPED_WBTC = 5e8; // 5 WBTC of maker capital

    /// @dev The venue sells WBTC below the PermAMM mark, and that gap IS the
    ///      compounder's profit. Both numbers are derived from the oracle the
    ///      pool was initialised from, never restated: the hook rejects a swap
    ///      whose pool and oracle disagree, so a mark that moves in one place
    ///      and not the other bricks every swap on a chain that looks healthy.
    uint256 private poolMarkWholeUsdc;
    uint256 private externalWholeUsdc;

    function run() external {
        string memory path = string.concat("../../deployments/", vm.toString(block.chainid), ".json");
        string memory deployment = vm.readFile(path);

        Aqua aqua = Aqua(vm.parseJsonAddress(deployment, ".contracts.Aqua"));
        MockERC20 wbtc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockWBTC"));
        MockERC20 usdc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockUSDC"));
        VortexRouter permRouter = VortexRouter(vm.parseJsonAddress(deployment, ".contracts.VortexRouter"));

        uint256 makerKey = vm.envOr(
            "DEMO_MAKER_KEY",
            uint256(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d)
        );
        address maker = vm.addr(makerKey);
        address routeSigner = vm.envOr("ROUTE_SIGNER", msg.sender);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", msg.sender);

        poolMarkWholeUsdc = MockReferenceOracle(
            vm.parseJsonAddress(deployment, ".contracts.MockReferenceOracle")
        ).latestPrice().midPriceE18 / 1e18;
        externalWholeUsdc = DemoPrice.growVenueWhole(poolMarkWholeUsdc);
        require(externalWholeUsdc > 0, "grow: venue mark rounded to zero");

        vm.startBroadcast();

        VortexCompounder compounder = new VortexCompounder(IAqua(address(aqua)), permRouter);

        MockExternalRouter externalRouter = new MockExternalRouter();
        // Rates are token-unit ratios: WBTC has 8 decimals, USDC 6.
        externalRouter.setRate(
            address(usdc), address(wbtc), (1e8 * 1e18) / (externalWholeUsdc * 1e6)
        );
        externalRouter.setRate(
            address(wbtc), address(usdc), (externalWholeUsdc * 1e6 * 1e18) / 1e8
        );

        // A labelled stale venue for the demo narrative — deliberately off-mark.
        MockStalePool stalePool =
            new MockStalePool(address(wbtc), address(usdc), externalWholeUsdc * 1e18);

        // Fund the maker for THIS position specifically. Aqua books virtual
        // balances without moving tokens, so shipping more than the maker holds
        // would create exactly the phantom liquidity the lens exists to expose —
        // the assertion after `ship` below refuses to let that happen silently.
        wbtc.mint(maker, SHIPPED_WBTC);

        // Fund both venues so they can actually settle.
        wbtc.mint(msg.sender, 10_000e8);
        usdc.mint(msg.sender, 1_000_000_000e6);
        wbtc.approve(address(externalRouter), type(uint256).max);
        usdc.approve(address(externalRouter), type(uint256).max);
        externalRouter.fund(address(wbtc), 5_000e8);
        externalRouter.fund(address(usdc), 500_000_000e6);
        wbtc.approve(address(stalePool), type(uint256).max);
        usdc.approve(address(stalePool), type(uint256).max);
        stalePool.fund(address(wbtc), 1_000e8);
        stalePool.fund(address(usdc), 100_000_000e6);

        vm.stopBroadcast();

        VortexGrowStrategy memory strategy = VortexGrowStrategy({
            maker: maker,
            asset: address(wbtc),
            bridgeToken: address(usdc),
            externalTarget: address(externalRouter),
            routeSigner: routeSigner,
            feeRecipient: feeRecipient,
            maxAmountPerExecution: MAX_PER_EXECUTION,
            minProfitBps: MIN_PROFIT_BPS,
            performanceFeeBps: PERFORMANCE_FEE_BPS,
            strategyDeadline: GROW_STRATEGY_DEADLINE,
            salt: 1
        });
        bytes32 growStrategyHash = VortexCompoundRouteLib.strategyHash(strategy);

        // Ship the maker's single-asset WBTC position into the compounder app.
        vm.startBroadcast(makerKey);
        wbtc.approve(address(aqua), type(uint256).max);
        address[] memory tokens = new address[](1);
        tokens[0] = address(wbtc);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = SHIPPED_WBTC;
        bytes32 shipped = aqua.ship(address(compounder), abi.encode(strategy), tokens, amounts);
        vm.stopBroadcast();
        require(shipped == growStrategyHash, "grow: strategy hash mismatch");

        // The maker must hold what they shipped, or the strategy is a phantom.
        require(wbtc.balanceOf(maker) >= SHIPPED_WBTC, "grow: maker underfunded for shipped amount");

        console.log("VortexCompounder   %s", address(compounder));
        console.log("MockExternalRouter %s", address(externalRouter));
        console.log("growStrategyHash   %s", vm.toString(growStrategyHash));

        _write(deployment, address(compounder), address(externalRouter), address(stalePool));
        _writeGrow(strategy, growStrategyHash, address(compounder), address(externalRouter));
    }

    function _write(
        string memory existing,
        address compounder,
        address externalRouter,
        address stalePool
    )
        internal
    {
        string memory c = "contracts";
        string[13] memory keys = [
            "Aqua",
            "AquaSwapVMRouter",
            "MockWBTC",
            "MockUSDC",
            "MockWETH",
            "MockReferenceOracle",
            "VortexAquaPricing",
            "VortexAquaOrderBuilder",
            "VortexAquaLens",
            "PoolManager",
            "VortexHook",
            "VortexRouter",
            "VortexQuoter"
        ];
        for (uint256 i = 0; i < keys.length; i++) {
            vm.serializeAddress(
                c, keys[i], vm.parseJsonAddress(existing, string.concat(".contracts.", keys[i]))
            );
        }
        vm.serializeAddress(
            c,
            "VortexLiquidityManager",
            vm.parseJsonAddress(existing, ".contracts.VortexLiquidityManager")
        );
        vm.serializeAddress(c, "MockExternalRouter", externalRouter);
        vm.serializeAddress(c, "MockStalePool", stalePool);
        string memory contractsJson = vm.serializeAddress(c, "VortexCompounder", compounder);

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeBytes32(
            root, "permAmmPoolId", vm.parseJsonBytes32(existing, ".permAmmPoolId")
        );
        // Carry the published PoolKey through — dropping it here would make it
        // vanish from the final artifact that consumers actually read.
        string memory pk = "poolKey";
        vm.serializeAddress(pk, "currency0", vm.parseJsonAddress(existing, ".permAmmPoolKey.currency0"));
        vm.serializeAddress(pk, "currency1", vm.parseJsonAddress(existing, ".permAmmPoolKey.currency1"));
        vm.serializeUint(pk, "fee", vm.parseJsonUint(existing, ".permAmmPoolKey.fee"));
        vm.serializeInt(pk, "tickSpacing", vm.parseJsonInt(existing, ".permAmmPoolKey.tickSpacing"));
        string memory poolKeyJson =
            vm.serializeAddress(pk, "hooks", vm.parseJsonAddress(existing, ".permAmmPoolKey.hooks"));
        vm.serializeString(root, "permAmmPoolKey", poolKeyJson);
        string memory json = vm.serializeString(root, "contracts", contractsJson);

        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            vm.writeJson(json, string.concat("../../deployments/", vm.toString(block.chainid), ".json"));
        }
    }

    function _writeGrow(
        VortexGrowStrategy memory strategy,
        bytes32 growStrategyHash,
        address compounder,
        address externalRouter
    )
        internal
    {
        string memory s = "strategy";
        vm.serializeAddress(s, "maker", strategy.maker);
        vm.serializeAddress(s, "asset", strategy.asset);
        vm.serializeAddress(s, "bridgeToken", strategy.bridgeToken);
        vm.serializeAddress(s, "externalTarget", strategy.externalTarget);
        vm.serializeAddress(s, "routeSigner", strategy.routeSigner);
        vm.serializeAddress(s, "feeRecipient", strategy.feeRecipient);
        vm.serializeUint(s, "maxAmountPerExecution", strategy.maxAmountPerExecution);
        vm.serializeUint(s, "minProfitBps", strategy.minProfitBps);
        vm.serializeUint(s, "performanceFeeBps", strategy.performanceFeeBps);
        vm.serializeUint(s, "strategyDeadline", strategy.strategyDeadline);
        string memory strategyJson = vm.serializeUint(s, "salt", strategy.salt);

        string memory root = "grow";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeBytes32(root, "growStrategyHash", growStrategyHash);
        vm.serializeAddress(root, "compounder", compounder);
        vm.serializeAddress(root, "externalTarget", externalRouter);
        vm.serializeUint(root, "shippedAsset", SHIPPED_WBTC);
        // Documented so the UI can label the venue honestly (MASTER §21).
        vm.serializeString(root, "externalVenueKind", "SIMULATED");
        vm.serializeUint(root, "externalVenuePriceWholeUsdc", externalWholeUsdc);
        vm.serializeUint(root, "poolMarkWholeUsdc", poolMarkWholeUsdc);
        string memory json = vm.serializeString(root, "strategy", strategyJson);

        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            vm.writeJson(
                json, string.concat("../../deployments/", vm.toString(block.chainid), ".grow.json")
            );
        }
    }
}

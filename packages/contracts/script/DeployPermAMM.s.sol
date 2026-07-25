// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { console } from "forge-std/console.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { IVortexReferenceOracle } from "../src/interfaces/IVortexReferenceOracle.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MockReferenceOracle } from "../src/mocks/MockReferenceOracle.sol";
import { VortexHook } from "../src/permamm/VortexHook.sol";
import { VortexHookDeployer } from "../src/permamm/VortexHookDeployer.sol";
import { VortexLiquidityManager } from "../src/permamm/VortexLiquidityManager.sol";
import { VortexQuoter } from "../src/permamm/VortexQuoter.sol";
import { VortexRouter } from "../src/permamm/VortexRouter.sol";

/// @notice Deploys the Vortex PermAMM stack on the local chain: a real v4
///         PoolManager, the hook at a permission-encoding address, the router,
///         quoter and liquidity manager, then opens and seeds a WBTC/USDC pool.
///
///         Run after DeployLocal (reads deployments/<chainId>.json for tokens
///         and the oracle) and writes the PermAMM addresses back into it.
contract DeployPermAMM is Script {
    uint24 internal constant MIN_SAFETY_FEE_PIPS = 500; // 0.05%
    uint24 internal constant MIN_COMMERCIAL_FEE_PIPS = 100; // 0.01%
    uint24 internal constant MAX_COMMERCIAL_FEE_PIPS = 20_000; // 2%
    int24 internal constant TICK_SPACING = 60;

    function run() external {
        string memory path = string.concat("../../deployments/", vm.toString(block.chainid), ".json");
        string memory deployment = vm.readFile(path);

        MockERC20 wbtc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockWBTC"));
        MockERC20 usdc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockUSDC"));
        MockReferenceOracle oracle =
            MockReferenceOracle(vm.parseJsonAddress(deployment, ".contracts.MockReferenceOracle"));

        (Currency currency0, Currency currency1) = address(wbtc) < address(usdc)
            ? (Currency.wrap(address(wbtc)), Currency.wrap(address(usdc)))
            : (Currency.wrap(address(usdc)), Currency.wrap(address(wbtc)));

        address feeSigner = vm.envOr("FEE_SIGNER", msg.sender);

        vm.startBroadcast();

        // The PoolManager is v4-core's own 0.8.26 artifact; it is deployed by
        // bytecode because no 0.8.30 source may import it (docs/dependencies.md).
        IPoolManager poolManager =
            IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(msg.sender)));

        VortexLiquidityManager liquidityManager = new VortexLiquidityManager(poolManager, msg.sender);
        VortexRouter router = new VortexRouter(poolManager);
        VortexQuoter quoter = new VortexQuoter(poolManager);
        VortexHookDeployer hookDeployer = new VortexHookDeployer();

        VortexHook.HookConfig memory config = VortexHook.HookConfig({
            poolManager: poolManager,
            oracle: IVortexReferenceOracle(address(oracle)),
            liquidityManager: address(liquidityManager),
            initializer: msg.sender,
            feeSigner: feeSigner,
            currency0: currency0,
            currency1: currency1,
            baseIsCurrency0: address(wbtc) < address(usdc),
            minSafetyFeePips: MIN_SAFETY_FEE_PIPS,
            minCommercialFeePips: MIN_COMMERCIAL_FEE_PIPS,
            maxCommercialFeePips: MAX_COMMERCIAL_FEE_PIPS,
            maxPoolDeviationBps: 500,
            maxOracleAge: 1 hours,
            maxOracleSpreadBps: 50
        });

        (bytes32 salt, address expected) = _mineSalt(hookDeployer, config);
        VortexHook hook = hookDeployer.deploy(config, salt, expected);

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });
        poolManager.initialize(key, _oracleSqrtPrice(oracle, address(wbtc) < address(usdc)));

        // Seed the managed position so the pool is immediately quotable.
        wbtc.mint(address(liquidityManager), 1_000_000e8);
        usdc.mint(address(liquidityManager), 100_000_000_000e6);
        liquidityManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(TICK_SPACING),
                tickUpper: TickMath.maxUsableTick(TICK_SPACING),
                liquidityDelta: 1e12,
                salt: bytes32(0)
            })
        );

        vm.stopBroadcast();

        console.log("VortexHook   %s", address(hook));
        console.log("poolId       %s", vm.toString(PoolId.unwrap(key.toId())));

        _write(deployment, address(poolManager), address(hook), address(router), address(quoter),
            address(liquidityManager), PoolId.unwrap(key.toId()));
    }

    /// @dev v4 reads a hook's permissions from its address, so the deployment
    ///      salt must produce an address whose low 14 bits are exactly our flags.
    function _mineSalt(
        VortexHookDeployer hookDeployer,
        VortexHook.HookConfig memory config
    )
        internal
        view
        returns (bytes32 salt, address expected)
    {
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        );

        // Mined inline: an external computeAddress call per candidate would be
        // thousands of times slower for the same arithmetic.
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(VortexHook).creationCode, abi.encode(config)));

        for (uint256 i = 0; i < 500_000; i++) {
            bytes32 candidate = bytes32(i);
            address predicted = address(
                uint160(
                    uint256(
                        keccak256(abi.encodePacked(bytes1(0xff), address(hookDeployer), candidate, initCodeHash))
                    )
                )
            );
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == flags) {
                return (candidate, predicted);
            }
        }
        revert("no salt found for the required hook flags");
    }

    function _oracleSqrtPrice(
        MockReferenceOracle oracle,
        bool wbtcIsCurrency0
    )
        internal
        view
        returns (uint160)
    {
        uint256 midE18 = oracle.latestPrice().midPriceE18;
        // WBTC has 8 decimals, USDC 6: currency1-per-currency0 in raw units.
        uint256 priceE18 = wbtcIsCurrency0 ? midE18 / 1e2 : (1e36 / (midE18 / 1e2));
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

    function _write(
        string memory existing,
        address poolManager,
        address hook,
        address router,
        address quoter,
        address liquidityManager,
        bytes32 poolId
    )
        internal
    {
        string memory contracts = "contracts";
        // Preserve what DeployLocal already published.
        vm.serializeAddress(contracts, "Aqua", vm.parseJsonAddress(existing, ".contracts.Aqua"));
        vm.serializeAddress(
            contracts, "AquaSwapVMRouter", vm.parseJsonAddress(existing, ".contracts.AquaSwapVMRouter")
        );
        vm.serializeAddress(contracts, "MockWBTC", vm.parseJsonAddress(existing, ".contracts.MockWBTC"));
        vm.serializeAddress(contracts, "MockUSDC", vm.parseJsonAddress(existing, ".contracts.MockUSDC"));
        vm.serializeAddress(contracts, "MockWETH", vm.parseJsonAddress(existing, ".contracts.MockWETH"));
        vm.serializeAddress(
            contracts, "MockReferenceOracle", vm.parseJsonAddress(existing, ".contracts.MockReferenceOracle")
        );
        vm.serializeAddress(
            contracts, "VortexAquaPricing", vm.parseJsonAddress(existing, ".contracts.VortexAquaPricing")
        );
        vm.serializeAddress(
            contracts,
            "VortexAquaOrderBuilder",
            vm.parseJsonAddress(existing, ".contracts.VortexAquaOrderBuilder")
        );
        vm.serializeAddress(
            contracts, "VortexAquaLens", vm.parseJsonAddress(existing, ".contracts.VortexAquaLens")
        );
        vm.serializeAddress(contracts, "PoolManager", poolManager);
        vm.serializeAddress(contracts, "VortexHook", hook);
        vm.serializeAddress(contracts, "VortexRouter", router);
        vm.serializeAddress(contracts, "VortexQuoter", quoter);
        string memory contractsJson = vm.serializeAddress(contracts, "VortexLiquidityManager", liquidityManager);

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeBytes32(root, "permAmmPoolId", poolId);
        string memory json = vm.serializeString(root, "contracts", contractsJson);

        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            vm.writeJson(json, string.concat("../../deployments/", vm.toString(block.chainid), ".json"));
        }
    }
}

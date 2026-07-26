// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { VmSafe } from "forge-std/Vm.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { AquaSwapVMRouter } from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";

import { VortexAquaLens } from "../src/aqua/VortexAquaLens.sol";
import { VortexAquaOrderBuilder } from "../src/aqua/VortexAquaOrderBuilder.sol";
import { VortexAquaPricing } from "../src/aqua/VortexAquaPricing.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MockReferenceOracle } from "../src/mocks/MockReferenceOracle.sol";

import { DemoPrice } from "./DemoPrice.sol";
import { MockUSDC } from "../src/mocks/MockUSDC.sol";
import { MockWBTC } from "../src/mocks/MockWBTC.sol";

/// @notice Deploys official Aqua + official AquaSwapVMRouter + the Vortex Swap
///         stack, and writes addresses to deployments/<chainId>.json.
///
/// @dev Tokens default to freshly deployed mocks (offline, deterministic). Set
///      `WBTC_ADDRESS` / `USDC_ADDRESS` / `WETH_ADDRESS` to run against tokens
///      that already exist — the Arbitrum-fork demo needs real WBTC/USDC so the
///      Uniswap Trade API can quote the same assets Vortex settles. Mocks are
///      mintable and real tokens are not, so anything downstream that funds an
///      account must check `USE_REAL_TOKENS` rather than assume it can mint.
contract DeployLocal is Script {
    function run() external {
        address wbtcOverride = vm.envOr("WBTC_ADDRESS", address(0));
        address usdcOverride = vm.envOr("USDC_ADDRESS", address(0));
        address wethOverride = vm.envOr("WETH_ADDRESS", address(0));

        vm.startBroadcast();

        Aqua aqua = new Aqua();
        address wbtc = wbtcOverride == address(0) ? address(new MockWBTC()) : wbtcOverride;
        address usdc = usdcOverride == address(0) ? address(new MockUSDC()) : usdcOverride;
        address weth = wethOverride == address(0)
            ? address(new MockERC20("Wrapped Ether", "WETH", 18))
            : wethOverride;
        AquaSwapVMRouter router =
            new AquaSwapVMRouter(address(aqua), weth, msg.sender, "AquaSwapVMRouter", "1.0.1");

        // Vortex Swap stack (Phase 2).
        MockReferenceOracle oracle = new MockReferenceOracle(msg.sender);
        oracle.setPrice(DemoPrice.midE18(), DemoPrice.bidE18(), DemoPrice.askE18());
        VortexAquaPricing pricing = new VortexAquaPricing(address(router), IAqua(address(aqua)));
        VortexAquaOrderBuilder orderBuilder = new VortexAquaOrderBuilder(pricing);
        VortexAquaLens lens = new VortexAquaLens(IAqua(address(aqua)), address(router), pricing);

        vm.stopBroadcast();

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        string memory contracts = "contracts";
        vm.serializeAddress(contracts, "Aqua", address(aqua));
        vm.serializeAddress(contracts, "MockWBTC", wbtc);
        vm.serializeAddress(contracts, "MockUSDC", usdc);
        vm.serializeAddress(contracts, "MockWETH", weth);
        vm.serializeAddress(contracts, "MockReferenceOracle", address(oracle));
        vm.serializeAddress(contracts, "VortexAquaPricing", address(pricing));
        vm.serializeAddress(contracts, "VortexAquaOrderBuilder", address(orderBuilder));
        vm.serializeAddress(contracts, "VortexAquaLens", address(lens));
        string memory contractsJson = vm.serializeAddress(contracts, "AquaSwapVMRouter", address(router));
        string memory json = vm.serializeString(root, "contracts", contractsJson);

        // Only a real broadcast may rewrite the committed deployment file —
        // dry runs and tests must not clobber it with unbroadcast addresses.
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            string memory fileName =
                vm.envOr("DEPLOY_OUT", string.concat(vm.toString(block.chainid), ".json"));
            vm.writeJson(json, string.concat("../../deployments/", fileName));
        }
    }
}

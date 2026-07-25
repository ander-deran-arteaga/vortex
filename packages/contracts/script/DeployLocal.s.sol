// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { AquaSwapVMRouter } from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";

import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MockUSDC } from "../src/mocks/MockUSDC.sol";
import { MockWBTC } from "../src/mocks/MockWBTC.sol";

/// @notice Deterministic local deployment: official Aqua + official
///         AquaSwapVMRouter + WBTC/USDC/WETH mocks. Writes addresses to
///         deployments/<chainId>.json for the api/web workspaces.
contract DeployLocal is Script {
    function run() external {
        vm.startBroadcast();

        Aqua aqua = new Aqua();
        MockWBTC wbtc = new MockWBTC();
        MockUSDC usdc = new MockUSDC();
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        AquaSwapVMRouter router =
            new AquaSwapVMRouter(address(aqua), address(weth), msg.sender, "AquaSwapVMRouter", "1.0.1");

        vm.stopBroadcast();

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        string memory contracts = "contracts";
        vm.serializeAddress(contracts, "Aqua", address(aqua));
        vm.serializeAddress(contracts, "MockWBTC", address(wbtc));
        vm.serializeAddress(contracts, "MockUSDC", address(usdc));
        vm.serializeAddress(contracts, "MockWETH", address(weth));
        string memory contractsJson = vm.serializeAddress(contracts, "AquaSwapVMRouter", address(router));
        string memory json = vm.serializeString(root, "contracts", contractsJson);

        vm.writeJson(json, string.concat("../../deployments/", vm.toString(block.chainid), ".json"));
    }
}

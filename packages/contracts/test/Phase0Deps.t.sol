// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { AquaSwapVMRouter } from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MockUSDC } from "../src/mocks/MockUSDC.sol";
import { MockWBTC } from "../src/mocks/MockWBTC.sol";

/// @notice Phase 0 exit gate: every pinned dependency resolves, compiles, and deploys.
contract Phase0DepsTest is Test {
    function test_pinnedDependenciesDeploy() public {
        Aqua aqua = new Aqua();
        assertGt(address(aqua).code.length, 0);

        MockWBTC wbtc = new MockWBTC();
        MockUSDC usdc = new MockUSDC();
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        assertEq(wbtc.decimals(), 8);
        assertEq(usdc.decimals(), 6);

        AquaSwapVMRouter router = new AquaSwapVMRouter(
            address(aqua),
            address(weth),
            address(this),
            "AquaSwapVMRouter",
            "1.0.1"
        );
        assertGt(address(router).code.length, 0);

        // v4-core interface is importable; full PoolManager lands in Phase 5.
        assertEq(type(IPoolManager).interfaceId, type(IPoolManager).interfaceId);
    }

    function test_aquaVirtualBalanceBookkeeping() public {
        Aqua aqua = new Aqua();
        MockWBTC wbtc = new MockWBTC();

        address app = makeAddr("app");
        address[] memory tokens = new address[](1);
        tokens[0] = address(wbtc);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e8;

        bytes32 strategyHash = aqua.ship(app, abi.encode("vortex-smoke"), tokens, amounts);
        (uint248 balance, uint8 tokensCount) = aqua.rawBalances(address(this), app, strategyHash, address(wbtc));
        assertEq(balance, 1e8);
        assertEq(tokensCount, 1);
    }
}

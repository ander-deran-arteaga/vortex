// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { IVortexReferenceOracle } from "../src/interfaces/IVortexReferenceOracle.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";

/// @notice Read-only pre-flight: is the demo chain actually ready to be shown?
///
/// @dev Run this immediately before a judged run. It is read-only and takes a
///      second. It exists because two of these conditions are *silent* — the
///      chain looks healthy and every contract is deployed, but the first
///      transaction of the demo reverts or the headline scene shows the maker
///      losing.
///
///      The oracle staleness check is the important one. Vortex Swap pricing
///      rejects an oracle older than `maxOracleAge` (1 hour). Anvil stamps each
///      new block with wall-clock time, so a chain that has been idle for over
///      an hour still *reads* fresh — until the demo's first transaction mines
///      a block and every quote starts reverting `VortexStaleOracle`. Refresh
///      with `SetDemoScenario.s.sol`, which re-stamps the price.
contract CheckDemoReady is Script {
    uint256 internal constant MAX_ORACLE_AGE = 1 hours;
    uint256 internal constant COMPETITIVE_MID_E18 = 100_000e18;

    function run() external {
        string memory deployment = vm.readFile(
            string.concat(
                "../../deployments/",
                vm.envOr("DEPLOY_OUT", string.concat(vm.toString(block.chainid), ".json"))
            )
        );
        string memory demo = vm.readFile(
            string.concat(
                "../../deployments/",
                vm.envOr("SEED_OUT", string.concat(vm.toString(block.chainid), ".demo.json"))
            )
        );

        uint256 failures = 0;
        console.log("=== Vortex demo pre-flight (chain %s) ===", block.chainid);

        failures += _checkContracts(deployment);
        failures += _checkOracle(deployment);
        failures += _checkStrategy(deployment, demo);

        console.log("");
        if (failures == 0) {
            console.log("READY: demo chain is judge-ready.");
        } else {
            console.log("NOT READY: %s check(s) need attention before demoing.", failures);
        }
        require(failures == 0, "demo chain is not ready; see the checks above");
    }

    function _checkContracts(string memory deployment) private view returns (uint256 failures) {
        string[6] memory required = [
            "Aqua",
            "AquaSwapVMRouter",
            "VortexAquaPricing",
            "VortexHook",
            "VortexRouter",
            "VortexCompounder"
        ];
        for (uint256 i = 0; i < required.length; i++) {
            address a = vm.parseJsonAddress(deployment, string.concat(".contracts.", required[i]));
            if (a.code.length == 0) {
                console.log("  FAIL  %s has no bytecode at %s", required[i], a);
                failures++;
            }
        }
        if (failures == 0) console.log("  ok    core contracts deployed");
    }

    function _checkOracle(string memory deployment) private returns (uint256 failures) {
        IVortexReferenceOracle oracle =
            IVortexReferenceOracle(vm.parseJsonAddress(deployment, ".contracts.MockReferenceOracle"));
        IVortexReferenceOracle.PriceData memory p = oracle.latestPrice();

        // Measure against WALL CLOCK, not block.timestamp.
        //
        // On an idle chain `block.timestamp` is frozen at the last mined block,
        // so an oracle set hours ago reads "0 s old" — and this check happily
        // reported READY for a chain whose very next transaction would revert
        // every quote. The next block stamps wall-clock time, so wall clock is
        // what the demo will actually be judged against. This exact blind spot
        // was live in this file: chain 4419 s behind real time, oracle reported
        // fresh, and the first demo transaction would have gone stale.
        uint256 wallNow = vm.unixTime() / 1000;
        uint256 chainNow = block.timestamp;
        uint256 age = (wallNow > chainNow ? wallNow : chainNow) - uint256(p.updatedAt);
        if (wallNow > chainNow + 60) {
            console.log("  note  chain clock is %s s behind wall time; ages measured against wall time", wallNow - chainNow);
        }
        if (age >= MAX_ORACLE_AGE) {
            console.log("  FAIL  oracle is STALE (%s s old, limit %s)", age, MAX_ORACLE_AGE);
            console.log("        every Vortex Swap quote will revert VortexStaleOracle");
            console.log("        fix: SCENARIO=AQUA_WINS forge script script/SetDemoScenario.s.sol --broadcast ...");
            failures++;
        } else if (age >= (MAX_ORACLE_AGE * 3) / 4) {
            // The demo's own transactions advance the clock, so "nearly stale"
            // becomes "stale mid-demo".
            console.log("  WARN  oracle is %s s old of %s allowed - refresh before demoing", age, MAX_ORACLE_AGE);
            failures++;
        } else {
            console.log("  ok    oracle fresh (%s s old)", age);
        }

        if (p.midPriceE18 != COMPETITIVE_MID_E18) {
            console.log("  WARN  maker is NOT on the competitive baseline (mid %s e18)", p.midPriceE18 / 1e18);
            console.log("        the headline best-execution scene will show Aqua losing, and");
            console.log("        ~300 of the hook's 500 bps deviation budget is spent, so Grow");
            console.log("        can revert in beforeSwap once the pool price has drifted");
            console.log("        fix: SCENARIO=AQUA_WINS forge script script/SetDemoScenario.s.sol --broadcast ...");
            failures++;
        } else {
            console.log("  ok    maker on the competitive baseline (mid 100000)");
        }
    }

    function _checkStrategy(
        string memory deployment,
        string memory demo
    )
        private
        view
        returns (uint256 failures)
    {
        IAqua aqua = IAqua(vm.parseJsonAddress(deployment, ".contracts.Aqua"));
        address router = vm.parseJsonAddress(deployment, ".contracts.AquaSwapVMRouter");
        address maker = vm.parseJsonAddress(demo, ".maker");
        bytes32 strategyHash = vm.parseJsonBytes32(demo, ".strategyHash");
        address wbtc = vm.parseJsonAddress(deployment, ".contracts.MockWBTC");
        address usdc = vm.parseJsonAddress(deployment, ".contracts.MockUSDC");

        (uint248 virtualWbtc,) = aqua.rawBalances(maker, router, strategyHash, wbtc);
        (uint248 virtualUsdc,) = aqua.rawBalances(maker, router, strategyHash, usdc);
        if (virtualWbtc == 0 || virtualUsdc == 0) {
            console.log("  FAIL  seeded Vortex Swap strategy has no inventory - re-seed");
            failures++;
        } else {
            console.log("  ok    swap strategy inventory: %s sats / %s usdc-units", virtualWbtc, virtualUsdc);
        }

        // Virtual balances are not collateral: the maker must actually hold and
        // have approved what the strategy promises, or fills revert at settlement.
        uint256 wallet = MockERC20(usdc).balanceOf(maker);
        uint256 allowed = MockERC20(usdc).allowance(maker, address(aqua));
        if (wallet < virtualUsdc || allowed < virtualUsdc) {
            console.log("  WARN  maker cannot fully cover the USDC side (wallet %s, allowance %s)", wallet, allowed);
            console.log("        large fills will revert at settlement rather than under-deliver");
            failures++;
        } else {
            console.log("  ok    maker covers the quoted side");
        }
    }
}

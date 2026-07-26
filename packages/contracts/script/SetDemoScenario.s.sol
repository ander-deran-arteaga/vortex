// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { MockReferenceOracle } from "../src/mocks/MockReferenceOracle.sol";

import { DemoPrice } from "./DemoPrice.sol";

/// @notice Moves the reference oracle so the venue comparison flips on demand,
///         for the judge demo.
///
/// @dev This makes the maker genuinely price better or worse — it does NOT
///      fake a comparison. Vortex Swap quotes off this oracle, so a lower mark
///      means the maker really does pay less for WBTC, and a correct comparator
///      will then choose Uniswap on the numbers. Nothing here touches the
///      comparator, the API, or any displayed value.
///
///      Usage (the oracle owner must be the caller — the deployer by default):
///        SCENARIO=AQUA_WINS    forge script script/SetDemoScenario.s.sol --broadcast ...
///        SCENARIO=UNISWAP_WINS forge script script/SetDemoScenario.s.sol --broadcast ...
///        SCENARIO=REFRESH      re-stamps the CURRENT price, changing no number
///
///      `REFRESH` exists because staleness is a clock problem, not a pricing
///      one: an idle chain reports a fresh oracle until its next mined block
///      carries wall-clock time, and then every quote reverts VortexStaleOracle.
///      `scripts/ensure-demo.sh` calls it automatically when the oracle is
///      close to the limit, which is why nobody has to remember this command.
///
///      Bounds that keep the rest of the system honest while this moves:
///      - the bid/ask spread stays at 10 bps, under VortexAquaPricing's 50 bps
///        `maxOracleSpreadBps`, so quotes stay valid rather than reverting;
///      - the mark moves at most 3%, under VortexHook's 500 bps
///        `maxPoolDeviationBps`, so the PermAMM pool and Vortex Grow keep
///        working at the same time.
contract SetDemoScenario is Script {
    function run() external {
        string memory path = string.concat(
            "../../deployments/",
            vm.envOr("DEPLOY_OUT", string.concat(vm.toString(block.chainid), ".json"))
        );
        MockReferenceOracle oracle =
            MockReferenceOracle(vm.parseJsonAddress(vm.readFile(path), ".contracts.MockReferenceOracle"));

        string memory scenario = vm.envOr("SCENARIO", string("AQUA_WINS"));

        uint256 mid;
        uint256 bid;
        uint256 ask;
        if (keccak256(bytes(scenario)) == keccak256("REFRESH")) {
            // Re-stamp the CURRENT price rather than imposing a scenario. An
            // idle chain goes stale on its next mined block, and the fix must
            // not silently drag a deliberate UNISWAP_WINS back to the
            // competitive mark in the middle of a demo.
            MockReferenceOracle.PriceData memory p = oracle.latestPrice();
            (mid, bid, ask) = (p.midPriceE18, p.bidPriceE18, p.askPriceE18);
        } else {
            mid = _midFor(scenario);
            bid = mid - (mid * DemoPrice.HALF_SPREAD_BPS) / 10_000;
            ask = mid + (mid * DemoPrice.HALF_SPREAD_BPS) / 10_000;
        }

        vm.startBroadcast();
        oracle.setPrice(mid, bid, ask);
        vm.stopBroadcast();

        console.log("scenario  %s", scenario);
        console.log("mid       %s", mid / 1e18);
        console.log("bid / ask %s / %s", bid / 1e18, ask / 1e18);

        // The de-tuned mark eats most of the PermAMM hook's pool-vs-oracle
        // deviation headroom: it moves the mark 300 bps against a 500 bps cap,
        // leaving ~200 bps. Grow's first leg swaps that same pool, so on a
        // fresh chain it still succeeds — but once trading has drifted the pool
        // price by more than the remaining headroom, Grow reverts in
        // beforeSwap. Measured, not assumed: Grow completes under this scenario
        // on a freshly bootstrapped chain.
        if (mid != DemoPrice.midE18()) {
            console.log("");
            console.log("WARNING: this scenario uses ~300 bps of the PermAMM hook's 500 bps");
            console.log("  pool-vs-oracle deviation budget, leaving ~200 bps.");
            console.log("  Vortex Grow's first leg swaps that pool. It still works on a fresh");
            console.log("  chain, but once trading has drifted the pool price it will revert");
            console.log("  in beforeSwap (VortexPoolDeviationTooLarge, 0x93830b27).");
            console.log("  Reset before demoing Grow:");
            console.log("  SCENARIO=AQUA_WINS forge script script/SetDemoScenario.s.sol --broadcast ...");
        }
    }

    function _midFor(string memory scenario) internal pure returns (uint256) {
        bytes32 key = keccak256(bytes(scenario));
        if (key == keccak256("AQUA_WINS")) return DemoPrice.midE18();
        if (key == keccak256("UNISWAP_WINS")) return DemoPrice.uniswapWinsMidE18();
        revert("SCENARIO must be AQUA_WINS or UNISWAP_WINS");
    }
}

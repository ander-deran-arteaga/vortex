// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { MockReferenceOracle } from "../src/mocks/MockReferenceOracle.sol";

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
///
///      Bounds that keep the rest of the system honest while this moves:
///      - the bid/ask spread stays at 10 bps, under VortexAquaPricing's 50 bps
///        `maxOracleSpreadBps`, so quotes stay valid rather than reverting;
///      - the mark moves at most 3%, under VortexHook's 500 bps
///        `maxPoolDeviationBps`, so the PermAMM pool and Vortex Grow keep
///        working at the same time.
contract SetDemoScenario is Script {
    /// @dev Competitive: the maker marks WBTC where the market is.
    uint256 internal constant AQUA_WINS_MID = 100_000e18;
    /// @dev Uncompetitive: the maker marks WBTC 3% low, so it really is the
    ///      worse venue and a correct router must route away from us.
    uint256 internal constant UNISWAP_WINS_MID = 97_000e18;

    /// @dev 10 bps total, symmetric around the mid.
    uint256 internal constant HALF_SPREAD_BPS = 5;

    function run() external {
        string memory path = string.concat(
            "../../deployments/",
            vm.envOr("DEPLOY_OUT", string.concat(vm.toString(block.chainid), ".json"))
        );
        MockReferenceOracle oracle =
            MockReferenceOracle(vm.parseJsonAddress(vm.readFile(path), ".contracts.MockReferenceOracle"));

        string memory scenario = vm.envOr("SCENARIO", string("AQUA_WINS"));
        uint256 mid = _midFor(scenario);

        uint256 bid = mid - (mid * HALF_SPREAD_BPS) / 10_000;
        uint256 ask = mid + (mid * HALF_SPREAD_BPS) / 10_000;

        vm.startBroadcast();
        oracle.setPrice(mid, bid, ask);
        vm.stopBroadcast();

        console.log("scenario  %s", scenario);
        console.log("mid       %s", mid / 1e18);
        console.log("bid / ask %s / %s", bid / 1e18, ask / 1e18);
    }

    function _midFor(string memory scenario) internal pure returns (uint256) {
        bytes32 key = keccak256(bytes(scenario));
        if (key == keccak256("AQUA_WINS")) return AQUA_WINS_MID;
        if (key == keccak256("UNISWAP_WINS")) return UNISWAP_WINS_MID;
        revert("SCENARIO must be AQUA_WINS or UNISWAP_WINS");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { DemoPrice } from "./DemoPrice.sol";

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
///      It covers both products. A strategy is Aqua *state*, not a contract,
///      so "every address has bytecode" is not readiness: Swap and Grow are
///      shipped separately and either can be missing on a fully deployed chain.
///
///      The oracle staleness check is the important one. Vortex Swap pricing
///      rejects an oracle older than `maxOracleAge` (1 hour). Anvil stamps each
///      new block with wall-clock time, so a chain that has been idle for over
///      an hour still *reads* fresh — until the demo's first transaction mines
///      a block and every quote starts reverting `VortexStaleOracle`. Refresh
///      with `SetDemoScenario.s.sol`, which re-stamps the price.
/// @dev Minimal view into PoolManager's transient-free storage. Declared here
///      rather than imported so this script stays on 0.8.30 while v4-core's
///      PoolManager.sol compiles under its own 0.8.26 profile.
interface IExtsload {
    function extsload(bytes32 slot) external view returns (bytes32);
}

contract CheckDemoReady is Script {
    uint256 internal constant MAX_ORACLE_AGE = 1 hours;
    /// @dev Aqua marks a docked strategy with this token count.
    uint8 internal constant DOCKED = 0xff;
    /// @dev v4-core PoolManager's `POOLS_SLOT`. A wrong value yields a nonsense
    ///      price, which the sanity bound below rejects rather than reporting.
    uint256 internal constant POOLS_SLOT = 6;
    uint256 internal constant Q96 = 1 << 96;
    /// @dev Grow arbitrages the PermAMM pool against the external venue, and
    ///      every cycle moves the pool closer to it, so the edge is a consumable
    ///      resource. Measured on this demo: 526 bps at deploy, ~57 bps consumed
    ///      per cycle, and the scanner stops finding work around 75 bps. Warn
    ///      with a couple of cycles still in hand rather than at the cliff.
    uint256 internal constant MIN_GROW_EDGE_BPS = 150;

    function run() external view {
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
        failures += _checkGrowStrategy(deployment);

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

    function _checkOracle(string memory deployment) private view returns (uint256 failures) {
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
            console.log("        every Vortex Swap quote and Grow cycle reverts VortexStaleOracle");
            console.log("        fix: ./scripts/ensure-demo.sh - it re-stamps at the same price");
            failures++;
        } else if (age >= (MAX_ORACLE_AGE * 3) / 4) {
            // The demo's own transactions advance the clock, so "nearly stale"
            // becomes "stale mid-demo".
            console.log("  WARN  oracle is %s s old of %s allowed - run ./scripts/ensure-demo.sh", age, MAX_ORACLE_AGE);
            failures++;
        } else {
            console.log("  ok    oracle fresh (%s s old)", age);
        }

        if (p.midPriceE18 != DemoPrice.midE18()) {
            console.log("  WARN  maker is NOT on the competitive baseline (mid %s e18)", p.midPriceE18 / 1e18);
            console.log("        the headline best-execution scene will show Aqua losing, and");
            console.log("        ~300 of the hook's 500 bps deviation budget is spent, so Grow");
            console.log("        can revert in beforeSwap once the pool price has drifted");
            console.log("        fix: SCENARIO=AQUA_WINS forge script script/SetDemoScenario.s.sol --broadcast ...");
            failures++;
        } else {
            console.log("  ok    maker on the competitive baseline (mid %s)", DemoPrice.WBTC_USD_WHOLE);
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

    /// @dev Vortex Grow's profit comes from the gap between the PermAMM pool and
    ///      the external venue, and each cycle narrows it — the demo arbitrages
    ///      away its own opportunity. Once the gap no longer clears the maker's
    ///      `minProfitBps`, the scanner answers `CYCLE_NOT_PROFITABLE`, which is
    ///      correct behaviour that looks exactly like a broken demo. Nothing
    ///      else on the chain changes, so this is invisible without measuring.
    function _checkGrowEdge(
        string memory deployment,
        string memory grow
    )
        private
        view
        returns (uint256 failures)
    {
        address poolManager = vm.parseJsonAddress(deployment, ".contracts.PoolManager");
        bytes32 poolId = vm.parseJsonBytes32(deployment, ".permAmmPoolId");
        address currency0 = vm.parseJsonAddress(deployment, ".permAmmPoolKey.currency0");
        address currency1 = vm.parseJsonAddress(deployment, ".permAmmPoolKey.currency1");
        uint256 externalWhole = vm.parseJsonUint(grow, ".externalVenuePriceWholeUsdc");

        uint256 sqrtPriceX96 =
            uint256(uint160(uint256(IExtsload(poolManager).extsload(_slot0Key(poolId)))));
        if (sqrtPriceX96 == 0 || externalWhole == 0) {
            console.log("  note  could not read the PermAMM pool price - skipping the Grow edge check");
            return 0;
        }

        // currency1 per currency0, in raw units, e18-scaled.
        uint256 priceE18 = Math.mulDiv(Math.mulDiv(sqrtPriceX96, sqrtPriceX96, Q96), 1e18, Q96);
        uint8 dec0 = MockERC20(currency0).decimals();
        uint8 dec1 = MockERC20(currency1).decimals();
        if (priceE18 == 0 || dec1 < dec0) {
            console.log("  note  unexpected pool orientation - skipping the Grow edge check");
            return 0;
        }
        // Invert into whole quote units per whole base unit, e.g. USDC per WBTC.
        uint256 poolWhole = Math.mulDiv(10 ** (dec1 - dec0), 1e18, priceE18);

        uint256 diff = poolWhole > externalWhole ? poolWhole - externalWhole : externalWhole - poolWhole;
        uint256 edgeBps = Math.mulDiv(diff, 10_000, externalWhole);
        if (edgeBps < MIN_GROW_EDGE_BPS) {
            console.log("  WARN  Grow's edge is nearly spent: pool %s vs venue %s (%s bps)", poolWhole, externalWhole, edgeBps);
            console.log("        cycles have arbitraged the pool toward the venue, which is correct");
            console.log("        behaviour - but the next scan will answer CYCLE_NOT_PROFITABLE");
            console.log("        fix: FRESH=1 ./scripts/verify-demo.sh rebuilds the chain and the edge");
            return 1;
        }
        console.log("  ok    grow edge %s bps (pool %s vs venue %s)", edgeBps, poolWhole, externalWhole);
    }

    function _slot0Key(bytes32 poolId) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(poolId, POOLS_SLOT));
    }

    /// @dev Vortex Grow ships a **single** asset, so the balance must be read
    ///      for the token the strategy itself names. Asking a single-asset
    ///      strategy about a token pair makes Aqua revert
    ///      `SafeBalancesForTokenNotInActiveStrategy`, which means "active, but
    ///      does not hold that token" — a different fact from "no strategy".
    ///      `rawBalances` returns rather than reverts, so it cannot be confused
    ///      with a missing strategy at all.
    function _checkGrowStrategy(string memory deployment) private view returns (uint256 failures) {
        string memory path =
            string.concat("../../deployments/", vm.toString(block.chainid), ".grow.json");
        if (!vm.exists(path)) {
            console.log("  note  no Grow artifact for chain %s - skipping Grow checks", block.chainid);
            return 0;
        }
        string memory grow = vm.readFile(path);

        IAqua aqua = IAqua(vm.parseJsonAddress(deployment, ".contracts.Aqua"));
        address compounder = vm.parseJsonAddress(deployment, ".contracts.VortexCompounder");
        address maker = vm.parseJsonAddress(grow, ".strategy.maker");
        address asset = vm.parseJsonAddress(grow, ".strategy.asset");
        bytes32 growHash = vm.parseJsonBytes32(grow, ".growStrategyHash");

        (uint248 shippedAsset, uint8 tokensCount) = aqua.rawBalances(maker, compounder, growHash, asset);
        if (tokensCount == DOCKED) {
            console.log("  FAIL  Grow strategy is DOCKED - its hash is spent, Grow will not execute");
            console.log("        fix: re-seed with a new salt, then ./scripts/ensure-demo.sh");
            return 1;
        }
        if (tokensCount == 0 || shippedAsset == 0) {
            // The Addendum 23 failure: every contract has bytecode, so the
            // chain looks deployed, and only Grow's quotes fail.
            console.log("  FAIL  Grow strategy was never shipped into Aqua");
            console.log("        VortexCompounder is deployed, so the chain LOOKS ready; Grow");
            console.log("        quotes will answer STRATEGY_NOT_FOUND until it is shipped");
            console.log("        fix: ./scripts/ensure-demo.sh - it ships what is missing, safe to re-run");
            return 1;
        }
        console.log("  ok    grow strategy shipped: %s sats of %s", shippedAsset, asset);
        failures += _checkGrowEdge(deployment, grow);

        // Same rule as the swap side: virtual balances are not collateral.
        uint256 wallet = MockERC20(asset).balanceOf(maker);
        uint256 allowed = MockERC20(asset).allowance(maker, address(aqua));
        if (wallet < shippedAsset || allowed < shippedAsset) {
            console.log("  WARN  maker cannot cover the Grow position (wallet %s, allowance %s)", wallet, allowed);
            console.log("        the compounding pull will revert rather than under-deliver");
            return 1;
        }
        console.log("  ok    maker covers the Grow position");
    }
}

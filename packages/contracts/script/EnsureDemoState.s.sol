// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraits } from "@1inch/swap-vm/src/libs/MakerTraits.sol";

import { VortexCompoundRouteLib, VortexGrowStrategy } from "../src/compound/VortexCompoundTypes.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";

/// @notice Idempotent: brings the demo chain's Aqua *state* up to scratch and
///         is safe to run any number of times.
///
/// @dev Deploying the contracts and shipping the strategies are separable
///      steps, so a partial bring-up leaves a chain that looks fully deployed —
///      every address has bytecode — while `STRATEGY_NOT_FOUND` is the only
///      symptom. A strategy is Aqua *state*, not a contract.
///
///      Aqua strategies are immutable: re-shipping one reverts with
///      `StrategiesMustBeImmutable`. So this checks `rawBalances().tokensCount`
///      first and only ships what is genuinely missing:
///        0     never shipped        -> ship it
///        0xff  docked               -> report; the hash is spent, re-seed needed
///        other already active       -> leave alone
///
///      Run after the deploy scripts. `scripts/ensure-demo.sh` wraps both.
contract EnsureDemoState is Script {
    uint8 internal constant DOCKED = 0xff;

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
        string memory grow =
            vm.readFile(string.concat("../../deployments/", vm.toString(block.chainid), ".grow.json"));

        Aqua aqua = Aqua(vm.parseJsonAddress(deployment, ".contracts.Aqua"));
        MockERC20 wbtc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockWBTC"));
        MockERC20 usdc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockUSDC"));

        console.log("=== ensuring Aqua state on chain %s ===", block.chainid);
        uint256 actions = 0;
        actions += _ensureSwapStrategy(aqua, deployment, demo, wbtc, usdc);
        actions += _ensureGrowStrategy(aqua, deployment, grow, wbtc);

        console.log("");
        if (actions == 0) {
            console.log("nothing to do: both strategies already shipped and funded.");
        } else {
            console.log("%s action(s) taken.", actions);
        }
    }

    function _ensureSwapStrategy(
        Aqua aqua,
        string memory deployment,
        string memory demo,
        MockERC20 wbtc,
        MockERC20 usdc
    )
        private
        returns (uint256 actions)
    {
        address router = vm.parseJsonAddress(deployment, ".contracts.AquaSwapVMRouter");
        address maker = vm.parseJsonAddress(demo, ".maker");
        bytes32 hash = vm.parseJsonBytes32(demo, ".strategyHash");
        uint256 baseAmount = vm.parseJsonUint(demo, ".baseShipped");
        uint256 quoteAmount = vm.parseJsonUint(demo, ".quoteShipped");

        (, uint8 tokensCount) = aqua.rawBalances(maker, router, hash, address(wbtc));
        if (tokensCount == DOCKED) {
            console.log("  DOCKED  swap strategy %s is docked; its hash is spent", vm.toString(hash));
            console.log("          re-seed with a new salt (SeedDemo.s.sol, DEMO_SALT=<n>)");
            return 0;
        }
        if (tokensCount > 0) {
            console.log("  ok      swap strategy already shipped");
            return 0;
        }

        console.log("  SHIP    swap strategy %s was never shipped", vm.toString(hash));
        ISwapVM.Order memory order = ISwapVM.Order({
            maker: maker,
            traits: MakerTraits.wrap(uint256(vm.parseJsonBytes32(demo, ".order.traits"))),
            data: vm.parseJsonBytes(demo, ".order.data")
        });

        uint256 makerKey = _makerKey();
        _fundAndApprove(wbtc, maker, makerKey, baseAmount, address(aqua));
        _fundAndApprove(usdc, maker, makerKey, quoteAmount, address(aqua));

        address[] memory tokens = new address[](2);
        tokens[0] = address(wbtc);
        tokens[1] = address(usdc);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = baseAmount;
        amounts[1] = quoteAmount;

        vm.startBroadcast(makerKey);
        bytes32 shipped = aqua.ship(router, abi.encode(order), tokens, amounts);
        vm.stopBroadcast();
        require(shipped == hash, "ensure: swap strategy hash mismatch (stale artifact?)");
        console.log("          shipped, %s sats / %s usdc-units", baseAmount, quoteAmount);
        return 1;
    }

    function _ensureGrowStrategy(
        Aqua aqua,
        string memory deployment,
        string memory grow,
        MockERC20 wbtc
    )
        private
        returns (uint256 actions)
    {
        address compounder = vm.parseJsonAddress(deployment, ".contracts.VortexCompounder");
        bytes32 hash = vm.parseJsonBytes32(grow, ".growStrategyHash");
        address maker = vm.parseJsonAddress(grow, ".strategy.maker");
        uint256 amount = vm.parseJsonUint(grow, ".shippedAsset");

        (, uint8 tokensCount) = aqua.rawBalances(maker, compounder, hash, address(wbtc));
        if (tokensCount == DOCKED) {
            console.log("  DOCKED  grow strategy %s is docked; its hash is spent", vm.toString(hash));
            return 0;
        }
        if (tokensCount > 0) {
            console.log("  ok      grow strategy already shipped");
            return 0;
        }

        console.log("  SHIP    grow strategy %s was never shipped", vm.toString(hash));
        VortexGrowStrategy memory strategy = VortexGrowStrategy({
            maker: maker,
            asset: vm.parseJsonAddress(grow, ".strategy.asset"),
            bridgeToken: vm.parseJsonAddress(grow, ".strategy.bridgeToken"),
            externalTarget: vm.parseJsonAddress(grow, ".strategy.externalTarget"),
            routeSigner: vm.parseJsonAddress(grow, ".strategy.routeSigner"),
            feeRecipient: vm.parseJsonAddress(grow, ".strategy.feeRecipient"),
            maxAmountPerExecution: uint128(vm.parseJsonUint(grow, ".strategy.maxAmountPerExecution")),
            minProfitBps: uint16(vm.parseJsonUint(grow, ".strategy.minProfitBps")),
            performanceFeeBps: uint16(vm.parseJsonUint(grow, ".strategy.performanceFeeBps")),
            strategyDeadline: uint40(vm.parseJsonUint(grow, ".strategy.strategyDeadline")),
            salt: uint64(vm.parseJsonUint(grow, ".strategy.salt"))
        });
        require(
            VortexCompoundRouteLib.strategyHash(strategy) == hash,
            "ensure: rebuilt grow strategy does not match the published hash"
        );

        uint256 makerKey = _makerKey();
        _fundAndApprove(wbtc, maker, makerKey, amount, address(aqua));

        address[] memory tokens = new address[](1);
        tokens[0] = address(wbtc);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        vm.startBroadcast(makerKey);
        bytes32 shipped = aqua.ship(compounder, abi.encode(strategy), tokens, amounts);
        vm.stopBroadcast();
        require(shipped == hash, "ensure: grow strategy hash mismatch");
        console.log("          shipped, %s sats", amount);
        return 1;
    }

    /// @dev Virtual balances are not collateral: a strategy the maker cannot
    ///      cover is phantom liquidity, so top up and approve before shipping.
    function _fundAndApprove(
        MockERC20 token,
        address maker,
        uint256 makerKey,
        uint256 needed,
        address aqua
    )
        private
    {
        if (token.balanceOf(maker) < needed) {
            vm.startBroadcast();
            token.mint(maker, needed - token.balanceOf(maker));
            vm.stopBroadcast();
        }
        if (token.allowance(maker, aqua) < needed) {
            vm.startBroadcast(makerKey);
            token.approve(aqua, type(uint256).max);
            vm.stopBroadcast();
        }
    }

    function _makerKey() private view returns (uint256) {
        return vm.envOr(
            "DEMO_MAKER_KEY",
            uint256(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d)
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraits } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";

import { MockERC20 } from "../src/mocks/MockERC20.sol";

/// @notice Executes a real Vortex Swap fill against the seeded strategy, using
///         ONLY the published artifacts (`31337.json` + `31337.demo.json`).
///
/// @dev Two jobs:
///      1. **Proof** that the Aqua settlement path is reachable end to end from
///         what blockend publishes — if this works, the API's
///         `POST /api/v1/transactions/aqua` builder is a mechanical
///         translation of the encoding below, with no missing contract piece.
///      2. **CLI backup** for the demo: if the UI or API is down in front of
///         judges, this moves real WBTC and USDC through official Aqua and
///         SwapVM and prints the balance deltas.
///
///      The taker-side encoding here is exactly what a browser must broadcast:
///      approve the ROUTER for tokenIn, then call the 5-arg `swap` with
///      `useTransferFromAndAquaPush` traits and the taker's minimum-out in
///      `threshold` so the CHAIN enforces slippage, not the caller.
contract ExecuteDemoSwap is Script {
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

        address router = vm.parseJsonAddress(deployment, ".contracts.AquaSwapVMRouter");
        MockERC20 wbtc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockWBTC"));
        MockERC20 usdc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockUSDC"));
        address maker = vm.parseJsonAddress(demo, ".maker");

        ISwapVM.Order memory order = ISwapVM.Order({
            maker: maker,
            traits: MakerTraits.wrap(uint256(vm.parseJsonBytes32(demo, ".order.traits"))),
            data: vm.parseJsonBytes(demo, ".order.data")
        });

        uint128 amountIn = uint128(vm.envOr("AMOUNT_IN", uint256(0.05e8)));
        // anvil account #2 as the taker, so the demo never spends maker funds.
        uint256 takerKey = vm.envOr(
            "TAKER_KEY", uint256(0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a)
        );
        address taker = vm.addr(takerKey);

        // Quote first — the same view the API would serve — then bind it as the
        // onchain minimum so the fill cannot silently come back worse.
        (, uint256 quotedOut,) = ISwapVM(router).quote(order, address(wbtc), address(usdc), amountIn, _traits(taker, ""));
        uint256 minOut = quotedOut - (quotedOut * vm.envOr("SLIPPAGE_BPS", uint256(50))) / 10_000;

        uint256 takerWbtcBefore = wbtc.balanceOf(taker);
        uint256 takerUsdcBefore = usdc.balanceOf(taker);
        uint256 makerWbtcBefore = wbtc.balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        vm.startBroadcast(takerKey);
        // Mocks are mintable; real tokens on a fork are not, so the taker must
        // already hold the input (bootstrap-fork.sh funds it from a whale).
        if (!vm.envOr("USE_REAL_TOKENS", false)) {
            wbtc.mint(taker, amountIn);
        }
        require(wbtc.balanceOf(taker) >= amountIn, "taker underfunded for the demo swap");
        wbtc.approve(router, amountIn);
        (uint256 amountInUsed, uint256 amountOut,) = ISwapVM(router).swap(
            order, address(wbtc), address(usdc), amountIn, _traits(taker, abi.encode(minOut))
        );
        vm.stopBroadcast();

        console.log("--- Vortex Swap executed through official Aqua + SwapVM ---");
        console.log("taker            %s", taker);
        console.log("maker            %s", maker);
        console.log("quoted out       %s", quotedOut);
        console.log("min out (chain)  %s", minOut);
        console.log("amount in        %s", amountInUsed);
        console.log("amount out       %s", amountOut);
        console.log("taker WBTC delta %s", _delta(wbtc.balanceOf(taker) + amountInUsed, takerWbtcBefore + amountIn));
        console.log("taker USDC  +%s", usdc.balanceOf(taker) - takerUsdcBefore);
        console.log("maker WBTC  +%s", wbtc.balanceOf(maker) - makerWbtcBefore);
        console.log("maker USDC  -%s", makerUsdcBefore - usdc.balanceOf(maker));

        // The settlement invariants, asserted rather than eyeballed.
        require(amountOut >= minOut, "fill came back below the bound minimum");
        require(usdc.balanceOf(taker) - takerUsdcBefore == amountOut, "taker did not receive amountOut");
        require(wbtc.balanceOf(maker) - makerWbtcBefore == amountInUsed, "maker did not receive amountIn");
        require(makerUsdcBefore - usdc.balanceOf(maker) == amountOut, "maker did not pay amountOut");
        require(IERC20(address(wbtc)).balanceOf(router) == 0, "router retained WBTC");
        require(IERC20(address(usdc)).balanceOf(router) == 0, "router retained USDC");
    }

    function _delta(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    /// @dev The exact taker encoding the API must reproduce. `threshold` is the
    ///      onchain slippage bound; empty means unbounded.
    function _traits(address taker, bytes memory threshold) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: taker,
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: true,
                threshold: threshold,
                to: address(0),
                deadline: 0,
                hasPreTransferInCallback: false,
                hasPreTransferOutCallback: false,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: ""
            })
        );
    }
}

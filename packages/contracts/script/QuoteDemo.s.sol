// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraits } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";

/// @notice Read-only: quotes the seeded Vortex Swap strategy through the real
///         AquaSwapVMRouter and prints the result.
/// @dev No broadcast, no state change. Useful for checking what the maker is
///      actually quoting right now — e.g. after SetDemoScenario moves the
///      oracle — without going through the API.
contract QuoteDemo is Script {
    function run() external view {
        string memory deployment =
            vm.readFile(string.concat("../../deployments/", vm.toString(block.chainid), ".json"));
        string memory demo =
            vm.readFile(string.concat("../../deployments/", vm.toString(block.chainid), ".demo.json"));

        address router = vm.parseJsonAddress(deployment, ".contracts.AquaSwapVMRouter");
        address wbtc = vm.parseJsonAddress(deployment, ".contracts.MockWBTC");
        address usdc = vm.parseJsonAddress(deployment, ".contracts.MockUSDC");

        ISwapVM.Order memory order = ISwapVM.Order({
            maker: vm.parseJsonAddress(demo, ".order.maker"),
            traits: MakerTraits.wrap(uint256(vm.parseJsonBytes32(demo, ".order.traits"))),
            data: vm.parseJsonBytes(demo, ".order.data")
        });

        uint128 amountIn = uint128(vm.envOr("AMOUNT_IN", uint256(0.05e8)));

        (, uint256 amountOut,) = ISwapVM(router).quote(
            order, wbtc, usdc, amountIn, _takerTraits(msg.sender)
        );

        console.log("wbtc in (sats)   %s", amountIn);
        console.log("usdc out (units) %s", amountOut);
        // Effective price in whole USDC per whole WBTC.
        console.log("effective price  %s USDC/WBTC", (amountOut * 1e8) / (uint256(amountIn) * 1e6));
    }

    function _takerTraits(address taker) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: taker,
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: true,
                threshold: "",
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

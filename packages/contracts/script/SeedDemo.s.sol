// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { console } from "forge-std/console.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraits } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";

import { VortexAquaOrderBuilder } from "../src/aqua/VortexAquaOrderBuilder.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MockReferenceOracle } from "../src/mocks/MockReferenceOracle.sol";

/// @notice Ships a deterministic Vortex Swap strategy on the local chain so
///         the api/web demos have live Aqua liquidity to quote against.
///         Deterministic by construction: the strategy deadline is an absolute
///         timestamp (not `now + delta`), so the same chain state always yields
///         the same strategyHash.
///
///         Run after DeployLocal (reads deployments/<chainId>.json), writes
///         deployments/<chainId>.demo.json with everything a taker needs to
///         call quote()/swap(): maker, strategyHash, and the full Order.
contract SeedDemo is Script {
    /// @dev 2033-05-18. Fixed so order bytes — and therefore the strategy
    ///      hash — do not drift with wall-clock time.
    uint40 internal constant DEMO_STRATEGY_DEADLINE = 2_000_000_000;

    uint256 internal constant DEMO_WBTC = 2e8; // 2 WBTC
    uint256 internal constant DEMO_USDC = 200_000e6; // 200k USDC (balanced at 100k/WBTC)
    uint256 internal constant VERIFY_QUOTE_AMOUNT = 0.05e8; // 0.05 WBTC reference fill

    function run() external {
        string memory deploymentPath = string.concat("../../deployments/", vm.toString(block.chainid), ".json");
        string memory deployment = vm.readFile(deploymentPath);

        Aqua aqua = Aqua(vm.parseJsonAddress(deployment, ".contracts.Aqua"));
        address router = vm.parseJsonAddress(deployment, ".contracts.AquaSwapVMRouter");
        MockERC20 wbtc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockWBTC"));
        MockERC20 usdc = MockERC20(vm.parseJsonAddress(deployment, ".contracts.MockUSDC"));
        MockReferenceOracle oracle =
            MockReferenceOracle(vm.parseJsonAddress(deployment, ".contracts.MockReferenceOracle"));
        VortexAquaOrderBuilder orderBuilder =
            VortexAquaOrderBuilder(vm.parseJsonAddress(deployment, ".contracts.VortexAquaOrderBuilder"));

        // anvil account #1 is the demo maker; account #0 deploys and owns the oracle.
        uint256 makerKey = vm.envOr(
            "DEMO_MAKER_KEY",
            uint256(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d)
        );
        address maker = vm.addr(makerKey);
        address rebateSigner = vm.envOr("REBATE_SIGNER", maker);

        VortexAquaOrderBuilder.VortexSwapStrategyParams memory params = VortexAquaOrderBuilder
            .VortexSwapStrategyParams({
            maker: maker,
            baseToken: address(wbtc),
            quoteToken: address(usdc),
            referenceOracle: address(oracle),
            rebateSigner: rebateSigner,
            minSafetyFeeBps: 5,
            defaultCommercialFeeBps: 20,
            minCommercialFeeBps: 5,
            maxCommercialFeeBps: 200,
            inventoryStrengthBps: 1_000,
            maxTradeBps: 1_000,
            minBaseWeightBps: 1_000,
            maxBaseWeightBps: 9_000,
            maxOracleSpreadBps: 50,
            maxOracleAge: 1 hours,
            strategyDeadline: DEMO_STRATEGY_DEADLINE,
            salt: vm.envOr("DEMO_SALT", uint256(1))
        });

        (ISwapVM.Order memory order, bytes32 strategyHash) = orderBuilder.buildOrder(params);

        // Fund the maker (mock tokens are freely mintable on the local chain).
        vm.startBroadcast();
        wbtc.mint(maker, DEMO_WBTC);
        usdc.mint(maker, DEMO_USDC);
        vm.stopBroadcast();

        address[] memory tokens = new address[](2);
        tokens[0] = address(wbtc);
        tokens[1] = address(usdc);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = DEMO_WBTC;
        amounts[1] = DEMO_USDC;

        vm.startBroadcast(makerKey);
        wbtc.approve(address(aqua), type(uint256).max);
        usdc.approve(address(aqua), type(uint256).max);
        bytes32 shipped = aqua.ship(router, abi.encode(order), tokens, amounts);
        vm.stopBroadcast();
        require(shipped == strategyHash, "seed: strategy hash mismatch");

        // Prove the seeded strategy is actually quotable before advertising it.
        (uint256 quotedIn, uint256 quotedOut) = _verifyQuote(router, order, address(wbtc), address(usdc));
        console.log("seeded strategy quote: %s wbtc-sats in -> %s usdc-units out", quotedIn, quotedOut);

        _write(order, strategyHash, maker, rebateSigner, address(wbtc), address(usdc), quotedIn, quotedOut);
    }

    /// @dev Static 0.05 WBTC -> USDC quote through the real router, exactly as
    ///      a taker (or the api) would call it.
    function _verifyQuote(
        address router,
        ISwapVM.Order memory order,
        address wbtc,
        address usdc
    )
        internal
        view
        returns (uint256 amountIn, uint256 amountOut)
    {
        bytes memory takerTraitsAndData = TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: msg.sender,
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
        (amountIn, amountOut,) = ISwapVM(router).quote(order, wbtc, usdc, VERIFY_QUOTE_AMOUNT, takerTraitsAndData);
        require(amountOut > 0, "seed: strategy is not quotable");
    }

    function _write(
        ISwapVM.Order memory order,
        bytes32 strategyHash,
        address maker,
        address rebateSigner,
        address wbtc,
        address usdc,
        uint256 quotedIn,
        uint256 quotedOut
    )
        internal
    {
        string memory orderKey = "order";
        vm.serializeAddress(orderKey, "maker", order.maker);
        // uint256 traits as hex: a JSON number would lose precision in JS.
        vm.serializeBytes32(orderKey, "traits", bytes32(MakerTraits.unwrap(order.traits)));
        string memory orderJson = vm.serializeBytes(orderKey, "data", order.data);

        string memory root = "demo";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeBytes32(root, "strategyHash", strategyHash);
        vm.serializeAddress(root, "maker", maker);
        vm.serializeAddress(root, "rebateSigner", rebateSigner);
        vm.serializeAddress(root, "baseToken", wbtc);
        vm.serializeAddress(root, "quoteToken", usdc);
        vm.serializeUint(root, "baseShipped", DEMO_WBTC);
        vm.serializeUint(root, "quoteShipped", DEMO_USDC);
        // Reference fill so consumers can assert their own wiring end to end.
        string memory sample = "sampleQuote";
        vm.serializeBool(sample, "isExactIn", true);
        vm.serializeAddress(sample, "tokenIn", wbtc);
        vm.serializeAddress(sample, "tokenOut", usdc);
        vm.serializeUint(sample, "amountIn", quotedIn);
        string memory sampleJson = vm.serializeUint(sample, "amountOut", quotedOut);
        vm.serializeString(root, "sampleQuote", sampleJson);
        string memory json = vm.serializeString(root, "order", orderJson);

        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            string memory fileName = vm.envOr(
                "SEED_OUT", string.concat(vm.toString(block.chainid), ".demo.json")
            );
            vm.writeJson(json, string.concat("../../deployments/", fileName));
        }
    }
}

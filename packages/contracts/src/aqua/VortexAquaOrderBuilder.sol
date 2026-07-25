// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";

import { VortexAquaPricing, VortexSwapConfig, VortexSwapConfigLib } from "./VortexAquaPricing.sol";

/// @title VortexAquaOrderBuilder — deterministic Vortex Swap order assembly
/// @notice Builds the exact SwapVM order a maker ships on Aqua: program =
///         [Deadline][Extruction(VortexAquaPricing ++ config)][Salt], Aqua
///         mode on, no hooks. Everything economic lives in the packed config
///         and is therefore immutable once shipped (the strategy hash covers
///         order.data).
contract VortexAquaOrderBuilder {
    using VortexSwapConfigLib for VortexSwapConfig;

    /// @dev v1.0.1 AquaSwapVMRouter opcode indices (dispatch-table positions).
    ///      Pinned by test_programEncodingMatchesOfficialBuilder against the
    ///      official ProgramBuilder — a dependency bump that reorders the
    ///      table fails that test, not production.
    uint8 internal constant OPCODE_DEADLINE = 13;
    uint8 internal constant OPCODE_SALT = 20;
    uint8 internal constant OPCODE_EXTRUCTION = 32;

    VortexAquaPricing public immutable PRICING;

    struct VortexSwapStrategyParams {
        address maker;
        address baseToken;
        address quoteToken;
        address referenceOracle;
        address rebateSigner;
        uint16 minSafetyFeeBps;
        uint16 defaultCommercialFeeBps;
        uint16 minCommercialFeeBps;
        uint16 maxCommercialFeeBps;
        uint16 inventoryStrengthBps;
        uint16 maxTradeBps;
        uint16 minBaseWeightBps;
        uint16 maxBaseWeightBps;
        uint16 maxOracleSpreadBps;
        uint32 maxOracleAge;
        uint40 strategyDeadline;
        uint256 salt;
    }

    error VortexBadFeeBand(uint16 minCommercialBps, uint16 defaultCommercialBps, uint16 maxCommercialBps);
    error VortexBadWeightBand(uint16 minBaseWeightBps, uint16 maxBaseWeightBps);
    error VortexFeeCeilingTooHigh(uint256 worstCaseFeeBps);
    error VortexZeroAddress();
    error VortexExpiredStrategyDeadline(uint40 strategyDeadline);

    constructor(VortexAquaPricing pricing) {
        PRICING = pricing;
    }

    /// @notice Assemble the order and its Aqua strategy hash. The maker then:
    ///         approve Aqua for both tokens → aqua.ship(router,
    ///         abi.encode(order), [base, quote], [baseAmount, quoteAmount]).
    function buildOrder(VortexSwapStrategyParams calldata params)
        external
        view
        returns (ISwapVM.Order memory order, bytes32 strategyHash)
    {
        _validate(params);

        VortexSwapConfig memory cfg = VortexSwapConfig({
            baseToken: params.baseToken,
            quoteToken: params.quoteToken,
            referenceOracle: params.referenceOracle,
            rebateSigner: params.rebateSigner,
            baseDecimals: IERC20Metadata(params.baseToken).decimals(),
            quoteDecimals: IERC20Metadata(params.quoteToken).decimals(),
            minSafetyFeeBps: params.minSafetyFeeBps,
            defaultCommercialFeeBps: params.defaultCommercialFeeBps,
            minCommercialFeeBps: params.minCommercialFeeBps,
            maxCommercialFeeBps: params.maxCommercialFeeBps,
            inventoryStrengthBps: params.inventoryStrengthBps,
            maxTradeBps: params.maxTradeBps,
            minBaseWeightBps: params.minBaseWeightBps,
            maxBaseWeightBps: params.maxBaseWeightBps,
            maxOracleSpreadBps: params.maxOracleSpreadBps,
            maxOracleAge: params.maxOracleAge
        });

        order = MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: params.maker,
                receiver: address(0),
                shouldUnwrapWeth: false,
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: buildProgram(params.strategyDeadline, cfg, params.salt)
            })
        );

        // Aqua-mode orders hash as plain keccak, not EIP-712 (ISwapVM.hash).
        strategyHash = keccak256(abi.encode(order));
    }

    /// @notice Program bytes: opcode ++ argsLength ++ args, three instructions.
    function buildProgram(
        uint40 strategyDeadline,
        VortexSwapConfig memory cfg,
        uint256 salt
    )
        public
        view
        returns (bytes memory)
    {
        bytes memory extructionArgs = abi.encodePacked(address(PRICING), cfg.encode());
        return abi.encodePacked(
            OPCODE_DEADLINE,
            uint8(5),
            strategyDeadline,
            OPCODE_EXTRUCTION,
            uint8(extructionArgs.length),
            extructionArgs,
            OPCODE_SALT,
            uint8(32),
            salt
        );
    }

    function _validate(VortexSwapStrategyParams calldata params) internal view {
        require(
            params.maker != address(0) && params.baseToken != address(0) && params.quoteToken != address(0)
                && params.referenceOracle != address(0) && params.rebateSigner != address(0),
            VortexZeroAddress()
        );
        require(
            params.minCommercialFeeBps <= params.defaultCommercialFeeBps
                && params.defaultCommercialFeeBps <= params.maxCommercialFeeBps,
            VortexBadFeeBand(params.minCommercialFeeBps, params.defaultCommercialFeeBps, params.maxCommercialFeeBps)
        );
        require(
            params.minBaseWeightBps < params.maxBaseWeightBps && params.maxBaseWeightBps <= 10_000,
            VortexBadWeightBand(params.minBaseWeightBps, params.maxBaseWeightBps)
        );
        uint256 worstCaseFee = uint256(params.minSafetyFeeBps) + params.maxCommercialFeeBps;
        require(worstCaseFee < 10_000, VortexFeeCeilingTooHigh(worstCaseFee));
        require(params.strategyDeadline > block.timestamp, VortexExpiredStrategyDeadline(params.strategyDeadline));
    }
}

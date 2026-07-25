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
    error VortexIdenticalTokens(address token);
    error VortexUnsupportedDecimals(address token, uint8 decimals);
    error VortexBpsOutOfRange(uint16 maxTradeBps, uint16 inventoryStrengthBps);

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
        VortexSwapConfig memory cfg = _validatedConfig(params);

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

    /// @dev Validates params and packs them into the immutable config. Kept in
    ///      its own frame so `buildOrder`'s stack stays within via-IR limits.
    function _validatedConfig(VortexSwapStrategyParams calldata params)
        internal
        view
        returns (VortexSwapConfig memory cfg)
    {
        _validate(params);
        // Field-by-field rather than a struct literal: a 16-field literal
        // holds every value live at once and blows the via-IR stack limit.
        cfg.baseToken = params.baseToken;
        cfg.quoteToken = params.quoteToken;
        cfg.referenceOracle = params.referenceOracle;
        cfg.rebateSigner = params.rebateSigner;
        cfg.baseDecimals = IERC20Metadata(params.baseToken).decimals();
        cfg.quoteDecimals = IERC20Metadata(params.quoteToken).decimals();
        cfg.minSafetyFeeBps = params.minSafetyFeeBps;
        cfg.defaultCommercialFeeBps = params.defaultCommercialFeeBps;
        cfg.minCommercialFeeBps = params.minCommercialFeeBps;
        cfg.maxCommercialFeeBps = params.maxCommercialFeeBps;
        cfg.inventoryStrengthBps = params.inventoryStrengthBps;
        cfg.maxTradeBps = params.maxTradeBps;
        cfg.minBaseWeightBps = params.minBaseWeightBps;
        cfg.maxBaseWeightBps = params.maxBaseWeightBps;
        cfg.maxOracleSpreadBps = params.maxOracleSpreadBps;
        cfg.maxOracleAge = params.maxOracleAge;
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

        // Shipped strategies are immutable, so a config that can never price a
        // trade would strand the maker in a dock-and-reship cycle. Reject the
        // dead configurations here, where it is still free to fix them.
        require(params.baseToken != params.quoteToken, VortexIdenticalTokens(params.baseToken));
        uint8 baseDecimals = IERC20Metadata(params.baseToken).decimals();
        uint8 quoteDecimals = IERC20Metadata(params.quoteToken).decimals();
        require(baseDecimals <= 18, VortexUnsupportedDecimals(params.baseToken, baseDecimals));
        require(quoteDecimals <= 18, VortexUnsupportedDecimals(params.quoteToken, quoteDecimals));
        require(
            params.maxTradeBps > 0 && params.maxTradeBps <= 10_000 && params.inventoryStrengthBps <= 10_000,
            VortexBpsOutOfRange(params.maxTradeBps, params.inventoryStrengthBps)
        );
    }
}

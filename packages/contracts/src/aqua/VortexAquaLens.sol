// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";

import { VortexAquaPricing } from "./VortexAquaPricing.sol";
import { VortexCoverage } from "../libraries/VortexCoverage.sol";
import { VortexInventoryMath } from "../libraries/VortexInventoryMath.sol";
import { VortexTokenMath } from "../libraries/VortexTokenMath.sol";
import { IVortexReferenceOracle } from "../interfaces/IVortexReferenceOracle.sol";

/// @title VortexAquaLens — strategy health and quote transparency reads
/// @notice Backend/UI read surface. Makes phantom liquidity visible:
///         executable = min(virtual, wallet, allowance) per token.
contract VortexAquaLens {
    using MakerTraitsLib for *;
    using VortexTokenMath for uint256;

    uint8 private constant DOCKED = 0xff;

    IAqua public immutable AQUA;
    /// @notice The AquaSwapVMRouter that executes Vortex Swap strategies (the Aqua "app").
    address public immutable ROUTER;
    VortexAquaPricing public immutable PRICING;

    error VortexPricingInstructionNotFound();

    struct TokenHealth {
        address token;
        uint256 virtualBalance;
        uint256 actualBalance;
        uint256 aquaAllowance;
        uint256 executableBalance;
    }

    struct StrategyHealth {
        TokenHealth base;
        TokenHealth quote;
        uint256 baseWeightBps;
        uint256 coverageBps;
        bool active;
        bool solvent;
    }

    constructor(IAqua aqua, address router, VortexAquaPricing pricing) {
        AQUA = aqua;
        ROUTER = router;
        PRICING = pricing;
    }

    function strategyHealth(
        address maker,
        bytes32 strategyHash,
        address baseToken,
        address quoteToken,
        address referenceOracle
    )
        external
        view
        returns (StrategyHealth memory health)
    {
        health.base = _tokenHealth(maker, strategyHash, baseToken);
        health.quote = _tokenHealth(maker, strategyHash, quoteToken);

        (, uint8 baseCount) = AQUA.rawBalances(maker, ROUTER, strategyHash, baseToken);
        health.active = baseCount > 0 && baseCount != DOCKED;

        health.solvent = health.base.executableBalance >= health.base.virtualBalance
            && health.quote.executableBalance >= health.quote.virtualBalance;

        uint256 baseCoverage =
            VortexCoverage.coverageBps(health.base.virtualBalance, health.base.executableBalance);
        uint256 quoteCoverage =
            VortexCoverage.coverageBps(health.quote.virtualBalance, health.quote.executableBalance);
        health.coverageBps = baseCoverage < quoteCoverage ? baseCoverage : quoteCoverage;

        IVortexReferenceOracle.PriceData memory price =
            IVortexReferenceOracle(referenceOracle).latestPrice();
        if (price.midPriceE18 > 0 && (health.base.virtualBalance > 0 || health.quote.virtualBalance > 0)) {
            uint256 baseValE18 = VortexInventoryMath.baseValueE18(
                health.base.virtualBalance.toE18(_decimals(baseToken)), price.midPriceE18
            );
            uint256 quoteValE18 = health.quote.virtualBalance.toE18(_decimals(quoteToken));
            if (baseValE18 + quoteValE18 > 0) {
                health.baseWeightBps = VortexInventoryMath.baseWeightBps(baseValE18, quoteValE18);
            }
        }
    }

    /// @notice Full fee/amount breakdown for a prospective fill, using the
    ///         exact config embedded in the order's Extruction instruction.
    function quoteBreakdown(
        ISwapVM.Order calldata order,
        address tokenIn,
        address tokenOut,
        bool isExactIn,
        uint256 amount,
        uint16 rebateBps
    )
        external
        view
        returns (VortexAquaPricing.FeeBreakdown memory)
    {
        bytes32 strategyHash = keccak256(abi.encode(order));
        (uint256 balanceIn, uint256 balanceOut) =
            AQUA.safeBalances(order.maker, ROUTER, strategyHash, tokenIn, tokenOut);

        bytes calldata configBlob = _findPricingConfig(order);
        return PRICING.preview(
            configBlob, order.maker, strategyHash, tokenIn, tokenOut, isExactIn, amount, balanceIn, balanceOut, rebateBps
        );
    }

    /// @dev Walks the program (opcode ++ len ++ args) and returns the config
    ///      of the Extruction instruction targeting our pricing contract.
    function _findPricingConfig(ISwapVM.Order calldata order) internal view returns (bytes calldata) {
        bytes calldata program = order.traits.program(order.data);
        uint256 pc = 0;
        while (pc + 2 <= program.length) {
            uint8 argsLength = uint8(program[pc + 1]);
            uint256 argsStart = pc + 2;
            uint256 argsEnd = argsStart + argsLength;
            if (argsEnd > program.length) break;
            bytes calldata args = program[argsStart:argsEnd];
            if (args.length >= 20 && address(bytes20(args[0:20])) == address(PRICING)) {
                return args[20:];
            }
            pc = argsEnd;
        }
        revert VortexPricingInstructionNotFound();
    }

    function _tokenHealth(
        address maker,
        bytes32 strategyHash,
        address token
    )
        internal
        view
        returns (TokenHealth memory th)
    {
        (uint256 virtualBalance, uint256 actualBalance, uint256 aquaAllowance, uint256 executable) =
            VortexCoverage.executableBalance(AQUA, maker, ROUTER, strategyHash, token);
        th = TokenHealth({
            token: token,
            virtualBalance: virtualBalance,
            actualBalance: actualBalance,
            aquaAllowance: aquaAllowance,
            executableBalance: executable
        });
    }

    function _decimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        return ok && data.length >= 32 ? abi.decode(data, (uint8)) : 18;
    }
}

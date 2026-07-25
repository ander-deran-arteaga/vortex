// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Fee composition for Vortex Swap. The safety floor is added AFTER
///         the commercial clamp, so no signed rebate can reach it.
library VortexFeeMath {
    uint256 internal constant BPS = 10_000;

    error FeeExceedsBps(uint256 feeBps);

    /// @notice Clamp the raw commercial fee (default - rebate + inventory
    ///         adjustment, may be negative) into the immutable band.
    function clampCommercialBps(
        int256 rawCommercialBps,
        uint16 minCommercialBps,
        uint16 maxCommercialBps
    )
        internal
        pure
        returns (uint16)
    {
        if (rawCommercialBps < int256(uint256(minCommercialBps))) return minCommercialBps;
        if (rawCommercialBps > int256(uint256(maxCommercialBps))) return maxCommercialBps;
        // Casting is safe: both clamp branches above bound the value to uint16 range.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(uint256(rawCommercialBps));
    }

    function composeFeeBps(uint16 safetyFeeBps, uint16 commercialFeeBps) internal pure returns (uint16) {
        uint256 total = uint256(safetyFeeBps) + commercialFeeBps;
        require(total < BPS, FeeExceedsBps(total));
        // Casting is safe: total < 10_000 fits uint16.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(total);
    }

    /// @notice Reduce a maker-paid output by the fee, rounding down (maker keeps the dust).
    function applyFeeOnOutputFloor(uint256 amountE18, uint16 feeBps) internal pure returns (uint256) {
        return Math.mulDiv(amountE18, BPS - feeBps, BPS);
    }

    /// @notice Gross-up a requested output for the fee, rounding up (taker pays the dust).
    function grossUpForFeeCeil(uint256 amountE18, uint16 feeBps) internal pure returns (uint256) {
        return Math.mulDiv(amountE18, BPS, BPS - feeBps, Math.Rounding.Ceil);
    }
}

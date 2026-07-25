// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { VortexTokenMath } from "./VortexTokenMath.sol";

/// @notice Inventory skew and weight math for Vortex Swap (1e18 value scale,
///         quote token as numeraire, bps outputs).
library VortexInventoryMath {
    uint256 internal constant BPS = 10_000;

    error EmptyPortfolio();

    /// @notice Base leg valued in quote terms at mid.
    function baseValueE18(uint256 baseAmountE18, uint256 midPriceE18) internal pure returns (uint256) {
        return VortexTokenMath.mulPriceE18Floor(baseAmountE18, midPriceE18);
    }

    /// @notice Signed portfolio skew in bps: positive = base-heavy.
    function skewBps(uint256 baseValE18, uint256 quoteValE18) internal pure returns (int256) {
        uint256 total = baseValE18 + quoteValE18;
        require(total > 0, EmptyPortfolio());
        // Casting is safe: portfolio values are bounded far below int256 max
        // (Aqua balances are uint248 token units; realistic E18 values are
        // <= ~1e40, versus int256 max ~5.7e76).
        // forge-lint: disable-next-line(unsafe-typecast)
        return (int256(baseValE18) - int256(quoteValE18)) * int256(BPS) / int256(total);
    }

    /// @notice Trade size as a fraction of portfolio value, in bps (rounded up
    ///         so the max-trade cap cannot be shaved by rounding).
    function tradeFractionBps(uint256 tradeValueE18, uint256 totalValueE18) internal pure returns (uint256) {
        require(totalValueE18 > 0, EmptyPortfolio());
        return Math.mulDiv(tradeValueE18, BPS, totalValueE18, Math.Rounding.Ceil);
    }

    /// @notice Inventory-aware commercial fee adjustment in bps (signed).
    /// @dev Pool receiving base: alpha * (skew + r). Pool sending base:
    ///      alpha * (-skew + r). Trades that recenter the book get cheaper,
    ///      trades that worsen it get pricier, and size always costs.
    function inventoryAdjustmentBps(
        uint16 strengthBps,
        int256 skewBps_,
        uint256 tradeFractionBps_,
        bool poolReceivesBase
    )
        internal
        pure
        returns (int256)
    {
        int256 directionalSkew = poolReceivesBase ? skewBps_ : -skewBps_;
        return int256(uint256(strengthBps)) * (directionalSkew + int256(tradeFractionBps_)) / int256(BPS);
    }

    /// @notice Base weight of the portfolio in bps.
    function baseWeightBps(uint256 baseValE18, uint256 quoteValE18) internal pure returns (uint256) {
        uint256 total = baseValE18 + quoteValE18;
        require(total > 0, EmptyPortfolio());
        return baseValE18 * BPS / total;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Decimal normalization and price math for Vortex.
/// @dev Internal value scale is 1e18 (MASTER R-009). WBTC is 8 decimals,
///      USDC is 6 — never assume 18. Every lossy conversion exists in an
///      explicit Floor/Ceil pair so callers choose the maker-favoring
///      direction: round DOWN what the pool pays out, round UP what the
///      pool charges.
library VortexTokenMath {
    uint256 internal constant E18 = 1e18;

    error DecimalsAboveInternalScale(uint8 decimals);

    /// @notice Token units -> 1e18 scale. Exact (upscaling only).
    function toE18(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        require(decimals <= 18, DecimalsAboveInternalScale(decimals));
        return amount * 10 ** (18 - decimals);
    }

    /// @notice 1e18 scale -> token units, rounding down.
    function fromE18Floor(uint256 amountE18, uint8 decimals) internal pure returns (uint256) {
        require(decimals <= 18, DecimalsAboveInternalScale(decimals));
        return amountE18 / 10 ** (18 - decimals);
    }

    /// @notice 1e18 scale -> token units, rounding up.
    function fromE18Ceil(uint256 amountE18, uint8 decimals) internal pure returns (uint256) {
        require(decimals <= 18, DecimalsAboveInternalScale(decimals));
        return Math.ceilDiv(amountE18, 10 ** (18 - decimals));
    }

    /// @notice base(1e18) * price(quote-per-base, 1e18) -> quote(1e18), rounding down.
    function mulPriceE18Floor(uint256 baseAmountE18, uint256 priceE18) internal pure returns (uint256) {
        return Math.mulDiv(baseAmountE18, priceE18, E18);
    }

    /// @notice base(1e18) * price(quote-per-base, 1e18) -> quote(1e18), rounding up.
    function mulPriceE18Ceil(uint256 baseAmountE18, uint256 priceE18) internal pure returns (uint256) {
        return Math.mulDiv(baseAmountE18, priceE18, E18, Math.Rounding.Ceil);
    }

    /// @notice quote(1e18) / price(quote-per-base, 1e18) -> base(1e18), rounding down.
    function divPriceE18Floor(uint256 quoteAmountE18, uint256 priceE18) internal pure returns (uint256) {
        return Math.mulDiv(quoteAmountE18, E18, priceE18);
    }

    /// @notice quote(1e18) / price(quote-per-base, 1e18) -> base(1e18), rounding up.
    function divPriceE18Ceil(uint256 quoteAmountE18, uint256 priceE18) internal pure returns (uint256) {
        return Math.mulDiv(quoteAmountE18, E18, priceE18, Math.Rounding.Ceil);
    }
}

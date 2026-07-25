// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Reference price feed consumed by Vortex pricing (USDC-per-WBTC, 1e18).
interface IVortexReferenceOracle {
    struct PriceData {
        uint256 midPriceE18;
        uint256 bidPriceE18;
        uint256 askPriceE18;
        uint40 updatedAt;
    }

    function latestPrice() external view returns (PriceData memory);
}

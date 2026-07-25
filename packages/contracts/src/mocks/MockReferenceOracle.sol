// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IVortexReferenceOracle } from "../interfaces/IVortexReferenceOracle.sol";

/// @notice Deterministic owner-set reference price for local/fork demos.
///         Stands in for a production oracle; pricing still enforces
///         freshness, ordering, and spread limits as if it were real.
contract MockReferenceOracle is IVortexReferenceOracle, Ownable {
    error InvalidPriceOrdering(uint256 bidPriceE18, uint256 midPriceE18, uint256 askPriceE18);

    event PriceSet(uint256 midPriceE18, uint256 bidPriceE18, uint256 askPriceE18, uint40 updatedAt);

    PriceData private _latest;

    constructor(address initialOwner) Ownable(initialOwner) { }

    function setPrice(
        uint256 midPriceE18,
        uint256 bidPriceE18,
        uint256 askPriceE18
    )
        external
        onlyOwner
    {
        require(
            bidPriceE18 > 0 && bidPriceE18 <= midPriceE18 && midPriceE18 <= askPriceE18,
            InvalidPriceOrdering(bidPriceE18, midPriceE18, askPriceE18)
        );
        _latest = PriceData({
            midPriceE18: midPriceE18,
            bidPriceE18: bidPriceE18,
            askPriceE18: askPriceE18,
            updatedAt: uint40(block.timestamp)
        });
        emit PriceSet(midPriceE18, bidPriceE18, askPriceE18, uint40(block.timestamp));
    }

    function latestPrice() external view returns (PriceData memory) {
        return _latest;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { VortexTokenMath } from "../../src/libraries/VortexTokenMath.sol";

contract VortexTokenMathTest is Test {
    uint8 internal constant WBTC_DECIMALS = 8;
    uint8 internal constant USDC_DECIMALS = 6;

    function test_toE18IsExactForWbtcAndUsdc() public pure {
        assertEq(VortexTokenMath.toE18(1e8, WBTC_DECIMALS), 1e18);
        assertEq(VortexTokenMath.toE18(1e6, USDC_DECIMALS), 1e18);
        assertEq(VortexTokenMath.toE18(12_345_678, WBTC_DECIMALS), 0.12345678e18);
        assertEq(VortexTokenMath.toE18(1, USDC_DECIMALS), 1e12);
    }

    function test_fromE18RoundingDirections() public pure {
        // 1 wei above an exact satoshi: floor drops it, ceil charges a full extra unit.
        uint256 oneSatPlusDust = 1e10 + 1;
        assertEq(VortexTokenMath.fromE18Floor(oneSatPlusDust, WBTC_DECIMALS), 1);
        assertEq(VortexTokenMath.fromE18Ceil(oneSatPlusDust, WBTC_DECIMALS), 2);

        // Exact values round identically in both directions.
        assertEq(VortexTokenMath.fromE18Floor(5e10, WBTC_DECIMALS), 5);
        assertEq(VortexTokenMath.fromE18Ceil(5e10, WBTC_DECIMALS), 5);
    }

    function test_decimalsAbove18Revert() public {
        bytes memory expectedError =
            abi.encodeWithSelector(VortexTokenMath.DecimalsAboveInternalScale.selector, uint8(19));

        vm.expectRevert(expectedError);
        this.toE18External(1, 19);
        vm.expectRevert(expectedError);
        this.fromE18FloorExternal(1, 19);
        vm.expectRevert(expectedError);
        this.fromE18CeilExternal(1, 19);
    }

    function toE18External(uint256 amount, uint8 decimals) external pure returns (uint256) {
        return VortexTokenMath.toE18(amount, decimals);
    }

    function fromE18FloorExternal(uint256 amountE18, uint8 decimals) external pure returns (uint256) {
        return VortexTokenMath.fromE18Floor(amountE18, decimals);
    }

    function fromE18CeilExternal(uint256 amountE18, uint8 decimals) external pure returns (uint256) {
        return VortexTokenMath.fromE18Ceil(amountE18, decimals);
    }

    function test_priceMathKnownValues() public pure {
        // 0.5 WBTC at 90_000 USDC/WBTC = 45_000 USDC.
        uint256 halfBtcE18 = 0.5e18;
        uint256 priceE18 = 90_000e18;
        assertEq(VortexTokenMath.mulPriceE18Floor(halfBtcE18, priceE18), 45_000e18);
        assertEq(VortexTokenMath.divPriceE18Floor(45_000e18, priceE18), halfBtcE18);
    }

    function testFuzz_toE18RoundtripsExactly(uint128 amount) public pure {
        assertEq(
            VortexTokenMath.fromE18Floor(VortexTokenMath.toE18(amount, WBTC_DECIMALS), WBTC_DECIMALS), amount
        );
        assertEq(VortexTokenMath.fromE18Ceil(VortexTokenMath.toE18(amount, USDC_DECIMALS), USDC_DECIMALS), amount);
    }

    function testFuzz_ceilNeverBelowFloor(uint256 amountE18, uint8 decimals) public pure {
        decimals = uint8(bound(decimals, 0, 18));
        uint256 floorValue = VortexTokenMath.fromE18Floor(amountE18, decimals);
        uint256 ceilValue = VortexTokenMath.fromE18Ceil(amountE18, decimals);
        assertGe(ceilValue, floorValue);
        assertLe(ceilValue - floorValue, 1);
    }

    function testFuzz_priceRoundingIsConservative(uint128 baseAmountE18, uint128 priceE18) public pure {
        vm.assume(priceE18 > 0);
        uint256 floorOut = VortexTokenMath.mulPriceE18Floor(baseAmountE18, priceE18);
        uint256 ceilOut = VortexTokenMath.mulPriceE18Ceil(baseAmountE18, priceE18);
        assertGe(ceilOut, floorOut);
        assertLe(ceilOut - floorOut, 1);

        uint256 floorBase = VortexTokenMath.divPriceE18Floor(floorOut, priceE18);
        // Paying out the floored quote never requires more base than was priced.
        assertLe(floorBase, baseAmountE18);
    }
}

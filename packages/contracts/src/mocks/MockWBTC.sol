// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { MockERC20 } from "./MockERC20.sol";

/// @notice 8-decimal WBTC stand-in for local/fork testing.
contract MockWBTC is MockERC20 {
    constructor() MockERC20("Wrapped BTC", "WBTC", 8) { }
}

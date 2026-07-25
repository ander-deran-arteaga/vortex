// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { MockERC20 } from "./MockERC20.sol";

/// @notice 6-decimal USDC stand-in for local/fork testing.
contract MockUSDC is MockERC20 {
    constructor() MockERC20("USD Coin", "USDC", 6) { }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

/// @notice Aqua virtual balances are NOT collateral: tokens stay in the maker's
///         wallet until pull. The executable balance is what settlement can
///         actually deliver right now.
library VortexCoverage {
    uint256 internal constant BPS = 10_000;

    /// @notice min(virtual, actual wallet balance, ERC20 allowance to Aqua).
    function executableBalance(
        IAqua aqua,
        address maker,
        address app,
        bytes32 strategyHash,
        address token
    )
        internal
        view
        returns (uint256 virtualBalance, uint256 actualBalance, uint256 aquaAllowance, uint256 executable)
    {
        (uint248 rawVirtual,) = aqua.rawBalances(maker, app, strategyHash, token);
        virtualBalance = rawVirtual;
        actualBalance = IERC20(token).balanceOf(maker);
        aquaAllowance = IERC20(token).allowance(maker, address(aqua));

        executable = virtualBalance;
        if (actualBalance < executable) executable = actualBalance;
        if (aquaAllowance < executable) executable = aquaAllowance;
    }

    /// @notice Executable fraction of the virtual balance (10000 = fully covered).
    function coverageBps(uint256 virtualBalance, uint256 executable) internal pure returns (uint256) {
        if (virtualBalance == 0) return BPS;
        return executable * BPS / virtualBalance;
    }
}

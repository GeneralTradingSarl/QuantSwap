// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

/// @notice Implemented by contracts that receive flash-swap callbacks from a pair.
interface IQuantSwapCallee {
    function quantSwapCall(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

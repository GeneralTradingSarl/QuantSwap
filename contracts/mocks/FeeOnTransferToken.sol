// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

import {MockERC20} from "./MockERC20.sol";

/// @notice Burns a percentage of every transfer. Exists so the fee-on-transfer paths in the
///         router are covered by tests rather than by hope.
contract FeeOnTransferToken is MockERC20 {
    uint256 public immutable feeBps;

    constructor(string memory name_, string memory symbol_, uint256 feeBps_, uint256 initialSupply)
        MockERC20(name_, symbol_, 18, initialSupply)
    {
        feeBps = feeBps_;
    }

    function _transfer(address from, address to, uint256 value) internal override {
        uint256 fee = value * feeBps / 10_000;
        balanceOf[from] -= value;
        unchecked {
            balanceOf[to] += value - fee;
            totalSupply -= fee;
        }
        emit Transfer(from, to, value - fee);
    }
}

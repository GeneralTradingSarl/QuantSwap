// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

import {IQuantSwapCallee} from "../interfaces/IQuantSwapCallee.sol";
import {IQuantSwapPair} from "../interfaces/IQuantSwapPair.sol";

/// @notice Re-enters `swap` from inside the flash-swap callback. The pair's lock must stop it.
contract ReentrancyAttacker is IQuantSwapCallee {
    address public immutable pair;

    constructor(address pair_) {
        pair = pair_;
    }

    function attack(uint256 amount0Out, uint256 amount1Out) external {
        IQuantSwapPair(pair).swap(amount0Out, amount1Out, address(this), abi.encode("reenter"));
    }

    function quantSwapCall(address, uint256 amount0, uint256 amount1, bytes calldata) external override {
        IQuantSwapPair(pair).swap(amount0, amount1, address(this), new bytes(0));
    }
}

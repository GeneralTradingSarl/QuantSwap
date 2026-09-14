// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

import {IQuantSwapCallee} from "../interfaces/IQuantSwapCallee.sol";
import {IQuantSwapPair} from "../interfaces/IQuantSwapPair.sol";
import {IERC20} from "../interfaces/IERC20.sol";

/// @notice Exercises the flash-swap path: borrows one side, repays it plus the fee in the callback.
contract FlashBorrower is IQuantSwapCallee {
    error Unauthorized();
    error RepaymentShortfall();

    address public immutable pair;
    /// @notice Share of the amount owed that the callback actually repays, in basis points.
    ///         10_000 is a correct repayment; anything less must be rejected by the pair.
    uint256 public repayBps;

    constructor(address pair_) {
        pair = pair_;
        repayBps = 10_000;
    }

    function setRepayBps(uint256 repayBps_) external {
        repayBps = repayBps_;
    }

    function flash(uint256 amount0Out, uint256 amount1Out) external {
        IQuantSwapPair(pair).swap(amount0Out, amount1Out, address(this), abi.encode(msg.sender));
    }

    function quantSwapCall(address, uint256 amount0, uint256 amount1, bytes calldata) external override {
        if (msg.sender != pair) revert Unauthorized();
        if (repayBps == 0) return; // the pair must reject this on the input check

        address token0 = IQuantSwapPair(pair).token0();
        address token1 = IQuantSwapPair(pair).token1();

        // 0.30% fee, rounded up.
        if (amount0 > 0) {
            uint256 owed = (amount0 * 1000 / 997 + 1) * repayBps / 10_000;
            if (IERC20(token0).balanceOf(address(this)) < owed) revert RepaymentShortfall();
            IERC20(token0).transfer(pair, owed);
        }
        if (amount1 > 0) {
            uint256 owed = (amount1 * 1000 / 997 + 1) * repayBps / 10_000;
            if (IERC20(token1).balanceOf(address(this)) < owed) revert RepaymentShortfall();
            IERC20(token1).transfer(pair, owed);
        }
    }
}

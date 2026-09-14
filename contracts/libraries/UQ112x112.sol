// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

/// @notice Binary fixed point arithmetic with 112 fractional bits, used by the TWAP accumulators.
/// @dev Range [0, 2**112 - 1], resolution 1 / 2**112. Overflow of the accumulator is intended and
///      handled by the consumer taking differences in unchecked arithmetic.
library UQ112x112 {
    uint224 internal constant Q112 = 2 ** 112;

    function encode(uint112 y) internal pure returns (uint224 z) {
        unchecked {
            z = uint224(y) * Q112;
        }
    }

    function uqdiv(uint224 x, uint112 y) internal pure returns (uint224 z) {
        z = x / uint224(y);
    }
}

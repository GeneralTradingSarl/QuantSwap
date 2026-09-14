// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

import {IQuantSwapPair} from "../interfaces/IQuantSwapPair.sol";
import {QuantSwapLibrary} from "../libraries/QuantSwapLibrary.sol";
import {UQ112x112} from "../libraries/UQ112x112.sol";

/// @title QuantSwapOracle
/// @notice Sliding window time-weighted average price over the pair accumulators.
/// @dev Why this exists: the spot reserve ratio is manipulable inside a single block by anyone
///      with capital, and using it as a price feed is one of the most common ways a DeFi
///      protocol loses money. A TWAP forces an attacker to hold a skewed price across blocks.
///      It is a mitigation, not immunity. On a low liquidity pair the cost of holding that
///      skew may still be lower than the payoff, which is why `consult` reverts on a window
///      that is too short or on a pair whose observations have gone stale.
contract QuantSwapOracle {
    error InvalidGranularity();
    error WindowNotDivisible();
    error MissingObservation();
    error UnexpectedTimeElapsed();
    error InvalidToken();

    struct Observation {
        uint256 timestamp;
        uint256 price0Cumulative;
        uint256 price1Cumulative;
    }

    address public immutable factory;
    /// @notice Length of the averaging window, in seconds.
    uint256 public immutable windowSize;
    /// @notice Number of buckets the window is split into. Effective window is
    ///         [windowSize - windowSize / granularity, windowSize].
    uint8 public immutable granularity;
    uint256 public immutable periodSize;

    mapping(address => Observation[]) public pairObservations;

    event ObservationRecorded(address indexed pair, uint256 index, uint256 timestamp);

    constructor(address factory_, uint256 windowSize_, uint8 granularity_) {
        if (granularity_ <= 1) revert InvalidGranularity();
        if ((windowSize_ / granularity_) * granularity_ != windowSize_) revert WindowNotDivisible();
        factory = factory_;
        windowSize = windowSize_;
        granularity = granularity_;
        periodSize = windowSize_ / granularity_;
    }

    function observationIndexOf(uint256 timestamp) public view returns (uint8 index) {
        uint256 epochPeriod = timestamp / periodSize;
        return uint8(epochPeriod % granularity);
    }

    function _firstObservationInWindow(address pair) private view returns (Observation storage observation) {
        // A pair nobody has called update() on has no buckets at all.
        if (pairObservations[pair].length < granularity) revert MissingObservation();
        uint8 observationIndex = observationIndexOf(block.timestamp);
        uint8 firstObservationIndex = (observationIndex + 1) % granularity;
        observation = pairObservations[pair][firstObservationIndex];
    }

    /// @notice Records the current cumulative prices for a pair. Anyone may call it, and it must
    ///         be called at least once per period for `consult` to stay usable.
    function update(address tokenA, address tokenB) external returns (bool recorded) {
        address pair = QuantSwapLibrary.pairFor(factory, tokenA, tokenB);

        Observation[] storage observations = pairObservations[pair];
        for (uint256 i = observations.length; i < granularity; ++i) {
            observations.push();
        }

        uint8 index = observationIndexOf(block.timestamp);
        Observation storage observation = observations[index];
        uint256 timeElapsed = block.timestamp - observation.timestamp;
        if (timeElapsed <= periodSize) return false;

        (uint256 price0Cumulative, uint256 price1Cumulative) = currentCumulativePrices(pair);
        observation.timestamp = block.timestamp;
        observation.price0Cumulative = price0Cumulative;
        observation.price1Cumulative = price1Cumulative;

        emit ObservationRecorded(pair, index, block.timestamp);
        return true;
    }

    /// @notice Amount of `tokenOut` that `amountIn` of `tokenIn` is worth at the window average.
    function consult(address tokenIn, uint256 amountIn, address tokenOut) external view returns (uint256 amountOut) {
        address pair = QuantSwapLibrary.pairFor(factory, tokenIn, tokenOut);
        Observation storage firstObservation = _firstObservationInWindow(pair);

        uint256 timeElapsed = block.timestamp - firstObservation.timestamp;
        if (firstObservation.timestamp == 0 || timeElapsed > windowSize) revert MissingObservation();
        // Guards against an average computed over a window shorter than advertised.
        if (timeElapsed < windowSize - periodSize * 2) revert UnexpectedTimeElapsed();

        (uint256 price0Cumulative, uint256 price1Cumulative) = currentCumulativePrices(pair);
        (address token0,) = QuantSwapLibrary.sortTokens(tokenIn, tokenOut);

        if (token0 == tokenIn) {
            return _computeAmountOut(firstObservation.price0Cumulative, price0Cumulative, timeElapsed, amountIn);
        } else {
            return _computeAmountOut(firstObservation.price1Cumulative, price1Cumulative, timeElapsed, amountIn);
        }
    }

    /// @notice Cumulative prices extrapolated to the current block, so a pair that has not
    ///         traded recently still reports a correct average.
    function currentCumulativePrices(address pair)
        public
        view
        returns (uint256 price0Cumulative, uint256 price1Cumulative)
    {
        price0Cumulative = IQuantSwapPair(pair).price0CumulativeLast();
        price1Cumulative = IQuantSwapPair(pair).price1CumulativeLast();

        (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) = IQuantSwapPair(pair).getReserves();
        uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);

        unchecked {
            if (blockTimestampLast != blockTimestamp && reserve0 != 0 && reserve1 != 0) {
                uint32 timeElapsed = blockTimestamp - blockTimestampLast;
                price0Cumulative += uint256(UQ112x112.encode(reserve1) / reserve0) * timeElapsed;
                price1Cumulative += uint256(UQ112x112.encode(reserve0) / reserve1) * timeElapsed;
            }
        }
    }

    function _computeAmountOut(
        uint256 priceCumulativeStart,
        uint256 priceCumulativeEnd,
        uint256 timeElapsed,
        uint256 amountIn
    ) private pure returns (uint256 amountOut) {
        unchecked {
            // The subtraction is intentionally wrapping: both accumulators overflow by design.
            uint224 priceAverage = uint224((priceCumulativeEnd - priceCumulativeStart) / timeElapsed);
            amountOut = (uint256(priceAverage) * amountIn) / UQ112x112.Q112;
        }
    }
}

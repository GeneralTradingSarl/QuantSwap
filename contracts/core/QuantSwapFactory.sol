// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

import {QuantSwapPair} from "./QuantSwapPair.sol";

/// @title QuantSwapFactory
/// @notice Deploys one pair per unordered token couple, at a deterministic CREATE2 address.
contract QuantSwapFactory {
    error IdenticalAddresses();
    error ZeroAddress();
    error PairExists();
    error Forbidden();

    address public feeTo;
    address public feeToSetter;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairsLength);
    event FeeToChanged(address indexed previous, address indexed current);
    event FeeToSetterChanged(address indexed previous, address indexed current);

    constructor(address feeToSetter_) {
        if (feeToSetter_ == address(0)) revert ZeroAddress();
        feeToSetter = feeToSetter_;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice Init code hash of the pair, for off-chain address computation.
    /// @dev Exposed rather than hardcoded in the periphery: a stale constant here is a
    ///      classic source of "funds sent to an address with no code" incidents on forks.
    function pairCodeHash() external pure returns (bytes32) {
        return keccak256(type(QuantSwapPair).creationCode);
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();

        pair = address(new QuantSwapPair{salt: keccak256(abi.encodePacked(token0, token1))}());
        QuantSwapPair(pair).initialize(token0, token1);

        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address feeTo_) external {
        if (msg.sender != feeToSetter) revert Forbidden();
        emit FeeToChanged(feeTo, feeTo_);
        feeTo = feeTo_;
    }

    function setFeeToSetter(address feeToSetter_) external {
        if (msg.sender != feeToSetter) revert Forbidden();
        if (feeToSetter_ == address(0)) revert ZeroAddress();
        emit FeeToSetterChanged(feeToSetter, feeToSetter_);
        feeToSetter = feeToSetter_;
    }
}

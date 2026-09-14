// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

/// @notice Token transfers that tolerate non-standard ERC20s: tokens that return nothing
///         (USDT is the canonical example) and tokens that return false instead of reverting.
library TransferHelper {
    error ApproveFailed();
    error TransferFailed();
    error TransferFromFailed();
    error EthTransferFailed();

    function safeApprove(address token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x095ea7b3, to, value));
        if (!(ok && (data.length == 0 || abi.decode(data, (bool))))) revert ApproveFailed();
    }

    function safeTransfer(address token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, value));
        if (!(ok && (data.length == 0 || abi.decode(data, (bool))))) revert TransferFailed();
    }

    function safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, value));
        if (!(ok && (data.length == 0 || abi.decode(data, (bool))))) revert TransferFromFailed();
    }

    function safeTransferETH(address to, uint256 value) internal {
        (bool ok,) = to.call{value: value}(new bytes(0));
        if (!ok) revert EthTransferFailed();
    }
}

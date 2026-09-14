"use client";

import type { SwapRecord } from "@/lib/api";
import { formatAddress, formatNumber, timeAgo } from "@/lib/format";

export function TradeFeed({ swaps }: { swaps: SwapRecord[] }) {
  if (swaps.length === 0) {
    return <p className="muted small">No trades yet.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Side</th>
            <th className="numeric">In</th>
            <th className="numeric">Out</th>
            <th className="numeric">Price</th>
            <th>Account</th>
          </tr>
        </thead>
        <tbody>
          {swaps.map((swap) => (
            <tr key={swap.txHash + swap.blockNumber}>
              <td className="muted">{timeAgo(swap.timestamp)}</td>
              <td className={swap.side === "buy" ? "pos" : "neg"}>{swap.side}</td>
              <td className="numeric">
                {formatNumber(Number(swap.amountIn), 4)} <span className="dim">{swap.tokenIn}</span>
              </td>
              <td className="numeric">
                {formatNumber(Number(swap.amountOut), 4)} <span className="dim">{swap.tokenOut}</span>
              </td>
              <td className="numeric">{formatNumber(swap.price, 6)}</td>
              <td className="mono muted">{formatAddress(swap.recipient)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

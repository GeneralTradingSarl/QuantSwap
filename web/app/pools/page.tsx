"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { indexerApi } from "@/lib/api";
import { formatAddress, formatNumber, formatPercent } from "@/lib/format";

export default function PoolsPage() {
  const pools = useQuery({ queryKey: ["pools"], queryFn: indexerApi.pools, refetchInterval: 10_000 });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Pools</h1>
          <p className="page-sub">Every pair the factory has created, with indexed activity.</p>
        </div>
      </div>

      <section className="card">
        {pools.isLoading ? <div className="skeleton" style={{ height: 160 }} /> : null}
        {pools.isError ? <p className="muted">The indexer API is not reachable.</p> : null}

        {pools.data ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>Address</th>
                  <th className="numeric">Last price</th>
                  <th className="numeric">24h change</th>
                  <th className="numeric">24h volume</th>
                  <th className="numeric">24h fees</th>
                  <th className="numeric">Trades</th>
                </tr>
              </thead>
              <tbody>
                {pools.data.map((pool) => (
                  <tr key={pool.address}>
                    <td>
                      <Link href={`/pools/${pool.address}`}>{pool.label}</Link>
                    </td>
                    <td className="mono muted">{formatAddress(pool.address)}</td>
                    <td className="numeric">{formatNumber(pool.lastTradePrice, 6)}</td>
                    <td className={`numeric ${pool.priceChange24h >= 0 ? "pos" : "neg"}`}>
                      {formatPercent(pool.priceChange24h)}
                    </td>
                    <td className="numeric">
                      {formatNumber(pool.volume24h.token0, 2)} {pool.token0.symbol}
                    </td>
                    <td className="numeric">
                      {formatNumber(pool.fees24h.token0, 4)} {pool.token0.symbol}
                    </td>
                    <td className="numeric">{pool.trades24h}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}

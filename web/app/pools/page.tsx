"use client";

import Link from "next/link";
import { usePools } from "@/lib/usePools";
import { formatAddress, formatNumber, formatPercent } from "@/lib/format";

export default function PoolsPage() {
  const pools = usePools();
  const liveOnly = pools.data?.source === "chain";
  const isDemo = pools.data?.source === "demo";

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
        {isDemo ? (
          <p className="notice notice-warning" style={{ marginTop: 0, marginBottom: 14 }}>
            Demo data: a snapshot of a seeded local market. Numbers below are real output from
            the contracts and the indexer, captured at a point in time rather than live.
          </p>
        ) : null}
        {liveOnly ? (
          <p className="notice" style={{ marginTop: 0, marginBottom: 14 }}>
            Live reserves read from the chain. Volume, fees and history require the indexer.
          </p>
        ) : null}

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
                {pools.data.pools.map((pool) => (
                  <tr key={pool.address}>
                    <td>
                      <Link href={`/pools/${pool.address}`}>{pool.label}</Link>
                    </td>
                    <td className="mono muted">{formatAddress(pool.address)}</td>
                    <td className="numeric">{formatNumber(pool.lastTradePrice, 6)}</td>
                    <td className={`numeric ${pool.priceChange24h >= 0 ? "pos" : "neg"}`}>
                      {liveOnly ? <span className="dim">-</span> : formatPercent(pool.priceChange24h)}
                    </td>
                    <td className="numeric">
                      {isDemo ? (
          <p className="notice notice-warning" style={{ marginTop: 0, marginBottom: 14 }}>
            Demo data: a snapshot of a seeded local market. Numbers below are real output from
            the contracts and the indexer, captured at a point in time rather than live.
          </p>
        ) : null}
        {liveOnly ? (
                        <span className="dim">-</span>
                      ) : (
                        <>
                          {formatNumber(pool.volume24h.token0, 2)} {pool.token0.symbol}
                        </>
                      )}
                    </td>
                    <td className="numeric">
                      {isDemo ? (
          <p className="notice notice-warning" style={{ marginTop: 0, marginBottom: 14 }}>
            Demo data: a snapshot of a seeded local market. Numbers below are real output from
            the contracts and the indexer, captured at a point in time rather than live.
          </p>
        ) : null}
        {liveOnly ? (
                        <span className="dim">-</span>
                      ) : (
                        <>
                          {formatNumber(pool.fees24h.token0, 4)} {pool.token0.symbol}
                        </>
                      )}
                    </td>
                    <td className="numeric">{liveOnly ? <span className="dim">-</span> : pool.trades24h}</td>
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

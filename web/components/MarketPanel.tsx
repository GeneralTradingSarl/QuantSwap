"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { indexerApi } from "@/lib/api";
import { usePools } from "@/lib/usePools";
import { formatNumber, formatPercent } from "@/lib/format";

/** Live market summary next to the swap form, straight from the indexer. */
export function MarketPanel() {
  const pools = usePools();
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: indexerApi.stats,
    refetchInterval: 15_000,
    retry: false,
  });
  const liveOnly = pools.data?.source === "chain";

  return (
    <div className="stack">
      <div className="stat-grid" style={{ marginBottom: 0 }}>
        <Stat label="Pools" value={String(stats.data?.pools ?? pools.data?.pools.length ?? "-")} />
        <Stat label="Swaps (24h)" value={stats.data ? String(stats.data.swaps24h) : "-"} />
        <Stat label="Traders (24h)" value={stats.data ? String(stats.data.uniqueTraders24h) : "-"} />
      </div>

      <section className="card">
        <h2 className="card-title">Markets</h2>
        <p className="card-subtitle">Reserves and 24 hour activity, from indexed events.</p>

        {liveOnly ? (
          <p className="notice" style={{ marginTop: 0, marginBottom: 14 }}>
            No indexer is reachable, so this table shows live reserves read directly from the
            chain. Volume, fees and price history need the indexer: run{" "}
            <span className="mono">npm run indexer</span>.
          </p>
        ) : null}

        {pools.isLoading ? <div className="skeleton" style={{ height: 120 }} /> : null}

        {pools.data ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th className="numeric">Price</th>
                  <th className="numeric">24h</th>
                  <th className="numeric">Liquidity</th>
                  <th className="numeric">Trades</th>
                </tr>
              </thead>
              <tbody>
                {pools.data.pools.map((pool) => (
                  <tr key={pool.address}>
                    <td>
                      <Link href={`/pools/${pool.address}`}>{pool.label}</Link>
                    </td>
                    <td className="numeric">{formatNumber(pool.lastTradePrice, 6)}</td>
                    <td className={`numeric ${pool.priceChange24h >= 0 ? "pos" : "neg"}`}>
                      {liveOnly ? <span className="dim">-</span> : formatPercent(pool.priceChange24h)}
                    </td>
                    <td className="numeric">
                      {formatNumber(Number(pool.reserve0), 2)} / {formatNumber(Number(pool.reserve1), 2)}
                    </td>
                    <td className="numeric">{liveOnly ? <span className="dim">-</span> : pool.trades24h}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

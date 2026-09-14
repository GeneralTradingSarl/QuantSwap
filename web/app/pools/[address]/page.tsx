"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { indexerApi } from "@/lib/api";
import { PriceChart } from "@/components/PriceChart";
import { TradeFeed } from "@/components/TradeFeed";
import { formatNumber, formatPercent } from "@/lib/format";

const INTERVALS = [
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
];

export default function PoolPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const interval = INTERVALS[1]!.seconds;

  const pool = useQuery({
    queryKey: ["pool", address],
    queryFn: () => indexerApi.pool(address),
    refetchInterval: 10_000,
  });
  const candles = useQuery({
    queryKey: ["candles", address, interval],
    queryFn: () => indexerApi.candles(address, interval, 120),
    refetchInterval: 15_000,
  });
  const swaps = useQuery({
    queryKey: ["swaps", address],
    queryFn: () => indexerApi.swaps(address, 25),
    refetchInterval: 10_000,
  });

  if (pool.isError) {
    return <p className="muted">Pool not found, or the indexer is not reachable.</p>;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{pool.data?.label ?? "Pool"}</h1>
          <p className="page-sub mono">{address}</p>
        </div>
        {pool.data ? (
          <div className="row">
            <div style={{ textAlign: "right" }}>
              <div className="stat-value">{formatNumber(pool.data.lastTradePrice, 6)}</div>
              <div className={`small ${pool.data.priceChange24h >= 0 ? "pos" : "neg"}`}>
                {formatPercent(pool.data.priceChange24h)} 24h
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {pool.data ? (
        <div className="stat-grid">
          <Stat
            label={`${pool.data.token0.symbol} reserve`}
            value={formatNumber(Number(pool.data.reserve0), 2)}
          />
          <Stat
            label={`${pool.data.token1.symbol} reserve`}
            value={formatNumber(Number(pool.data.reserve1), 2)}
          />
          <Stat
            label="24h volume"
            value={`${formatNumber(pool.data.volume24h.token0, 2)} ${pool.data.token0.symbol}`}
          />
          <Stat
            label="24h fees to LPs"
            value={`${formatNumber(pool.data.fees24h.token0, 4)} ${pool.data.token0.symbol}`}
          />
        </div>
      ) : null}

      <div className="stack">
        <section className="card">
          <h2 className="card-title">Price</h2>
          <p className="card-subtitle">
            {pool.data ? `${pool.data.token1.symbol} per ${pool.data.token0.symbol}` : ""}, 15 minute
            candles from executed swaps.
          </p>
          {candles.isLoading ? (
            <div className="skeleton" style={{ height: 260 }} />
          ) : (
            <PriceChart candles={candles.data ?? []} quoteSymbol={pool.data?.token1.symbol ?? ""} />
          )}
        </section>

        <section className="card">
          <h2 className="card-title">Recent trades</h2>
          <p className="card-subtitle">Directly from indexed Swap events.</p>
          <TradeFeed swaps={swaps.data ?? []} />
        </section>
      </div>
    </>
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

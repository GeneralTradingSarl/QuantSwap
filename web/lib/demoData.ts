import type { Candle, PoolSummary, ProtocolStats, SwapRecord } from "./api";

/**
 * Demo dataset.
 *
 * A public deployment of this interface has no contracts to talk to: they live on a local
 * chain a visitor does not have. Rather than show an empty shell, the app can serve a
 * snapshot captured from a real seeded run of the contracts and the indexer, so the swap
 * form, the charts and the trade feed render exactly what they render against live data.
 *
 * It is opt-in via NEXT_PUBLIC_DEMO and every view that uses it says so on screen. Quietly
 * presenting a fixture as live market data would be the one thing worse than an empty page.
 */
export const demoEnabled = process.env.NEXT_PUBLIC_DEMO === "1";

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) throw new Error(`demo dataset missing: ${path}`);
  return (await response.json()) as T;
}

export const demoApi = {
  pools: () => loadJson<{ pools: PoolSummary[] }>("/demo/pools.json").then((r) => r.pools),
  stats: () => loadJson<ProtocolStats>("/demo/stats.json"),
  pool: (address: string) => loadJson<PoolSummary>(`/demo/pools/${address}/index.json`),
  candles: (address: string) =>
    loadJson<{ candles: Candle[] }>(`/demo/pools/${address}/candles.json`).then((r) => r.candles),
  swaps: (address: string) =>
    loadJson<{ swaps: SwapRecord[] }>(`/demo/pools/${address}/swaps.json`).then((r) => r.swaps),
};

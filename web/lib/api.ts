/** Client for the indexer API. Everything historical comes from here, never from an RPC node. */
export type PoolSummary = {
  address: `0x${string}`;
  label: string;
  token0: { address: `0x${string}`; symbol: string; name: string; decimals: number };
  token1: { address: `0x${string}`; symbol: string; name: string; decimals: number };
  reserve0: string;
  reserve1: string;
  spotPrice: number;
  lastTradePrice: number;
  priceChange24h: number;
  volume24h: { token0: number; token1: number };
  fees24h: { token0: number; token1: number };
  trades24h: number;
};

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  trades: number;
};

export type SwapRecord = {
  txHash: string;
  blockNumber: number;
  timestamp: number;
  recipient: string;
  side: "buy" | "sell";
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
  price: number;
};

export type ProtocolStats = {
  pools: number;
  swaps24h: number;
  swapsTotal: number;
  uniqueTraders24h: number;
};

const BASE_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:4000";

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, { ...init, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`indexer ${response.status} on ${path}`);
  }
  return (await response.json()) as T;
}

export const indexerApi = {
  pools: () => get<{ pools: PoolSummary[] }>("/pools").then((r) => r.pools),
  pool: (address: string) => get<PoolSummary>(`/pools/${address}`),
  candles: (address: string, interval = 300, limit = 200) =>
    get<{ candles: Candle[] }>(`/pools/${address}/candles?interval=${interval}&limit=${limit}`).then(
      (r) => r.candles
    ),
  swaps: (address: string, limit = 25) =>
    get<{ swaps: SwapRecord[] }>(`/pools/${address}/swaps?limit=${limit}`).then((r) => r.swaps),
  stats: () => get<ProtocolStats>("/stats"),
  health: () => get<{ status: string; lastIndexedBlock: number | null }>("/health"),
};

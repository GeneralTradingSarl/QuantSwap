"use client";

import { useQuery } from "@tanstack/react-query";
import { indexerApi, type PoolSummary } from "./api";
import { readPoolsFromChain } from "./chainPools";
import { demoApi, demoEnabled } from "./demoData";
import { useDeployment } from "./hooks";

/**
 * Where pool data comes from, in order:
 *
 *   indexer → the full picture: reserves, volume, fees, candles, trade history
 *   chain   → live reserves read by multicall when no indexer answers
 *   demo    → a captured snapshot, only when the build opts in, only labelled as such
 *
 * The caller is always told which one answered, because an interface that cannot say
 * whether its numbers are live is worse than one that shows nothing.
 */
export type PoolSource = "indexer" | "chain" | "demo";

export type PoolsResult = {
  pools: PoolSummary[];
  source: PoolSource;
};

/**
 * A build with no indexer configured and the demo enabled is a public showcase: going
 * through two network failures on every page load to reach that conclusion is wasted time
 * and a console full of red.
 */
const demoFirst = demoEnabled && !process.env.NEXT_PUBLIC_INDEXER_URL;

export function usePools() {
  const { chainId } = useDeployment();

  return useQuery<PoolsResult>({
    queryKey: ["pools", chainId],
    refetchInterval: demoFirst ? false : 10_000,
    queryFn: async () => {
      if (demoFirst) return { pools: await demoApi.pools(), source: "demo" };
      try {
        const pools = await indexerApi.pools();
        if (pools.length > 0) return { pools, source: "indexer" };
      } catch {
        // An unreachable indexer is a degraded mode, not a failure.
      }

      try {
        const pools = await readPoolsFromChain(chainId);
        if (pools.length > 0) return { pools, source: "chain" };
      } catch {
        // No RPC either: fall through to the snapshot if this build has one.
      }

      if (demoEnabled) return { pools: await demoApi.pools(), source: "demo" };
      return { pools: [], source: "chain" };
    },
  });
}

/** A single pool, with the same source ladder. */
export function usePool(address: string) {
  const { chainId } = useDeployment();

  return useQuery<{ pool: PoolSummary | undefined; source: PoolSource }>({
    queryKey: ["pool", chainId, address],
    refetchInterval: demoFirst ? false : 10_000,
    queryFn: async () => {
      if (demoFirst) return { pool: await demoApi.pool(address), source: "demo" };
      try {
        return { pool: await indexerApi.pool(address), source: "indexer" };
      } catch {
        // fall through
      }

      try {
        const pools = await readPoolsFromChain(chainId);
        const match = pools.find((pool) => pool.address.toLowerCase() === address.toLowerCase());
        if (match) return { pool: match, source: "chain" };
      } catch {
        // fall through
      }

      if (demoEnabled) return { pool: await demoApi.pool(address), source: "demo" };
      return { pool: undefined, source: "chain" };
    },
  });
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { indexerApi, type PoolSummary } from "./api";
import { readPoolsFromChain } from "./chainPools";
import { useDeployment } from "./hooks";

export type PoolsResult = {
  pools: PoolSummary[];
  /** "indexer" when history is available, "chain" when only live reserves could be read. */
  source: "indexer" | "chain";
};

/**
 * Pool data with a degraded mode instead of an error state: try the indexer, fall back to
 * reading reserves directly from the chain. The caller is told which source answered so the
 * interface can be honest about what it is showing.
 */
export function usePools() {
  const { chainId } = useDeployment();

  return useQuery<PoolsResult>({
    queryKey: ["pools", chainId],
    refetchInterval: 10_000,
    queryFn: async () => {
      try {
        const pools = await indexerApi.pools();
        if (pools.length > 0) return { pools, source: "indexer" };
      } catch {
        // Fall through: an unreachable indexer is a degraded mode, not a failure.
      }
      return { pools: await readPoolsFromChain(chainId), source: "chain" };
    },
  });
}

/** A single pool, with the same degraded mode as `usePools`. */
export function usePool(address: string) {
  const { chainId } = useDeployment();

  return useQuery<{ pool: PoolSummary | undefined; source: "indexer" | "chain" }>({
    queryKey: ["pool", chainId, address],
    refetchInterval: 10_000,
    queryFn: async () => {
      try {
        return { pool: await indexerApi.pool(address), source: "indexer" };
      } catch {
        const pools = await readPoolsFromChain(chainId);
        return {
          pool: pools.find((pool) => pool.address.toLowerCase() === address.toLowerCase()),
          source: "chain",
        };
      }
    },
  });
}

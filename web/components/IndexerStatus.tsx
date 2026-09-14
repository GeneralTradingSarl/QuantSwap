"use client";

import { useQuery } from "@tanstack/react-query";
import { indexerApi } from "@/lib/api";

/** Shows whether the interface is looking at fresh indexed data or at nothing at all. */
export function IndexerStatus() {
  const { data, isError } = useQuery({
    queryKey: ["indexer-health"],
    queryFn: indexerApi.health,
    refetchInterval: 10_000,
  });

  if (isError) {
    return (
      <span className="badge" title="The indexer API is not reachable">
        <span className="dot off" /> indexer offline
      </span>
    );
  }

  return (
    <span className="badge" title="Last block indexed">
      <span className={data ? "dot" : "dot stale"} />
      <span className="mono">{data?.lastIndexedBlock ?? "..."}</span>
    </span>
  );
}

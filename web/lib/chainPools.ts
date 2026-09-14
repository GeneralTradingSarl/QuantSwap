import { createPublicClient, http, formatUnits, type PublicClient } from "viem";
import { quantSwapPairAbi } from "@/generated/abis";
import type { PoolSummary } from "./api";
import { deploymentFor, type Deployment } from "./deployment";
import { supportedChains } from "./wagmi";

/**
 * Fallback market data read straight from the chain.
 *
 * The indexer is the right source for anything historical, but a public deployment of this
 * interface should still work when no backend is running: a visitor gets live reserves and
 * the spot price from a multicall, and the parts that genuinely require an index (volume,
 * fees, candles, trade history) are reported as unavailable rather than faked as zero.
 */
export async function readPoolsFromChain(chainId: number): Promise<PoolSummary[]> {
  const deployment = deploymentFor(chainId);
  if (!deployment || deployment.pairs.length === 0) return [];

  const client = clientFor(chainId);
  const results = await client.multicall({
    contracts: deployment.pairs.map((pair) => ({
      address: pair.address,
      abi: quantSwapPairAbi,
      functionName: "getReserves" as const,
    })),
    allowFailure: true,
  });

  return deployment.pairs.flatMap((pair, index) => {
    const result = results[index];
    if (!result || result.status !== "success") return [];

    const [reserve0, reserve1] = result.result as unknown as [bigint, bigint, number];
    const token0 = tokenByAddress(deployment, pair.token0);
    const token1 = tokenByAddress(deployment, pair.token1);
    if (!token0 || !token1) return [];

    const amount0 = Number(formatUnits(reserve0, token0.decimals));
    const amount1 = Number(formatUnits(reserve1, token1.decimals));
    const spotPrice = amount0 === 0 ? 0 : amount1 / amount0;

    return [
      {
        address: pair.address,
        label: `${token0.symbol}/${token1.symbol}`,
        token0,
        token1,
        reserve0: String(amount0),
        reserve1: String(amount1),
        spotPrice,
        lastTradePrice: spotPrice,
        priceChange24h: 0,
        volume24h: { token0: 0, token1: 0 },
        fees24h: { token0: 0, token1: 0 },
        trades24h: 0,
      },
    ];
  });
}

function tokenByAddress(deployment: Deployment, address: string) {
  return Object.values(deployment.tokens).find(
    (token) => token.address.toLowerCase() === address.toLowerCase()
  );
}

function clientFor(chainId: number): PublicClient {
  const chain = supportedChains.find((candidate) => candidate.id === chainId);
  const url = process.env.NEXT_PUBLIC_RPC_URL ?? chain?.rpcUrls.default.http[0];
  return createPublicClient({ chain, transport: http(url) }) as PublicClient;
}

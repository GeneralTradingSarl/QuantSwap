"use client";

import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { erc20Abi, zeroAddress } from "viem";
import { quantSwapFactoryAbi, quantSwapPairAbi } from "@/generated/abis";
import { defaultChainId, deploymentFor, type TokenInfo } from "./deployment";

/**
 * The deployment the interface is pointed at. Before a wallet is connected there is no
 * chain id to read, so it falls back to the default deployment: the token list and the
 * pool data should render for a visitor who has not connected anything yet.
 */
export function useDeployment() {
  const { chainId, isConnected } = useAccount();
  const activeChainId = chainId ?? defaultChainId;
  const deployment = deploymentFor(activeChainId);
  return {
    deployment,
    chainId: activeChainId,
    isSupported: Boolean(deployment) && (!isConnected || deploymentFor(chainId) !== undefined),
  };
}

/** Address of the pool for a token couple, or undefined when no pool exists yet. */
export function usePairAddress(tokenA?: TokenInfo, tokenB?: TokenInfo) {
  const { deployment } = useDeployment();

  const query = useReadContract({
    address: deployment?.contracts.factory,
    abi: quantSwapFactoryAbi,
    functionName: "getPair",
    args: tokenA && tokenB ? [tokenA.address, tokenB.address] : undefined,
    query: { enabled: Boolean(deployment && tokenA && tokenB && tokenA.address !== tokenB.address) },
  });

  const address = query.data as `0x${string}` | undefined;
  return { ...query, address: address && address !== zeroAddress ? address : undefined };
}

/**
 * Reserves oriented to the caller's token order, so consumers never have to remember which
 * side token0 is. Polled rather than subscribed: a quote from a two-second-old reserve is
 * fine because the on-chain minimum output is what actually protects the trade.
 */
export function usePairReserves(pair?: `0x${string}`, tokenIn?: TokenInfo) {
  const query = useReadContracts({
    contracts: pair
      ? [
          { address: pair, abi: quantSwapPairAbi, functionName: "getReserves" },
          { address: pair, abi: quantSwapPairAbi, functionName: "token0" },
        ]
      : [],
    query: { enabled: Boolean(pair), refetchInterval: 4000 },
  });

  const reservesResult = query.data?.[0];
  const token0Result = query.data?.[1];

  if (
    !tokenIn ||
    reservesResult?.status !== "success" ||
    token0Result?.status !== "success"
  ) {
    return { ...query, reserveIn: undefined, reserveOut: undefined };
  }

  const [reserve0, reserve1] = reservesResult.result as [bigint, bigint, number];
  const token0 = token0Result.result as `0x${string}`;
  const inputIsToken0 = token0.toLowerCase() === tokenIn.address.toLowerCase();

  return {
    ...query,
    reserveIn: inputIsToken0 ? reserve0 : reserve1,
    reserveOut: inputIsToken0 ? reserve1 : reserve0,
  };
}

export function useTokenBalance(token?: TokenInfo) {
  const { address } = useAccount();

  return useReadContract({
    address: token?.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(token && address), refetchInterval: 8000 },
  });
}

export function useAllowance(token?: TokenInfo, spender?: `0x${string}`) {
  const { address } = useAccount();

  return useReadContract({
    address: token?.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && spender ? [address, spender] : undefined,
    query: { enabled: Boolean(token && address && spender) },
  });
}

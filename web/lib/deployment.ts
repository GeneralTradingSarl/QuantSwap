import deployments from "@/generated/deployments.json";

export type TokenInfo = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
};

export type Deployment = {
  chainId: number;
  network: string;
  startBlock: number;
  contracts: {
    factory: `0x${string}`;
    router: `0x${string}`;
    weth: `0x${string}`;
    oracle: `0x${string}`;
  };
  tokens: Record<string, TokenInfo>;
  pairs: { address: `0x${string}`; token0: `0x${string}`; token1: `0x${string}`; label: string }[];
};

const registry = deployments as unknown as Record<string, Deployment>;

export const supportedChainIds = Object.keys(registry).map(Number);

export function deploymentFor(chainId: number | undefined): Deployment | undefined {
  if (chainId === undefined) return undefined;
  return registry[String(chainId)];
}

/** The chain the app defaults to before a wallet is connected. */
export const defaultChainId = supportedChainIds[0] ?? 31337;

export function tokenList(deployment: Deployment | undefined): TokenInfo[] {
  if (!deployment) return [];
  return Object.values(deployment.tokens).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

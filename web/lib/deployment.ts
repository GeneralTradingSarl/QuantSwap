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

/**
 * The chain the app defaults to before a wallet is connected.
 *
 * A public deployment should open on the public network, not on whatever local chain the
 * deployment file happens to list first, so a real network wins over 31337 unless an
 * explicit override is set at build time.
 */
export const defaultChainId = (() => {
  const override = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID);
  if (Number.isFinite(override) && supportedChainIds.includes(override)) return override;
  const publicChain = supportedChainIds.find((id) => id !== 31337);
  return publicChain ?? supportedChainIds[0] ?? 31337;
})();

export function tokenList(deployment: Deployment | undefined): TokenInfo[] {
  if (!deployment) return [];
  return Object.values(deployment.tokens).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

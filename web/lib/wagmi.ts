import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { sepolia, baseSepolia, arbitrumSepolia, hardhat } from "wagmi/chains";
// `injected` comes from @wagmi/core rather than the wagmi/connectors barrel on purpose: that
// barrel also pulls in a payments SDK and its optional native dependencies, which lands in
// the browser bundle for no benefit here. Adding WalletConnect later means importing it from
// "@wagmi/connectors/walletConnect" directly, not re-opening the barrel.
import { injected } from "@wagmi/core";
import type { Chain } from "viem";
import { supportedChainIds } from "./deployment";

const KNOWN_CHAINS: Chain[] = [hardhat, sepolia, baseSepolia, arbitrumSepolia];

/**
 * Only chains the contracts are actually deployed on are offered. A wallet connected to a
 * chain with no deployment is a wrong-network state the interface handles explicitly,
 * rather than a swap button that reverts.
 */
const chains = KNOWN_CHAINS.filter((chain) => supportedChainIds.includes(chain.id));
const activeChains = (chains.length > 0 ? chains : [hardhat]) as [Chain, ...Chain[]];

export const wagmiConfig = createConfig({
  chains: activeChains,
  connectors: [injected({ shimDisconnect: true })],
  transports: Object.fromEntries(
    activeChains.map((chain) => [
      chain.id,
      http(process.env.NEXT_PUBLIC_RPC_URL ?? chain.rpcUrls.default.http[0]),
    ])
  ),
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

export const supportedChains = activeChains;

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { formatAddress } from "@/lib/format";
import { deploymentFor, defaultChainId } from "@/lib/deployment";

/**
 * Connection UI. The three states that matter are: not connected, connected to a chain the
 * contracts are on, and connected to a chain they are not. The third one is the state most
 * interfaces forget, and it is the one that produces confusing reverts.
 */
export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  if (!isConnected) {
    const connector = connectors[0];
    return (
      <div className="row">
        {error ? <span className="small neg">{shorten(error.message)}</span> : null}
        <button
          className="btn btn-primary"
          disabled={!connector || isPending}
          onClick={() => connector && connect({ connector })}
        >
          {isPending ? "Connecting..." : "Connect wallet"}
        </button>
      </div>
    );
  }

  const onSupportedChain = Boolean(deploymentFor(chainId));

  if (!onSupportedChain) {
    return (
      <button
        className="btn"
        style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        disabled={isSwitching}
        onClick={() => switchChain({ chainId: defaultChainId })}
      >
        {isSwitching ? "Switching..." : "Wrong network"}
      </button>
    );
  }

  return (
    <button className="btn" onClick={() => disconnect()} title="Disconnect">
      <span className="mono">{address ? formatAddress(address) : ""}</span>
    </button>
  );
}

function shorten(message: string) {
  return message.length > 60 ? `${message.slice(0, 60)}...` : message;
}

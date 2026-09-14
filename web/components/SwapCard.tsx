"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { erc20Abi } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { quantSwapRouterAbi } from "@/generated/abis";
import { tokenList, type TokenInfo } from "@/lib/deployment";
import { useAllowance, useDeployment, usePairAddress, usePairReserves, useTokenBalance } from "@/lib/hooks";
import { deadlineFromNow, getAmountOut, minimumReceived, priceImpact } from "@/lib/amm";
import { formatAmount, formatPercent, parseAmount } from "@/lib/format";
import { TokenSelect } from "./TokenSelect";

const SLIPPAGE_PRESETS = [10, 50, 100]; // basis points
const HIGH_IMPACT = 0.03;
const SEVERE_IMPACT = 0.1;

type Stage = "idle" | "approving" | "swapping";

export function SwapCard() {
  const { isConnected } = useAccount();
  const { deployment, isSupported } = useDeployment();
  const tokens = useMemo(() => tokenList(deployment), [deployment]);
  const queryClient = useQueryClient();

  const [tokenIn, setTokenIn] = useState<TokenInfo>();
  const [tokenOut, setTokenOut] = useState<TokenInfo>();
  const [amountInput, setAmountInput] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [deadlineMinutes, setDeadlineMinutes] = useState(20);
  const [showSettings, setShowSettings] = useState(false);
  const [acceptedImpact, setAcceptedImpact] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");

  // Default to the first two tokens of the deployment once it is known.
  useEffect(() => {
    if (!tokenIn && tokens[0]) setTokenIn(tokens[0]);
    if (!tokenOut && tokens[1]) setTokenOut(tokens[1]);
  }, [tokens, tokenIn, tokenOut]);

  const { address: pairAddress, isLoading: pairLoading } = usePairAddress(tokenIn, tokenOut);
  const { reserveIn, reserveOut } = usePairReserves(pairAddress, tokenIn);
  const { data: balance } = useTokenBalance(tokenIn);
  const { data: allowance, refetch: refetchAllowance } = useAllowance(
    tokenIn,
    deployment?.contracts.router
  );

  const amountIn = tokenIn ? parseAmount(amountInput, tokenIn.decimals) : null;
  const quote = useMemo(() => {
    if (!amountIn || amountIn <= 0n || reserveIn === undefined || reserveOut === undefined) return null;
    const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
    if (amountOut <= 0n) return null;
    return {
      amountOut,
      impact: priceImpact(amountIn, reserveIn, reserveOut),
      minimum: minimumReceived(amountOut, slippageBps),
    };
  }, [amountIn, reserveIn, reserveOut, slippageBps]);

  const { writeContractAsync, isPending: isSigning, error: writeError, reset } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  // When a transaction confirms, refresh everything it could have changed.
  useEffect(() => {
    if (receipt.isSuccess) {
      refetchAllowance();
      queryClient.invalidateQueries();
      if (stage === "swapping") setAmountInput("");
      setStage("idle");
    }
  }, [receipt.isSuccess, refetchAllowance, queryClient, stage]);

  const needsApproval = Boolean(amountIn && allowance !== undefined && allowance < amountIn);
  const insufficientBalance = Boolean(amountIn && balance !== undefined && amountIn > balance);
  const severeImpact = (quote?.impact ?? 0) >= SEVERE_IMPACT;

  async function onApprove() {
    if (!tokenIn || !amountIn || !deployment) return;
    setStage("approving");
    try {
      // Approve exactly what this trade needs. An infinite approval is convenient and is
      // also the single most common way a compromised contract drains a wallet later.
      const hash = await writeContractAsync({
        address: tokenIn.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [deployment.contracts.router, amountIn],
      });
      setTxHash(hash);
    } catch {
      setStage("idle");
    }
  }

  async function onSwap() {
    if (!tokenIn || !tokenOut || !amountIn || !quote || !deployment) return;
    setStage("swapping");
    try {
      const hash = await writeContractAsync({
        address: deployment.contracts.router,
        abi: quantSwapRouterAbi,
        functionName: "swapExactTokensForTokens",
        args: [
          amountIn,
          quote.minimum,
          [tokenIn.address, tokenOut.address],
          (await currentAccount()) as `0x${string}`,
          deadlineFromNow(deadlineMinutes),
        ],
      });
      setTxHash(hash);
    } catch {
      setStage("idle");
    }
  }

  function flip() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountInput("");
    reset();
  }

  const busy = isSigning || receipt.isLoading;

  return (
    <section className="card">
      <div className="swap-head">
        <div>
          <h2 className="card-title">Swap</h2>
          <p className="card-subtitle" style={{ margin: 0 }}>
            Constant product, 0.30% fee
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => setShowSettings((open) => !open)}>
          {slippageBps / 100}% slippage
        </button>
      </div>

      {showSettings ? (
        <div className="settings-panel">
          <div>
            <div className="small muted" style={{ marginBottom: 8 }}>
              Slippage tolerance
            </div>
            <div className="slippage-options">
              {SLIPPAGE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  className={`chip${slippageBps === preset ? " selected" : ""}`}
                  onClick={() => setSlippageBps(preset)}
                >
                  {preset / 100}%
                </button>
              ))}
              <input
                className="chip-input"
                inputMode="decimal"
                value={String(slippageBps / 100)}
                onChange={(event) => {
                  const percent = Number(event.target.value);
                  if (Number.isFinite(percent)) {
                    setSlippageBps(Math.min(5000, Math.max(1, Math.round(percent * 100))));
                  }
                }}
                aria-label="Custom slippage percentage"
              />
            </div>
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 8 }}>
              Transaction deadline (minutes)
            </div>
            <input
              className="chip-input"
              inputMode="numeric"
              value={String(deadlineMinutes)}
              onChange={(event) => {
                const minutes = Number(event.target.value);
                if (Number.isFinite(minutes)) setDeadlineMinutes(Math.min(180, Math.max(1, minutes)));
              }}
              aria-label="Deadline in minutes"
            />
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <div className="token-field">
          <div className="token-field-head">
            <span>You pay</span>
            <span>
              {balance !== undefined && tokenIn ? (
                <>
                  Balance {formatAmount(balance, tokenIn.decimals)}
                  <button
                    className="max-button"
                    onClick={() => setAmountInput(formatMax(balance, tokenIn.decimals))}
                  >
                    MAX
                  </button>
                </>
              ) : null}
            </span>
          </div>
          <div className="token-field-body">
            <input
              className="amount-input"
              inputMode="decimal"
              placeholder="0.0"
              value={amountInput}
              onChange={(event) => {
                const next = event.target.value.replace(/,/g, ".");
                if (/^\d*\.?\d*$/.test(next)) setAmountInput(next);
              }}
            />
            <TokenSelect tokens={tokens} value={tokenIn} onChange={setTokenIn} exclude={tokenOut} />
          </div>
        </div>

        <div className="flip-row">
          <button className="flip-button" onClick={flip} aria-label="Swap direction">
            ↓
          </button>
        </div>

        <div className="token-field">
          <div className="token-field-head">
            <span>You receive</span>
            <span className="dim">estimated</span>
          </div>
          <div className="token-field-body">
            <input
              className="amount-input"
              readOnly
              disabled
              placeholder="0.0"
              value={quote && tokenOut ? formatAmount(quote.amountOut, tokenOut.decimals) : ""}
            />
            <TokenSelect tokens={tokens} value={tokenOut} onChange={setTokenOut} exclude={tokenIn} />
          </div>
        </div>
      </div>

      {quote && tokenIn && tokenOut ? (
        <div className="quote-details">
          <div className="detail-row">
            <span>Rate</span>
            <strong>
              1 {tokenIn.symbol} ={" "}
              {formatAmount(
                (quote.amountOut * 10n ** BigInt(tokenIn.decimals)) / (amountIn as bigint),
                tokenOut.decimals
              )}{" "}
              {tokenOut.symbol}
            </strong>
          </div>
          <div className="detail-row">
            <span>Price impact</span>
            <strong className={quote.impact >= HIGH_IMPACT ? "neg" : undefined}>
              {formatPercent(quote.impact)}
            </strong>
          </div>
          <div className="detail-row">
            <span>Minimum received</span>
            <strong>
              {formatAmount(quote.minimum, tokenOut.decimals)} {tokenOut.symbol}
            </strong>
          </div>
          <div className="detail-row">
            <span>Fee (0.30%)</span>
            <strong>
              {formatAmount((amountIn as bigint) * 3n / 1000n, tokenIn.decimals)} {tokenIn.symbol}
            </strong>
          </div>
        </div>
      ) : null}

      <SwapStatus
        isConnected={isConnected}
        isSupported={isSupported}
        pairLoading={pairLoading}
        hasPair={Boolean(pairAddress)}
        insufficientBalance={insufficientBalance}
        impact={quote?.impact ?? 0}
        error={writeError?.message}
        receiptStatus={receipt.isLoading ? "pending" : receipt.isSuccess ? "success" : undefined}
        txHash={txHash}
      />

      {severeImpact ? (
        <label className="notice notice-danger" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={acceptedImpact}
            onChange={(event) => setAcceptedImpact(event.target.checked)}
          />
          I understand this trade moves the price by {formatPercent(quote?.impact ?? 0)}.
        </label>
      ) : null}

      <div className="steps">
        <div className={`step${needsApproval ? " active" : " done"}`}>1. Approve {tokenIn?.symbol}</div>
        <div className={`step${!needsApproval && quote ? " active" : ""}`}>2. Swap</div>
      </div>

      <div style={{ marginTop: 12 }}>
        {needsApproval ? (
          <button
            className="btn btn-primary btn-block"
            disabled={!isConnected || !isSupported || busy || !quote || insufficientBalance}
            onClick={onApprove}
          >
            {stage === "approving" && busy ? "Approving..." : `Approve ${tokenIn?.symbol ?? ""}`}
          </button>
        ) : (
          <button
            className="btn btn-primary btn-block"
            disabled={
              !isConnected ||
              !isSupported ||
              busy ||
              !quote ||
              insufficientBalance ||
              (severeImpact && !acceptedImpact)
            }
            onClick={onSwap}
          >
            {swapLabel({ isConnected, isSupported, busy, stage, hasQuote: Boolean(quote), insufficientBalance })}
          </button>
        )}
      </div>
    </section>
  );
}

function swapLabel({
  isConnected,
  isSupported,
  busy,
  stage,
  hasQuote,
  insufficientBalance,
}: {
  isConnected: boolean;
  isSupported: boolean;
  busy: boolean;
  stage: Stage;
  hasQuote: boolean;
  insufficientBalance: boolean;
}) {
  if (!isConnected) return "Connect a wallet";
  if (!isSupported) return "Unsupported network";
  if (insufficientBalance) return "Insufficient balance";
  if (busy && stage === "swapping") return "Confirming...";
  if (!hasQuote) return "Enter an amount";
  return "Swap";
}

function SwapStatus({
  isConnected,
  isSupported,
  pairLoading,
  hasPair,
  insufficientBalance,
  impact,
  error,
  receiptStatus,
  txHash,
}: {
  isConnected: boolean;
  isSupported: boolean;
  pairLoading: boolean;
  hasPair: boolean;
  insufficientBalance: boolean;
  impact: number;
  error?: string;
  receiptStatus?: "pending" | "success";
  txHash?: `0x${string}`;
}) {
  if (isConnected && !isSupported) {
    return <div className="notice notice-danger">This network has no QuantSwap deployment.</div>;
  }
  if (isConnected && !pairLoading && !hasPair) {
    return <div className="notice notice-warning">No pool exists for this pair yet.</div>;
  }
  if (error) {
    return <div className="notice notice-danger">{firstLine(error)}</div>;
  }
  if (receiptStatus === "pending") {
    return (
      <div className="notice">
        Waiting for confirmation{txHash ? <span className="mono"> · {txHash.slice(0, 10)}...</span> : null}
      </div>
    );
  }
  if (receiptStatus === "success") {
    return <div className="notice notice-success">Transaction confirmed.</div>;
  }
  if (insufficientBalance) {
    return <div className="notice notice-warning">Amount exceeds your balance.</div>;
  }
  if (impact >= HIGH_IMPACT && impact < SEVERE_IMPACT) {
    return (
      <div className="notice notice-warning">
        This trade moves the pool price by {formatPercent(impact)}. Consider splitting it.
      </div>
    );
  }
  return null;
}

/** The wallet address, read at call time so a mid-session account switch is respected. */
async function currentAccount(): Promise<string> {
  const { getAccount } = await import("wagmi/actions");
  const { wagmiConfig } = await import("@/lib/wagmi");
  const account = getAccount(wagmiConfig);
  if (!account.address) throw new Error("No connected account");
  return account.address;
}

function formatMax(balance: bigint, decimals: number) {
  const whole = balance / 10n ** BigInt(decimals);
  const fraction = (balance % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").slice(0, 8);
  return `${whole}.${fraction}`.replace(/\.?0+$/, "");
}

function firstLine(message: string) {
  return message.split("\n")[0] ?? message;
}

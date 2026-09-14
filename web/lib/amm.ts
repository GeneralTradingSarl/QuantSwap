/**
 * Client-side mirror of the on-chain pricing math.
 *
 * The contract remains the authority: every quote shown here is re-derived on chain inside
 * the swap, and the minimum-output bound is what actually protects the user. This exists so
 * the interface can show price impact and a quote without a round trip per keystroke.
 */
const FEE_NUMERATOR = 997n;
const FEE_DENOMINATOR = 1000n;

export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * FEE_NUMERATOR;
  return (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
}

export function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountOut <= 0n || amountOut >= reserveOut) return 0n;
  return (reserveIn * amountOut * FEE_DENOMINATOR) / ((reserveOut - amountOut) * FEE_NUMERATOR) + 1n;
}

/**
 * Price impact: how far the execution price sits from the pool's mid price, as a fraction.
 * The 0.30% fee is excluded, so the number shown is the cost of the trade's own size and
 * not the fee the user is charged anyway.
 */
export function priceImpact(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): number {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0;

  const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
  if (amountOut === 0n) return 0;

  const PRECISION = 10n ** 18n;
  const midPrice = (reserveOut * PRECISION) / reserveIn;
  const executionPrice = (amountOut * PRECISION) / amountIn;
  const feeAdjusted = (executionPrice * FEE_DENOMINATOR) / FEE_NUMERATOR;

  if (feeAdjusted >= midPrice) return 0;
  return Number(((midPrice - feeAdjusted) * 1_000_000n) / midPrice) / 1_000_000;
}

/** Applies a slippage tolerance (in basis points) to a quoted output. */
export function minimumReceived(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function maximumSold(amountIn: bigint, slippageBps: number): bigint {
  return (amountIn * BigInt(10_000 + slippageBps)) / 10_000n;
}

/** A deadline `minutes` from now, as the contract expects it. */
export function deadlineFromNow(minutes: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + Math.round(minutes * 60));
}

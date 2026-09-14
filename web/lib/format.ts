import { formatUnits, parseUnits } from "viem";

/** Formats a token amount for display without ever showing a rounded-up balance. */
export function formatAmount(value: bigint, decimals: number, maxFractionDigits = 6): string {
  const raw = formatUnits(value, decimals);
  const [whole = "0", fraction = ""] = raw.split(".");
  if (fraction.length === 0) return groupDigits(whole);

  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed.length > 0 ? `${groupDigits(whole)}.${trimmed}` : groupDigits(whole);
}

export function formatNumber(value: number, maxFractionDigits = 4): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits: maxFractionDigits });
}

export function formatPercent(value: number, fractionDigits = 2): string {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Parses user input into base units. Returns null rather than throwing, because an
 * in-progress input like "0." is a normal state of a text field, not an error.
 */
export function parseAmount(input: string, decimals: number): bigint | null {
  if (!input || input === "." || Number.isNaN(Number(input))) return null;
  try {
    return parseUnits(input as `${number}`, decimals);
  } catch {
    return null;
  }
}

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

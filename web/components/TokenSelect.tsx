"use client";

import type { TokenInfo } from "@/lib/deployment";

export function TokenSelect({
  tokens,
  value,
  onChange,
  exclude,
}: {
  tokens: TokenInfo[];
  value?: TokenInfo;
  onChange: (token: TokenInfo) => void;
  exclude?: TokenInfo;
}) {
  return (
    <select
      className="token-select"
      value={value?.address ?? ""}
      onChange={(event) => {
        const token = tokens.find((candidate) => candidate.address === event.target.value);
        if (token) onChange(token);
      }}
      aria-label="Select token"
    >
      {tokens
        .filter((token) => token.address !== exclude?.address)
        .map((token) => (
          <option key={token.address} value={token.address}>
            {token.symbol}
          </option>
        ))}
    </select>
  );
}

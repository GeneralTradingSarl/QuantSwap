"use client";

import { useMemo, useState } from "react";
import type { Candle } from "@/lib/api";
import { formatNumber } from "@/lib/format";

const WIDTH = 720;
const HEIGHT = 280;
const PADDING = { top: 16, right: 56, bottom: 24, left: 8 };

/**
 * Candlestick chart drawn as plain SVG.
 *
 * No charting library: the data is already shaped by the indexer, the interactions are a
 * crosshair and a tooltip, and a dependency that ships its own canvas renderer would be
 * more code than this file for the same result.
 */
export function PriceChart({ candles, quoteSymbol }: { candles: Candle[]; quoteSymbol: string }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (candles.length === 0) return null;

    const lows = candles.map((candle) => candle.low);
    const highs = candles.map((candle) => candle.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const pad = (max - min) * 0.08 || max * 0.02 || 1;
    const domain = { min: min - pad, max: max + pad };

    const plotWidth = WIDTH - PADDING.left - PADDING.right;
    const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const step = plotWidth / candles.length;

    const x = (index: number) => PADDING.left + index * step + step / 2;
    const y = (value: number) =>
      PADDING.top + plotHeight - ((value - domain.min) / (domain.max - domain.min)) * plotHeight;

    return { domain, step, x, y, plotHeight };
  }, [candles]);

  if (!geometry || candles.length === 0) {
    return (
      <div className="card" style={{ display: "grid", placeItems: "center", height: 240 }}>
        <span className="muted small">No trades indexed for this pool yet.</span>
      </div>
    );
  }

  const { domain, step, x, y } = geometry;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => domain.min + (domain.max - domain.min) * fraction);
  const active = hovered !== null ? candles[hovered] : undefined;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Price chart">
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="grid-line" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y(tick)} y2={y(tick)} />
            <text className="axis-label" x={WIDTH - PADDING.right + 6} y={y(tick) + 3}>
              {formatNumber(tick, 6)}
            </text>
          </g>
        ))}

        {candles.map((candle, index) => {
          const up = candle.close >= candle.open;
          const bodyTop = y(Math.max(candle.open, candle.close));
          const bodyBottom = y(Math.min(candle.open, candle.close));
          const bodyHeight = Math.max(1, bodyBottom - bodyTop);
          const bodyWidth = Math.min(18, Math.max(1.5, step * 0.6));

          return (
            <g
              key={candle.time}
              className={up ? "candle-up" : "candle-down"}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            >
              <rect
                x={x(index) - step / 2}
                y={PADDING.top}
                width={step}
                height={HEIGHT - PADDING.top - PADDING.bottom}
                fill="transparent"
                stroke="none"
              />
              <line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} strokeWidth={1} />
              <rect x={x(index) - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} />
            </g>
          );
        })}

        {hovered !== null ? (
          <line
            className="grid-line"
            x1={x(hovered)}
            x2={x(hovered)}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
            strokeDasharray="3 3"
          />
        ) : null}

        <text className="axis-label" x={PADDING.left} y={HEIGHT - 6}>
          {new Date((candles[0]?.time ?? 0) * 1000).toLocaleString()}
        </text>
        <text className="axis-label" x={WIDTH - PADDING.right} y={HEIGHT - 6} textAnchor="end">
          {new Date((candles[candles.length - 1]?.time ?? 0) * 1000).toLocaleString()}
        </text>
      </svg>

      <div className="small muted" style={{ minHeight: 20, marginTop: 6 }}>
        {active ? (
          <span className="mono">
            O {formatNumber(active.open, 6)} · H {formatNumber(active.high, 6)} · L{" "}
            {formatNumber(active.low, 6)} · C {formatNumber(active.close, 6)} {quoteSymbol} ·{" "}
            {active.trades} trade{active.trades === 1 ? "" : "s"}
          </span>
        ) : (
          <span>Hover a candle for detail.</span>
        )}
      </div>
    </div>
  );
}

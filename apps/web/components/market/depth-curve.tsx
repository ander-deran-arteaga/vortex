"use client";

import { useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import type { CurvePoint } from "@/lib/market/model";

export interface Series {
  name: string;
  points: CurvePoint[];
  /** A CSS colour from the theme, never a new hue invented for the chart. */
  stroke: string;
  dashed?: boolean;
}

const HEIGHT = 300;
const PAD = { top: 16, right: 16, bottom: 34, left: 46 };

/**
 * Measures the container so the drawing can use real pixel units and the axis
 * labels land at their true type size.
 *
 * The measurement is an improvement, never a requirement: the SVG below scales
 * its viewBox to 100% of the container either way, so a ResizeObserver that is
 * throttled, unsupported or simply slow makes the type slightly smaller and
 * nothing else. Sizing the SVG in absolute pixels from this value instead would
 * push the chart out of a 360px page whenever the observer did not fire.
 */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  // A sane default means the first paint draws a real chart rather than
  // nothing, even before the observer has measured anything.
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width;
      if (next !== undefined && next > 0) {
        setWidth(next);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function niceBound(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

/**
 * Cumulative size against distance from mid, bids left of centre and asks
 * right, every venue measured against its own mid.
 *
 * A venue whose curve rises almost vertically is holding its price as size
 * grows; one that leans outward is charging more for size. That comparison is
 * the entire point, and it only works because of the normalisation.
 */
export function DepthCurve({
  series,
  maxSize,
}: {
  series: Series[];
  maxSize: bigint;
}) {
  const [ref, width] = useWidth();

  const all = series.flatMap((s) => s.points);
  const maxBps = niceBound(Math.max(1, ...all.map((p) => Math.abs(p.bps))));
  const innerW = Math.max(120, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const maxSizeNumber = Number(maxSize);

  const x = (bps: number) => PAD.left + ((bps + maxBps) / (2 * maxBps)) * innerW;
  const y = (size: bigint) =>
    PAD.top + innerH - (Number(size) / maxSizeNumber) * innerH;

  const pathFor = (points: CurvePoint[], side: "bid" | "ask") => {
    const sorted = points
      .filter((p) => p.side === side)
      .sort((a, b) => Number(a.size - b.size));
    if (sorted.length === 0) {
      return null;
    }
    return sorted
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.bps).toFixed(1)} ${y(p.size).toFixed(1)}`)
      .join(" ");
  };

  const ticks = [-maxBps, -maxBps / 2, 0, maxBps / 2, maxBps];
  const sizeTicks = [0n, maxSize / 2n, maxSize];

  return (
    <div ref={ref} className="w-full">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Cumulative size against distance from each venue's own mid, in basis points."
        className="block h-auto w-full"
      >
        {/* The mid. Everything on the chart is measured from this line. */}
        <line
          x1={x(0)}
          x2={x(0)}
          y1={PAD.top}
          y2={PAD.top + innerH}
          stroke="var(--color-ink-3)"
          strokeWidth="1"
        />

        {sizeTicks.map((size) => (
          <g key={String(size)}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={y(size)}
              y2={y(size)}
              stroke="var(--color-ink-2)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={y(size) + 4}
              textAnchor="end"
              className="fill-say-3 text-[10px]"
            >
              {formatTokenAmount(size, 8, 3)}
            </text>
          </g>
        ))}

        {ticks.map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={HEIGHT - 14}
            textAnchor="middle"
            className="fill-say-3 text-[10px]"
          >
            {tick === 0 ? "mid" : `${tick > 0 ? "+" : ""}${tick.toFixed(tick % 1 === 0 ? 0 : 1)}`}
          </text>
        ))}

        {series.map((s) =>
          (["bid", "ask"] as const).map((side) => {
            const d = pathFor(s.points, side);
            return d === null ? null : (
              <path
                key={`${s.name}-${side}`}
                d={d}
                fill="none"
                stroke={s.stroke}
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={s.dashed === true ? "4 3" : undefined}
              />
            );
          }),
        )}

        {/* The sampled sizes themselves, so a reader can see these are measured
            points rather than a drawn shape. */}
        {series.map((s) =>
          s.points.map((p, i) => (
            <circle
              key={`${s.name}-${p.side}-${i}`}
              cx={x(p.bps)}
              cy={y(p.size)}
              r="2"
              fill={s.stroke}
            />
          )),
        )}
      </svg>

      <p className="mt-1 text-center text-xs text-say-3">
        basis points from mid · bids left, asks right
      </p>
    </div>
  );
}

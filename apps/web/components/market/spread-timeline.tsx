"use client";

import { useEffect, useRef, useState } from "react";
import type { SeriesKey, SpreadHistory, SpreadPoint } from "@/lib/market/history";
import { WINDOW_MS, allPoints } from "@/lib/market/history";

export interface TimelineSeries {
  key: SeriesKey;
  name: string;
  stroke: string;
  /** Modelled rather than measured. Drawn dashed, and badged by the caller. */
  simulated?: boolean;
}

const HEIGHT = 240;
const PAD = { top: 14, right: 12, bottom: 28, left: 52 };

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
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

/** Powers of ten spanning the data, because the venues differ by four of them. */
function decadeTicks(minBps: number, maxBps: number): number[] {
  const lo = Math.floor(Math.log10(minBps));
  const hi = Math.ceil(Math.log10(maxBps));
  const ticks: number[] = [];
  for (let e = lo; e <= hi; e += 1) {
    ticks.push(10 ** e);
  }
  return ticks;
}

function formatBps(value: number): string {
  if (value >= 10) {
    return value.toFixed(0);
  }
  if (value >= 1) {
    return value.toFixed(1);
  }
  return value.toFixed(value >= 0.01 ? 2 : 4);
}

/**
 * Spread by venue over the last minute.
 *
 * The y-axis is logarithmic, and it has to be: Binance quotes about two
 * thousandths of a basis point while the demo maker quotes eighty-odd. On a
 * linear axis the tightest venue on the page would be a flat line pinned to
 * zero — technically drawn, practically invisible. Decade gridlines say so
 * plainly rather than leaving the reader to infer the scale.
 *
 * There is no enter or update animation anywhere in here. The line simply
 * redraws when a reading lands, so a reader who asked for reduced motion gets
 * the current frame with nothing moving, and nobody waits on a transition to
 * see a number.
 */
export function SpreadTimeline({
  history,
  series,
  tightest,
  now,
}: {
  history: SpreadHistory;
  series: TimelineSeries[];
  tightest: SeriesKey | null;
  now: number;
}) {
  const [ref, width] = useWidth();

  const points = allPoints(history).filter((p) => p.bps > 0);
  const minBps = points.length === 0 ? 0.001 : Math.min(...points.map((p) => p.bps));
  const maxBps = points.length === 0 ? 100 : Math.max(...points.map((p) => p.bps));
  const ticks = decadeTicks(minBps, maxBps);
  const lo = Math.log10(ticks[0] ?? 0.001);
  const hi = Math.log10(ticks[ticks.length - 1] ?? 100);
  const span = hi - lo || 1;

  const innerW = Math.max(120, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (at: number) =>
    PAD.left + innerW - ((now - at) / WINDOW_MS) * innerW;
  const y = (bps: number) =>
    PAD.top + innerH - ((Math.log10(Math.max(bps, 1e-6)) - lo) / span) * innerH;

  const pathFor = (list: SpreadPoint[]) => {
    const inWindow = list.filter((p) => now - p.at <= WINDOW_MS && p.bps > 0);
    if (inWindow.length === 0) {
      return null;
    }
    if (inWindow.length === 1) {
      // One reading is a point, not a line — draw it as a point rather than
      // stretching it across the window as though it had been measured twice.
      const only = inWindow[0] as SpreadPoint;
      return `M ${x(only.at).toFixed(1)} ${y(only.bps).toFixed(1)} l 0.01 0`;
    }
    return inWindow
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.at).toFixed(1)} ${y(p.bps).toFixed(1)}`)
      .join(" ");
  };

  return (
    <div ref={ref} className="w-full">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Spread in basis points by venue over the last sixty seconds, on a logarithmic scale."
        className="block h-auto w-full"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-ink-2)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-say-3 text-[10px]"
            >
              {formatBps(tick)}
            </text>
          </g>
        ))}

        {[60, 40, 20, 0].map((secondsAgo) => (
          <text
            key={secondsAgo}
            x={x(now - secondsAgo * 1000)}
            y={HEIGHT - 10}
            textAnchor={secondsAgo === 0 ? "end" : secondsAgo === 60 ? "start" : "middle"}
            className="fill-say-3 text-[10px]"
          >
            {secondsAgo === 0 ? "now" : `${secondsAgo}s`}
          </text>
        ))}

        {series.map((s) => {
          const d = pathFor(history[s.key]);
          return d === null ? null : (
            <path
              key={s.key}
              d={d}
              fill="none"
              stroke={s.stroke}
              strokeWidth={tightest === s.key ? 2.25 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.simulated === true ? "5 4" : undefined}
            />
          );
        })}

        {/* The latest reading of each venue, so "now" is a value and not just
            where the line happens to stop. */}
        {series.map((s) => {
          const list = history[s.key];
          const latest = list[list.length - 1];
          if (latest === undefined || now - latest.at > WINDOW_MS) {
            return null;
          }
          return (
            <circle
              key={`${s.key}-head`}
              cx={x(latest.at)}
              cy={y(latest.bps)}
              r={tightest === s.key ? 3.5 : 2.5}
              fill={s.stroke}
            />
          );
        })}
      </svg>

      <p className="mt-1 text-center text-xs text-say-3">
        spread in bps, logarithmic · last 60 seconds
      </p>
    </div>
  );
}

/**
 * The money visual: a true price moving smoothly while a passive pool's price
 * lags behind it in stair-steps, with the gap between them shaded.
 *
 * The shaded area is the argument, so it is drawn as real geometry rather than
 * decoration: both series come from one deterministic sample set, the steps are
 * the pool holding its last price until an arbitrageur moves it, and the fill
 * is literally the area between the two paths. Static SVG, so it carries its
 * whole meaning with no JavaScript and nothing to reveal.
 */

const W = 720;
const H = 230;
const PAD = { top: 26, right: 16, bottom: 30, left: 16 };

// One deterministic series. A gentle drift up with a dip, sampled evenly.
const TRUE_SERIES = [
  0.30, 0.34, 0.40, 0.44, 0.42, 0.47, 0.55, 0.61, 0.58, 0.54,
  0.60, 0.67, 0.72, 0.70, 0.75, 0.81, 0.86, 0.83, 0.88, 0.93,
];
/** The pool only re-prices when someone arbitrages it: every fourth sample. */
const STEP_EVERY = 4;

const innerW = W - PAD.left - PAD.right;
const innerH = H - PAD.top - PAD.bottom;

// Scale to the data's own range so the plot fills its panel instead of
// floating in the top half with dead space beneath it.
const MIN = Math.min(...TRUE_SERIES);
const MAX = Math.max(...TRUE_SERIES);
const x = (i: number) => PAD.left + (i / (TRUE_SERIES.length - 1)) * innerW;
const y = (v: number) => PAD.top + (1 - (v - MIN) / (MAX - MIN)) * innerH;

function truePath(): string {
  return TRUE_SERIES.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
}

/** The pool price: flat until it is corrected, then a vertical jump. */
function poolPoints(): { px: number; py: number }[] {
  const points: { px: number; py: number }[] = [];
  let held = TRUE_SERIES[0] ?? 0;
  TRUE_SERIES.forEach((v, i) => {
    if (i % STEP_EVERY === 0) {
      held = v;
    }
    points.push({ px: x(i), py: y(held) });
  });
  return points;
}

function poolPath(): string {
  const pts = poolPoints();
  return pts
    .map((p, i) => {
      const prev = pts[i - 1];
      if (prev === undefined) return `M ${p.px.toFixed(1)} ${p.py.toFixed(1)}`;
      // Hold, then step: horizontal to this x, then vertical to the new price.
      return `L ${p.px.toFixed(1)} ${prev.py.toFixed(1)} L ${p.px.toFixed(1)} ${p.py.toFixed(1)}`;
    })
    .join(" ");
}

/** The area between the two lines: the value the pool hands to the arbitrageur. */
function gapPath(): string {
  const pts = poolPoints();
  const forward = TRUE_SERIES.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
  const back = [...pts]
    .reverse()
    .map((p) => `L ${p.px.toFixed(1)} ${p.py.toFixed(1)}`);
  return `${forward.join(" ")} ${back.join(" ")} Z`;
}

export function PriceLeak() {
  return (
    <figure className="panel p-5 sm:p-6">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="A true market price rising smoothly while a passive pool's price lags behind it in steps. The area between the two is value extracted from the liquidity provider."
      >
        <path d={gapPath()} fill="var(--color-loss)" fillOpacity="0.17" />
        <path
          d={poolPath()}
          fill="none"
          stroke="var(--color-say-3)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={truePath()}
          fill="none"
          stroke="var(--color-cu)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      <figcaption className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2 text-say-2">
          <span aria-hidden="true" className="inline-block h-[2px] w-5 bg-cu" />
          True market price
        </span>
        <span className="flex items-center gap-2 text-say-2">
          <span aria-hidden="true" className="inline-block h-[2px] w-5 bg-say-3" />
          Passive pool price
        </span>
        <span className="flex items-center gap-2 text-say-1">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-5 bg-loss opacity-[0.28]"
          />
          Value extracted from the LP
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * The Vortex mark.
 *
 * Two logarithmic spiral arms winding into one centre: the two venues that
 * quote every trade, resolving into the single execution that wins. The curve
 * is computed, not eyeballed — r = a·e^(bθ) sampled evenly in θ — so the arms
 * are a real spiral rather than a decorative swoosh, and the same geometry
 * serves the 20px nav mark and the oversized footer watermark.
 */

const TURNS = 2.1;
const GROWTH = 0.18;
const SAMPLES = 160;
const OUTER_RADIUS = 45;

function spiralArm(rotation: number): string {
  const thetaMax = TURNS * 2 * Math.PI;
  // Normalise so the arm always ends exactly at OUTER_RADIUS, whatever the
  // growth constant — the mark must fill its box precisely at any size.
  const scale = OUTER_RADIUS / Math.exp(GROWTH * thetaMax);

  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const theta = (i / SAMPLES) * thetaMax;
    const r = scale * Math.exp(GROWTH * theta);
    const angle = theta + rotation;
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    points.push(`${x.toFixed(3)},${y.toFixed(3)}`);
  }
  return `M ${points.join(" L ")}`;
}

// Computed once at module scope: pure, deterministic, no work at render time.
const ARM_A = spiralArm(0);
const ARM_B = spiralArm(Math.PI);

export function VortexMark({
  size = 20,
  className = "",
  strokeWidth = 5,
  title,
}: {
  size?: number;
  className?: string;
  strokeWidth?: number;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-50 -50 100 100"
      fill="none"
      className={className}
      role={title === undefined ? "presentation" : "img"}
      aria-hidden={title === undefined ? true : undefined}
      aria-label={title}
    >
      <g
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
      >
        <path d={ARM_A} />
        <path d={ARM_B} opacity="0.45" />
      </g>
    </svg>
  );
}

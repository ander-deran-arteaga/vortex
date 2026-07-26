/**
 * The cycle as a closed loop.
 *
 * A list of steps reads as a sequence with an end; this is a ring that returns
 * to where it started, which is the whole point of Grow — the maker's asset
 * leaves and comes back inside one transaction. Five nodes sit on the circle,
 * the arrows run clockwise, and the closing arc is the one that hands principal
 * and profit back.
 *
 * Geometry is computed once at module load from the node count, so the ring
 * stays even if a node is ever added or removed. Positions are percentages of
 * a square container: the SVG scales with it while the labels stay at their own
 * type size, which is what keeps this legible at 360px.
 */

const NODES: ReadonlyArray<{ name: string; detail: string; gate?: boolean }> = [
  { name: "Aqua maker", detail: "Holds the WBTC" },
  { name: "Vortex Grow", detail: "Borrows the principal" },
  { name: "Vortex PermAMM", detail: "WBTC → USDC" },
  { name: "External venue", detail: "USDC → WBTC" },
  { name: "Profit check", detail: "More WBTC, or revert", gate: true },
];

/**
 * The ring lives in a square; the box around it is wider (4:3) so the labels
 * have somewhere to sit without crossing the arc. SQUISH maps a coordinate in
 * the square onto the box, which is what keeps the HTML labels lined up with
 * the SVG under it at every width.
 */
const R = 28;
const CENTRE = 50;
const SQUISH = 0.75;
/** Degrees of clear space either side of a node, so arcs never touch one. */
const GAP = 15;
/** How far past the ring a label sits. */
const LABEL_OFFSET = 5;

function point(degrees: number, radius = R) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: CENTRE + radius * Math.cos(radians),
    y: CENTRE + radius * Math.sin(radians),
    cos: Math.cos(radians),
  };
}

/** The same point, in the wider box the labels are positioned against. */
function boxPoint(degrees: number, radius = R) {
  const p = point(degrees, radius);
  return { x: CENTRE + (p.x - CENTRE) * SQUISH, y: p.y, cos: p.cos };
}

/** Node k sits at the top of the circle for k = 0, then clockwise. */
function nodeAngle(index: number): number {
  return -90 + (index * 360) / NODES.length;
}

/**
 * Where a label hangs off its node. Near the sides it reads outward
 * horizontally; at the top and bottom it stacks above or below. Anything else
 * puts type across the arc it is describing.
 */
function labelAnchor(cos: number, y: number): string {
  if (cos > 0.5) {
    return "translate(0, -50%)";
  }
  if (cos < -0.5) {
    return "translate(-100%, -50%)";
  }
  return y < CENTRE ? "translate(-50%, -100%)" : "translate(-50%, 0)";
}

const ARCS = NODES.map((_, index) => {
  const from = point(nodeAngle(index) + GAP);
  const to = point(nodeAngle(index + 1) - GAP);
  const mid = nodeAngle(index) + 180 / NODES.length;
  const head = point(mid);
  return {
    key: index,
    // Sweep 1, small arc: the loop runs clockwise, the direction the arrows read.
    d: `M ${from.x} ${from.y} A ${R} ${R} 0 0 1 ${to.x} ${to.y}`,
    // The arrowhead is drawn pointing right, then turned along the tangent.
    head: `translate(${head.x} ${head.y}) rotate(${mid + 90})`,
    // The last arc is the one that returns the asset to the maker.
    closing: index === NODES.length - 1,
  };
});

export function CycleDiagram() {
  return (
    <div className="mx-auto w-full max-w-[34rem]">
      <div className="relative aspect-[4/3] w-full">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          className="absolute inset-0 size-full"
        >
          {/* The track: the whole loop, present but quiet. */}
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={R}
            fill="none"
            stroke="var(--color-ink-3)"
            strokeWidth="1.4"
          />

          {ARCS.map((arc) => (
            <g key={arc.key}>
              <path
                d={arc.d}
                fill="none"
                stroke="var(--color-cu)"
                strokeWidth={arc.closing ? 2.2 : 1.4}
                strokeLinecap="round"
                opacity={arc.closing ? 1 : 0.6}
              />
              <path
                d="M -2.2 -2.4 L 2.6 0 L -2.2 2.4 Z"
                transform={arc.head}
                fill="var(--color-cu)"
                opacity={arc.closing ? 1 : 0.6}
              />
            </g>
          ))}

          {/*
            One highlight orbiting the track. Motion around a circle is what
            makes a diagram read as a cycle before a word of it is read; the
            global reduced-motion rule stops it dead for anyone who asked.
          */}
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={R}
            fill="none"
            stroke="var(--color-cu-hi)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray="8 168"
            className="[animation:vortex-orbit_9s_linear_infinite]"
          />
        </svg>

        {/* The centre says what the ring means. */}
        <div className="absolute left-1/2 top-1/2 w-[34%] -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="text-[13px] leading-tight text-say-1 sm:text-[15px]">
            One transaction
          </p>
          <p className="mt-1 text-[10px] leading-snug text-say-3 sm:text-xs">
            All of it, or none
          </p>
        </div>

        {NODES.map((node, index) => {
          const angle = nodeAngle(index);
          const dot = boxPoint(angle);
          const label = boxPoint(angle, R + LABEL_OFFSET);
          return (
            <div key={node.name}>
              <span
                aria-hidden="true"
                style={{ left: `${dot.x}%`, top: `${dot.y}%` }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${
                  node.gate === true
                    ? "size-3.5 bg-cu-hi ring-4 ring-ink-0"
                    : "size-2.5 bg-cu-hi ring-4 ring-ink-0"
                }`}
              />
              <div
                style={{
                  left: `${label.x}%`,
                  top: `${label.y}%`,
                  transform: labelAnchor(label.cos, label.y),
                }}
                className={`absolute w-[26%] ${
                  label.cos > 0.5
                    ? "pl-2 text-left"
                    : label.cos < -0.5
                      ? "pr-2 text-right"
                      : "text-center"
                }`}
              >
                <p
                  className={`text-[11px] leading-tight sm:text-xs ${
                    node.gate === true ? "text-cu" : "text-say-1"
                  }`}
                >
                  {node.name}
                </p>
                <p className="mt-0.5 text-[10px] leading-tight text-say-3 sm:text-[11px]">
                  {node.detail}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/*
        The ring is a picture; this is the same thing in order, for a screen
        reader and for anyone who would rather read it.
      */}
      <ol className="sr-only">
        {NODES.map((node) => (
          <li key={node.name}>
            {node.name}: {node.detail}
          </li>
        ))}
        <li>The cycle closes: principal and profit return to the maker.</li>
      </ol>
    </div>
  );
}

import {
  CompounderNode,
  FeeSplit,
  GateNode,
  MakerNode,
  VenueNode,
} from "./grow-flow-nodes";
import type { FlowStep, NodeId } from "./scenario-data";

/**
 * The stage. Renders purely from the current step: no timers, no internal
 * state, nothing to get out of sync with the reducer.
 *
 * Layout follows the spec's breakpoints: a single vertical column below 640px,
 * a two-column zigzag to 1023px, and a horizontal flow above that. Sizing is
 * fluid throughout, so the stage never scrolls sideways.
 */

function Connector({
  label,
  lit,
  reversing = false,
}: {
  label: string;
  lit: boolean;
  reversing?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-1" aria-hidden="true">
      <span
        className={`text-[10px] uppercase tracking-wider transition-colors duration-300 ${
          lit ? "text-cu" : "text-say-3"
        }`}
      >
        {label}
      </span>
      <span className="relative h-px flex-1 overflow-hidden bg-ink-3">
        {/*
          The energised path is a scaled bar, not a width transition, so it
          animates on the compositor and the caps never deform. Reversing runs
          the same path in the opposite direction, which is what atomicity
          looks like.
        */}
        <span
          className={`absolute inset-0 origin-left bg-cu transition-transform duration-500 ease-out ${
            reversing ? "origin-right" : "origin-left"
          }`}
          style={{ transform: `scaleX(${lit ? 1 : 0})` }}
        />
      </span>
    </div>
  );
}

function Region({
  title, note, children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-[13px] text-say-1">{title}</h4>
        <p className="text-xs text-say-3">{note}</p>
      </div>
      {children}
    </div>
  );
}

export function GrowFlowDiagram({
  step,
  stepNumber,
  totalSteps,
}: {
  step: FlowStep;
  stepNumber: number;
  totalSteps: number;
}) {
  const at = (node: NodeId) => step.active === node;
  const reversing = step.reversing === true;
  const reached = (ids: NodeId[]) => ids.includes(step.active);

  return (
    <div className="panel p-5 sm:p-6">
      <p className="sr-only">
        Step {stepNumber} of {totalSteps}. {step.caption}
      </p>

      {/*
        Offchain proposes, onchain disposes. This split is the single most
        important idea in the diagram, so it is drawn as two labelled regions
        rather than implied.
      */}
      <Region
        title="Backend"
        note="Offchain. Discovers, prepares and simulates. Proposes only."
      >
        <div className="panel-raised px-4 py-3 text-xs leading-relaxed text-say-2">
          Finds the opportunity, builds the route and simulates it before
          anything is signed. It cannot make the cycle settle.
        </div>
      </Region>

      <div className="my-5 flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-ink-3" />
        <span className="text-[10px] uppercase tracking-wider text-say-3">
          onchain from here
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-ink-3" />
      </div>

      <Region title="Contracts" note="Onchain. Authorisation, limits, atomicity, the final check.">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <div className="space-y-2">
            <MakerNode step={step} active={at("maker") || at("return")} />
            <Connector
              label={reversing ? "revert" : "pull"}
              lit={reached(["compounder", "legA", "legB", "gate", "fee", "return"])}
              reversing={reversing}
            />
            <CompounderNode step={step} active={at("compounder")} />
          </div>

          <div className="flex items-center justify-center lg:px-2">
            <span aria-hidden="true" className="hidden h-full w-px bg-ink-3 lg:block" />
          </div>

          <div className="space-y-2">
            <VenueNode
              title="Vortex PermAMM"
              role="First leg, WBTC to USDC"
              detail="A Vortex-operated Uniswap v4 pool."
              active={at("legA")}
            />
            <Connector
              label="bridge"
              lit={reached(["legB", "gate", "fee", "return"])}
              reversing={reversing}
            />
            <VenueNode
              title="External venue"
              role="Second leg, USDC back to WBTC"
              detail="The demo runs a deterministic simulated venue. The route format supports a Uniswap API-built call."
              active={at("legB")}
            />
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <GateNode step={step} active={at("gate")} />
          <div className="panel-raised p-4">
            <p className="text-[13px] text-say-1">Fee</p>
            <p className="mt-0.5 text-xs text-say-3">20% of profit, never principal</p>
            <div className="mt-3">
              <FeeSplit visible={at("fee") || at("return") || (at("maker") && stepNumber === totalSteps)} />
            </div>
          </div>
        </div>
      </Region>
    </div>
  );
}

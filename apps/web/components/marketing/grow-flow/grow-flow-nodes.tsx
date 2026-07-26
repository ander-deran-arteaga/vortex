import type { ReactNode } from "react";
import { USDC, WBTC } from "@vortex/shared";
import { BalanceCounter } from "./balance-counter";
import type { FlowStep, NodeId } from "./scenario-data";

/**
 * The nodes of the cycle. Each carries a real text label in the DOM, so the
 * diagram is legible to a screen reader and to anyone who never sees the
 * motion.
 */

function Shell({
  active,
  tone = "default",
  children,
}: {
  active: boolean;
  tone?: "default" | "verified" | "failed";
  children: ReactNode;
}) {
  const toneRing =
    tone === "verified"
      ? "shadow-[inset_0_0_0_1px_var(--color-gain)]"
      : tone === "failed"
        ? "shadow-[inset_0_0_0_1px_var(--color-loss)]"
        : active
          ? "shadow-[inset_0_0_0_1px_var(--color-cu)]"
          : "";
  return (
    <div
      className={`panel-raised p-4 transition-colors duration-300 ${toneRing} ${
        active ? "" : "opacity-60"
      }`}
    >
      {children}
    </div>
  );
}

function Label({ title, role }: { title: string; role: string }) {
  return (
    <>
      <p className="text-[13px] text-say-1">{title}</p>
      <p className="mt-0.5 text-xs leading-snug text-say-3">{role}</p>
    </>
  );
}

export function MakerNode({ step, active }: { step: FlowStep; active: boolean }) {
  return (
    <Shell active={active}>
      <Label title="Aqua maker" role="Authorisation and virtual balance" />
      <p className="mt-3 text-lg">
        <BalanceCounter
          value={step.makerWbtc}
          decimals={WBTC.decimals}
          suffix="WBTC"
          className="text-say-1"
        />
      </p>
      <p className="mt-1 text-xs text-say-3">Assets stay in the maker&rsquo;s wallet.</p>
    </Shell>
  );
}

export function CompounderNode({
  step,
  active,
}: {
  step: FlowStep;
  active: boolean;
}) {
  const tone =
    step.status === "verified" ? "verified" : step.status === "failed" ? "failed" : "default";
  return (
    <Shell active={active} tone={tone}>
      <Label
        title="Vortex Compounder"
        role="Atomic coordinator, not a source of yield"
      />
      <div className="mt-3 space-y-1">
        <p className="text-lg">
          <BalanceCounter
            value={step.compounderWbtc ?? "0"}
            decimals={WBTC.decimals}
            suffix="WBTC"
            className="text-say-1"
          />
        </p>
        {step.compounderUsdc === undefined ? null : (
          <p className="text-sm">
            <BalanceCounter
              value={step.compounderUsdc}
              decimals={USDC.decimals}
              displayDecimals={2}
              suffix="USDC"
              className="text-say-2"
            />
          </p>
        )}
      </div>
    </Shell>
  );
}

export function VenueNode({
  title,
  role,
  detail,
  active,
}: {
  title: string;
  role: string;
  detail?: string;
  active: boolean;
}) {
  return (
    <Shell active={active}>
      <Label title={title} role={role} />
      {detail === undefined ? null : (
        <p className="mt-2 text-xs leading-relaxed text-say-2">{detail}</p>
      )}
    </Shell>
  );
}

export function GateNode({ step, active }: { step: FlowStep; active: boolean }) {
  const verified = step.status === "verified";
  const failed = step.status === "failed";
  return (
    <Shell active={active} tone={verified ? "verified" : failed ? "failed" : "default"}>
      <Label title="Profit gate" role="Checked onchain, after both legs" />
      <p
        className={`num mt-3 text-[13px] ${
          verified ? "text-gain" : failed ? "text-loss" : "text-say-2"
        }`}
      >
        final &ge; principal + minimum profit
      </p>
      <p className="mt-2 text-xs text-say-2">
        {verified
          ? "Met. The cycle settles."
          : failed
            ? "Not met. The whole transaction reverts."
            : "Evaluated once both legs have returned."}
      </p>
    </Shell>
  );
}

/**
 * The fee, shown as a slice taken out of the profit segment.
 *
 * The bar is split principal / profit, and the fee is cut from inside the
 * profit only. A reader must never be able to see the fee coming out of the
 * principal, because it does not.
 *
 * `failed` is the unprofitable cycle. There the floor is never met, so no fee
 * is ever taken — printing the successful cycle's arithmetic here would show a
 * deduction that did not happen, while the caption two lines down says nothing
 * moved.
 */
export function FeeSplit({
  visible,
  failed = false,
}: {
  visible: boolean;
  failed?: boolean;
}) {
  if (failed) {
    return (
      <div>
        <div
          className="flex h-8 w-full overflow-hidden rounded-[3px] opacity-45"
          aria-hidden="true"
        >
          <div className="flex w-full items-center justify-center bg-ink-3 text-[11px] text-say-2">
            principal
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-say-2">
          The floor was not met, so there is no profit and{" "}
          <span className="text-say-1">no fee is taken</span>.
        </p>
      </div>
    );
  }

  return (
    <div className={visible ? "" : "opacity-45"}>
      <div className="flex h-8 w-full overflow-hidden rounded-[3px]" aria-hidden="true">
        <div
          className="flex items-center justify-center bg-ink-3 text-[11px] text-say-2"
          style={{ width: "76%" }}
        >
          principal
        </div>
        <div
          className="flex items-center justify-center bg-gain/25 text-[11px] text-gain transition-[width] duration-500"
          style={{ width: visible ? "19.2%" : "24%" }}
        >
          profit
        </div>
        {visible ? (
          <div
            className="flex items-center justify-center bg-cu/30 text-[11px] text-cu transition-[width] duration-500"
            style={{ width: "4.8%" }}
          />
        ) : null}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-say-2">
        1.00300000 gross.{" "}
        <span className="text-cu">The 0.00060000 fee comes out of the profit</span>,
        leaving 1.00240000 to the maker.
      </p>
    </div>
  );
}

export const NODE_TITLES: Record<NodeId, string> = {
  maker: "Aqua maker",
  compounder: "Vortex Compounder",
  legA: "Vortex PermAMM",
  legB: "External venue",
  gate: "Profit gate",
  fee: "Fee",
  return: "Aqua maker",
};

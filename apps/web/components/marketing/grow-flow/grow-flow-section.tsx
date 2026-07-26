"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { GrowFlowDiagram } from "./grow-flow-diagram";
import {
  currentStep,
  flowReducer,
  initialFlowState,
  lastIndex,
  stepsFor,
} from "./grow-flow-machine";
import { SCENARIOS, SCENARIO_ORDER, type ScenarioId } from "./scenario-data";

const STEP_MS = 820;

/** Reads the media query once and keeps up if the user changes it mid-session. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export function GrowFlowSection() {
  const [state, dispatch] = useReducer(flowReducer, initialFlowState);
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const autoplayed = useRef(false);

  const steps = stepsFor(state.scenario);
  const end = lastIndex(state.scenario);
  // Under reduced motion the diagram sits at its final frame from the start:
  // the reader gets the whole explanation with no motion at all.
  const effectiveIndex = reducedMotion ? end : state.stepIndex;
  const step = currentStep({ ...state, stepIndex: effectiveIndex });

  // Advance while playing. One timer, cleared on every state change.
  useEffect(() => {
    if (!state.playing || reducedMotion) {
      return;
    }
    const id = setTimeout(() => dispatch({ type: "ADVANCE" }), STEP_MS);
    return () => clearTimeout(id);
  }, [state.playing, state.stepIndex, state.scenario, reducedMotion]);

  // Autoplay once when the section is meaningfully on screen. It never loops,
  // never steals focus and never scrolls.
  useEffect(() => {
    if (reducedMotion || autoplayed.current) {
      return;
    }
    const node = sectionRef.current;
    if (node === null) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting === true && !autoplayed.current) {
          autoplayed.current = true;
          dispatch({ type: "PLAY" });
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion]);

  const onTabKey = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = SCENARIO_ORDER[(index + delta + SCENARIO_ORDER.length) % SCENARIO_ORDER.length];
      if (next !== undefined) {
        dispatch({ type: "SELECT_SCENARIO", scenario: next });
        document.getElementById(`grow-tab-${next}`)?.focus();
      }
    },
    [],
  );

  return (
    <div ref={sectionRef} className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-xl">
          <h3 className="text-[clamp(1.4rem,2.6vw,2rem)] leading-tight text-say-1">
            Start with WBTC. Finish with more WBTC.
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-say-2">
            Vortex Grow temporarily uses an Aqua maker&rsquo;s WBTC across an atomic
            two-leg route. The transaction succeeds only when the final WBTC balance
            exceeds the principal plus the maker&rsquo;s required profit. The profit comes
            from one thing: a price difference between the two venues.
          </p>
          <p className="mt-3 text-[15px] text-cu">No profit, no execution.</p>
        </div>

        {/* Visible without scrolling or hovering, per the accuracy rule. */}
        <p className="text-xs text-warn">Illustrative values, not a live quote.</p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" aria-label="Grow scenarios" className="flex gap-1 rounded-[4px] bg-ink-1 p-1">
          {SCENARIO_ORDER.map((id, index) => {
            const selected = state.scenario === id;
            return (
              <button
                key={id}
                id={`grow-tab-${id}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls="grow-flow-stage"
                tabIndex={selected ? 0 : -1}
                onKeyDown={(event) => onTabKey(event, index)}
                onClick={() => dispatch({ type: "SELECT_SCENARIO", scenario: id })}
                className={`min-h-[44px] rounded-[3px] px-4 text-sm transition-colors duration-150 ${
                  selected ? "bg-ink-3 text-cu" : "text-say-2 hover:text-say-1"
                }`}
              >
                {SCENARIOS[id].label}
              </button>
            );
          })}
        </div>

        {reducedMotion ? null : (
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => dispatch({ type: state.playing ? "PAUSE" : "PLAY" })}
              aria-label={
                state.playing
                  ? "Pause the Grow flow"
                  : state.completed
                    ? "Replay the Grow flow"
                    : "Play the Grow flow"
              }
              className="cut-tr min-h-[44px] bg-cu px-5 pr-6 text-sm font-medium text-ink-0 transition-colors duration-150 hover:bg-cu-hi"
            >
              {state.playing ? "Pause" : state.completed ? "Replay" : "Play flow"}
            </button>
            <p className="num text-xs text-say-2">
              Step {effectiveIndex + 1} of {steps.length}
            </p>
          </div>
        )}
      </div>

      <div id="grow-flow-stage" className="mt-5">
        <GrowFlowDiagram
          step={step}
          stepNumber={effectiveIndex + 1}
          totalSteps={steps.length}
        />
      </div>

      {/* One live region, updated in place, rather than eleven. */}
      <p aria-live="polite" className="mt-4 min-h-[1.5rem] text-[15px] text-say-1">
        {reducedMotion ? null : step.caption}
      </p>

      {/*
        The captions are the accessible narrative, so they live in the DOM as an
        ordered list whether or not the animation ever runs. Under reduced
        motion this is the whole explanation, complete and static.
      */}
      <ol className="mt-4 space-y-1.5">
        {steps.map((s, index) => {
          const isCurrent = !reducedMotion && index === effectiveIndex;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => dispatch({ type: "GO_TO", stepIndex: index })}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex w-full items-baseline gap-3 rounded-[3px] px-2 py-1 text-left text-sm transition-colors duration-150 ${
                  isCurrent ? "text-say-1" : "text-say-2 hover:text-say-1"
                }`}
              >
                <span className={`num text-xs ${isCurrent ? "text-cu" : "text-say-3"}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="leading-snug">{s.caption}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="mt-5 max-w-2xl text-xs leading-relaxed text-say-3">
        The backend discovers and simulates the opportunity. The Compounder verifies the
        actual final balance onchain. If either leg fails or returns too little WBTC, the
        entire transaction reverts and the maker&rsquo;s principal is untouched.
      </p>
    </div>
  );
}

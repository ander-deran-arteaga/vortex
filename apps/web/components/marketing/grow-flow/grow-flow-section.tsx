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

/**
 * A step is readable, not brisk: at 1.55s a viewer can take in the caption and
 * the balance change before the next one lands, so the eleven-step cycle runs
 * around 18 seconds. Steps that declare a `holdMs` dwell longer still.
 */
const STEP_MS = 1550;

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
    const id = setTimeout(() => dispatch({ type: "ADVANCE" }), step.holdMs ?? STEP_MS);
    return () => clearTimeout(id);
  }, [state.playing, state.stepIndex, state.scenario, reducedMotion, step.holdMs]);

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
            SwapVM proposes the route. The Compounder checks the final
            balance onchain, or the whole transaction reverts.
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

      {/*
        One caption at a time, in a single live region updated in place. The
        stacked list was noise beside the diagram; the active line is the whole
        narrative while the animation runs.
      */}
      {reducedMotion ? null : (
        <div className="mt-4 flex items-baseline gap-3">
          <span className="num text-xs text-cu">
            {String(effectiveIndex + 1).padStart(2, "0")}
          </span>
          <p aria-live="polite" className="min-h-[1.5rem] text-[15px] text-say-1">
            {step.caption}
          </p>
        </div>
      )}

      {/*
        With motion off there is no sequence to watch, so the numbered captions
        ARE the explanation. Removing them here would leave a reader who asked
        for less motion, or anyone on a screen reader, with an unexplained
        diagram — so the full list stays in exactly that case.
      */}
      {reducedMotion ? (
        <ol className="mt-5 space-y-1.5">
          {steps.map((s, index) => (
            <li key={s.id} className="flex items-baseline gap-3 text-sm">
              <span className="num text-xs text-say-3">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="leading-snug text-say-2">{s.caption}</span>
            </li>
          ))}
        </ol>
      ) : null}

    </div>
  );
}

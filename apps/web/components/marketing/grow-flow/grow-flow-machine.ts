import {
  SCENARIOS,
  type FlowStep,
  type ScenarioId,
} from "./scenario-data";

/**
 * The whole diagram is a pure function of (scenario, stepIndex).
 *
 * No animation library owns the truth. That buys reduced-motion support for
 * free (render the final frame), tab switching for free, replay for free, and
 * — the reason it matters most here — tests that assert on state at step n
 * instead of racing timers. This suite has already had one timing flake; it is
 * not getting another.
 */

export interface FlowState {
  scenario: ScenarioId;
  /** Index into the active scenario's steps. */
  stepIndex: number;
  /** True while the sequence is advancing on its own. */
  playing: boolean;
  /** Set once a scenario has run to the end, so the control reads "Replay". */
  completed: boolean;
}

export type FlowEvent =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "ADVANCE" }
  | { type: "GO_TO"; stepIndex: number }
  | { type: "SELECT_SCENARIO"; scenario: ScenarioId }
  | { type: "RESET" };

export const initialFlowState: FlowState = {
  scenario: "success",
  stepIndex: 0,
  playing: false,
  completed: false,
};

export function stepsFor(scenario: ScenarioId): readonly FlowStep[] {
  return SCENARIOS[scenario].steps;
}

export function lastIndex(scenario: ScenarioId): number {
  return stepsFor(scenario).length - 1;
}

export function currentStep(state: FlowState): FlowStep {
  const steps = stepsFor(state.scenario);
  // Clamped rather than asserted: an out-of-range index should degrade to the
  // final frame, never crash a landing page.
  const index = Math.min(Math.max(state.stepIndex, 0), steps.length - 1);
  return steps[index] as FlowStep;
}

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "PLAY":
      // Replaying from a finished run starts over rather than sitting still.
      return state.stepIndex >= lastIndex(state.scenario)
        ? { ...state, stepIndex: 0, playing: true, completed: false }
        : { ...state, playing: true };

    case "PAUSE":
      return { ...state, playing: false };

    case "ADVANCE": {
      const end = lastIndex(state.scenario);
      if (state.stepIndex >= end) {
        // Stepping past the end is a no-op that also stops playback, so the
        // sequence runs once and never loops.
        return { ...state, playing: false, completed: true };
      }
      const next = state.stepIndex + 1;
      return {
        ...state,
        stepIndex: next,
        playing: next < end ? state.playing : false,
        completed: next >= end ? true : state.completed,
      };
    }

    case "GO_TO": {
      const end = lastIndex(state.scenario);
      const index = Math.min(Math.max(event.stepIndex, 0), end);
      return {
        ...state,
        stepIndex: index,
        playing: false,
        completed: index >= end ? true : state.completed,
      };
    }

    case "SELECT_SCENARIO":
      if (event.scenario === state.scenario) {
        return state;
      }
      // Switching tabs resets to step one, per the spec.
      return {
        scenario: event.scenario,
        stepIndex: 0,
        playing: false,
        completed: false,
      };

    case "RESET":
      return { ...state, stepIndex: 0, playing: false, completed: false };

    default:
      return state;
  }
}

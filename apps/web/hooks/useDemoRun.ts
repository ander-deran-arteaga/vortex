"use client";

import { useCallback, useReducer, useRef } from "react";
import { useAccount } from "wagmi";
import {
  demoReducer,
  initialDemoRun,
  type DemoStepId,
} from "@/lib/demo/demoMachine";
import { DEMO_STEPS, type DemoRunContext } from "@/lib/demo/steps";

const LOCAL_FORK_CHAIN_ID = 31337;

export function useDemoRun() {
  const [state, dispatch] = useReducer(demoReducer, initialDemoRun);
  const { chain } = useAccount();
  // Guards against a second click starting an overlapping run.
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    dispatch({ type: "RUN_STARTED", at: Date.now() });

    const ctx: DemoRunContext = {
      chainId: chain?.id === 42161 ? 42161 : LOCAL_FORK_CHAIN_ID,
      now: () => Date.now(),
    };

    try {
      // Sequential by design: a judge follows one step at a time, and later
      // steps read state earlier ones establish.
      for (const step of DEMO_STEPS) {
        dispatch({ type: "STEP_STARTED", id: step.id });
        try {
          const result = await step.run(ctx);
          if (result.kind === "success") {
            dispatch({ type: "STEP_SUCCEEDED", id: step.id, outcome: result.outcome });
          } else if (result.kind === "blocked") {
            dispatch({ type: "STEP_BLOCKED", id: step.id, reason: result.reason });
          } else {
            dispatch({ type: "STEP_FAILED", id: step.id, reason: result.reason });
          }
        } catch (error) {
          // A thrown step is a bug in the step, not a blocked capability.
          dispatch({
            type: "STEP_FAILED",
            id: step.id,
            reason: error instanceof Error ? error.message : "The step threw.",
          });
        }
      }
    } finally {
      dispatch({ type: "RUN_FINISHED", at: Date.now() });
      runningRef.current = false;
    }
  }, [chain?.id]);

  const reset = useCallback(() => {
    if (runningRef.current) {
      return;
    }
    dispatch({ type: "RESET" });
  }, []);

  const stepState = useCallback(
    (id: DemoStepId) => state.steps[id],
    [state.steps],
  );

  return { state, run, reset, stepState };
}

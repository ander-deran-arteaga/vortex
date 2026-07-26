import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Async assertions get a real budget.
 *
 * testing-library's default `asyncUtilTimeout` is 1000ms. That is fine when
 * this package is the only thing running, and it is not enough when `pnpm test`
 * runs four workspaces at once: a render plus a mocked fetch plus a state
 * settle loses the race under CPU contention, and the suite fails a different
 * two-to-four tests on each run.
 *
 * The wait itself is already condition-based — `waitFor`/`findBy*` resolve the
 * instant the DOM matches, so a generous ceiling costs nothing on a healthy
 * run. It only changes how long we are willing to wait before calling it a
 * failure. A genuinely broken assertion still fails, with waitFor's own
 * message rather than a bare test timeout, because the vitest `testTimeout`
 * in vitest.config.ts is set well above this.
 */
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
  cleanup();
});

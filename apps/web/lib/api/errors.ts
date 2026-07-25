/**
 * The API answered with the shared `zApiError` envelope. These are real,
 * actionable failures (validation, insolvent maker, expired session) and are
 * surfaced to the user — never swallowed into a fixture fallback.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * The API could not be reached at all, or the route is not registered yet
 * (backend Phase 3 still in flight). This is the ONLY condition that permits
 * falling back to fixture data, and the fallback is always labeled.
 */
export class ApiUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ApiUnavailableError";
  }
}

/** A response body that did not match the shared Zod schema. */
export class ApiContractError extends Error {
  constructor(
    readonly path: string,
    readonly issues: unknown,
  ) {
    super(`response from ${path} did not match the shared schema`);
    this.name = "ApiContractError";
  }
}

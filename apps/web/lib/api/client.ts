import type { z } from "zod";
import { zApiError } from "@vortex/shared";
import { ApiContractError, ApiRequestError, ApiUnavailableError } from "./errors";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface RequestOptions<T> {
  schema: z.ZodType<T>;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Typed request against the Vortex API.
 *
 * Paths always come from `API_ROUTES` in @vortex/shared (R-005) and every
 * response is validated against the shared schema, so a backend contract
 * drift fails loudly here instead of rendering `undefined` in the UI.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions<T>,
): Promise<T> {
  const { schema, method = "GET", body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const url = `${API_BASE_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    // Connection refused, DNS failure, timeout — the API is not up.
    throw new ApiUnavailableError(`${method} ${path} could not reach the API`, cause);
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const parsed = zApiError.safeParse(payload);
    const code = parsed.success ? parsed.data.error.code : "UNKNOWN";

    // A 404 means the route is not registered yet (backend Phase 3 still
    // landing) — an availability gap, not a request failure. The API's
    // setNotFoundHandler answers unregistered routes with the shared envelope
    // and code NOT_FOUND, so both the enveloped and bare forms land here.
    // A resource that genuinely does not exist must use a specific code
    // (e.g. STRATEGY_NOT_FOUND) so it surfaces as a real error instead.
    if (response.status === 404 && (!parsed.success || code === "NOT_FOUND")) {
      throw new ApiUnavailableError(`${method} ${path} is not implemented yet`);
    }

    throw new ApiRequestError(
      code,
      parsed.success ? parsed.data.error.message : `${method} ${path} failed with ${response.status}`,
      response.status,
      parsed.success ? parsed.data.error.details : payload,
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiContractError(path, result.error.flatten());
  }
  return result.data;
}

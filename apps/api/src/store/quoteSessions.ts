import { randomUUID } from "node:crypto";

import type { Hex } from "viem";

import type {
  AquaQuote,
  QuoteRequestParams,
  UniswapQuote,
} from "../services/types";

/** MASTER D-011: exchange quote sessions live 45s and are single-use. */
export const EXCHANGE_SESSION_TTL_MS = 45_000;
/**
 * MASTER D-011: once a session is this old the UI should re-quote rather than
 * let the taker walk into an expiry. The threshold is on session AGE, not on
 * remaining time, so a 45s session becomes refreshable with 15s left.
 */
export const REFRESH_THRESHOLD_MS = 30_000;
/** MASTER D-011: Grow opportunities reuse this primitive with a 30s TTL. */
export const GROW_SESSION_TTL_MS = 30_000;

/**
 * What an exchange quote session holds server-side.
 *
 * SECURITY: the FULL Uniswap quote lives here and never leaves the server. The
 * browser receives only the opaque session id and echoes it back to
 * /transactions/uniswap; a quote (or its rawQuote / permitData) is never
 * round-tripped through the client where it could be tampered with.
 */
export interface ExchangeSessionPayload {
  request: QuoteRequestParams & { strategyHash: Hex };
  selectedVenue: "AQUA" | "UNISWAP";
  /** Verbatim venue quote, including `rawQuote` echoed into /swap. */
  uniswap: UniswapQuote | null;
  aqua: AquaQuote | null;
}

export interface QuoteSession<TPayload> {
  readonly id: string;
  readonly payload: TPayload;
  /** Epoch milliseconds (MASTER D-010) — never seconds. */
  readonly createdAt: number;
  readonly expiresAt: number;
  /** Epoch ms at which the session becomes refreshable. */
  readonly refreshAt: number;
  readonly consumedAt: number | null;
}

/** Distinct reasons so routes map each to a stable API error code. */
export type QuoteSessionFailure = "NOT_FOUND" | "EXPIRED" | "ALREADY_USED";

export type QuoteSessionResult<TPayload> =
  | { ok: true; session: QuoteSession<TPayload> }
  | { ok: false; reason: QuoteSessionFailure };

export interface QuoteSessionStoreOptions {
  /** Defaults to the 45s exchange TTL; Grow passes GROW_SESSION_TTL_MS. */
  ttlMs?: number;
  refreshThresholdMs?: number;
  now?: () => number;
  /** Overridable only for tests; production ids must stay unguessable. */
  idFactory?: () => string;
}

export interface QuoteSessionStore<TPayload> {
  create(payload: TPayload): QuoteSession<TPayload>;
  /** Non-mutating read: does not consume and does not extend the TTL. */
  peek(id: string): QuoteSessionResult<TPayload>;
  /** Single-use: the second call on the same id fails with ALREADY_USED. */
  consume(id: string): QuoteSessionResult<TPayload>;
  /** True once a live, unused session has aged past the refresh threshold. */
  isRefreshable(id: string): boolean;
  /** Drops expired entries; returns how many were removed. */
  sweep(): number;
  readonly size: number;
}

/**
 * In-memory (deliberately not JSONL — sessions are ephemeral and must die with
 * the process) single-use quote session store.
 */
export function createQuoteSessionStore<TPayload = ExchangeSessionPayload>(
  options: QuoteSessionStoreOptions = {},
): QuoteSessionStore<TPayload> {
  const ttlMs = options.ttlMs ?? EXCHANGE_SESSION_TTL_MS;
  const refreshThresholdMs = options.refreshThresholdMs ?? REFRESH_THRESHOLD_MS;
  const now = options.now ?? Date.now;
  // randomUUID is CSPRNG-backed: a taker cannot guess another taker's session.
  const idFactory = options.idFactory ?? (() => randomUUID());

  const sessions = new Map<string, QuoteSession<TPayload>>();

  const isExpired = (session: QuoteSession<TPayload>, at: number): boolean =>
    // Boundary: a session is dead AT expiresAt, not one tick later.
    at >= session.expiresAt;

  const sweep = (): number => {
    const at = now();
    let removed = 0;
    for (const [id, session] of sessions) {
      if (isExpired(session, at)) {
        sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  };

  const lookup = (id: string): QuoteSessionResult<TPayload> => {
    const session = sessions.get(id);
    if (!session) return { ok: false, reason: "NOT_FOUND" };
    // A replayed session id reports ALREADY_USED even after it expires: the
    // replay is the more actionable signal than the staleness.
    if (session.consumedAt !== null) return { ok: false, reason: "ALREADY_USED" };
    if (isExpired(session, now())) return { ok: false, reason: "EXPIRED" };
    return { ok: true, session };
  };

  return {
    create(payload: TPayload): QuoteSession<TPayload> {
      // Lazy sweep on write keeps the map bounded without timers.
      sweep();
      const createdAt = now();
      const session: QuoteSession<TPayload> = {
        id: idFactory(),
        payload,
        createdAt,
        expiresAt: createdAt + ttlMs,
        refreshAt: createdAt + refreshThresholdMs,
        consumedAt: null,
      };
      sessions.set(session.id, session);
      return session;
    },
    peek: lookup,
    consume(id: string): QuoteSessionResult<TPayload> {
      const result = lookup(id);
      if (!result.ok) return result;
      const consumed: QuoteSession<TPayload> = {
        ...result.session,
        consumedAt: now(),
      };
      // Kept (not deleted) until it expires so a replay is reported as
      // ALREADY_USED rather than as an indistinguishable NOT_FOUND.
      sessions.set(id, consumed);
      return { ok: true, session: consumed };
    },
    isRefreshable(id: string): boolean {
      const result = lookup(id);
      return result.ok && now() >= result.session.refreshAt;
    },
    sweep,
    get size() {
      return sessions.size;
    },
  };
}

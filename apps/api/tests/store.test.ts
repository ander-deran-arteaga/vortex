import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionRecord } from "@vortex/shared";
import type { Address, Hex } from "viem";
import { afterAll, describe, expect, it } from "vitest";

import type { UniswapQuote } from "../src/services/types";
import {
  createExecutionStore,
  InvalidExecutionRecordError,
} from "../src/store/executions";
import {
  createJsonStore,
  resolveStoreDir,
  type JsonStoreFs,
} from "../src/store/jsonStore";
import {
  createQuoteSessionStore,
  EXCHANGE_SESSION_TTL_MS,
  GROW_SESSION_TTL_MS,
  REFRESH_THRESHOLD_MS,
  type ExchangeSessionPayload,
} from "../src/store/quoteSessions";

// ── hermetic doubles ───────────────────────────────────────────────

interface MemoryFs extends JsonStoreFs {
  files: Map<string, string>;
  dirs: Set<string>;
}

function createMemoryFs(): MemoryFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    existsSync: (path) => files.has(path) || dirs.has(path),
    mkdirSync: (path) => {
      dirs.add(path);
    },
    appendFileSync: (path, data) => {
      files.set(path, (files.get(path) ?? "") + data);
    },
    readFileSync: (path) => {
      const contents = files.get(path);
      if (contents === undefined) throw new Error(`ENOENT: ${path}`);
      return contents;
    },
  };
}

function createClock(start = 0): { now: () => number; set: (t: number) => void } {
  let current = start;
  return { now: () => current, set: (t) => (current = t) };
}

const BASE = "/base/dir";
const WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f" as Address;
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;
const TAKER = "0x1111111111111111111111111111111111111111" as Address;
const MAKER = "0x2222222222222222222222222222222222222222" as Address;
const STRATEGY_HASH = `0x${"ab".repeat(32)}` as Hex;
const TX_HASH = `0x${"cd".repeat(32)}`;

const uniswapQuote = (): UniswapQuote => ({
  amountIn: 1_000_000n, // 0.01 WBTC (8 decimals)
  amountOut: 640_148_143n, // 640.148143 USDC (6 decimals)
  minimumAmountOut: 638_227_698n,
  gasUnits: 100_618n,
  gasCostInOutputToken: 3_751n,
  requestId: "req-abc-123",
  routing: "CLASSIC",
  rawQuote: { input: { amount: "1000000" }, output: { amount: "640148143" } },
  permitData: { domain: { chainId: 42161 } },
  approvalRequired: false,
  gasFeeUSD: "0.00375",
  priceImpact: 0.05,
});

const exchangePayload = (): ExchangeSessionPayload => ({
  request: {
    chainId: 42161,
    tokenIn: WBTC,
    tokenOut: USDC,
    amountIn: 1_000_000n,
    taker: TAKER,
    slippageBps: 30,
    strategyHash: STRATEGY_HASH,
  },
  selectedVenue: "UNISWAP",
  uniswap: uniswapQuote(),
  aqua: null,
});

// ── jsonStore ──────────────────────────────────────────────────────

describe("createJsonStore", () => {
  it("creates the directory lazily and reads an absent file as empty", () => {
    const fs = createMemoryFs();
    const store = createJsonStore<{ n: number }>({
      dir: "./data",
      baseDir: BASE,
      name: "things",
      fs,
    });

    expect(store.filePath).toBe("/base/dir/data/things.jsonl");
    expect(fs.dirs.size).toBe(0);
    expect(store.readAll()).toEqual([]);

    store.append({ n: 1 });
    expect([...fs.dirs]).toEqual(["/base/dir/data"]);
  });

  it("round-trips records as one JSON line each, in append order", () => {
    const fs = createMemoryFs();
    const store = createJsonStore<{ id: string; nested: { a: number[] } }>({
      dir: "/abs/store",
      name: "things",
      fs,
    });

    store.append({ id: "a", nested: { a: [1, 2] } });
    store.append({ id: "b", nested: { a: [] } });

    expect(fs.files.get(store.filePath)).toBe(
      '{"id":"a","nested":{"a":[1,2]}}\n{"id":"b","nested":{"a":[]}}\n',
    );
    expect(store.readAll().map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("skips a truncated final line instead of throwing", () => {
    const fs = createMemoryFs();
    const store = createJsonStore<{ id: string }>({
      dir: "/abs/store",
      name: "things",
      fs,
    });

    store.append({ id: "a" });
    store.append({ id: "b" });
    // Simulate a kill mid-write: the last line never got its closing brace.
    fs.files.set(store.filePath, `${fs.files.get(store.filePath) ?? ""}{"id":"c`);

    const result = store.readAllWithStats();
    expect(result.records.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result.skipped).toBe(1);
  });

  it("skips a corrupt mid-file line and keeps the records around it", () => {
    const fs = createMemoryFs();
    const store = createJsonStore<{ id: string }>({
      dir: "/abs/store",
      name: "things",
      fs,
    });

    fs.files.set(store.filePath, '{"id":"a"}\nnot json at all\n{"id":"c"}\n');

    const result = store.readAllWithStats();
    expect(result.records.map((r) => r.id)).toEqual(["a", "c"]);
    expect(result.skipped).toBe(1);
  });

  it("resolves a relative dir against the caller-supplied base", () => {
    expect(resolveStoreDir("./data", BASE)).toBe("/base/dir/data");
    expect(resolveStoreDir("../shared-data", BASE)).toBe("/base/shared-data");
    expect(resolveStoreDir("/var/lib/vortex", BASE)).toBe("/var/lib/vortex");
    expect(resolveStoreDir("/var/lib/vortex")).toBe("/var/lib/vortex");
  });

  it("refuses a relative dir with no base rather than falling back to cwd", () => {
    expect(() => resolveStoreDir("./data")).toThrow(/baseDir/);
  });

  it("exposes the injected clock so callers stamp from one source", () => {
    const clock = createClock(1_700_000_000_000);
    const store = createJsonStore<{ n: number }>({
      dir: "/abs/store",
      name: "things",
      fs: createMemoryFs(),
      now: clock.now,
    });

    expect(store.now()).toBe(1_700_000_000_000);
    clock.set(1_700_000_005_000);
    expect(store.now()).toBe(1_700_000_005_000);
  });
});

describe("createJsonStore on the real filesystem", () => {
  const dir = mkdtempSync(join(tmpdir(), "vortex-store-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes and reads back through node:fs in a temp dir", () => {
    const store = createJsonStore<{ id: string }>({
      dir: join(dir, "nested", "data"),
      name: "things",
    });

    store.append({ id: "a" });
    store.append({ id: "b" });

    expect(store.readAll()).toEqual([{ id: "a" }, { id: "b" }]);
  });
});

// ── quote sessions ─────────────────────────────────────────────────

describe("createQuoteSessionStore", () => {
  it("keeps the full Uniswap quote server-side behind an opaque id", () => {
    const clock = createClock(1_000_000);
    const sessions = createQuoteSessionStore({ now: clock.now });
    const payload = exchangePayload();

    const session = sessions.create(payload);

    expect(session.expiresAt).toBe(1_000_000 + EXCHANGE_SESSION_TTL_MS);
    expect(session.consumedAt).toBeNull();

    const peeked = sessions.peek(session.id);
    expect(peeked.ok).toBe(true);
    if (!peeked.ok) throw new Error("unreachable");
    // The browser only ever holds `session.id`; rawQuote/permitData never
    // round-trip through the client.
    expect(peeked.session.payload.uniswap?.rawQuote).toEqual(
      payload.uniswap?.rawQuote,
    );
    expect(peeked.session.payload.uniswap?.permitData).toEqual(
      payload.uniswap?.permitData,
    );
    expect(peeked.session.payload.uniswap?.requestId).toBe("req-abc-123");
    expect(peeked.session.payload.request.amountIn).toBe(1_000_000n);
  });

  it("expires exactly at expiresAt, not a tick later", () => {
    const clock = createClock(1_000_000);
    const sessions = createQuoteSessionStore({ now: clock.now });
    const { id, expiresAt } = sessions.create(exchangePayload());

    clock.set(expiresAt - 1);
    expect(sessions.peek(id).ok).toBe(true);

    clock.set(expiresAt);
    const atBoundary = sessions.peek(id);
    expect(atBoundary).toEqual({ ok: false, reason: "EXPIRED" });
    expect(sessions.consume(id)).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("is single-use: the second consume fails", () => {
    const clock = createClock(1_000_000);
    const sessions = createQuoteSessionStore({ now: clock.now });
    const { id } = sessions.create(exchangePayload());

    clock.set(1_005_000);
    const first = sessions.consume(id);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.session.consumedAt).toBe(1_005_000);
    expect(first.session.payload.uniswap?.requestId).toBe("req-abc-123");

    expect(sessions.consume(id)).toEqual({ ok: false, reason: "ALREADY_USED" });
    expect(sessions.peek(id)).toEqual({ ok: false, reason: "ALREADY_USED" });
  });

  it("reports NOT_FOUND for an id that was never issued", () => {
    const sessions = createQuoteSessionStore({ now: createClock().now });

    expect(sessions.peek("nope")).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(sessions.consume("nope")).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("still reports ALREADY_USED when a consumed session later expires", () => {
    const clock = createClock(0);
    const sessions = createQuoteSessionStore({ now: clock.now });
    const { id } = sessions.create(exchangePayload());

    clock.set(1_000);
    expect(sessions.consume(id).ok).toBe(true);

    clock.set(EXCHANGE_SESSION_TTL_MS + 1_000);
    expect(sessions.consume(id)).toEqual({ ok: false, reason: "ALREADY_USED" });
  });

  it("becomes refreshable exactly at the 30s threshold", () => {
    const clock = createClock(0);
    const sessions = createQuoteSessionStore({ now: clock.now });
    const { id, refreshAt } = sessions.create(exchangePayload());

    expect(refreshAt).toBe(REFRESH_THRESHOLD_MS);
    clock.set(REFRESH_THRESHOLD_MS - 1);
    expect(sessions.isRefreshable(id)).toBe(false);
    clock.set(REFRESH_THRESHOLD_MS);
    expect(sessions.isRefreshable(id)).toBe(true);
    // Still live: refreshable is guidance, not expiry.
    expect(sessions.peek(id).ok).toBe(true);
  });

  it("is not refreshable when unknown, expired, or already consumed", () => {
    const clock = createClock(0);
    const sessions = createQuoteSessionStore({ now: clock.now });
    const live = sessions.create(exchangePayload());
    const used = sessions.create(exchangePayload());
    sessions.consume(used.id);

    clock.set(REFRESH_THRESHOLD_MS + 1);
    expect(sessions.isRefreshable("nope")).toBe(false);
    expect(sessions.isRefreshable(used.id)).toBe(false);
    expect(sessions.isRefreshable(live.id)).toBe(true);

    clock.set(EXCHANGE_SESSION_TTL_MS);
    expect(sessions.isRefreshable(live.id)).toBe(false);
  });

  it("mints unguessable, unique ids", () => {
    const clock = createClock(0);
    const sessions = createQuoteSessionStore({ now: clock.now });

    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) ids.add(sessions.create(exchangePayload()).id);

    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("sweeps only expired entries", () => {
    const clock = createClock(0);
    const sessions = createQuoteSessionStore({ now: clock.now });
    const old = sessions.create(exchangePayload());

    clock.set(40_000);
    const fresh = sessions.create(exchangePayload());
    expect(sessions.size).toBe(2);

    clock.set(EXCHANGE_SESSION_TTL_MS);
    expect(sessions.sweep()).toBe(1);
    expect(sessions.size).toBe(1);
    expect(sessions.peek(old.id)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(sessions.peek(fresh.id).ok).toBe(true);
  });

  it("reuses the same primitive for 30s Grow opportunities", () => {
    const clock = createClock(0);
    const grow = createQuoteSessionStore<{ opportunityId: string }>({
      ttlMs: GROW_SESSION_TTL_MS,
      now: clock.now,
    });

    const session = grow.create({ opportunityId: "opp-1" });
    expect(session.expiresAt).toBe(GROW_SESSION_TTL_MS);

    clock.set(GROW_SESSION_TTL_MS - 1);
    expect(grow.peek(session.id).ok).toBe(true);
    clock.set(GROW_SESSION_TTL_MS);
    expect(grow.peek(session.id)).toEqual({ ok: false, reason: "EXPIRED" });
  });
});

// ── executions ─────────────────────────────────────────────────────

const executionStore = (
  fs: MemoryFs,
  now: () => number,
  seq = { n: 0 },
): ReturnType<typeof createExecutionStore> =>
  createExecutionStore({
    dir: "./data",
    baseDir: BASE,
    fs,
    now,
    idFactory: () => `exec-${(seq.n += 1)}`,
  });

describe("createExecutionStore", () => {
  it("fills defaults and validates before persisting", () => {
    const fs = createMemoryFs();
    const clock = createClock(1_700_000_000_000);
    const store = executionStore(fs, clock.now);

    const record = store.recordExecution({
      kind: "BEST_EXECUTION_AQUA",
      chainId: 42161,
      taker: TAKER,
      maker: MAKER,
    });

    expect(record.id).toBe("exec-1");
    expect(record.timestamp).toBe(1_700_000_000_000);
    expect(record.txHash).toBeNull();
    expect(record.uniswapRequestId).toBeNull();
    expect(record.grossProfit).toBeNull();
    expect(record.failureCategory).toBeNull();
    expect(store.filePath).toBe("/base/dir/data/executions.jsonl");
    expect(fs.files.get(store.filePath)).toBe(`${JSON.stringify(record)}\n`);
  });

  it("never persists a record that fails the shared schema", () => {
    const fs = createMemoryFs();
    const store = executionStore(fs, createClock(1).now);

    expect(() =>
      store.recordExecution({
        kind: "BEST_EXECUTION_UNISWAP",
        chainId: 42161,
        txHash: "0xdeadbeef", // not 32 bytes
      }),
    ).toThrow(InvalidExecutionRecordError);

    expect(() =>
      store.recordExecution({
        kind: "GROW",
        chainId: 42161,
        amountIn: "1.5", // base units are integers
      }),
    ).toThrow(InvalidExecutionRecordError);

    expect(fs.files.size).toBe(0);
    expect(store.listExecutions()).toEqual([]);
  });

  it("carries the Uniswap requestId, tx hash, and timestamp through the file", () => {
    const fs = createMemoryFs();
    const clock = createClock(1_700_000_123_456);
    const store = executionStore(fs, clock.now);

    store.recordExecution({
      kind: "BEST_EXECUTION_UNISWAP",
      chainId: 42161,
      txHash: TX_HASH,
      blockNumber: 123_456_789,
      taker: TAKER,
      tokenIn: WBTC,
      tokenOut: USDC,
      amountIn: "1000000", // 0.01 WBTC, 8 decimals
      amountOut: "640148143", // 640.148143 USDC, 6 decimals
      uniswapRequestId: "req-abc-123",
    });

    // Re-read through a fresh store instance: evidence must survive the file.
    const reopened = executionStore(fs, clock.now);
    const [persisted] = reopened.listExecutions();
    expect(persisted?.uniswapRequestId).toBe("req-abc-123");
    expect(persisted?.txHash).toBe(TX_HASH);
    expect(persisted?.timestamp).toBe(1_700_000_123_456);
    expect(persisted?.amountIn).toBe("1000000");
    expect(persisted?.amountOut).toBe("640148143");
  });

  it("lists newest first, breaking timestamp ties by append order", () => {
    const fs = createMemoryFs();
    const clock = createClock(1_000);
    const store = executionStore(fs, clock.now);

    store.recordExecution({ kind: "GROW", chainId: 42161 }); // exec-1 @1000
    clock.set(3_000);
    store.recordExecution({ kind: "GROW", chainId: 42161 }); // exec-2 @3000
    clock.set(2_000);
    store.recordExecution({ kind: "GROW", chainId: 42161 }); // exec-3 @2000
    store.recordExecution({ kind: "GROW", chainId: 42161 }); // exec-4 @2000

    expect(store.listExecutions().map((r) => r.id)).toEqual([
      "exec-2",
      "exec-4",
      "exec-3",
      "exec-1",
    ]);
  });

  it("filters by kind and applies the limit after ordering", () => {
    const fs = createMemoryFs();
    const clock = createClock(1_000);
    const store = executionStore(fs, clock.now);

    store.recordExecution({ kind: "BEST_EXECUTION_AQUA", chainId: 42161 });
    clock.set(2_000);
    store.recordExecution({ kind: "GROW", chainId: 42161 });
    clock.set(3_000);
    store.recordExecution({ kind: "BEST_EXECUTION_AQUA", chainId: 42161 });
    clock.set(4_000);
    store.recordExecution({ kind: "BEST_EXECUTION_UNISWAP", chainId: 42161 });

    expect(
      store.listExecutions({ kind: "BEST_EXECUTION_AQUA" }).map((r) => r.id),
    ).toEqual(["exec-3", "exec-1"]);
    expect(store.listExecutions({ limit: 2 }).map((r) => r.id)).toEqual([
      "exec-4",
      "exec-3",
    ]);
    expect(
      store.listExecutions({ kind: "GROW", limit: 5 }).map((r) => r.id),
    ).toEqual(["exec-2"]);
    expect(store.listExecutions({ limit: 0 })).toEqual([]);
  });

  it("drops persisted rows that no longer match the shared schema", () => {
    const fs = createMemoryFs();
    const clock = createClock(5_000);
    const store = executionStore(fs, clock.now);

    const good = store.recordExecution({ kind: "GROW", chainId: 42161 });
    // A hand-edited / legacy line: valid JSON, invalid evidence.
    const legacy: Record<string, unknown> = { ...(good as ExecutionRecord) };
    legacy.id = "legacy-1";
    legacy.kind = "SOMETHING_ELSE";
    fs.files.set(
      store.filePath,
      `${fs.files.get(store.filePath) ?? ""}${JSON.stringify(legacy)}\n`,
    );

    expect(store.listExecutions().map((r) => r.id)).toEqual([good.id]);
  });
});

import { randomUUID } from "node:crypto";

import {
  zExecutionRecord,
  type ExecutionKind,
  type ExecutionRecord,
} from "@vortex/shared";
import type { ZodError } from "zod";

import {
  createJsonStore,
  type JsonStore,
  type JsonStoreFs,
} from "./jsonStore";

export const EXECUTIONS_STORE_NAME = "executions";

/**
 * Everything except `kind` and `chainId` is filled in: a record is evidence,
 * so an unknown field is persisted as an explicit null, never dropped.
 */
export type ExecutionDraft = Partial<ExecutionRecord> &
  Pick<ExecutionRecord, "kind" | "chainId">;

/**
 * A record that fails the shared schema is a server-side bug, not caller
 * input — it stays untagged so the error handler renders it as a 500 (see
 * lib/errors.ts) instead of blaming the taker.
 */
export class InvalidExecutionRecordError extends Error {
  constructor(readonly zodError: ZodError) {
    super("invalid execution record");
    this.name = "InvalidExecutionRecordError";
  }
}

export interface ExecutionStoreOptions {
  dir: string;
  baseDir?: string;
  name?: string;
  fs?: JsonStoreFs;
  now?: () => number;
  idFactory?: () => string;
}

export interface ListExecutionsOptions {
  limit?: number;
  kind?: ExecutionKind;
}

export interface ExecutionStore {
  /** Validates, then persists. An invalid record is never written. */
  recordExecution(draft: ExecutionDraft): ExecutionRecord;
  /** Newest first; ties broken by append order (latest append wins). */
  listExecutions(options?: ListExecutionsOptions): ExecutionRecord[];
  readonly filePath: string;
}

function withDefaults(
  draft: ExecutionDraft,
  id: string,
  timestamp: number,
): ExecutionRecord {
  return {
    id: draft.id ?? id,
    kind: draft.kind,
    chainId: draft.chainId,
    txHash: draft.txHash ?? null,
    blockNumber: draft.blockNumber ?? null,
    strategyHash: draft.strategyHash ?? null,
    maker: draft.maker ?? null,
    taker: draft.taker ?? null,
    tokenIn: draft.tokenIn ?? null,
    tokenOut: draft.tokenOut ?? null,
    amountIn: draft.amountIn ?? null,
    amountOut: draft.amountOut ?? null,
    uniswapRequestId: draft.uniswapRequestId ?? null,
    opportunityId: draft.opportunityId ?? null,
    grossProfit: draft.grossProfit ?? null,
    makerReturn: draft.makerReturn ?? null,
    performanceFee: draft.performanceFee ?? null,
    failureCategory: draft.failureCategory ?? null,
    timestamp: draft.timestamp ?? timestamp,
  };
}

/**
 * Append-only evidence store (MASTER R-008). Every execution can carry the
 * Uniswap requestId, the tx hash, and a timestamp — evidence is an exit
 * criterion, so those three survive a round-trip through the file.
 */
export function createExecutionStore(
  options: ExecutionStoreOptions,
): ExecutionStore {
  const store: JsonStore<ExecutionRecord> = createJsonStore<ExecutionRecord>({
    dir: options.dir,
    baseDir: options.baseDir,
    name: options.name ?? EXECUTIONS_STORE_NAME,
    fs: options.fs,
    now: options.now,
  });
  const idFactory = options.idFactory ?? (() => randomUUID());

  return {
    filePath: store.filePath,
    recordExecution(draft: ExecutionDraft): ExecutionRecord {
      const candidate = withDefaults(draft, idFactory(), store.now());
      const parsed = zExecutionRecord.safeParse(candidate);
      if (!parsed.success) throw new InvalidExecutionRecordError(parsed.error);
      store.append(parsed.data);
      return parsed.data;
    },
    listExecutions(listOptions: ListExecutionsOptions = {}): ExecutionRecord[] {
      const records: ExecutionRecord[] = [];
      for (const raw of store.readAll()) {
        // Re-validated on read: a hand-edited or legacy line is dropped rather
        // than served as if it were evidence.
        const parsed = zExecutionRecord.safeParse(raw);
        if (!parsed.success) continue;
        if (listOptions.kind && parsed.data.kind !== listOptions.kind) continue;
        records.push(parsed.data);
      }
      // reverse() first so Array#sort's stability makes the later append win a
      // timestamp tie (same-millisecond writes are common on a fork).
      records.reverse();
      records.sort((a, b) => b.timestamp - a.timestamp);
      return listOptions.limit === undefined
        ? records
        : records.slice(0, Math.max(0, listOptions.limit));
    },
  };
}

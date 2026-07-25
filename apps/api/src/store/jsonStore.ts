import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * The slice of `node:fs` the store touches. Injectable so tests exercise the
 * real code path against an in-memory double instead of the disk.
 */
export interface JsonStoreFs {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: true }): void;
  appendFileSync(path: string, data: string): void;
  readFileSync(path: string, encoding: "utf8"): string;
}

export const nodeJsonStoreFs: JsonStoreFs = {
  existsSync: (path) => existsSync(path),
  mkdirSync: (path, options) => {
    mkdirSync(path, options);
  },
  appendFileSync: (path, data) => appendFileSync(path, data),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
};

export interface JsonStoreOptions {
  /** STORE_DIR as configured; may be relative (default `./data`). */
  dir: string;
  /**
   * Base a relative `dir` resolves against. Required for relative dirs so the
   * store location never silently depends on process.cwd().
   */
  baseDir?: string;
  /** File stem; the store writes `<dir>/<name>.jsonl`. */
  name: string;
  fs?: JsonStoreFs;
  now?: () => number;
}

export interface JsonStoreReadResult<T> {
  records: T[];
  /** Lines that could not be parsed — a truncated tail after a crash, or rot. */
  skipped: number;
}

export interface JsonStore<T> {
  readonly dir: string;
  readonly filePath: string;
  /** Appends one JSON line. Creates the directory on first write. */
  append(record: T): T;
  readAll(): T[];
  readAllWithStats(): JsonStoreReadResult<T>;
  /** The injected clock, shared so callers stamp records from the same source. */
  now(): number;
}

/**
 * Resolves a configured store dir against an explicit base. Callers pass
 * something stable (a module URL's dirname, the repo root) — never cwd, which
 * differs between `pnpm dev`, vitest, and a packaged run.
 */
export function resolveStoreDir(dir: string, baseDir?: string): string {
  if (isAbsolute(dir)) return dir;
  if (baseDir === undefined) {
    throw new Error(
      `relative store dir "${dir}" requires an explicit baseDir (process.cwd() is not a stable base)`,
    );
  }
  return resolve(baseDir, dir);
}

/**
 * Append-only JSONL store (MASTER R-008 — no SQLite). Writes are one
 * `JSON.stringify` per line; reads tolerate a partially written final line,
 * which is the failure mode of an append-only file whose process was killed
 * mid-write. Corrupt lines are skipped and counted rather than throwing, so a
 * single bad record can never make the whole evidence file unreadable.
 */
export function createJsonStore<T>(options: JsonStoreOptions): JsonStore<T> {
  const fs = options.fs ?? nodeJsonStoreFs;
  const now = options.now ?? Date.now;
  const dir = resolveStoreDir(options.dir, options.baseDir);
  const filePath = join(dir, `${options.name}.jsonl`);

  let dirEnsured = false;
  const ensureDir = (): void => {
    if (dirEnsured) return;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    dirEnsured = true;
  };

  const readAllWithStats = (): JsonStoreReadResult<T> => {
    if (!fs.existsSync(filePath)) return { records: [], skipped: 0 };
    const contents = fs.readFileSync(filePath, "utf8");
    const records: T[] = [];
    let skipped = 0;
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        records.push(JSON.parse(trimmed) as T);
      } catch {
        skipped += 1;
      }
    }
    return { records, skipped };
  };

  return {
    dir,
    filePath,
    append(record: T): T {
      ensureDir();
      fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
      return record;
    },
    readAll: () => readAllWithStats().records,
    readAllWithStats,
    now,
  };
}

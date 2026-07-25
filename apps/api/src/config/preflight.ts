/**
 * Startup preflight for the single most likely way the demo dies: the API
 * configured for one chain while the RPC answers on another.
 *
 * The failure is silent by nature — every endpoint keeps returning 200, the
 * quote just says `AQUA_EXECUTION_UNAVAILABLE` and the contracts list is
 * empty, which reads like "the feature is broken" rather than "the chain id is
 * wrong". Master lost a demo run to exactly this, so it is checked explicitly
 * and reported with the fix rather than left to be inferred.
 */

export type PreflightSeverity = "ok" | "warn" | "error";

export interface PreflightFinding {
  severity: PreflightSeverity;
  code: string;
  message: string;
  /** The exact thing to change. Always present on a non-ok finding. */
  remedy?: string;
}

export interface ChainDiagnosisInput {
  configuredChainId: number;
  rpcUrl: string;
  /** Chain id the configured RPC actually reports; null when unreachable. */
  rpcChainId: number | null;
  /** Whether the CONFIGURED chain has a seeded Aqua strategy. */
  hasAquaStrategy: boolean;
  /**
   * Chain ids that do have a seeded strategy, for pointing at the right one.
   */
  chainsWithStrategies: readonly number[];
}

export function diagnoseChainConfiguration(
  input: ChainDiagnosisInput,
): PreflightFinding {
  const {
    configuredChainId,
    rpcUrl,
    rpcChainId,
    hasAquaStrategy,
    chainsWithStrategies,
  } = input;

  if (rpcChainId === null) {
    return {
      severity: "warn",
      code: "RPC_UNREACHABLE",
      message: `no RPC answering at ${rpcUrl} for chain ${configuredChainId}`,
      remedy:
        "start the chain (scripts/bootstrap-fork.sh) or point RPC_URL/FORK_RPC_URL at a live node",
    };
  }

  if (rpcChainId !== configuredChainId) {
    return {
      severity: "error",
      code: "CHAIN_ID_MISMATCH",
      message: `CHAIN_ID=${configuredChainId} but the RPC at ${rpcUrl} reports chain ${rpcChainId}`,
      remedy: `set CHAIN_ID=${rpcChainId} (or point the RPC at chain ${configuredChainId})`,
    };
  }

  if (!hasAquaStrategy) {
    const alternative = chainsWithStrategies.find(
      (id) => id !== configuredChainId,
    );
    return {
      severity: "error",
      code: "NO_AQUA_STRATEGY",
      message: `chain ${configuredChainId} has no seeded Aqua strategy, so swaps cannot be built (AQUA_EXECUTION_UNAVAILABLE)`,
      remedy:
        alternative === undefined
          ? "run scripts/bootstrap-fork.sh to deploy and seed a strategy"
          : `set CHAIN_ID=${alternative} — that chain has a seeded strategy`,
    };
  }

  return {
    severity: "ok",
    code: "OK",
    message: `chain ${configuredChainId} verified: RPC agrees and an Aqua strategy is deployed`,
  };
}

/** Human-facing block, printed loudly enough that nobody starts a demo past it. */
export function formatPreflight(finding: PreflightFinding): string {
  if (finding.severity === "ok") return `preflight: ${finding.message}`;
  const banner = finding.severity === "error" ? "CONFIGURATION ERROR" : "WARNING";
  const lines = [
    "",
    "  ┌──────────────────────────────────────────────────────────────",
    `  │ ${banner}: ${finding.code}`,
    `  │ ${finding.message}`,
  ];
  if (finding.remedy) lines.push(`  │ FIX: ${finding.remedy}`);
  lines.push("  └──────────────────────────────────────────────────────────────", "");
  return lines.join("\n");
}

/** Reads the chain id an RPC reports, or null when it cannot be reached. */
export async function probeRpcChainId(
  rpcUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2_000,
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string };
    if (typeof body.result !== "string") return null;
    const parsed = Number.parseInt(body.result, 16);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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

import { encodeFunctionData, type Address, type Hex } from "viem";

const aquaRawBalancesAbi = [
  {
    type: "function",
    name: "rawBalances",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type PreflightSeverity = "ok" | "warn" | "error";

export interface PreflightFinding {
  severity: PreflightSeverity;
  code: string;
  message: string;
  /** The exact thing to change. Always present on a non-ok finding. */
  remedy?: string;
}

/** The one idempotent command that deploys, seeds and ships everything. */
export const BRING_UP_COMMAND = "./scripts/ensure-demo.sh";

export interface ChainDiagnosisInput {
  configuredChainId: number;
  rpcUrl: string;
  /** Chain id the configured RPC actually reports; null when unreachable. */
  rpcChainId: number | null;
  /** Whether the CONFIGURED chain has a seeded Aqua strategy ARTIFACT. */
  hasAquaStrategy: boolean;
  /**
   * Chain ids that do have a seeded strategy, for pointing at the right one.
   */
  chainsWithStrategies: readonly number[];
  /** Deployment-file contracts whose address has no bytecode on this chain. */
  contractsMissing?: readonly string[];
  /**
   * Strategies whose contracts exist but which were never `ship`ped into Aqua.
   *
   * This is the dangerous state: every address has bytecode, so the system
   * *looks* deployed while the API answers STRATEGY_NOT_FOUND. A strategy is
   * Aqua state, not a contract, and the two steps are separable.
   */
  strategiesUnshipped?: readonly string[];
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

  const contractsMissing = input.contractsMissing ?? [];
  if (contractsMissing.length > 0) {
    return {
      severity: "error",
      code: "CONTRACTS_MISSING",
      message: `chain ${configuredChainId} is missing deployed bytecode for: ${contractsMissing.join(", ")}`,
      remedy: `run ${BRING_UP_COMMAND} — it deploys whatever is absent`,
    };
  }

  const strategiesUnshipped = input.strategiesUnshipped ?? [];
  if (strategiesUnshipped.length > 0) {
    return {
      severity: "error",
      code: "STRATEGIES_UNSHIPPED",
      message: `contracts are deployed but no strategy was shipped into Aqua for: ${strategiesUnshipped.join(", ")}. The system looks deployed and is not — quotes will answer STRATEGY_NOT_FOUND`,
      remedy: `run ${BRING_UP_COMMAND} — it ships whatever is missing and is safe to re-run`,
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
          ? `run ${BRING_UP_COMMAND} to deploy and seed a strategy`
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

/** True when the address holds bytecode on this chain. */
export async function probeHasCode(
  rpcUrl: string,
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [address, "latest"],
      }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: string };
    return typeof body.result === "string" && body.result.length > 2;
  } catch {
    return false;
  }
}

/**
 * Aqua virtual balance for a strategy. Zero means the strategy was never
 * shipped — the state that makes a fully deployed chain answer
 * STRATEGY_NOT_FOUND. Returns null when the call itself fails, which is a
 * different problem and must not be reported as "unshipped".
 */
export async function probeStrategyShipped(
  rpcUrl: string,
  aqua: string,
  maker: string,
  app: string,
  strategyHash: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  // Encoded rather than hand-written: a hardcoded selector is silently wrong
  // if it drifts, and a wrong selector reads as "unshipped" for every strategy.
  const data = encodeFunctionData({
    abi: aquaRawBalancesAbi,
    functionName: "rawBalances",
    args: [
      maker as Address,
      app as Address,
      strategyHash as Hex,
      token as Address,
    ],
  });
  try {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: aqua, data }, "latest"],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string; error?: unknown };
    if (body.error || typeof body.result !== "string") return null;
    return BigInt(body.result) > 0n;
  } catch {
    return null;
  }
}

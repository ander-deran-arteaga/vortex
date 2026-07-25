import { API_ROUTES, type ConfigResponse } from "@vortex/shared";
import { z } from "zod";
import { apiRequest } from "@/lib/api/client";
import { fetchConfig, fetchExchangeQuote, scanGrowOpportunity } from "@/lib/api/endpoints";
import { ApiRequestError, ApiUnavailableError } from "@/lib/api/errors";
import { STRATEGY_HASHES } from "@/lib/strategy-config";
import { WBTC, USDC } from "@vortex/shared";
import { resolveTokens } from "@/lib/tokens";
import type { DemoStepId, DemoStepOutcome } from "./demoMachine";

export type StepRunResult =
  | { kind: "success"; outcome: DemoStepOutcome }
  | { kind: "blocked"; reason: string }
  | { kind: "failure"; reason: string };

export interface DemoRunContext {
  chainId: 42161 | 31337;
  now: () => number;
  /** Cached across steps so the whole run reads config once. */
  config?: ConfigResponse;
}

/**
 * Non-destructive capability probe: send a request that cannot possibly
 * succeed and read which way it fails. `ApiUnavailableError` means the route
 * is not registered (or the API is down); any other error means the route
 * exists and rejected the input. Nothing real is consumed, so a probe can run
 * on every demo pass — and a step unblocks itself the moment backend registers
 * its route, with no change here.
 */
async function isRouteRegistered(path: string, body: unknown): Promise<boolean> {
  try {
    await apiRequest(path, { method: "POST", body, schema: z.unknown() });
    return true;
  } catch (error) {
    return !(error instanceof ApiUnavailableError);
  }
}

async function loadConfig(ctx: DemoRunContext): Promise<ConfigResponse | null> {
  if (ctx.config !== undefined) {
    return ctx.config;
  }
  try {
    const result = await fetchConfig();
    ctx.config = result.data;
    return result.data;
  } catch {
    return null;
  }
}

function contractAddress(config: ConfigResponse | null, name: string): string | undefined {
  return config?.contracts[name];
}

export interface DemoStepDefinition {
  id: DemoStepId;
  title: string;
  /** What a judge should understand this step proves. */
  description: string;
  run: (ctx: DemoRunContext) => Promise<StepRunResult>;
}

const CONTRACTS_NOT_DEPLOYED =
  "No deployment is reported by GET /api/v1/config for this chain, so there is no contract to call. Run the fork deployment and restart the API.";

/**
 * The one thing that makes a quote failure actionable when the UI is still on
 * a fixture hash: the strategy was never shipped, so the venue is unavailable
 * rather than uncompetitive.
 */
const PLACEHOLDER_HASH_HINT =
  " The UI is still on a placeholder strategy hash, which no deployment ever shipped — set NEXT_PUBLIC_DEMO_STRATEGY_HASH (and NEXT_PUBLIC_DEMO_GROW_STRATEGY_HASH) to the hashes the demo seeding produced.";

/**
 * The API's own error code, verbatim, in front of its message. A run that
 * reports `AQUA_ORDER_UNAVAILABLE` tells a judge exactly which layer is
 * missing; "Quote request failed" tells them nothing.
 */
function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : fallback;
}

/** Quote-shaped failures also name the placeholder hash when that is the cause. */
function describeQuoteError(error: unknown, fallback: string): string {
  const described = describeError(error, fallback);
  return STRATEGY_HASHES.isPlaceholder ? `${described}${PLACEHOLDER_HASH_HINT}` : described;
}

export const DEMO_STEPS: DemoStepDefinition[] = [
  {
    id: "seed",
    title: "Seed accounts",
    description:
      "Fund the maker and taker on the local fork so the rest of the run has balances to move.",
    run: async () => {
      try {
        await apiRequest(API_ROUTES.demoSeed, {
          method: "POST",
          body: {},
          schema: z.unknown(),
        });
        return {
          kind: "success",
          outcome: { detail: "Demo accounts seeded through the API.", source: "live" },
        };
      } catch (error) {
        if (error instanceof ApiUnavailableError) {
          return {
            kind: "blocked",
            reason:
              "POST /api/v1/demo/seed is not registered yet, so accounts cannot be seeded from the UI.",
          };
        }
        return {
          kind: "failure",
          reason: describeError(error, "Seeding failed."),
        };
      }
    },
  },
  {
    id: "shipSwap",
    title: "Ship the Vortex Swap position",
    description:
      "The maker approves WBTC and USDC to Aqua and ships the market-making strategy.",
    run: async (ctx) => {
      const config = await loadConfig(ctx);
      const aqua = contractAddress(config, "Aqua");
      if (aqua === undefined) {
        return { kind: "blocked", reason: CONTRACTS_NOT_DEPLOYED };
      }
      return {
        kind: "blocked",
        reason:
          "Aqua is deployed, but shipping is a wallet action on the Maker page — there is no API route that ships on the maker's behalf, by design.",
      };
    },
  },
  {
    id: "shipGrow",
    title: "Ship the Vortex Grow position",
    description:
      "The maker approves WBTC to Aqua and ships the single-asset compounding strategy.",
    run: async (ctx) => {
      const config = await loadConfig(ctx);
      const compounder = contractAddress(config, "VortexCompounder");
      if (compounder === undefined) {
        return { kind: "blocked", reason: CONTRACTS_NOT_DEPLOYED };
      }
      return {
        kind: "blocked",
        reason:
          "VortexCompounder is deployed, but shipping is a wallet action on the Maker page.",
      };
    },
  },
  {
    id: "permammDiscrepancy",
    title: "Show the Vortex PermAMM price discrepancy",
    description:
      "The v4 pool is priced away from the reference oracle — the gap the Grow cycle harvests.",
    run: async (ctx) => {
      const config = await loadConfig(ctx);
      const quoter = contractAddress(config, "VortexQuoter");
      if (quoter === undefined) {
        return { kind: "blocked", reason: CONTRACTS_NOT_DEPLOYED };
      }
      return {
        kind: "blocked",
        reason:
          "VortexQuoter is deployed but the API exposes no quoting route for it yet, so the UI cannot read the pool price.",
      };
    },
  },
  {
    id: "executeSwap",
    title: "Execute the Vortex Swap best-execution trade",
    description:
      "Route the taker's WBTC through whichever venue nets more after gas, and settle it onchain.",
    run: async (ctx) => {
      // Attempt the real build rather than guessing at capability. The session
      // consumed here is one this step created, so nothing else is disturbed,
      // and the step reports whatever actually came back — including which
      // layer is missing.
      let sessionId: string;
      let venue: string;
      const tokens = resolveTokens((await loadConfig(ctx)) ?? undefined);
      try {
        const quote = await fetchExchangeQuote(
          {
            chainId: ctx.chainId,
            strategyHash: STRATEGY_HASHES.swap,
            tokenIn: tokens.wbtc.address,
            tokenOut: tokens.usdc.address,
            amountIn: "100000000",
            taker: "0x0000000000000000000000000000000000000000",
            slippageBps: 30,
          },
          { now: ctx.now() },
        );
        if (quote.source === "fixture") {
          return {
            kind: "blocked",
            reason:
              "The comparator is unreachable, so there is no quote session to execute against.",
          };
        }
        sessionId = quote.data.quoteSessionId;
        venue = quote.data.selectedVenue;
      } catch (error) {
        return {
          kind: "failure",
          reason: describeQuoteError(error, "Could not obtain a quote."),
        };
      }

      const route =
        venue === "AQUA" ? API_ROUTES.transactionsAqua : API_ROUTES.transactionsUniswap;
      try {
        await apiRequest(route, {
          method: "POST",
          body: { quoteSessionId: sessionId },
          schema: z.unknown(),
        });
        return {
          kind: "success",
          outcome: {
            detail: `${venue} transaction built for session ${sessionId}. Broadcasting it needs a connected wallet.`,
            source: "live",
          },
        };
      } catch (error) {
        if (error instanceof ApiUnavailableError) {
          return {
            kind: "blocked",
            reason: `${route} is not registered, so the winning venue has no transaction builder.`,
          };
        }
        if (error instanceof ApiRequestError) {
          // The builder answered — it just cannot serve this chain or session.
          return { kind: "blocked", reason: `${error.code}: ${error.message}` };
        }
        return {
          kind: "failure",
          reason: describeError(error, "The build failed."),
        };
      }
    },
  },
  {
    id: "aquaTransfers",
    title: "Show the real Aqua token transfers",
    description:
      "Prove ERC-20 ownership actually changed hands through official Aqua settlement.",
    run: async () => ({
      kind: "blocked",
      reason:
        "Depends on the trade above executing; there is no settlement to read yet.",
    }),
  },
  {
    id: "scanGrow",
    title: "Scan for a Vortex Grow opportunity",
    description:
      "Price a WBTC → USDC → WBTC cycle and check it clears the maker's profit floor.",
    run: async (ctx) => {
      try {
        const result = await scanGrowOpportunity(
          {
            chainId: ctx.chainId,
            strategyHash: STRATEGY_HASHES.grow,
            principalAmount: "100000000",
            direction: "AUTO",
          },
          { now: ctx.now() },
        );
        if (!result.data.opportunityFound) {
          return {
            kind: "success",
            outcome: {
              detail: `No opportunity: ${result.data.reason}`,
              source: result.source,
            },
          };
        }
        const opportunity = result.data;
        const principal = BigInt(opportunity.principalAmount);
        return {
          kind: "success",
          outcome: {
            detail: `Opportunity ${opportunity.opportunityId} — ${opportunity.direction}.`,
            source: result.source,
            deltas: [
              {
                label: "Maker WBTC across the cycle",
                symbol: WBTC.symbol,
                decimals: WBTC.decimals,
                before: principal,
                after: BigInt(opportunity.minFinalAsset),
              },
              {
                label: "USDC bridged mid-cycle",
                symbol: USDC.symbol,
                decimals: USDC.decimals,
                before: 0n,
                after: BigInt(opportunity.bridgeAmount),
              },
            ],
          },
        };
      } catch (error) {
        return {
          kind: "failure",
          reason: describeQuoteError(error, "Scan failed."),
        };
      }
    },
  },
  {
    id: "executeGrow",
    title: "Execute the Grow cycle atomically",
    description:
      "Pull the maker's WBTC, run both legs, and revert unless the position ends with more WBTC.",
    run: async () => {
      const registered = await isRouteRegistered(API_ROUTES.growExecute, {
        opportunityId: "capability-probe",
      });
      if (!registered) {
        return {
          kind: "blocked",
          reason:
            "POST /api/v1/grow/execute is not registered, so no cycle can be submitted from the UI.",
        };
      }
      return {
        kind: "blocked",
        reason:
          "The Grow execution route is live. Browser-side wiring follows the Vortex Swap path.",
      };
    },
  },
  {
    id: "wbtcIncrease",
    title: "Show the maker's WBTC increase",
    description:
      "The whole point of Grow: the maker ends the cycle holding more WBTC than they started with.",
    run: async () => ({
      kind: "blocked",
      reason: "Depends on the cycle above executing; there is no result to measure.",
    }),
  },
  {
    id: "uniswapEvidence",
    title: "Show the Uniswap API request ID and transaction",
    description:
      "Every comparison is benchmarked against a real Uniswap Trade API quote; this is its request ID.",
    run: async (ctx) => {
      const tokens = resolveTokens((await loadConfig(ctx)) ?? undefined);
      try {
        const result = await fetchExchangeQuote(
          {
            chainId: ctx.chainId,
            strategyHash: STRATEGY_HASHES.swap,
            tokenIn: tokens.wbtc.address,
            tokenOut: tokens.usdc.address,
            amountIn: "100000000",
            taker: "0x0000000000000000000000000000000000000000",
            slippageBps: 30,
          },
          { now: ctx.now() },
        );
        const uniswap = result.data.comparison.uniswap;
        if (uniswap === null) {
          return {
            kind: "failure",
            reason: "The comparator returned no Uniswap quote to evidence.",
          };
        }
        if (uniswap.requestId === undefined) {
          return {
            kind: "failure",
            reason: "The Uniswap quote carried no request ID.",
          };
        }
        return {
          kind: "success",
          outcome: {
            detail: `Benchmarked against Uniswap, selected venue ${result.data.selectedVenue}.`,
            uniswapRequestId: uniswap.requestId,
            // The evidence is only as good as the leg's provenance, so carry
            // the venue's own source rather than the response's.
            source: uniswap.source,
          },
        };
      } catch (error) {
        return {
          kind: "failure",
          reason: describeQuoteError(error, "Quote request failed."),
        };
      }
    },
  },
];

export const DEMO_STEP_LABELS = DEMO_STEPS.reduce(
  (acc, step) => {
    acc[step.id] = step.title;
    return acc;
  },
  {} as Record<DemoStepId, string>,
);

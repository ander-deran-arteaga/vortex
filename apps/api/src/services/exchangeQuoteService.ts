import type {
  AquaComparison,
  ExchangeQuoteResponse,
  QuoteSource,
  UniswapComparison,
} from "@vortex/shared";
import type { Hex } from "viem";

import { explainAquaReason } from "../clients/liveAquaQuoteSource";
import {
  quoteParamsFromRequest,
  UniswapApiError,
  type UniswapApiClient,
} from "../clients/uniswapApiClient";
import type { ExchangeSessionPayload, QuoteSessionStore } from "../store/quoteSessions";
import {
  compareVenues,
  type ComparatorOptions,
  type ComparisonResult,
} from "./venueComparator";
import type {
  AquaQuote,
  AquaQuoteSource,
  QuoteRequestParams,
  UniswapQuote,
} from "./types";

export interface ExchangeQuoteDeps {
  aquaSource: AquaQuoteSource;
  /** Absent until an API key is configured; Uniswap simply never wins then. */
  uniswapClient: UniswapApiClient | null;
  sessions: QuoteSessionStore<ExchangeSessionPayload>;
  comparatorOptions?: ComparatorOptions;
}

export interface ExchangeQuoteParams extends QuoteRequestParams {
  strategyHash: Hex;
}

export class NoVenueAvailableError extends Error {
  constructor(readonly detail: string) {
    super("no venue can price this trade");
    this.name = "NoVenueAvailableError";
  }
}

/** Failures of one venue must not fail the comparison — the other may still win. */
async function safely<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

async function loadUniswapQuote(
  client: UniswapApiClient | null,
  params: QuoteRequestParams,
): Promise<UniswapQuote | null> {
  if (!client) return null;
  return safely(async () => {
    const quote = await client.getClassicQuote(quoteParamsFromRequest(params));
    const gasFeeQuote = quote.quote.gasFeeQuote;
    return {
      amountIn: BigInt(quote.quote.input.amount),
      amountOut: BigInt(quote.quote.output.amount),
      minimumAmountOut: BigInt(quote.quote.output.minimumAmount),
      gasUnits: BigInt(quote.quote.gasUseEstimate ?? 0),
      // Denominated in the output token — the rate the Aqua leg is charged at.
      gasCostInOutputToken:
        gasFeeQuote === undefined || gasFeeQuote === null
          ? null
          : BigInt(gasFeeQuote),
      requestId: quote.requestId,
      routing: quote.routing,
      rawQuote: quote.rawQuote,
      permitData: quote.permitData,
      approvalRequired: quote.approvalRequired,
      gasFeeUSD: quote.quote.gasFeeUSD ?? null,
      priceImpact: quote.quote.priceImpact ?? null,
      txFailureReasons: quote.quote.txFailureReasons ?? [],
    } satisfies UniswapQuote;
  });
}

/**
 * Aqua settles onchain and pays gas like any other venue. Its cost in USD is
 * scaled off Uniswap's stated `gasFeeUSD` by the gas-units ratio — the same
 * reference trick the comparator uses, so the figure shown to the taker
 * matches the figure the comparator actually charged it.
 *
 * Returns **null** when there is no reference quote to derive a rate from.
 * Vortex has no ETH price feed, so on a chain where Uniswap cannot quote the
 * gas genuinely cannot be priced — and "0" would read as "this venue is free
 * to execute", which is a fabricated number, not a missing one.
 */
function aquaGasUsd(
  aquaGasUnits: bigint,
  uniswapQuote: UniswapQuote | null,
): string | null {
  if (!uniswapQuote || uniswapQuote.gasUnits <= 0n || !uniswapQuote.gasFeeUSD) {
    return null;
  }
  const uniswapUsd = Number(uniswapQuote.gasFeeUSD);
  if (!Number.isFinite(uniswapUsd)) return null;
  const ratio = Number(aquaGasUnits) / Number(uniswapQuote.gasUnits);
  return String(uniswapUsd * ratio);
}

function toAquaComparison(
  quote: AquaQuote,
  compared: ComparisonResult["aqua"],
  source: QuoteSource,
  uniswapQuote: UniswapQuote | null,
): AquaComparison {
  return {
    source,
    amountOut: quote.amountOut.toString(),
    minimumAmountOut: quote.minimumAmountOut.toString(),
    estimatedGasUsd: aquaGasUsd(quote.gasUnits, uniswapQuote),
    netAmountOut: (compared?.netAmountOut ?? 0n).toString(),
    safetyFeeBps: quote.safetyFeeBps,
    commercialFeeBps: quote.commercialFeeBps,
    inventoryAdjustmentBps: quote.inventoryAdjustmentBps,
    makerCoverageBps: quote.makerCoverageBps,
  };
}

function toUniswapComparison(
  quote: UniswapQuote,
  compared: ComparisonResult["uniswap"],
): UniswapComparison {
  return {
    // Uniswap quotes only ever come from the authenticated Trade API; there is
    // no fixture Uniswap source. If one is ever added, thread its kind here.
    source: "live",
    amountOut: quote.amountOut.toString(),
    minimumAmountOut: quote.minimumAmountOut.toString(),
    estimatedGasUsd: quote.gasFeeUSD ?? null,
    netAmountOut: (compared?.netAmountOut ?? 0n).toString(),
    requestId: quote.requestId,
  };
}

/**
 * Quotes both venues, ranks them on net output, and opens a single-use session
 * holding the full Uniswap quote server-side. The browser only ever receives
 * the session id, so a quote can never be tampered with in transit.
 */
export async function quoteExchange(
  params: ExchangeQuoteParams,
  deps: ExchangeQuoteDeps,
): Promise<ExchangeQuoteResponse> {
  const [aquaQuote, uniswapQuote] = await Promise.all([
    safely(() => deps.aquaSource.quote(params)),
    loadUniswapQuote(deps.uniswapClient, params),
  ]);

  // A quote that exists but cannot settle is not a venue. Routing to one would
  // strand the taker just as surely as routing to a venue that never quoted.
  const aquaViable = Boolean(aquaQuote?.executable);
  // A quote Uniswap simulated as failing is not a venue either: routing to it
  // hands the taker a transaction that reverts and costs them the gas.
  const uniswapViable =
    uniswapQuote !== null && uniswapQuote.txFailureReasons.length === 0;

  if (!aquaViable && !uniswapViable) {
    const reasons = [
      aquaQuote?.reason
        ? `Aqua unavailable (${explainAquaReason(aquaQuote.reason)})`
        : null,
      uniswapQuote && uniswapQuote.txFailureReasons.length > 0
        ? `Uniswap simulation failed (${uniswapQuote.txFailureReasons.join(", ")})`
        : null,
    ].filter(Boolean);
    throw new NoVenueAvailableError(
      reasons.length > 0
        ? reasons.join("; ")
        : "neither the Aqua strategy nor the Uniswap API returned a quote",
    );
  }

  const comparison = compareVenues(
    aquaQuote,
    uniswapQuote,
    deps.comparatorOptions,
  );

  const selectedVenue = !uniswapViable
    ? "AQUA"
    : !aquaViable
      ? "UNISWAP"
      : comparison.selectedVenue;

  const session = deps.sessions.create({
    request: params,
    selectedVenue,
    uniswap: uniswapQuote,
    aqua: aquaQuote,
  });

  const execution: ExchangeQuoteResponse["execution"] =
    selectedVenue === "AQUA"
      ? {
          kind: "AQUA_SWAPVM",
          // The quoted floor travels with the order so settlement can be bound
          // to what the taker was shown. The full SwapVM Order tuple lands
          // here once blockend publishes a seeded strategy.
          order: {
            strategyHash: aquaQuote?.strategyHash ?? params.strategyHash,
            minimumAmountOut: (aquaQuote?.minimumAmountOut ?? 0n).toString(),
            source: deps.aquaSource.kind,
          },
          amount: params.amountIn.toString(),
          takerTraitsAndData: "0x",
        }
      : {
          kind: "UNISWAP_API",
          quoteSessionId: session.id,
          permitData: uniswapQuote?.permitData ?? null,
          approvalRequired: uniswapQuote?.approvalRequired ?? true,
        };

  return {
    quoteSessionId: session.id,
    selectedVenue,
    expiresAt: session.expiresAt,
    comparison: {
      aqua: aquaQuote
        ? toAquaComparison(
            aquaQuote,
            comparison.aqua,
            deps.aquaSource.kind,
            uniswapQuote,
          )
        : null,
      uniswap: uniswapQuote
        ? toUniswapComparison(uniswapQuote, comparison.uniswap)
        : null,
    },
    execution,
  };
}

export { UniswapApiError };

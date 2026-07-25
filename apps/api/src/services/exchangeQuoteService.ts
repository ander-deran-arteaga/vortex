import type {
  AquaComparison,
  ExchangeQuoteResponse,
  QuoteSource,
  UniswapComparison,
} from "@vortex/shared";
import type { Hex } from "viem";

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
    } satisfies UniswapQuote;
  });
}

function toAquaComparison(
  quote: AquaQuote,
  compared: ComparisonResult["aqua"],
  source: QuoteSource,
): AquaComparison {
  return {
    source,
    amountOut: quote.amountOut.toString(),
    minimumAmountOut: quote.minimumAmountOut.toString(),
    estimatedGasUsd: "0",
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
    estimatedGasUsd: quote.gasFeeUSD ?? "0",
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
  const uniswapViable = uniswapQuote !== null;

  if (!aquaViable && !uniswapViable) {
    throw new NoVenueAvailableError(
      aquaQuote?.reason
        ? `the Uniswap API returned no quote and the Aqua strategy is unavailable (${aquaQuote.reason})`
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
          order: { strategyHash: aquaQuote?.strategyHash ?? params.strategyHash },
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
        ? toAquaComparison(aquaQuote, comparison.aqua, deps.aquaSource.kind)
        : null,
      uniswap: uniswapQuote
        ? toUniswapComparison(uniswapQuote, comparison.uniswap)
        : null,
    },
    execution,
  };
}

export { UniswapApiError };

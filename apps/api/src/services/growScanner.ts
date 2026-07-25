import { bpsOf } from "@vortex/shared";
import {
  encodeFunctionData,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import {
  mockExternalRouterAbi,
  vortexQuoterAbi,
} from "../clients/growAbis";
import type { GrowDeployment } from "../config/growDeployment";
import {
  buildPermHookData,
  MAX_SQRT_PRICE_MINUS_ONE,
  MIN_SQRT_PRICE_PLUS_ONE,
  type PermFeeSignerConfig,
} from "../signer/growSigners";

/** Route direction encoding shared with `VortexCompoundRoute.direction`. */
export const DIRECTION_VORTEX_THEN_EXTERNAL = 0;

/**
 * Commercial fee the signer authorizes on the PermAMM leg of a Grow cycle, in
 * pips (1e-6). The hook adds its immutable safety fee on top; this is the only
 * part the backend controls.
 */
export const GROW_PERM_FEE_PIPS = 1_000;

/** How long a scanned opportunity stays actionable (MASTER D-011). */
export const GROW_OPPORTUNITY_TTL_MS = 30_000;

export interface GrowScanDeps {
  client: Pick<PublicClient, "readContract" | "simulateContract">;
  deployment: GrowDeployment;
  permSigner: PermFeeSignerConfig;
  now: () => number;
  /** Injected so scans are reproducible in tests. */
  nonce: () => bigint;
}

export interface GrowLegQuote {
  /** Asset spent on the PermAMM leg to obtain exactly `bridgeAmount`. */
  assetIn: bigint;
  bridgeAmount: bigint;
  /** Asset the external venue returns for `bridgeAmount`. */
  externalOut: bigint;
}

export interface GrowOpportunityDraft {
  opportunityId: Hex;
  direction: number;
  principalAmount: bigint;
  bridgeAmount: bigint;
  maxAssetSpent: bigint;
  minFinalAsset: bigint;
  minimumProfit: bigint;
  estimatedGrossProfit: bigint;
  performanceFee: bigint;
  nonce: bigint;
  deadline: number;
  expiresAt: number;
  permHookData: Hex;
  externalCalldata: Hex;
  quote: GrowLegQuote;
}

export type GrowScanOutcome =
  | { found: true; opportunity: GrowOpportunityDraft }
  | { found: false; reason: string };

/**
 * Slippage headroom added to the PermAMM leg's spend cap. The quote is taken
 * a block before execution, so the cap must tolerate a little drift without
 * ever letting the cycle spend unboundedly.
 */
const SPEND_CAP_BPS = 50;

/**
 * Scans for a profitable same-asset cycle.
 *
 * Direction A (`VORTEX_THEN_EXTERNAL`): spend asset on the PermAMM pool to get
 * an exact bridge amount, then sell the bridge on the external venue for more
 * asset than was spent. Every figure below is a WORST case — the PermAMM leg
 * is capped at its maximum spend and the external leg at its minimum return —
 * so an opportunity that clears here clears at any legal fill. A cycle that is
 * only profitable at mid price is not an opportunity; it is a coin flip with
 * the maker's principal.
 */
export async function scanGrowOpportunity(
  principalAmount: bigint,
  deps: GrowScanDeps,
): Promise<GrowScanOutcome> {
  const { deployment, client } = deps;
  const { strategy } = deployment;

  if (principalAmount <= 0n) {
    return { found: false, reason: "PRINCIPAL_MUST_BE_POSITIVE" };
  }
  if (principalAmount > strategy.maxAmountPerExecution) {
    return { found: false, reason: "PRINCIPAL_EXCEEDS_MAX_PER_EXECUTION" };
  }
  if (principalAmount > deployment.shippedAsset) {
    return { found: false, reason: "PRINCIPAL_EXCEEDS_SHIPPED_ASSET" };
  }

  // The asset leg sells asset for bridge, so it is zeroForOne only when the
  // asset is currency0. Getting this backwards quotes the wrong direction.
  const assetToBridgeZeroForOne = deployment.assetIsCurrency0;

  // Size the bridge leg from the external venue's rate so the cycle round-trips
  // roughly the whole principal without exceeding it.
  let bridgeAmount: bigint;
  try {
    const assetToBridgeRate = await client.readContract({
      address: deployment.externalTarget,
      abi: mockExternalRouterAbi,
      functionName: "rateE18",
      args: [strategy.asset, strategy.bridgeToken],
    });
    if (assetToBridgeRate === 0n) {
      return { found: false, reason: "EXTERNAL_VENUE_HAS_NO_RATE" };
    }
    // Bridge the value of ~90% of principal, leaving headroom for the spend cap.
    bridgeAmount = (principalAmount * 9n * assetToBridgeRate) / (10n * 10n ** 18n);
  } catch {
    return { found: false, reason: "EXTERNAL_VENUE_UNREACHABLE" };
  }

  if (bridgeAmount <= 0n) {
    return { found: false, reason: "BRIDGE_AMOUNT_ROUNDS_TO_ZERO" };
  }

  const nonce = deps.nonce();
  const opportunityId = keccak256(
    toHex(`grow-${deployment.strategyHash}-${nonce}`),
  );
  const deadlineSeconds = Math.floor(deps.now() / 1000) + 600;

  // The quoter runs the real hook, so the fee authorization must be signed
  // before quoting — the quote reflects the fee that will actually be charged.
  const { hookData: permHookData } = await buildPermHookData(deps.permSigner, {
    quoteId: opportunityId,
    swapper: deployment.compounder,
    tokenIn: strategy.asset,
    tokenOut: strategy.bridgeToken,
    zeroForOne: assetToBridgeZeroForOne,
    amountSpecified: bridgeAmount,
    commercialFeePips: GROW_PERM_FEE_PIPS,
    deadline: deadlineSeconds,
    nonce,
  });

  let assetIn: bigint;
  try {
    const { result } = await client.simulateContract({
      address: deployment.quoterAddress,
      abi: vortexQuoterAbi,
      functionName: "quoteExactOutput",
      args: [
        deployment.poolKey,
        assetToBridgeZeroForOne,
        bridgeAmount,
        assetToBridgeZeroForOne
          ? MIN_SQRT_PRICE_PLUS_ONE
          : MAX_SQRT_PRICE_MINUS_ONE,
        permHookData,
      ],
      account: deployment.compounder,
    });
    assetIn = result[0];
  } catch {
    return { found: false, reason: "PERMAMM_LEG_UNQUOTABLE" };
  }

  if (assetIn <= 0n) return { found: false, reason: "PERMAMM_LEG_QUOTED_ZERO" };

  // Worst case the cycle may spend on the first leg.
  const maxAssetSpent = assetIn + bpsOf(assetIn, SPEND_CAP_BPS);
  if (maxAssetSpent > principalAmount) {
    return { found: false, reason: "PERMAMM_LEG_EXCEEDS_PRINCIPAL" };
  }

  // Worst case the external venue returns.
  let externalOut: bigint;
  try {
    const [bridgeToAssetRate, shortfall] = await Promise.all([
      client.readContract({
        address: deployment.externalTarget,
        abi: mockExternalRouterAbi,
        functionName: "rateE18",
        args: [strategy.bridgeToken, strategy.asset],
      }),
      client.readContract({
        address: deployment.externalTarget,
        abi: mockExternalRouterAbi,
        functionName: "shortfall",
      }),
    ]);
    if (bridgeToAssetRate === 0n) {
      return { found: false, reason: "EXTERNAL_VENUE_HAS_NO_RATE" };
    }
    const gross = (bridgeAmount * bridgeToAssetRate) / 10n ** 18n;
    externalOut = gross > shortfall ? gross - shortfall : 0n;
  } catch {
    return { found: false, reason: "EXTERNAL_VENUE_UNREACHABLE" };
  }

  const unspentPrincipal = principalAmount - maxAssetSpent;
  const minFinalAsset = unspentPrincipal + externalOut;

  if (minFinalAsset <= principalAmount) {
    return { found: false, reason: "CYCLE_NOT_PROFITABLE" };
  }

  const grossProfit = minFinalAsset - principalAmount;
  const performanceFee = bpsOf(grossProfit, strategy.performanceFeeBps);
  const makerProfit = grossProfit - performanceFee;
  const requiredProfit = bpsOf(principalAmount, strategy.minProfitBps);

  if (makerProfit < requiredProfit) {
    return { found: false, reason: "PROFIT_BELOW_MAKER_MINIMUM" };
  }

  const externalCalldata = encodeFunctionData({
    abi: mockExternalRouterAbi,
    functionName: "swap",
    args: [
      strategy.bridgeToken,
      strategy.asset,
      bridgeAmount,
      deployment.compounder as Address,
    ],
  });

  return {
    found: true,
    opportunity: {
      opportunityId,
      direction: DIRECTION_VORTEX_THEN_EXTERNAL,
      principalAmount,
      bridgeAmount,
      maxAssetSpent,
      minFinalAsset,
      minimumProfit: makerProfit,
      estimatedGrossProfit: grossProfit,
      performanceFee,
      nonce,
      deadline: deadlineSeconds,
      expiresAt: deps.now() + GROW_OPPORTUNITY_TTL_MS,
      permHookData,
      externalCalldata,
      quote: { assetIn, bridgeAmount, externalOut },
    },
  };
}

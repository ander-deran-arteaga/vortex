import {
  API_ROUTES,
  zGrowExecuteRequest,
  zGrowPrepareRequest,
  zGrowScanRequest,
  type GrowPrepareResponse,
  type GrowScanResponse,
  type VortexCompoundRoute,
} from "@vortex/shared";
import type { FastifyInstance } from "fastify";
import { encodeFunctionData, keccak256, type Hex } from "viem";

import { vortexCompounderAbi } from "../clients/growAbis";
import type { AppContext } from "../context";
import { parseRequest } from "../lib/errors";
import { signCompoundRoute } from "../signer/growSigners";
import { scanGrowOpportunity } from "../services/growScanner";

const UNAVAILABLE = {
  code: "GROW_UNAVAILABLE",
  message: "Vortex Grow is not deployed on this chain",
} as const;

export function registerGrowRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.post(API_ROUTES.growScan, async (req, reply) => {
    const body = parseRequest(zGrowScanRequest, req.body);
    const grow = ctx.grow;
    if (!grow) return reply.status(503).send({ error: UNAVAILABLE });

    if (body.chainId !== ctx.env.CHAIN_ID) {
      return reply.status(400).send({
        error: {
          code: "CHAIN_MISMATCH",
          message:
            `this server scans chain ${ctx.env.CHAIN_ID}, not ${body.chainId}. ` +
            `Take the chain from GET /api/v1/config — it is authoritative — ` +
            `rather than from the wallet. To move the server instead, restart ` +
            `it with CHAIN_ID=${body.chainId}.`,
        },
      });
    }
    if (
      body.strategyHash.toLowerCase() !==
      grow.deployment.strategyHash.toLowerCase()
    ) {
      return reply.status(404).send({
        error: {
          code: "STRATEGY_NOT_FOUND",
          message:
            `no Grow strategy ${body.strategyHash} on chain ${ctx.env.CHAIN_ID}. ` +
            `If the contracts are deployed, the strategy was never shipped into ` +
            `Aqua — run ./scripts/ensure-demo.sh, which is safe to re-run.`,
        },
      });
    }

    const outcome = await scanGrowOpportunity(BigInt(body.principalAmount), {
      client: grow.client,
      deployment: grow.deployment,
      permSigner: grow.permSigner,
      now: () => Date.now(),
      nonce: grow.nextNonce,
    });

    if (!outcome.found) {
      // "No opportunity" is an expected product state, not an error.
      const response: GrowScanResponse = {
        opportunityFound: false,
        reason: outcome.reason,
      };
      return response;
    }

    const o = outcome.opportunity;
    grow.opportunities.set(o.opportunityId, o);

    const response: GrowScanResponse = {
      opportunityFound: true,
      opportunityId: o.opportunityId,
      direction: "VORTEX_THEN_EXTERNAL",
      principalAmount: o.principalAmount.toString(),
      bridgeAmount: o.bridgeAmount.toString(),
      maxAssetSpent: o.maxAssetSpent.toString(),
      minFinalAsset: o.minFinalAsset.toString(),
      minimumProfit: o.minimumProfit.toString(),
      estimatedGrossProfit: o.estimatedGrossProfit.toString(),
      performanceFee: o.performanceFee.toString(),
      expiresAt: o.expiresAt,
      // No `uniswap` key: this cycle's external leg is the deterministic
      // simulated venue, and claiming a Trade API request id would be a lie.
    };
    return response;
  });

  app.post(API_ROUTES.growPrepare, async (req, reply) => {
    const body = parseRequest(zGrowPrepareRequest, req.body);
    const grow = ctx.grow;
    if (!grow) return reply.status(503).send({ error: UNAVAILABLE });

    const opportunity = grow.opportunities.get(body.opportunityId as Hex);
    if (!opportunity) {
      return reply.status(404).send({
        error: {
          code: "OPPORTUNITY_NOT_FOUND",
          message: "unknown opportunity; scan again",
        },
      });
    }
    if (Date.now() >= opportunity.expiresAt) {
      grow.opportunities.delete(body.opportunityId as Hex);
      return reply.status(410).send({
        error: {
          code: "OPPORTUNITY_EXPIRED",
          message: "opportunity expired; scan again",
        },
      });
    }

    const { deployment } = grow;
    const route: VortexCompoundRoute = {
      strategyHash: deployment.strategyHash,
      opportunityId: opportunity.opportunityId,
      direction: opportunity.direction,
      principalAmount: opportunity.principalAmount,
      bridgeAmount: opportunity.bridgeAmount,
      maxAssetSpent: opportunity.maxAssetSpent,
      minFinalAsset: opportunity.minFinalAsset,
      externalTarget: deployment.externalTarget,
      externalValue: 0n,
      externalCalldataHash: keccak256(opportunity.externalCalldata),
      permHookDataHash: keccak256(opportunity.permHookData),
      deadline: opportunity.deadline,
      nonce: opportunity.nonce,
    };

    const routeSignature = await signCompoundRoute(grow.routeSigner, route);

    const data = encodeFunctionData({
      abi: vortexCompounderAbi,
      functionName: "executeCompound",
      args: [
        {
          strategy: deployment.strategy,
          route,
          routeSignature,
          permHookData: opportunity.permHookData,
          externalCalldata: opportunity.externalCalldata,
          poolKey: deployment.poolKey,
          assetIsCurrency0: deployment.assetIsCurrency0,
        },
      ],
    });

    // Simulate the exact transaction before offering it. A route that cannot
    // execute must never be handed out as if it could.
    let gasEstimate: bigint | null = null;
    try {
      await grow.client.simulateContract({
        address: deployment.compounder,
        abi: vortexCompounderAbi,
        functionName: "executeCompound",
        args: [
          {
            strategy: deployment.strategy,
            route,
            routeSignature,
            permHookData: opportunity.permHookData,
            externalCalldata: opportunity.externalCalldata,
            poolKey: deployment.poolKey,
            assetIsCurrency0: deployment.assetIsCurrency0,
          },
        ],
        account: grow.solverAddress ?? deployment.strategy.maker,
      });
    } catch (err) {
      return reply.status(409).send({
        error: {
          code: "GROW_SIMULATION_FAILED",
          message:
            err instanceof Error
              ? err.message.split("\n")[0]?.slice(0, 200) ?? "simulation reverted"
              : "simulation reverted",
        },
      });
    }

    grow.prepared.set(opportunity.opportunityId, { route, data });

    const response: GrowPrepareResponse = {
      opportunityId: opportunity.opportunityId,
      to: deployment.compounder,
      data,
      value: "0",
      gasEstimate: gasEstimate === null ? null : String(gasEstimate),
      routeHash: keccak256(data),
      minFinalAsset: opportunity.minFinalAsset.toString(),
      expiresAt: opportunity.expiresAt,
    };
    return response;
  });

  app.post(API_ROUTES.growExecute, async (req, reply) => {
    const body = parseRequest(zGrowExecuteRequest, req.body);
    const grow = ctx.grow;
    if (!grow) return reply.status(503).send({ error: UNAVAILABLE });

    const prepared = grow.prepared.get(body.opportunityId as Hex);
    if (!prepared) {
      return reply.status(404).send({
        error: {
          code: "OPPORTUNITY_NOT_PREPARED",
          message: "prepare the opportunity before executing it",
        },
      });
    }
    if (!grow.sendTransaction) {
      // Permissionless mode: the caller broadcasts the prepared transaction.
      return reply.status(503).send({
        error: {
          code: "SOLVER_UNAVAILABLE",
          message:
            "no solver key configured; broadcast the prepared transaction yourself",
        },
      });
    }

    let txHash: Hex;
    try {
      txHash = await grow.sendTransaction({
        to: grow.deployment.compounder,
        data: prepared.data,
      });
    } catch (err) {
      return reply.status(502).send({
        error: {
          code: "GROW_EXECUTION_FAILED",
          message:
            err instanceof Error
              ? err.message.split("\n")[0]?.slice(0, 200) ?? "execution reverted"
              : "execution reverted",
        },
      });
    }

    grow.prepared.delete(body.opportunityId as Hex);
    grow.opportunities.delete(body.opportunityId as Hex);

    ctx.executions.recordExecution({
      kind: "GROW",
      chainId: ctx.env.CHAIN_ID,
      strategyHash: grow.deployment.strategyHash,
      maker: grow.deployment.strategy.maker,
      opportunityId: body.opportunityId,
      txHash,
      grossProfit: prepared.route.minFinalAsset
        ? (prepared.route.minFinalAsset - prepared.route.principalAmount).toString()
        : null,
    });

    return { opportunityId: body.opportunityId, txHash };
  });
}

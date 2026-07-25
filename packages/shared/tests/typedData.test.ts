import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";

import {
  COMPOUND_DIRECTION,
  VORTEX_COMPOUND_ROUTE_TYPES,
  VORTEX_GROW_DOMAIN_NAME,
  VORTEX_PERM_FEE_AUTHORIZATION_TYPES,
  VORTEX_PERMAMM_DOMAIN_NAME,
  VORTEX_QUOTE_AUTHORIZATION_TYPES,
  VORTEX_SWAP_DOMAIN_NAME,
  vortexCompoundRouteDomain,
  vortexPermFeeAuthorizationDomain,
  vortexQuoteAuthorizationDomain,
} from "../src/typedData";

const CONTRACT = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const HASH = `0x${"ab".repeat(32)}` as const;

describe("domains", () => {
  it("uses the R-006 canonical domain names", () => {
    expect(VORTEX_SWAP_DOMAIN_NAME).toBe("Vortex Swap");
    expect(VORTEX_PERMAMM_DOMAIN_NAME).toBe("Vortex PermAMM");
    expect(VORTEX_GROW_DOMAIN_NAME).toBe("Vortex Grow");
    expect(vortexQuoteAuthorizationDomain(42161, CONTRACT).name).toBe("Vortex Swap");
    expect(vortexPermFeeAuthorizationDomain(42161, CONTRACT).name).toBe("Vortex PermAMM");
    expect(vortexCompoundRouteDomain(42161, CONTRACT).name).toBe("Vortex Grow");
  });
});

describe("VortexQuoteAuthorization", () => {
  it("includes replay protection and competitor binding", () => {
    const fields = VORTEX_QUOTE_AUTHORIZATION_TYPES.VortexQuoteAuthorization.map(
      (f) => f.name,
    );
    expect(fields).toContain("nonce");
    expect(fields).toContain("deadline");
    expect(fields).toContain("competitorQuoteHash");
    expect(fields).toContain("commercialRebateBps");
  });

  it("hashes deterministically", () => {
    const hash = () =>
      hashTypedData({
        domain: vortexQuoteAuthorizationDomain(42161, CONTRACT),
        types: VORTEX_QUOTE_AUTHORIZATION_TYPES,
        primaryType: "VortexQuoteAuthorization",
        message: {
          orderHash: HASH,
          quoteId: HASH,
          competitorQuoteHash: HASH,
          taker: CONTRACT,
          tokenIn: CONTRACT,
          tokenOut: USDC,
          amount: 100_000_000n,
          isExactIn: true,
          commercialRebateBps: 5,
          deadline: 1_753_000_000,
          nonce: 1n,
        },
      });
    expect(hash()).toBe(hash());
    expect(hash()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("VortexPermFeeAuthorization", () => {
  it("binds pool, swapper, direction, amount and oracle snapshot", () => {
    const fields =
      VORTEX_PERM_FEE_AUTHORIZATION_TYPES.VortexPermFeeAuthorization.map(
        (f) => f.name,
      );
    for (const required of [
      "poolId",
      "swapper",
      "zeroForOne",
      "amountSpecified",
      "oracleSnapshotHash",
      "commercialFeePips",
      "deadline",
      "nonce",
    ]) {
      expect(fields).toContain(required);
    }
  });
});

describe("VortexCompoundRoute", () => {
  const message = {
    strategyHash: HASH,
    opportunityId: HASH,
    direction: COMPOUND_DIRECTION.VORTEX_THEN_EXTERNAL,
    principalAmount: 100_000_000n,
    bridgeAmount: 100_000_000_000n,
    maxAssetSpent: 99_800_000n,
    minFinalAsset: 100_240_000n,
    externalTarget: CONTRACT,
    externalValue: 0n,
    externalCalldataHash: HASH,
    permHookDataHash: HASH,
    deadline: 1_753_000_000,
    nonce: 7n,
  } as const;

  it("binds routes to chain and verifying contract", () => {
    const onArbitrum = hashTypedData({
      domain: vortexCompoundRouteDomain(42161, CONTRACT),
      types: VORTEX_COMPOUND_ROUTE_TYPES,
      primaryType: "VortexCompoundRoute",
      message,
    });
    const onFork = hashTypedData({
      domain: vortexCompoundRouteDomain(31337, CONTRACT),
      types: VORTEX_COMPOUND_ROUTE_TYPES,
      primaryType: "VortexCompoundRoute",
      message,
    });
    expect(onArbitrum).not.toBe(onFork);
  });

  it("binds the exact external calldata and spend cap", () => {
    const fields = VORTEX_COMPOUND_ROUTE_TYPES.VortexCompoundRoute.map(
      (f) => f.name,
    );
    for (const required of [
      "externalTarget",
      "externalCalldataHash",
      "permHookDataHash",
      "maxAssetSpent",
      "minFinalAsset",
      "opportunityId",
      "direction",
      "nonce",
    ]) {
      expect(fields).toContain(required);
    }
  });
});

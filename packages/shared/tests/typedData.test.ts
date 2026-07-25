import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";

import {
  COMPOUND_ROUTE_TYPES,
  compoundRouteDomain,
  FEE_AUTHORIZATION_TYPES,
  feeAuthorizationDomain,
} from "../src/typedData";

const CONTRACT = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const HASH = `0x${"ab".repeat(32)}` as const;

describe("typed data", () => {
  it("hashes a fee authorization deterministically", () => {
    const hash = () =>
      hashTypedData({
        domain: feeAuthorizationDomain(42161, CONTRACT),
        types: FEE_AUTHORIZATION_TYPES,
        primaryType: "FeeAuthorization",
        message: {
          poolId: HASH,
          feePips: 3000,
          deadline: 1_753_000_000n,
          nonce: 1n,
        },
      });
    expect(hash()).toBe(hash());
    expect(hash()).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("binds compound routes to chain and verifying contract", () => {
    const message = {
      strategyHash: HASH,
      principalToken: CONTRACT,
      principalAmount: 100_000_000n,
      bridgeToken: USDC,
      bridgeAmount: 100_000_000_000n,
      minimumFinalAmount: 100_240_000n,
      externalTarget: CONTRACT,
      externalCalldataHash: HASH,
      externalValue: 0n,
      deadline: 1_753_000_000n,
      nonce: 7n,
    };
    const onArbitrum = hashTypedData({
      domain: compoundRouteDomain(42161, CONTRACT),
      types: COMPOUND_ROUTE_TYPES,
      primaryType: "CompoundRoute",
      message,
    });
    const onFork = hashTypedData({
      domain: compoundRouteDomain(31337, CONTRACT),
      types: COMPOUND_ROUTE_TYPES,
      primaryType: "CompoundRoute",
      message,
    });
    expect(onArbitrum).not.toBe(onFork);
  });
});

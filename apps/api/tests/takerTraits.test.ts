import { describe, expect, it } from "vitest";

import {
  buildTakerTraits,
  TAKER_TRAITS_HEADER_BYTES,
} from "../src/clients/takerTraits";

const TAKER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;

const bytes = (hex: string) => (hex.length - 2) / 2;
const header = (hex: string) => hex.slice(2, 2 + TAKER_TRAITS_HEADER_BYTES * 2);
const tail = (hex: string) => hex.slice(2 + TAKER_TRAITS_HEADER_BYTES * 2);

/**
 * Vectors below are the exact bytes the deployed swap-vm v1.0.1 router
 * accepted on 31337 (see tests/integration/aquaSwapVm.integration.test.ts).
 * The blob is packed, not ABI-encoded, so a one-byte drift silently
 * reinterprets every slice rather than failing loudly.
 */
describe("buildTakerTraits — header layout", () => {
  it("emits a bare 22-byte header when nothing is appended", () => {
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: null,
    });

    expect(bytes(traits)).toBe(22);
    // All ten slice offsets are zero; flags are exactIn | aquaPush.
    expect(traits).toBe(`0x${"00".repeat(20)}0041`);
  });

  it("sets every slice offset to 32 once a threshold is appended", () => {
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: 4_979_009_250n,
    });

    expect(bytes(traits)).toBe(22 + 32);
    // Ten uint16 slots, each 0x0020, then the flags.
    expect(header(traits)).toBe(`${"0020".repeat(10)}0041`);
    expect(BigInt(`0x${tail(traits)}`)).toBe(4_979_009_250n);
  });

  it("left-pads the threshold to a full 32 bytes", () => {
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: 1n,
    });

    expect(tail(traits)).toBe(`${"00".repeat(31)}01`);
  });

  it("accepts a zero threshold as a real bound, not as absent", () => {
    // 0n is a legitimate (if useless) floor; it must not be treated as null.
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: 0n,
    });

    expect(bytes(traits)).toBe(22 + 32);
    expect(header(traits)).toBe(`${"0020".repeat(10)}0041`);
  });
});

describe("buildTakerTraits — flags", () => {
  const flagsOf = (hex: string) => header(hex).slice(40);

  it("sets exact-in and Aqua-push by default", () => {
    expect(
      flagsOf(buildTakerTraits({ taker: TAKER, isExactIn: true, threshold: null })),
    ).toBe("0041");
  });

  it("clears the exact-in bit for exact-output", () => {
    expect(
      flagsOf(buildTakerTraits({ taker: TAKER, isExactIn: false, threshold: null })),
    ).toBe("0040");
  });

  it("clears the Aqua-push bit when the taker uses a callback", () => {
    expect(
      flagsOf(
        buildTakerTraits({
          taker: TAKER,
          isExactIn: true,
          threshold: null,
          useTransferFromAndAquaPush: false,
        }),
      ),
    ).toBe("0001");
  });

  it("packs the optional flags at their documented bit positions", () => {
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: null,
      shouldUnwrapWeth: true,
      isStrictThresholdAmount: true,
      isFirstTransferFromTaker: true,
    });

    // 0x0001 | 0x0002 | 0x0010 | 0x0020 | 0x0040
    expect(flagsOf(traits)).toBe("0073");
  });
});

describe("buildTakerTraits — optional slices", () => {
  it("omits the recipient when it is the taker", () => {
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: null,
      to: TAKER,
    });

    expect(bytes(traits)).toBe(22);
  });

  it("omits the recipient when it is the zero address", () => {
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: null,
      to: "0x0000000000000000000000000000000000000000",
    });

    expect(bytes(traits)).toBe(22);
  });

  it("appends a distinct recipient and advances offsets 1 onward", () => {
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: null,
      to: OTHER,
    });

    expect(bytes(traits)).toBe(22 + 20);
    // Slot 0 (threshold) stays 0; slots 1..9 become 20 = 0x0014.
    expect(header(traits)).toBe(`${"0014".repeat(9)}00000041`);
    expect(`0x${tail(traits)}`.toLowerCase()).toBe(OTHER.toLowerCase());
  });

  it("appends a 5-byte deadline only when non-zero", () => {
    const without = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: null,
      deadline: 0,
    });
    const with_ = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: null,
      deadline: 2_000_000_000,
    });

    expect(bytes(without)).toBe(22);
    expect(bytes(with_)).toBe(22 + 5);
    expect(tail(with_)).toBe("0077359400");
  });

  it("appends instructionsArgs and reflects them in the final offset", () => {
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: null,
      instructionsArgs: "0xdeadbeef",
    });

    expect(bytes(traits)).toBe(22 + 4);
    // Only slot 9 moves: everything before instructionsArgs is empty.
    expect(header(traits)).toBe(`0004${"0000".repeat(9)}0041`);
  });

  it("keeps the signature outside the offset table", () => {
    // The signature is whatever remains after offset 9, so it must not shift
    // any slice index.
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: null,
      signature: "0xaabbcc",
    });

    expect(bytes(traits)).toBe(22 + 3);
    expect(header(traits)).toBe(`${"0000".repeat(10)}0041`);
    expect(tail(traits)).toBe("aabbcc");
  });

  it("orders threshold, recipient and deadline as the router parses them", () => {
    const traits = buildTakerTraits({
      taker: TAKER,
      isExactIn: true,
      threshold: 255n,
      to: OTHER,
      deadline: 1,
    });

    expect(bytes(traits)).toBe(22 + 32 + 20 + 5);
    const body = tail(traits);
    expect(body.slice(0, 64)).toBe(`${"00".repeat(31)}ff`);
    expect(`0x${body.slice(64, 104)}`.toLowerCase()).toBe(OTHER.toLowerCase());
    expect(body.slice(104)).toBe("0000000001");
  });
});

describe("buildTakerTraits — guards", () => {
  it("rejects a negative threshold", () => {
    expect(() =>
      buildTakerTraits({ taker: TAKER, isExactIn: true, threshold: -1n }),
    ).toThrow(RangeError);
  });

  it("rejects a slice that would overflow its uint16 slot", () => {
    // Overflow would corrupt the neighbouring offset instead of failing.
    const huge = `0x${"ab".repeat(70_000)}` as const;
    expect(() =>
      buildTakerTraits({
        taker: TAKER,
        isExactIn: true,
        threshold: null,
        instructionsArgs: huge,
      }),
    ).toThrow(RangeError);
  });
});

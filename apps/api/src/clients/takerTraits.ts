import { concat, numberToHex, type Address, type Hex } from "viem";

/**
 * TypeScript port of swap-vm v1.0.1 `TakerTraitsLib.build`.
 *
 * The taker half of a SwapVM call is a packed blob, not an ABI struct, so it
 * has to be assembled byte-for-byte the way the router parses it:
 *
 *   [20 bytes] slicesIndexes — ten cumulative uint16 end-offsets into the tail
 *   [ 2 bytes] flags
 *   [    ...] tail: threshold ++ to? ++ deadline? ++ hooks ++ instructionsArgs
 *                   ++ signature
 *
 * `TakerTraitsLib.parse` reads exactly the first 22 bytes as the header, so a
 * one-byte drift here silently reinterprets every slice. The reference
 * encoding is `packages/contracts/script/ExecuteDemoSwap.s.sol::_traits`,
 * which blockend annotated "the exact taker encoding the API must reproduce".
 *
 * `threshold` is what binds the quoted floor onchain: for an exact-input swap
 * the router reverts with `TakerTraitsInsufficientMinOutputAmount` if the fill
 * would pay less. Omitting it means the swap is unbounded — never do that for
 * a taker-facing transaction.
 */

const IS_EXACT_IN = 0x0001;
const SHOULD_UNWRAP = 0x0002;
const HAS_PRE_TRANSFER_IN_CALLBACK = 0x0004;
const HAS_PRE_TRANSFER_OUT_CALLBACK = 0x0008;
const IS_STRICT_THRESHOLD = 0x0010;
const IS_FIRST_TRANSFER_FROM_TAKER = 0x0020;
const USE_TRANSFER_FROM_AND_AQUA_PUSH = 0x0040;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface TakerTraitsArgs {
  taker: Address;
  /** True for exact-input. Vortex Swap only exposes exact-input today. */
  isExactIn: boolean;
  /**
   * Minimum output (exact-in) or maximum input (exact-out), enforced by the
   * router. `null` leaves the swap unbounded.
   */
  threshold: bigint | null;
  /** Aqua-mode settlement: transferFrom the taker, push from the maker. */
  useTransferFromAndAquaPush?: boolean;
  /** Output recipient. Omitted from the blob when zero or equal to the taker. */
  to?: Address;
  /** Unix seconds; 0 means no deadline. */
  deadline?: number;
  shouldUnwrapWeth?: boolean;
  isStrictThresholdAmount?: boolean;
  isFirstTransferFromTaker?: boolean;
  /** Pricing taker-data — carries a signed rebate authorization when present. */
  instructionsArgs?: Hex;
  /** Only for non-Aqua orders; Aqua orders authenticate through the ship. */
  signature?: Hex;
}

const byteLength = (hex: Hex | undefined): number =>
  hex && hex !== "0x" ? (hex.length - 2) / 2 : 0;

const asBytes = (hex: Hex | undefined): Hex =>
  hex && hex !== "0x" ? hex : "0x";

export function buildTakerTraits(args: TakerTraitsArgs): Hex {
  if (args.threshold !== null && args.threshold < 0n) {
    throw new RangeError("taker traits threshold must not be negative");
  }

  const thresholdBytes: Hex =
    args.threshold === null
      ? "0x"
      : numberToHex(args.threshold, { size: 32 });

  const includeTo =
    args.to !== undefined &&
    args.to !== ZERO_ADDRESS &&
    args.to.toLowerCase() !== args.taker.toLowerCase();
  const deadline = args.deadline ?? 0;
  const includeDeadline = deadline !== 0;

  const instructionsArgs = asBytes(args.instructionsArgs);
  const signature = asBytes(args.signature);

  // Cumulative end-offsets, in the library's order. Hook and callback slices
  // are always empty here, so each simply carries the previous offset forward.
  const index0 = byteLength(thresholdBytes);
  const index1 = index0 + (includeTo ? 20 : 0);
  const index2 = index1 + (includeDeadline ? 5 : 0);
  const index3 = index2; // preTransferInHookData
  const index4 = index3; // postTransferInHookData
  const index5 = index4; // preTransferOutHookData
  const index6 = index5; // postTransferOutHookData
  const index7 = index6; // preTransferInCallbackData
  const index8 = index7; // preTransferOutCallbackData
  const index9 = index8 + byteLength(instructionsArgs);

  const indexes = [
    index0,
    index1,
    index2,
    index3,
    index4,
    index5,
    index6,
    index7,
    index8,
    index9,
  ];
  for (const index of indexes) {
    // Each slot is a uint16 in the packed word; overflowing one would corrupt
    // its neighbour rather than fail loudly onchain.
    if (index > 0xffff) {
      throw new RangeError("taker traits slice offset exceeds uint16");
    }
  }

  let slicesIndexes = 0n;
  indexes.forEach((index, slot) => {
    slicesIndexes |= BigInt(index) << BigInt(16 * slot);
  });

  const flags =
    (args.isExactIn ? IS_EXACT_IN : 0) |
    (args.shouldUnwrapWeth ? SHOULD_UNWRAP : 0) |
    (args.isStrictThresholdAmount ? IS_STRICT_THRESHOLD : 0) |
    (args.isFirstTransferFromTaker ? IS_FIRST_TRANSFER_FROM_TAKER : 0) |
    (args.useTransferFromAndAquaPush ?? true ? USE_TRANSFER_FROM_AND_AQUA_PUSH : 0);
  // Callbacks are unsupported here; their flags stay clear by construction.
  void HAS_PRE_TRANSFER_IN_CALLBACK;
  void HAS_PRE_TRANSFER_OUT_CALLBACK;

  return concat([
    numberToHex(slicesIndexes, { size: 20 }),
    numberToHex(flags, { size: 2 }),
    thresholdBytes,
    includeTo ? (args.to as Hex) : "0x",
    includeDeadline ? numberToHex(deadline, { size: 5 }) : "0x",
    instructionsArgs,
    signature,
  ]);
}

/** Header length `TakerTraitsLib.parse` consumes before the tail. */
export const TAKER_TRAITS_HEADER_BYTES = 22;

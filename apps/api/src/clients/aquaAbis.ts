/**
 * Hand-written, minimal ABIs — only the members Vortex actually calls.
 * Shapes come from packages/contracts (swap-vm pinned v1.0.1 five-arg form)
 * and coordination/interfaces/contracts.md.
 */

/** `struct ISwapVM.Order { address maker; MakerTraits traits; bytes data; }` */
const orderParam = {
  name: "order",
  type: "tuple",
  components: [
    { name: "maker", type: "address" },
    // MakerTraits is a uint256 user-defined value type.
    { name: "traits", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
} as const;

/**
 * Custom errors the pricing/lens contracts revert with. Attached to every ABI
 * below so viem can decode a revert into a named reason instead of raw bytes.
 */
export const vortexErrorsAbi = [
  {
    type: "error",
    name: "VortexMaxTradeExceeded",
    inputs: [
      { name: "tradeFractionBps", type: "uint256" },
      { name: "maxTradeBps", type: "uint16" },
    ],
  },
  {
    type: "error",
    name: "VortexStaleOracle",
    inputs: [
      { name: "updatedAt", type: "uint40" },
      { name: "maxOracleAge", type: "uint32" },
    ],
  },
  {
    type: "error",
    name: "VortexOracleSpreadTooWide",
    inputs: [
      { name: "spreadBps", type: "uint256" },
      { name: "maxOracleSpreadBps", type: "uint16" },
    ],
  },
  {
    type: "error",
    name: "VortexInvalidOraclePrice",
    inputs: [
      { name: "bidE18", type: "uint256" },
      { name: "midE18", type: "uint256" },
      { name: "askE18", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "VortexInventoryBoundBreached",
    inputs: [
      { name: "baseWeightBps", type: "uint256" },
      { name: "minBaseWeightBps", type: "uint16" },
      { name: "maxBaseWeightBps", type: "uint16" },
    ],
  },
  {
    type: "error",
    name: "VortexInsufficientStrategyBalance",
    inputs: [
      { name: "amountOut", type: "uint256" },
      { name: "balanceOut", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "VortexMakerNotCovered",
    inputs: [
      { name: "token", type: "address" },
      { name: "required", type: "uint256" },
      { name: "executable", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "VortexUnsupportedTokenPair",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
    ],
  },
  { type: "error", name: "VortexZeroAmountOut", inputs: [] },
  {
    type: "error",
    name: "VortexRebateExpired",
    inputs: [{ name: "deadline", type: "uint40" }],
  },
  { type: "error", name: "VortexRebateMismatch", inputs: [] },
  {
    type: "error",
    name: "VortexBadRebateSignature",
    inputs: [
      { name: "recovered", type: "address" },
      { name: "expected", type: "address" },
    ],
  },
  {
    type: "error",
    name: "VortexRebateNonceUsed",
    inputs: [
      { name: "taker", type: "address" },
      { name: "nonce", type: "uint64" },
    ],
  },
  { type: "error", name: "VortexRecomputeDetected", inputs: [] },
  {
    type: "error",
    name: "VortexUnauthorizedCaller",
    inputs: [{ name: "caller", type: "address" }],
  },
  { type: "error", name: "VortexPricingInstructionNotFound", inputs: [] },
  { type: "error", name: "EmptyPortfolio", inputs: [] },
  {
    type: "error",
    name: "FeeExceedsBps",
    inputs: [{ name: "feeBps", type: "uint256" }],
  },
  {
    type: "error",
    name: "BadConfigLength",
    inputs: [{ name: "actual", type: "uint256" }],
  },
  {
    type: "error",
    name: "DecimalsAboveInternalScale",
    inputs: [{ name: "decimals", type: "uint8" }],
  },
] as const;

/** Every custom-error name we can put in an AquaQuote.reason. */
export const VORTEX_ERROR_NAMES: readonly string[] = vortexErrorsAbi.map(
  (entry) => entry.name,
);

export const aquaSwapVmRouterAbi = [
  {
    type: "function",
    name: "quote",
    // The compiled artifact marks this nonpayable (SwapVM's base is not view),
    // but it is a pure read: we only ever eth_call it, never send it.
    stateMutability: "view",
    inputs: [
      orderParam,
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "takerTraitsAndData", type: "bytes" },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
      { name: "orderHash", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      orderParam,
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "takerTraitsAndData", type: "bytes" },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
      { name: "orderHash", type: "bytes32" },
    ],
  },
  ...vortexErrorsAbi,
] as const;

const tokenHealthComponents = [
  { name: "token", type: "address" },
  { name: "virtualBalance", type: "uint256" },
  { name: "actualBalance", type: "uint256" },
  { name: "aquaAllowance", type: "uint256" },
  { name: "executableBalance", type: "uint256" },
] as const;

export const vortexAquaLensAbi = [
  {
    type: "function",
    name: "quoteBreakdown",
    stateMutability: "view",
    inputs: [
      orderParam,
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "isExactIn", type: "bool" },
      { name: "amount", type: "uint256" },
      { name: "rebateBps", type: "uint16" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "safetyFeeBps", type: "uint16" },
          { name: "commercialFeeBps", type: "uint16" },
          // Signed: a negative adjustment discounts the taker to pull the
          // strategy back toward its target inventory weight.
          { name: "inventoryAdjustmentBps", type: "int256" },
          { name: "finalFeeBps", type: "uint16" },
          { name: "oracleMidE18", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOut", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "strategyHealth",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "baseToken", type: "address" },
      { name: "quoteToken", type: "address" },
      { name: "referenceOracle", type: "address" },
    ],
    outputs: [
      {
        name: "health",
        type: "tuple",
        components: [
          { name: "base", type: "tuple", components: tokenHealthComponents },
          { name: "quote", type: "tuple", components: tokenHealthComponents },
          { name: "baseWeightBps", type: "uint256" },
          { name: "coverageBps", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "solvent", type: "bool" },
        ],
      },
    ],
  },
  ...vortexErrorsAbi,
] as const;

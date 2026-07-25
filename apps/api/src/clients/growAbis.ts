/**
 * Minimal ABIs for the Grow cycle. Hand-written rather than imported from the
 * artifacts so the shapes the backend depends on are explicit and reviewable.
 */

const poolKeyParam = {
  name: "key",
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

export const vortexQuoterAbi = [
  {
    type: "function",
    name: "quoteExactOutput",
    // Not view: the quoter unlocks the PoolManager and reverts to unwind, so
    // it must be simulated rather than read.
    stateMutability: "nonpayable",
    inputs: [
      poolKeyParam,
      { name: "zeroForOne", type: "bool" },
      { name: "amountOut", type: "uint128" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [
      { name: "quotedIn", type: "uint256" },
      { name: "quotedOut", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      poolKeyParam,
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint128" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [
      { name: "quotedIn", type: "uint256" },
      { name: "quotedOut", type: "uint256" },
    ],
  },
] as const;

export const mockExternalRouterAbi = [
  {
    type: "function",
    name: "rateE18",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "shortfall",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const growStrategyComponents = [
  { name: "maker", type: "address" },
  { name: "asset", type: "address" },
  { name: "bridgeToken", type: "address" },
  { name: "externalTarget", type: "address" },
  { name: "routeSigner", type: "address" },
  { name: "feeRecipient", type: "address" },
  { name: "maxAmountPerExecution", type: "uint128" },
  { name: "minProfitBps", type: "uint16" },
  { name: "performanceFeeBps", type: "uint16" },
  { name: "strategyDeadline", type: "uint40" },
  { name: "salt", type: "uint64" },
] as const;

/** Field order mirrors `VortexCompoundRoute` in shared typedData.ts exactly. */
const compoundRouteComponents = [
  { name: "strategyHash", type: "bytes32" },
  { name: "opportunityId", type: "bytes32" },
  { name: "direction", type: "uint8" },
  { name: "principalAmount", type: "uint128" },
  { name: "bridgeAmount", type: "uint128" },
  { name: "maxAssetSpent", type: "uint128" },
  { name: "minFinalAsset", type: "uint128" },
  { name: "externalTarget", type: "address" },
  { name: "externalValue", type: "uint256" },
  { name: "externalCalldataHash", type: "bytes32" },
  { name: "permHookDataHash", type: "bytes32" },
  { name: "deadline", type: "uint40" },
  { name: "nonce", type: "uint64" },
] as const;

export const vortexCompounderAbi = [
  {
    type: "function",
    name: "executeCompound",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "strategy", type: "tuple", components: growStrategyComponents },
          { name: "route", type: "tuple", components: compoundRouteComponents },
          { name: "routeSignature", type: "bytes" },
          { name: "permHookData", type: "bytes" },
          { name: "externalCalldata", type: "bytes" },
          { ...poolKeyParam, name: "poolKey" },
          { name: "assetIsCurrency0", type: "bool" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "usedRouteNonces",
    stateMutability: "view",
    inputs: [
      { name: "strategyHash", type: "bytes32" },
      { name: "nonce", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "VortexGrowExecuted",
    inputs: [
      { name: "strategyHash", type: "bytes32", indexed: true },
      { name: "opportunityId", type: "bytes32", indexed: true },
      { name: "maker", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: false },
      { name: "principal", type: "uint256", indexed: false },
      { name: "makerReturn", type: "uint256", indexed: false },
      { name: "grossProfit", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
] as const;

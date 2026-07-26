# Vortex economic model

How Vortex decides where a trade executes, and who is paid what. Owner:
backend. Companion to `docs/uniswap-api.md` (venue mechanics) and
`docs/security.md` (the onchain envelope the backend cannot widen).

## 1. Best execution — what "better" means

A taker asks to swap an exact input amount. Two venues can fill it: the
maker's Aqua strategy (priced by SwapVM through `VortexAquaPricing`) and the
external AMM route the Uniswap Trade API returns.

Vortex ranks them on **net output** — what the taker is *guaranteed* to keep
after gas — never on the headline quote:

```
netAmountOut = minimumAmountOut − gasCostInOutputToken
```

Two deliberate choices are embedded here:

- **`minimumAmountOut`, not `amountOut`.** The headline figure is a
  best-case number neither venue promises. Ranking on the guaranteed floor
  means the chosen venue is the one that is better even when both fills land
  at their worst permitted price.
- **Gas is charged to the venue that spends it.** An Aqua settlement burns
  roughly 260k gas against a Universal Router swap's ~100k. Ignoring that
  would hand Aqua a systematic and fictitious advantage on small trades.

### Pricing gas in the output token

Gas is paid in ETH but the comparison happens in the output token, so the two
must be commensurable. The Uniswap quote already carries `gasFeeQuote` — its
own gas cost denominated in the output token's base units — which yields a
per-gas-unit rate:

```
rate            = gasFeeQuote / gasUseEstimate      [output-token units per gas unit]
aquaGasInOutput = ceil(aquaGasUnits × rate)
```

This is why the backend needs no ETH price feed on the hot path: the external
venue states the exchange rate as a side effect of quoting. The multiplication
is done before the division and rounds **up**, so gas is never understated for
the venue being charged.

When no Uniswap quote exists there is no rate, and both venues are charged
zero gas. That overstates Aqua's net slightly — documented and pinned by test,
because the alternative (a price feed) buys nothing when Aqua is the only
venue that can fill anyway.

### The tie-break rule

```
requiredMargin = uniswapNet × minimumImprovementBps / 10_000     (default 1 bps)
aqua wins      = requiredMargin > 0
                   ? aquaNet ≥ uniswapNet + requiredMargin
                   : aquaNet > uniswapNet
```

**Uniswap wins ties.** A maker that merely matches the deep venue does not
earn the routing; it has to genuinely beat it. The zero-margin branch exists
because `requiredMargin` floors to 0 on small trades, which would otherwise
silently turn the threshold into a tie-break in Aqua's favour.

**A non-executable quote is not a venue.** If the strategy is inactive,
insolvent, under-covered, past an inventory bound, or its oracle is stale, the
quote is discarded regardless of how good its price looks. If neither venue is
viable the API returns `503 NO_VENUE_AVAILABLE` rather than routing a taker
somewhere that cannot settle.

## 2. Where the maker's money comes from

The Aqua quote decomposes into basis points, all reported to the UI so a taker
can see exactly what they are paying:

| Component | Who sets it | Can the backend move it? |
| --- | --- | --- |
| `safetyFeeBps` | immutable, onchain | **No** |
| `commercialFeeBps` | maker configuration | No — signed rebates can only *reduce* the taker's cost |
| `inventoryAdjustmentBps` | computed from inventory skew; signed | No |

The inventory adjustment is the economically interesting one: it is negative
when a trade moves the strategy *toward* its target weight. The maker pays a
premium for flow that rebalances it, and charges more for flow that worsens
its skew. Trades that would push inventory past a hard bound do not get a
worse price — they revert.

The safety fee floor is immutable and outside the signer's reach by
construction. A fully compromised backend signer can only give away
commercial margin, never breach the maker's safety envelope. That property is
enforced onchain, not here.

### Competitive rebate — CUT for the MVP

The onchain machinery for a per-fill commercial rebate is built, deployed and
tested: `VortexAquaPricing` verifies a signed `VortexQuoteAuthorization`,
`instructionsArgs` carries it, nonces are per-taker and consumed on swap only,
and `test_rebateCannotRemoveSafetyFee` proves that no rebate — however extreme
— can pierce the safety floor.

**The backend does not derive one.** `rebateBps` is a static configuration
value defaulting to `0`, and nothing reads the competitor's quote to compute
it; `competitorQuoteHash` is signed as a field but is never bound to a real
competitor quote in the live path.

This is a deliberate MVP cut, not an oversight:

- It is a **pricing optimisation, not a capability**. Best execution already
  works: both venues are quoted, ranked on net output, and the router genuinely
  routes away from the maker when the maker is worse.
- The **security property it protects is already evidenced** onchain, so
  nothing about the safety story depends on the backend half existing.
- Deriving it means re-quoting through the lens with a computed rebate, signing
  per-taker with nonce management, and threading it through the taker-traits
  blob — changes to the one path that currently settles end to end.

**What may be claimed:** inventory-aware pricing, an immutable safety fee floor
no signer can pierce, and a rebate mechanism that exists and is enforced
onchain. **What may not:** that Vortex sharpens its quote against an observed
competitor quote. It does not, today.

## 3. Vortex Grow — compounding economics (Phase 6/7)

A maker ships WBTC and states "only execute if I end with more WBTC". A cycle
is WBTC → USDC → WBTC across the Vortex PermAMM and an external venue.

```
unspentPrincipal   = principalAmount − maxAssetSpent
grossMinimumFinal  = unspentPrincipal + minimumExternalOut
grossMinimumProfit = grossMinimumFinal − principalAmount
```

The scan is built entirely on **minimums**: the worst legal outcome of both
legs must still clear the maker's minimum profit, plus the performance fee,
plus a gas buffer. A cycle that is profitable only at mid price is not an
opportunity — it is a coin flip with the maker's principal.

Settlement rules, enforced onchain and not negotiable by the backend:

- final asset balance ≥ principal + minimum maker profit, or the whole
  transaction reverts;
- the performance fee is taken **from realized profit only** — a failed or
  break-even cycle costs the maker nothing but leaves the solver out of gas;
- MVP split is 80% maker / 20% solver + protocol, from profit only.

"No opportunity" is a first-class, expected result, not an error. Most scans
should return it.

## 4. Units

WBTC has 8 decimals, USDC has 6, reference prices are scaled 1e18, and fees
are basis points. Nothing in Vortex is 18 decimals by default. Every amount
crossing the API is a decimal string in base units; every internal
computation is `bigint`. Rounding is always conservative in the taker's and
the maker's favour: down what Vortex pays out, up what Vortex charges.

`expiresAt` values in the API are **epoch milliseconds** (master D-010).
Solidity deadlines are epoch seconds (`uint40`); the conversion happens once,
at the signing boundary, and milliseconds never enter a signed struct.

# Vortex architecture

Vortex ships two products over one maker inventory, plus a separate liquidity
venue. The products are independent of each other, and — importantly — the
Vortex Swap Aqua path is independent of the Vortex PermAMM venue.

## The two products

```
Vortex Swap  (best execution)
├── AQUA_SWAPVM   direct Aqua + SwapVM quote and settlement
└── UNISWAP_API   external quote and API-built transaction

Vortex Grow  (same-asset compounding)
├── Aqua pull/push for maker capital
├── Vortex PermAMM as one possible leg
└── external venue or Uniswap API as the other leg
```

Vortex PermAMM is a **separate Uniswap v4 liquidity venue**. It may be used on
its own, compared as an additional venue later, or used as one leg of Vortex
Grow. It is **not** part of the Aqua SwapVM settlement path.

## Vortex Swap — Aqua execution path

```
taker → Aqua router (AquaSwapVMRouter, official 1inch)
      → SwapVM  (VortexAquaPricing as the extension)
      → Aqua settlement (pull/push against maker inventory)
      → maker
```

Never `taker → Aqua → Vortex PermAMM → maker`. This is the architectural
invariant in `docs/decisions.md` D-015, enforced in CI by
`scripts/check-architecture.sh`, which fails the build if anything in the Aqua
module or the backend's Vortex Swap path references the PermAMM module.

A Vortex Swap succeeds with **no PermAMM contracts deployed at all**. Turning
PermAMM off, or never deploying it, does not affect Vortex Swap.

## Vortex Grow — where PermAMM legitimately appears

```
maker WBTC (Aqua virtual balance)
  → VortexCompounder pulls principal via Aqua
  → leg 1  Vortex PermAMM   WBTC → USDC          (or the external venue)
  → leg 2  external venue   USDC → WBTC          (or Vortex PermAMM)
  → require final WBTC ≥ principal + minimum profit
  → performance fee from realized profit only
  → Aqua pushes principal + maker profit back
```

Either ordering is expressible (`VORTEX_THEN_EXTERNAL` /
`EXTERNAL_THEN_VORTEX`). The whole cycle is one atomic transaction: if the
profit floor is not met, everything reverts and the maker's actual and virtual
balances are untouched.

## Component map

```
apps/web            Next.js — presents Aqua + SwapVM and Uniswap as the two
                    Vortex Swap options; presents Vortex PermAMM separately,
                    in the architecture view and the Grow flow
apps/api            Fastify — Aqua quote source (SwapVM direct), Uniswap Trade
                    API client, venue comparator, signers, Grow scanner.
                    PermAMM clients live apart and are reachable only from Grow
packages/contracts
  src/aqua/         VortexAquaPricing, VortexAquaOrderBuilder, VortexAquaLens
                    — settlement through official Aqua + SwapVM. PermAMM-free
  src/permamm/      VortexHook, VortexRouter, VortexQuoter,
                    VortexLiquidityManager, VortexFeeAuthorization
  src/compound/     VortexCompounder, route validation — may use both
packages/shared     Zod schemas, EIP-712 typed data, units, chain metadata
```

## Trust and signing model

Three offchain signers, none of which can bypass onchain policy:

- **Rebate signer** (Vortex Swap): grants a bounded commercial rebate against
  an observed competitor quote. Cannot touch the immutable safety fee.
- **Fee signer** (Vortex PermAMM): sets the per-swap commercial fee inside
  hook-enforced bounds; the minimum safety fee is immutable and the hook
  validates oracle freshness and price deviation regardless.
- **Route signer** (Vortex Grow): authorizes one exact external call (target
  allowlisted, calldata hash bound). The compounder still enforces principal
  cap, minimum final asset, recipient, deadline, nonce, and the final balance
  check onchain.

## Data flow rules

- The Uniswap API key exists only in `apps/api` env. The browser never calls
  the authenticated API.
- The backend stores authoritative quotes; the browser holds only a
  `quoteSessionId` and broadcasts prebuilt transactions unchanged.
- All request/response shapes come from `@vortex/shared` Zod schemas; the
  typed-data definitions there are canonical for both TypeScript signers and
  Solidity verifiers.
- Every venue quote carries `source` (`live` or `fixture`), required with no
  default, so simulated data can never render as live.
- Executable maker liquidity is always computed as
  min(Aqua virtual balance, actual ERC-20 balance, Aqua allowance), and exact
  transaction simulation runs immediately before submission.

# Vortex architecture

```
                           ┌────────────────────┐
                           │ Vortex frontend    │
                           │ (apps/web)         │
                           └─────────┬──────────┘
                                     │
                           ┌─────────▼──────────┐
                           │ Vortex backend     │
                           │ (apps/api)         │
                           │                    │
                           │ Quote comparator   │
                           │ Uniswap API client │
                           │ Rebate signer      │
                           │ JIT scanner        │
                           │ Route signer       │
                           │ Simulator          │
                           └──────┬───────┬─────┘
                                  │       │
                     Aqua route   │       │ Uniswap route
                                  │       │
          ┌───────────────────────▼─┐   ┌─▼─────────────────────┐
          │ Official Aqua           │   │ Uniswap API-built     │
          │                         │   │ transaction           │
          │ Vortex SwapVM strategy  │   └──────────┬────────────┘
          │ Vortex Grow strategy    │              │
          └──────────────┬──────────┘              │
                         │                         │
                         ▼                         ▼
               ┌─────────────────┐       ┌──────────────────────┐
               │ Vortex          │       │ Uniswap liquidity    │
               │ Compounder      │       │ and routers          │
               └────────┬────────┘       └──────────────────────┘
                        │
                        ▼
               ┌─────────────────┐
               │ Vortex PermAMM  │
               │ Uniswap v4 hook │
               └─────────────────┘
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
  cap, minimum final asset, recipient, deadline, nonce, and the final
  balance check onchain.

## Data flow rules

- The Uniswap API key exists only in `apps/api` env. The browser never calls
  the authenticated API.
- The backend stores authoritative quotes; the browser holds only a
  `quoteSessionId` and broadcasts prebuilt transactions unchanged.
- All request/response shapes come from `@vortex/shared` Zod schemas; the
  typed-data definitions there are canonical for both TypeScript signers and
  Solidity verifiers.
- Executable maker liquidity is always computed as
  min(Aqua virtual balance, actual ERC-20 balance, Aqua allowance), and
  exact transaction simulation runs immediately before submission.

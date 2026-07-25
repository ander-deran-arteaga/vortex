# Vortex decision log

Decisions that affect more than one workstream. Newest last. Each decision is
applied consistently and not repeatedly revisited.

## D-001 — Trunk-based development on `main`

All workstreams share one working tree, so agent branches are impractical.
Everyone commits path-scoped slices to `main` (`git add <owned-paths>`, never
`git add -A`). History is never squashed. Only the integration owner pushes.

## D-002 — `@vortex/shared` ships TypeScript source

No build step: `exports` points at `./src/index.ts`. Next.js consumes it via
`transpilePackages`; the API runs through tsx; `build` is a typecheck
(`tsc --noEmit`). Zod v3 for runtime schemas; viem for address/hex types.

## D-003 — Persistence is an append-only JSON event store

`apps/api/data/` (gitignored). Zero native dependencies, deterministic in CI.
No SQLite, no external database.

## D-004 — API surface is versioned under `/api/v1`

Exact endpoint set: health, config, strategies/:strategyHash, executions,
quotes/exchange, transactions/aqua, transactions/uniswap, grow/scan,
grow/prepare, grow/execute, resolver/quote, resolver/build, demo/seed.
Path constants live in `@vortex/shared` (`API_ROUTES`); nothing hardcodes
paths.

## D-005 — EIP-712 domains

| Authorization | Domain name | Version | Verifying contract |
| --- | --- | --- | --- |
| VortexQuoteAuthorization (Swap rebate) | `Vortex Swap` | 1 | Aqua strategy verifier |
| VortexPermFeeAuthorization (per-swap fee) | `Vortex PermAMM` | 1 | VortexHook |
| VortexCompoundRoute (Grow route) | `Vortex Grow` | 1 | VortexCompounder |

Canonical struct definitions live in `packages/shared/src/typedData.ts`;
Solidity matches it field-for-field. The Swap rebate signer can only grant a
bounded commercial rebate — the safety fee floor is immutable onchain.

## D-006 — Target environment

Arbitrum One (42161), WBTC/USDC (8/6 decimals), internal price scale 1e18,
local Arbitrum fork as chain 31337 for development. At most one chain change,
recorded here if it ever happens.

## D-007 — Contract dependencies come through pnpm, pinned

aqua v1.0.0 (81c26e4), swap-vm v1.0.1 (b6e4f97), forge-std v1.11.0,
@openzeppelin/contracts 5.4.0, @1inch/solidity-utils 6.9.10,
@uniswap/v4-core 1.0.2, @uniswap/v4-periphery 1.0.3. No git submodules —
mirrors how the upstream 1inch repositories consume their own dependencies.
Details in `docs/dependencies.md`.

## D-008 — Official Aqua is deployed from source on the 42161 fork

No canonical Aqua deployment address for Arbitrum One ships in the pinned
1inch repositories, so the official bytecode is deployed on the local fork.
If a canonical address is later verified on an explorer, `deployments/42161.json`
switches to it.

## D-009 — Canonical event names

`VortexPermSwap` (hook afterSwap) and `VortexGrowExecuted` (compounder
settlement), with the field lists from the master plan. The indexer binds to
these exact names.

## D-010 — Timestamps cross the API as epoch milliseconds

Every `expiresAt` / `timestamp` field in the shared schemas is epoch
milliseconds, matching `Date.now()` so neither side multiplies or divides.
Solidity deadlines remain epoch **seconds** (uint40) — the backend converts at
the signing boundary, and that conversion is the only place the two units
meet.

## D-011 — Quote sessions live 45 seconds and are single-use

A quote session expires 45 s after issue and is consumed on first successful
transaction build. Uniswap's guidance is to refresh quotes older than ~30 s,
so the backend re-requests construction data past 30 s rather than serving a
stale route. The browser holds only the session id; it never mutates
target/data/value.

## D-012 — Fork deployment artifacts are not committed

`deployments/<chainId>.json` holds reviewed, committed addresses. Ephemeral
fork runs write `deployments/<chainId>.fork.json`, which is gitignored, so a
local anvil session can never clobber the committed record. Dry runs write
nothing.

## D-013 — Uniswap Trade API facts are recorded with provenance

`docs/uniswap-api.md` tags every claim `[VERIFIED <url>]` or `[UNVERIFIED]`,
and keeps contradictions between research passes rather than silently picking
one. Nothing in the client is built on an `[UNVERIFIED]` claim without first
confirming it against the live API. Remembered API behavior is never trusted.

## D-015 — Vortex Swap's Aqua execution must not depend on Vortex PermAMM

**Invariant.** Vortex Swap settles through official Aqua and SwapVM only:

```
taker → Aqua router (AquaSwapVMRouter) → SwapVM → Aqua settlement → maker
```

It must never settle `taker → Aqua → Vortex PermAMM → maker`. Vortex PermAMM
is a separate Uniswap v4 liquidity venue. It may be used on its own, compared
as an additional venue later, or used as one leg of Vortex Grow — but it is
not part of the Aqua SwapVM settlement path.

Consequences, all enforced rather than merely documented:

- Aqua pricing and settlement live in `packages/contracts/src/aqua/`; the
  Uniswap v4 hook, router, quoter, and liquidity manager live in
  `packages/contracts/src/permamm/`. Nothing in `aqua/` may reference
  anything in `permamm/`.
- Vortex Swap has exactly two execution kinds: `AQUA_SWAPVM` (direct Aqua and
  SwapVM quote plus settlement) and `UNISWAP_API` (external quote plus an
  API-built transaction). A third kind is a deliberate schema change.
- The backend's Aqua quote path calls SwapVM directly and builds direct
  Aqua/SwapVM calldata. PermAMM clients stay in their own module and are
  reachable only from Grow opportunity scanning, or from a future explicit
  `VORTEX_PERMAMM` venue.
- A Vortex Swap must succeed with no PermAMM contracts deployed at all, and
  disabling PermAMM must not affect Vortex Swap.

`scripts/check-architecture.sh` enforces the import and call-graph rules in
CI. The rule matters most from Phase 5 onward: PermAMM did not exist when this
was written, so the invariant is a guard against future coupling rather than a
description of a past fix.

## D-016 — Vortex Swap uses the official Aqua SwapVM router directly

The taker-facing router is `AquaSwapVMRouter` from the pinned
`@1inch/swap-vm`, not a Vortex-authored router. `VortexAquaPricing` plugs into
it as the SwapVM extension, so quoting and settlement run through official
sponsor code rather than a wrapper. The `VortexAquaRouter` contract sketched in
the original plan is therefore not built; `VortexAquaOrderBuilder` and
`VortexAquaLens` provide the order construction and health views around the
official router.

## D-017 — Uniswap v4 PoolManager enters the build as its own compilation unit

v4-core's `PoolManager` is `pragma solidity 0.8.26` exact, while every Vortex
contract is 0.8.30 (Aqua and SwapVM require it). Solidity resolves one compiler
version per compilation unit — a file plus its transitive imports — so no
0.8.30 file can import `PoolManager`.

`packages/contracts/src/v4/V4Deps.sol` exists solely to pull v4-core into the
build as a separate 0.8.26 unit, producing the artifact. Tests then instantiate
the genuine contract by artifact rather than by type:

```solidity
poolManager = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(owner)));
```

Vortex contracts import only `^0.8.0` v4 interfaces and libraries
(`IPoolManager`, `IHooks`, `Hooks`, `Currency`, `BalanceDelta`,
`BeforeSwapDelta`, `IUnlockCallback`), never the concrete pool.

Chosen over a mainnet fork or `vm.etch` because it keeps contract CI
deterministic with no RPC endpoint and no API key, while still exercising the
real PoolManager bytecode rather than a mock.

## D-014 — CI workflows declare least privilege and cancel superseded runs

Every workflow sets `permissions: {contents: read}` and a
`concurrency` group keyed on the ref with `cancel-in-progress`. Action
version pinning by commit SHA is deliberately deferred: it has no sponsor
qualification value and the kill rules say defer such polish.

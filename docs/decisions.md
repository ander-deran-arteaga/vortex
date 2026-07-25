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

## D-014 — CI workflows declare least privilege and cancel superseded runs

Every workflow sets `permissions: {contents: read}` and a
`concurrency` group keyed on the ref with `cancel-in-progress`. Action
version pinning by commit SHA is deliberately deferred: it has no sponsor
qualification value and the kill rules say defer such polish.

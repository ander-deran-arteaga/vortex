# AGENTS.md

## Naming (frozen)

The project, product, and repository name is **Vortex**.

Component names:

- **Vortex Swap** — best-execution service (official Aqua + SwapVM).
- **Vortex Grow** — same-asset compounding service (custom Aqua app).
- **Vortex PermAMM** — the Uniswap v4 dynamic-fee pool component
  (`VortexHook`, `VortexLiquidityManager`, `VortexRouter`, `VortexQuoter`,
  `VortexFeeAuthorization`).
- **Vortex Compounder** — the Grow settlement contract (`VortexCompounder`).

"PermAMM" appears only as a component description and only prefixed with
Vortex. Every legacy project name that predates Vortex is forbidden
everywhere; the integration workflow greps for them and fails the build on
any hit. "Aqua" and "SwapVM" refer only to the official 1inch protocol
components.

## Team

Three implementation agents plus a supervising master:

- **blockend** — `packages/contracts` (Foundry), deployment addresses,
  `scripts/bootstrap-fork.sh`, `scripts/export-contracts.ts`,
  `docs/dependencies.md`, `docs/security.md`.
- **backend** — `apps/api` (Fastify), Uniswap Trade API client, venue
  comparison, signers, Grow scanner, indexer, `docs/uniswap-api.md`,
  `docs/economic-model.md`.
- **frontend** — `apps/web` (Next.js App Router).
- **master** — architecture, phase gating, cross-agent arbitration,
  `packages/shared`, `deployments` schema, root docs, CI, integration,
  security review, final demo.

Agents communicate exclusively through the gitignored `coordination/`
directory. Each agent appends to its own channel file
(`coordination/<agent>.md`); interface contracts are pinned under
`coordination/interfaces/`; the master writes gates, rulings, and directives
to `coordination/MASTER.md`. Disagreements are argued in channel files; the
master has the last say.

## Commit policy

- Exactly one subject line, no body, no trailers.
- Subject matches `^(feat|fix|del): .+`.
- No Co-authored-by, no tool or model attribution, ever.
- Commit each working slice before starting the next substantial slice.
- Never squash history. Only the master pushes to origin.
- Enforced by `scripts/check-commit-policy.sh` (run locally and in CI).

## Build order

Work follows the phased build order (Phase 0 → 8) with exit criteria
(`docs/master-plan.md`). Gating is strict: no agent starts phase N+1 work
until the master marks phase N passed in `coordination/MASTER.md`.

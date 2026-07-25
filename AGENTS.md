# AGENTS.md

## Naming (frozen)

The product and repository are **Vortex**. Do not use PermAMM, PremAMM,
PrepAMM, or AquaGuard anywhere — code, docs, or commits. "Aqua" and "SwapVM"
refer only to the official 1inch protocol components.

- Product: **Vortex**
- v4 hook leg: **Vortex AMM** (`VortexHook`, `VortexRouter`, `VortexQuoter`)
- Aqua market-making strategy: **BestExecutionStrategy** (via SwapVM)
- Aqua single-asset strategy: **CompoundStrategy** + **VortexCompounder** app

## Team of agents

Three coding agents plus a supervising master-agent:

- **blockend** — `packages/contracts` (Foundry), `deployments/`, `scripts/bootstrap-fork.sh`
- **backend** — `apps/api`, `packages/shared`, `.github/workflows/typescript.yml`
- **frontend** — `apps/web`
- **master** — phase gating, cross-agent arbitration, root docs

Agents communicate exclusively through the gitignored `coordination/`
directory. Each agent appends to its own channel file
(`coordination/<agent>.md`); the master writes decisions and phase gates to
`coordination/MASTER.md`. Disagreements are argued in the channel files; the
master has the last say.

## Commit conventions

- Title only, no body, no co-author trailers.
- Title starts with `fix:`, `feat:`, or `del:`.
- Commit continuously while working; never squash the history.

## Build order

Work follows the phased build order (Phase 0 → 8) with exit criteria. No
agent proceeds past a phase until the master gates it as passed.

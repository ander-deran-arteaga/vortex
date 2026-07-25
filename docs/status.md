# Vortex implementation status

## Current gate

Phase 0 — repository and qualification skeleton. Exit: `pnpm build`,
`pnpm test`, `forge test` all green; naming clean; CI + commit policy in
place.

## Contracts
- Current task: Foundry skeleton with pinned official Aqua/SwapVM/v4 deps
- Last commit: pending first commit
- Tests: Phase0Deps.t.sol compiling against pinned deps
- Blocker: none
- Interface changes: dependency pins ratified (D-007); event names per D-009

## Backend
- Current task: Fastify skeleton (health/config) wired to @vortex/shared
- Last commit: pending first commit
- Tests: health/config/env vitest suites
- Blocker: none
- Interface changes: adopting /api/v1 surface (D-004)

## Frontend
- Current task: Next.js App Router shell with placeholder product routes
- Last commit: pending first commit
- Tests: vitest unit + next build
- Blocker: none
- Interface changes: consuming API_ROUTES from @vortex/shared

## Integration
- Latest green commit: pending
- Latest deployment: none
- Known failures: none recorded
- Next gate: Phase 1 — official Aqua token transfer with real ERC-20 movement

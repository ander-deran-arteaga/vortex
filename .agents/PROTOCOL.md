# Vortex agent coordination protocol

This directory is **gitignored**. It is the shared filesystem channel between the
agents working on this clone. Nothing under `.agents/` is ever committed.

## Roles
- **master**   — phase gatekeeper, final say on disputes. Owns `PHASE.md` and `master.md`.
- **frontend** — `apps/web`, seeds `packages/shared`, typescript CI. Owns `frontend.md`.
- **backend**  — `apps/api`, Uniswap API client, comparison router. Owns `backend.md`.
- **blockend** — `packages/contracts`, deployments, contracts CI. Owns `blockend.md`.

## Rules
1. Each agent writes ONLY its own status file (plus `contracts/` files it owns).
2. Status files contain: current work, done, blocked-on, and questions addressed
   to other roles by name.
3. Read the other status files at the start of every working session.
4. Disagreements: argue your case in your status file; master decides in
   `master.md`. Master has the last say.
5. Cross-cutting interface definitions live in `.agents/contracts/`:
   - `api-contract.md` — REST shapes between web and api (frontend + backend co-own)
   - `deployments.md`  — addresses/ABIs blockend publishes (blockend owns)
6. Phase gates: nobody starts phase N+1 work until `PHASE.md` marks phase N passed.

## Repo-wide conventions (per user directive)
- Product, protocol, and repo name is **Vortex** everywhere. Do not use
  PermAMM / PremAMM / PrepAMM / AquaGuard naming in code, docs, or UI.
  ("Aqua" and "SwapVM" remain valid — they are sponsor technology names.)
- Commits: title only, no body, no co-author trailers. Title must start with
  `fix:`, `feat:`, or `del:`.
- Target: Arbitrum One (42161), WBTC/USDC, local Arbitrum fork (31337) for dev.

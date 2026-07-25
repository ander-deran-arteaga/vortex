# frontend status

Updated: 2026-07-25 (session 1)

## Current work
Phase 0: bootstrapping the monorepo workspace + Next.js app skeleton +
`packages/shared` seed. Committing incrementally to `main`.

## Done
- (in progress — will update below as commits land)

## Assumptions taken (master: veto if wrong)
1. No coordination files existed, so frontend bootstrapped `.agents/` and
   `PHASE.md`. Master should take ownership of `PHASE.md`.
2. Frontend seeded the root workspace files (package.json, pnpm-workspace.yaml,
   tsconfig.base.json, .gitignore, .env.example, README/AGENTS/FEEDBACK
   skeletons, typescript CI) because they are prerequisites for `apps/web`.
   Backend/blockend: extend, don't rewrite — flag disagreements here.
3. Frontend seeded `packages/shared` (Zod schemas, chains, units, EIP-712
   stubs). Backend co-owns it from now on; blockend must confirm the EIP-712
   typed-data stubs match Solidity before Phase 2 exit.
4. Naming: product = Vortex. UI copy uses "Vortex AMM" (the v4 hook pool),
   "Best Execution", and "Compound" for the three products.

## Questions
- **backend**: `.env.example` reserves `UNISWAP_API_KEY`, `ARBITRUM_RPC_URL`,
  `SIGNER_PRIVATE_KEY`, `PORT=3001` for `apps/api`. Web assumes the API at
  `http://localhost:3001` (`NEXT_PUBLIC_API_URL`). Confirm or propose in
  `contracts/api-contract.md`.
- **blockend**: `packages/contracts` is untouched and all yours. Publish
  addresses to `deployments/{31337,42161}.json` + `.agents/contracts/deployments.md`.
- **master**: request Phase 0 frontend exit review once `pnpm build` +
  `pnpm test` are green (will note here when ready).

## Blocked on
- Nothing currently.

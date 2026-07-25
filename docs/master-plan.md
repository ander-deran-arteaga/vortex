# Vortex master plan

Condensed working plan. The decision log (`decisions.md`) and status board
(`status.md`) track live state.

## Product

**Vortex Swap** — best execution. A taker asks to swap WBTC/USDC. The backend
compares an Aqua + SwapVM inventory-aware quote against a Uniswap Trade API
quote and executes through Aqua only when Aqua beats the best observed
executable quote without violating the maker's onchain safety envelope
(immutable safety spread, minimum commercial margin, inventory limits, max
trade size, fresh reference price, real balance/allowance coverage).
Otherwise the Uniswap API builds the fallback transaction.

**Vortex Grow** — same-asset compounding. A maker ships WBTC into a custom
Aqua app and states "only execute if I end with more WBTC". Vortex executes
an atomic WBTC → USDC → WBTC cycle across the Vortex PermAMM and an external
venue. Success requires final WBTC ≥ principal + minimum maker profit; the
performance fee comes from realized profit only; failure reverts atomically.

**Vortex PermAMM** — a real Uniswap v4 dynamic-fee pool (VortexHook) with
controlled liquidity, mock reference oracle, immutable minimum safety fee,
signed per-swap commercial fee, and price-deviation guards. No external LPs
in the MVP.

## Scope guards

- Pair: WBTC (8 decimals) / USDC (6 decimals); price scale 1e18; explicit fee
  units. Never assume 18 decimals.
- Chain: Arbitrum One (42161); local fork as 31337.
- Mocked: reference oracle, price updates, competitor volatility, stale
  external pool (labeled simulated), solver competition.
- Real: v4 pool + hook, Aqua contract, SwapVM program, Uniswap API call,
  ERC-20 transfers, same-asset compound settlement.
- Excluded from MVP: live Chainlink streams, slot0 reset, per-swap liquidity
  relocation, external LPs, vault shares, multi-chain, UniswapX, solver
  marketplace, governance, proxies, The Graph, cross-chain, generic
  arbitrary-call execution.

## Phases and exit criteria

0. **Repo skeleton** — monorepo builds; Foundry runs; api + web run; CI +
   commit policy live. Exit: `pnpm build`, `pnpm test`, `forge test` green.
1. **Official Aqua settlement** — maker approves + ships, taker executes,
   real ERC-20 moves, virtual balances update, Foundry test proves it.
2. **SwapVM best execution** — Vortex Swap strategy with inventory-aware
   pricing via the official extension mechanism; recentring trades priced
   better, worsening trades worse; toxic trades revert; real transfers.
3. **Backend comparison router** — authenticated Uniswap Trade API client;
   venue comparison on net execution; Uniswap-built transaction executes on
   fork; request IDs + tx hashes stored.
4. **Best-execution frontend** — maker onboarding, side-by-side comparison,
   both execution paths from the UI.
5. **v4 PermAMM** — dynamic-fee pool; signed fee authorization changes a real
   swap's fee; unauthorized liquidity reverts; deviation guard works.
6. **Deterministic Grow** — atomic pull → PermAMM leg → stale-venue leg →
   profit check → fee from profit only → push back; failure fully reverts.
7. **API-powered Grow leg** — only after the contract-as-swapper spike; the
   compounder executes an API-built external leg under signed-route
   constraints; if blocked, keep deterministic Grow and the already-complete
   API qualification.
8. **Polish and freeze** — one-click demo, CLI backup, README qualification
   mapping with direct links, FEEDBACK.md, deployment files, evidence.

Gating is strict: no phase starts before the previous one passes review.

## Security invariants (blockers on sight)

No arbitrary `target.call(data)`; no unbounded external calldata; recipient
always constrained; safety fee floor immutable and out of signer reach;
performance fee from realized profit only; nonces + deadlines everywhere;
final balance checks authoritative; explicit token decimals; no unbounded
loops; no proxies; no external LPs in the MVP pool; API key backend-only;
mock data always labeled; failed swaps and failed Grow cycles atomic;
exact transaction simulation immediately before submission.

## Kill rules

Defer immediately anything that threatens Aqua settlement, SwapVM completion,
token-transfer proof, or the deterministic demo; anything needing unbounded
calldata, a live API for local tests, or a solver network; anything that
cannot be explained in one minute or has no testable invariant.

Priority: Aqua settlement → SwapVM Swap → transfer tests → Uniswap API
transaction → best-execution UI → PermAMM → deterministic Grow → API Grow →
polish.

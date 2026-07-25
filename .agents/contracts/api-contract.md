# Web ↔ API contract (co-owned: frontend + backend) — DRAFT

Status: DRAFT proposed by frontend. Backend: edit freely, note changes in
backend.md. Canonical runtime schemas live in `packages/shared/src/schemas.ts` —
this file is the human-readable index.

## Base
- Base URL: `http://localhost:3001` (dev). Web reads `NEXT_PUBLIC_API_URL`.
- All bodies JSON. All amounts are decimal strings in base units (wei-style).

## Endpoints (phase they land in)

### GET /health (phase 0)
→ `{ status: "ok", chainId: number, uptimeSeconds: number }`

### POST /v1/quote/compare (phase 3)
Body: `ExchangeQuoteRequest` (shared schemas).
→ Aqua quote + Uniswap API quote + selected venue + quote session id + expiry.

### POST /v1/execute/uniswap (phase 3)
Builds the Uniswap /swap transaction for a quote session (Permit2 data included
when required). Frontend broadcasts the returned transaction unchanged.

### POST /v1/aqua/quote, POST /v1/aqua/build (phase 3)
Resolver-facing endpoints proving an aggregator can consume Aqua liquidity.

### GET /v1/compound/opportunity (phase 6)
→ `CompoundOpportunity` (shared schemas).

### POST /v1/compound/execute (phase 6/7)

### GET /v1/dashboard/summary (phase 4+)
Volumes, win rate, revenue, revert rate, API latency.

## Open items
- Quote session TTL and refresh semantics (backend proposes).
- Error envelope shape (frontend proposes `{ error: { code, message } }`).

# Deploying Vortex to Vercel

The web app is a pnpm-workspace Next.js app that **builds and serves with no
API, no chain and no environment variables**. Verified: a production build with
every `NEXT_PUBLIC_*` unset prerenders all six routes and serves them 200.

That matters because it decides what a Vercel deploy can honestly show.

---

## What a Vercel deploy gives you, and what it does not

| Surface | Without a backend | With a reachable API |
| --- | --- | --- |
| Landing page (`/`) | **Fully working** — static, no wallet, no chain | same |
| `/market` | Live **Binance** data works (browser-direct, CORS allows it); the Vortex series says it is unavailable | Both venues live |
| `/swap`, `/grow`, `/maker` | Render with **labelled fixture data** and honest empty states | Live quotes; execution needs a wallet on the chain |

The landing page is the whole marketing story and it needs nothing. Everything
under `(app)` degrades to labelled fixtures rather than breaking — the
`source` badge already carries provenance, so a visitor is never shown a
simulated number dressed as a live one.

**Do not point a public deploy at a laptop.** If `NEXT_PUBLIC_API_URL` names a
host that is not reachable, the app falls back to fixtures, which is correct.
An API URL that only resolves on your machine is worse than none.

---

## Setup

`vercel.json` at the repo root already pins the monorepo build:

```json
{
  "framework": "nextjs",
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm --filter @vortex/web build",
  "outputDirectory": "apps/web/.next"
}
```

In the Vercel project:

- **Root Directory:** repository root (not `apps/web` — the build needs the
  workspace so `@vortex/shared` resolves).
- **Node version:** 22 or later (`package.json` sets `engines.node >= 22`).
- **Install/Build commands:** leave them; `vercel.json` wins.

## Environment variables

All optional. Set none and you get the fixture-backed deploy described above.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Vortex API base URL. Omit for the fixture-backed deploy. |
| `NEXT_PUBLIC_DEMO_STRATEGY_HASH` | Seeded Vortex Swap strategy |
| `NEXT_PUBLIC_DEMO_GROW_STRATEGY_HASH` | Seeded Vortex Grow strategy |
| `NEXT_PUBLIC_AQUA_ADDRESS` | Aqua deployment the UI reads against |

**`UNISWAP_API_KEY` is never set here.** It belongs to the API only and must
never reach the browser; CI fails the build if `NEXT_PUBLIC_UNISWAP` appears
anywhere.

## Hosting the API too (optional)

The API is Fastify and is **not** a Vercel app. To make `/swap`, `/grow` and
`/maker` live you need two long-running processes somewhere that keeps them up
(Fly, Railway, a VPS):

1. `anvil` on 31337 with the stack deployed — `./scripts/ensure-demo.sh`, which
   is idempotent and takes about 12 seconds cold.
2. `pnpm --filter @vortex/api demo` with `UNISWAP_API_KEY` set, its chain
   reachable, and CORS allowing the Vercel origin.

Then set `NEXT_PUBLIC_API_URL` to that host and redeploy.

Two cautions if you do this:

- **Shared mutable state.** Every visitor shares one chain. A Grow cycle moves
  the maker balance and `SetDemoScenario` moves the oracle — and a scenario left
  set has already broken the Grow scene once. Reset on a schedule with
  `ensure-demo.sh`.
- **Execution still needs the visitor's wallet on that chain**, which means a
  public RPC and funded keys. Read-only hosting gives most of the value without
  any of that.

## Verifying a deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<deployment>/          # 200
curl -s https://<deployment>/ | grep -c "Launch App"                    # 1
```

Then open `/market` and confirm the Binance series is live — it is fetched
straight from the browser, so it works on Vercel with no backend at all.

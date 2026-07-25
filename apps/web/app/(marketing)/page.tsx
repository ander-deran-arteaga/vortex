import Link from "next/link";
import { FalseChoice } from "@/components/marketing/false-choice";
import { PriceLeak } from "@/components/marketing/price-leak";
import { VortexMark } from "@/components/ui/vortex-mark";

/* ─────────────────────────── shared section frame ─────────────────────────── */

function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-20 sm:px-8 sm:py-24 ${className}`}
    >
      {children}
    </section>
  );
}

function LaunchApp({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/swap"
      className={`cut-tr inline-block bg-cu px-6 py-3 pr-7 text-sm font-medium text-ink-0 transition-colors duration-150 hover:bg-cu-hi ${className}`}
    >
      Launch App
    </Link>
  );
}

/* ──────────────────────────────── guarantees ──────────────────────────────── */

const GUARANTEES = [
  {
    claim: "A signed rebate can never price below the safety floor.",
    detail: "The floor is immutable: safety fee plus minimum commercial fee.",
    revert: "immutable floor",
  },
  {
    claim: "Every swap requires a fresh reference price.",
    detail: "Stale, future-dated and implausibly wide feeds all revert.",
    revert: "VortexStaleOracle",
  },
  {
    claim: "Trade size is capped by the maker, onchain.",
    detail: "A quote larger than the maker allowed cannot settle.",
    revert: "VortexMaxTradeExceeded",
  },
  {
    claim: "Inventory bounds hold.",
    detail: "A swap that would push the book past its limits is refused.",
    revert: "VortexInventoryBoundBreached",
  },
  {
    claim: "Maker solvency is checked, not assumed.",
    detail:
      "Executable size is the minimum of virtual balance, wallet balance and allowance.",
    revert: "never the virtual balance alone",
  },
  {
    claim: "Grow is atomic.",
    detail:
      "Below the profit floor the whole cycle reverts and balances are untouched.",
    revert: "all or nothing",
  },
] as const;

/* ──────────────────────────────── built on ────────────────────────────────── */

const FOUNDATIONS = [
  { name: "1inch Aqua", line: "Liquidity without custody." },
  { name: "SwapVM", line: "Strategy enforced onchain." },
  {
    name: "Uniswap v4 & Trading API",
    line: "Depth, hooks, and the benchmark every quote must beat.",
  },
  {
    name: "Pull-oracle-ready reference price",
    line: "Freshness enforced per swap.",
  },
] as const;

export default function LandingPage() {
  return (
    <>
      {/* ───────────────────────────── 1 · hero ───────────────────────────── */}
      {/*
        Deliberately NOT the stock hero: no text column on the left with an
        object parked on the right. The headline owns the full width, the mark
        is a layer the type crosses rather than a panel beside it, and the
        supporting line and action sit on one row underneath.
      */}
      <Section className="relative overflow-hidden pt-14 sm:pt-16">
        <VortexMark
          size={520}
          strokeWidth={2.5}
          className="pointer-events-none absolute -right-24 top-4 hidden h-[34rem] w-[34rem] text-ink-2 lg:block"
        />

        <div className="relative">
          <p className="text-sm text-say-2">
            Programmable market making
            <span className="mx-2 text-say-3">·</span>
            Arbitrum One
          </p>

          {/*
            Two lines at every width. The size is capped so the first line
            cannot wrap on a 1152px container, and the explicit break keeps the
            second line whole instead of letting a stray word dangle.
          */}
          <h1 className="mt-6 max-w-[15ch] text-[clamp(2.1rem,5vw,3.75rem)] leading-[1.04] text-say-1 sm:max-w-none">
            Active market making,
            <br className="hidden sm:block" />{" "}
            <span className="text-say-2">enforced by contracts.</span>
          </h1>

          <div className="mt-10 flex flex-wrap items-start gap-x-14 gap-y-8">
            <p className="max-w-md text-[15px] leading-relaxed text-say-2">
              Passive AMMs wait for arbitrageurs to correct their price.
              Proprietary AMMs quote actively, but you must trust whoever sets
              the quote. Vortex gives makers active pricing with the spread,
              inventory limits and profit floor enforced onchain.
            </p>

            <div className="flex flex-wrap items-center gap-x-8 gap-y-4 pt-1">
              <LaunchApp />
              <a
                href="#choice"
                className="text-sm text-say-2 transition-colors duration-150 hover:text-cu"
              >
                See how it works
              </a>
            </div>
          </div>

          <p className="mt-16 text-sm text-say-3">
            Built on 1inch Aqua
            <span className="mx-2">·</span>SwapVM
            <span className="mx-2">·</span>Uniswap v4 &amp; Trading API
          </p>
        </div>
      </Section>

      {/* ──────────────────────────── 2 · the leak ────────────────────────── */}
      <Section id="problem">
        <p className="text-sm text-say-3">The problem</p>
        <h2 className="mt-3 max-w-3xl text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.1] text-say-1">
          Every time a pool price goes stale, someone profits.
        </h2>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-say-2">
          It is usually not the liquidity provider. A passive pool cannot move
          its own price: it waits to be corrected by an arbitrageur, and pays
          for the correction.
        </p>
        <div className="mt-10">
          <PriceLeak />
        </div>
      </Section>

      {/* ────────────────────────── 3 · false choice ──────────────────────── */}
      <Section id="choice">
        <p className="text-sm text-say-3">The trade-off nobody wants to make</p>
        <h2 className="mt-3 max-w-3xl text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.1] text-say-1">
          Better prices, or no trusted operator. Pick one.
        </h2>
        <div className="mt-10">
          <FalseChoice />
        </div>
        <p className="mt-8 max-w-2xl text-[15px] leading-relaxed text-say-2">
          <span className="text-cu">Vortex takes both.</span> The maker&rsquo;s
          strategy quotes actively; the chain decides whether the quote is
          allowed.
        </p>
      </Section>

      {/* ─────────────────────────── 4 · how it works ─────────────────────── */}
      <Section id="how">
        <h2 className="max-w-3xl text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.1] text-say-1">
          Offchain systems find opportunities. Onchain contracts guarantee the
          outcome.
        </h2>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <div className="panel p-6">
            <h3 className="text-[15px] text-say-1">Execution proposes</h3>
            <p className="mt-1 text-sm text-say-3">Offchain</p>
            <dl className="mt-5 space-y-4">
              <div>
                <dt className="text-sm text-cu">Aqua</dt>
                <dd className="mt-1 text-sm leading-relaxed text-say-2">
                  Makers provide liquidity while assets stay in their own
                  wallets, subscribing to strategies.
                </dd>
              </div>
              <div>
                <dt className="text-sm text-cu">Uniswap and the Trading API</dt>
                <dd className="mt-1 text-sm leading-relaxed text-say-2">
                  Deep liquidity and network effects, including v4 hooks.
                </dd>
              </div>
            </dl>
          </div>

          <div className="panel-raised p-6">
            <h3 className="text-[15px] text-say-1">Enforcement disposes</h3>
            <p className="mt-1 text-sm text-say-3">Onchain</p>
            <dl className="mt-5 space-y-4">
              <div>
                <dt className="text-sm text-cu">SwapVM</dt>
                <dd className="mt-1 text-sm leading-relaxed text-say-2">
                  Enforces the strategy: spreads, inventory behaviour, the
                  liquidity curve.
                </dd>
              </div>
              <div>
                <dt className="text-sm text-cu">The comparator</dt>
                <dd className="mt-1 text-sm leading-relaxed text-say-2">
                  Improves the quote only while the maker stays profitable.
                </dd>
              </div>
              <div>
                <dt className="text-sm text-cu">A fresh reference price</dt>
                <dd className="mt-1 text-sm leading-relaxed text-say-2">
                  Required on every swap, checked before anything settles.
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <p className="mt-6 text-sm text-say-3">
          <Link
            href="/architecture"
            className="text-say-2 transition-colors duration-150 hover:text-cu"
          >
            Read the architecture
          </Link>
        </p>
      </Section>

      {/* ───────────────────────── 5 · what the chain enforces ────────────── */}
      <Section id="guarantees">
        <h2 className="max-w-3xl text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.1] text-say-1">
          The quote signer cannot cross these lines.
        </h2>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-say-2">
          Each of these is a real check in the deployed contracts. The names
          below are the errors they revert with.
        </p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GUARANTEES.map((guarantee) => (
            <li key={guarantee.claim} className="panel flex flex-col p-5">
              <p className="text-[15px] leading-snug text-say-1">{guarantee.claim}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-say-2">
                {guarantee.detail}
              </p>
              <p className="num mt-4 text-xs text-cu">{guarantee.revert}</p>
            </li>
          ))}
        </ul>

        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-say-3">
          The reference-price interface is pull-oracle-ready: bid, mid, ask and
          a timestamp. This hackathon build runs a mock feed, and the freshness
          checks around it are real and enforced on every swap.
        </p>
      </Section>

      {/* ───────────────────────────── 6 · products ───────────────────────── */}
      <Section id="products">
        <h2 className="max-w-3xl text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.1] text-say-1">
          Choose an outcome, not a venue.
        </h2>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {/* Swap is a comparison: two quotes, one winner. */}
          <article className="panel flex flex-col p-6">
            <h3 className="font-display text-2xl text-say-1">Vortex Swap</h3>
            <p className="mt-1 text-sm text-cu">Best safe execution</p>

            <div className="mt-6 grid grid-cols-2 gap-3" aria-hidden="true">
              <div className="panel-raised p-4">
                <p className="text-xs text-say-2">Aqua</p>
                <p className="num mt-2 text-lg text-say-1">64,948.00</p>
                <p className="mt-2 text-xs text-cu">Wins on net output</p>
              </div>
              <div className="p-4">
                <p className="text-xs text-say-2">Uniswap API</p>
                <p className="num mt-2 text-lg text-say-3">64,200.14</p>
                <p className="mt-2 text-xs text-say-3">Benchmark</p>
              </div>
            </div>

            <p className="mt-6 flex-1 text-sm leading-relaxed text-say-2">
              Every Aqua quote is benchmarked against the Uniswap Trading API.
              Aqua executes only when it wins on net output; otherwise the API
              builds the transaction.
            </p>
            <p className="mt-4 text-xs text-say-3">
              Figures shown are an illustration of the comparison, not a live
              quote.
            </p>
          </article>

          {/* Grow is a cycle: a closed loop with a gate on the final edge. */}
          <article className="panel flex flex-col p-6">
            <h3 className="font-display text-2xl text-say-1">Vortex Grow</h3>
            <p className="mt-1 text-sm text-gain">Compounding, or nothing</p>

            <ol className="mt-6 space-y-2.5" aria-hidden="true">
              {[
                "Maker authorises WBTC",
                "Vortex runs one atomic cycle",
                "Ends with more WBTC, or reverts",
              ].map((step, index) => (
                <li key={step} className="flex items-baseline gap-3">
                  <span className="num text-xs text-say-3">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`text-sm ${index === 2 ? "text-gain" : "text-say-2"}`}
                  >
                    {step}
                  </span>
                </li>
              ))}
            </ol>

            <p className="mt-6 flex-1 text-sm leading-relaxed text-say-2">
              A maker authorises an asset such as WBTC. Vortex runs an atomic
              cycle and it settles only if the maker ends with more of that same
              asset. The performance fee comes from realised profit only.
            </p>
            <p className="mt-4 text-xs text-say-3">
              The profit gate is enforced onchain, not checked afterwards.
            </p>
          </article>
        </div>
      </Section>

      {/* ───────────────────────────── 7 · built on ───────────────────────── */}
      <Section id="built-on">
        <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.1] text-say-1">
          Built on
        </h2>
        <dl className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {FOUNDATIONS.map((foundation) => (
            <div key={foundation.name}>
              <dt className="text-[15px] text-say-1">{foundation.name}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-say-2">
                {foundation.line}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* ───────────────────────────── 8 · closing ────────────────────────── */}
      <Section className="pb-8">
        <div className="panel cut-tr p-8 sm:p-12">
          <h2 className="max-w-3xl pr-6 text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.12] text-say-1">
            Permissionless market-making capital that earns spread, manages
            inventory, and compounds itself.
          </h2>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-say-2">
            Without giving unrestricted pricing power to a centralized operator.
          </p>
          <LaunchApp className="mt-9" />
        </div>
      </Section>
    </>
  );
}

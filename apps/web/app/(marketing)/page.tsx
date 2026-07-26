import { Layers, Lock, Radio, ShieldCheck } from "lucide-react";
import { FalseChoice } from "@/components/marketing/false-choice";
import { GrowFlowSection } from "@/components/marketing/grow-flow/grow-flow-section";
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
    claim: "Grow is atomic.",
    detail:
      "Below the profit floor the whole cycle reverts and balances are untouched.",
    revert: "all or nothing",
  },
] as const;

/* ──────────────────────────────── built on ────────────────────────────────── */

const FOUNDATIONS = [
  { name: "1inch Aqua", line: "Liquidity without custody.", Icon: Lock },
  { name: "SwapVM", line: "Strategy enforced onchain.", Icon: ShieldCheck },
  {
    name: "Uniswap v4 & Trading API",
    line: "The benchmark every quote must beat.",
    Icon: Layers,
  },
  {
    name: "Pull-oracle-ready reference price",
    line: "Checked fresh on every swap.",
    Icon: Radio,
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
          </p>

          {/*
            Two lines at every width, including 390px. The break is
            unconditional so the tone change always starts a line: letting it
            wrap naturally on mobile put "making, enforced" on one row and the
            colour shift landed mid-phrase. The lower clamp bound is sized so
            the longer headline still fits one line at the 360px floor, and
            the viewport coefficient carries it up from there.
          */}
          <h1 className="mt-6 text-[clamp(1.4rem,5.4vw,3.5rem)] leading-[1.06] text-say-1">
            Quote like a market maker.
            <br />
            <span className="text-say-2">Trust like a contract.</span>
          </h1>

          <div className="mt-10 flex flex-wrap items-start gap-x-14 gap-y-8">
            <p className="max-w-md text-[15px] leading-relaxed text-say-2">
              Makers price actively. The spread, inventory limits and profit
              floor are enforced onchain.
            </p>

            <a
              href="#choice"
              className="pt-1 text-sm text-say-2 transition-colors duration-150 hover:text-cu"
            >
              See how it works
            </a>
          </div>

        </div>
      </Section>

      {/*
        The trust strip sits directly under the hero: what this is built on is
        the first question a reader has, and the answer belongs before the
        argument rather than after it.
      */}
      <Section id="built-on" className="pt-0 sm:pt-0">
        <dl className="grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          {FOUNDATIONS.map(({ name, line, Icon }) => (
            <div key={name}>
              {/* The mark sits bare on the surface: no tile, no chip. */}
              <Icon aria-hidden="true" className="size-5 text-cu" strokeWidth={1.5} />
              <dt className="mt-3 text-[15px] text-say-1">{name}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-say-2">{line}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* ──────────────────────────── 2 · the leak ────────────────────────── */}
      <Section id="problem">
        <p className="text-sm text-say-3">The problem</p>
        <h2 className="mt-3 max-w-3xl text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.1] text-say-1">
          Every time a pool price goes stale, someone profits.
        </h2>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-say-2">
          A passive pool waits to be corrected by an arbitrageur, and pays for
          the correction.
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
          strategy quotes. The chain decides whether the quote is allowed.
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
                  Liquidity without custody: assets stay in the maker&rsquo;s
                  wallet.
                </dd>
              </div>
              <div>
                <dt className="text-sm text-cu">Uniswap and the Trading API</dt>
                <dd className="mt-1 text-sm leading-relaxed text-say-2">
                  Deep liquidity and v4 hooks.
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
                  Enforces spreads, inventory behaviour and the curve.
                </dd>
              </div>
              <div>
                <dt className="text-sm text-cu">The comparator</dt>
                <dd className="mt-1 text-sm leading-relaxed text-say-2">
                  Improves the quote only while the maker profits.
                </dd>
              </div>
            </dl>
          </div>
        </div>

      </Section>

      {/* ───────────────────────── 5 · what the chain enforces ────────────── */}
      <Section id="guarantees">
        <h2 className="max-w-3xl text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.1] text-say-1">
          The quote signer cannot cross these lines.
        </h2>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-say-2">
          Real checks, each named by the error it reverts with.
        </p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          Pull-oracle-ready: bid, mid, ask and a timestamp. This build runs a
          mock feed; the freshness checks around it are real.
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
              Aqua executes only when it wins on net output.
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
              An atomic cycle that settles only if the maker ends with more of
              the same asset.
            </p>
          </article>
        </div>

        <GrowFlowSection />
      </Section>

      {/* ───────────────────────────── 8 · closing ────────────────────────── */}
      <Section className="pb-8">
        <div className="panel cut-tr p-8 sm:p-12">
          <h2 className="max-w-3xl pr-6 text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.12] text-say-1">
            Permissionless market-making capital that earns spread, manages
            inventory, and compounds itself.
          </h2>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-say-2">
            Without handing pricing power to a centralized operator.
          </p>
        </div>
      </Section>
    </>
  );
}

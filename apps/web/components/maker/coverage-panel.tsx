import type { StrategyHealth, StrategyTokenHealth } from "@vortex/shared";
import { TOKENS } from "@vortex/shared";
import { SourceBadge } from "@/components/source-badge";
import type { DataSource } from "@/lib/api/source";
import { basisPointsToPercent, formatTokenAmount } from "@/lib/format";

/** WBTC is 8 decimals and USDC is 6 — never assume 18. */
function decimalsFor(token: StrategyTokenHealth): number {
  const known = TOKENS.find(
    (candidate) => candidate.address.toLowerCase() === token.address.toLowerCase(),
  );
  return known?.decimals ?? 18;
}

function CoverageBadge({ health }: { health: StrategyHealth }) {
  if (!health.active || health.coverageBps === 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-0.5 text-xs font-medium text-zinc-400">
        Offline
      </span>
    );
  }
  if (health.coverageBps >= 10_000) {
    return (
      <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-400">
        Fully covered
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
      Partially covered
    </span>
  );
}

export function CoveragePanel({
  health,
  source,
  title = "Balance coverage",
}: {
  health: StrategyHealth;
  source: DataSource;
  title?: string;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          {title}
        </h2>
        <div className="flex items-center gap-3">
          <CoverageBadge health={health} />
          <SourceBadge source={source} />
        </div>
      </header>

      {health.solvent ? null : (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
        >
          This maker cannot honour quotes at the size they shipped. Executable
          balance has fallen below the virtual balance Aqua is quoting against.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-widest text-zinc-500">
              <th scope="col" className="pb-2 pr-4 font-medium">Token</th>
              <th scope="col" className="pb-2 pr-4 text-right font-medium">Aqua virtual</th>
              <th scope="col" className="pb-2 pr-4 text-right font-medium">Wallet</th>
              <th scope="col" className="pb-2 pr-4 text-right font-medium">Allowance</th>
              <th scope="col" className="pb-2 text-right font-medium">Executable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {health.tokens.map((token) => {
              const decimals = decimalsFor(token);
              return (
                <tr key={token.address}>
                  <th scope="row" className="py-2 pr-4 text-sm font-medium text-zinc-200">
                    {token.symbol}
                  </th>
                  <td className="py-2 pr-4 text-right font-mono text-sm tabular-nums text-zinc-400">
                    {formatTokenAmount(BigInt(token.virtualBalance), decimals)}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-sm tabular-nums text-zinc-400">
                    {formatTokenAmount(BigInt(token.actualBalance), decimals)}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-sm tabular-nums text-zinc-400">
                    {formatTokenAmount(BigInt(token.aquaAllowance), decimals)}
                  </td>
                  <td className="py-2 text-right font-mono text-sm tabular-nums text-zinc-100">
                    {formatTokenAmount(BigInt(token.executableBalance), decimals)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-zinc-400">
        Aqua virtual balances are accounting entries, not collateral. What a
        taker can actually receive is the <strong className="font-medium text-zinc-200">executable</strong>{" "}
        balance — the smallest of the virtual balance, the maker&apos;s wallet
        balance, and the allowance granted to Aqua. Coverage is currently{" "}
        {basisPointsToPercent(health.coverageBps)}.
      </p>
    </section>
  );
}

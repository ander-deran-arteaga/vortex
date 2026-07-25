import type { StrategyHealth, StrategyTokenHealth } from "@vortex/shared";
import { TOKENS } from "@vortex/shared";
import { SourceBadge } from "@/components/source-badge";
import { Panel, StatusMark } from "@/components/ui/primitives";
import type { DataSource } from "@/lib/api/source";
import { basisPointsToPercent, formatTokenAmount } from "@/lib/format";

/**
 * WBTC is 8 decimals and USDC is 6 — never assume 18. An unrecognised token
 * yields undefined so the row renders an em dash instead of a number that is
 * wrong by orders of magnitude.
 */
function decimalsFor(token: StrategyTokenHealth): number | undefined {
  return TOKENS.find(
    (candidate) => candidate.address.toLowerCase() === token.address.toLowerCase(),
  )?.decimals;
}

function amountCell(value: string, decimals: number | undefined): string {
  return decimals === undefined ? "—" : formatTokenAmount(BigInt(value), decimals);
}

/** Status in type and tone, not in a tinted pill. */
function CoverageStatus({ health }: { health: StrategyHealth }) {
  if (!health.active || health.coverageBps === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-say-3">
        <StatusMark tone="muted" />
        Offline
      </span>
    );
  }
  if (health.coverageBps >= 10_000) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gain">
        <StatusMark tone="gain" />
        Fully covered
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-warn">
      <StatusMark tone="warn" />
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
    <Panel
      title={title}
      aside={
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <CoverageStatus health={health} />
          <SourceBadge source={source} />
        </div>
      }
    >
      {health.solvent ? null : (
        <div role="alert" className="panel-raised mb-5 flex gap-3 p-4">
          <StatusMark tone="warn" className="mt-[7px] shrink-0" />
          <p className="text-sm leading-relaxed text-say-2">
            <span className="text-warn">Under-covered.</span> This maker cannot
            honour quotes at the size they shipped. Executable balance has fallen
            below the virtual balance Aqua is quoting against.
          </p>
        </div>
      )}

      {/*
        Executable leads, and it is the only figure set at money size: it is the
        one balance a taker can actually be paid from. The three figures behind
        it are the constraints it is the minimum of, so they recede.
      */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left">
          <thead>
            <tr>
              <th scope="col" className="pb-3 pr-4 text-xs font-normal text-say-3">
                Token
              </th>
              <th
                scope="col"
                className="pb-3 pr-6 text-right text-xs font-medium text-say-1"
              >
                Executable
              </th>
              <th scope="col" className="pb-3 pr-4 text-right text-xs font-normal text-say-3">
                Aqua virtual
              </th>
              <th scope="col" className="pb-3 pr-4 text-right text-xs font-normal text-say-3">
                Wallet
              </th>
              <th scope="col" className="pb-3 text-right text-xs font-normal text-say-3">
                Allowance
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(255,238,222,0.05)]">
            {health.tokens.map((token) => {
              const decimals = decimalsFor(token);
              return (
                <tr key={token.address}>
                  <th
                    scope="row"
                    className="py-3.5 pr-4 align-baseline text-sm font-medium text-say-1"
                  >
                    {token.symbol}
                  </th>
                  <td className="num py-3.5 pr-6 text-right align-baseline text-[17px] leading-none text-say-1">
                    {amountCell(token.executableBalance, decimals)}
                  </td>
                  <td className="num py-3.5 pr-4 text-right align-baseline text-sm text-say-3">
                    {amountCell(token.virtualBalance, decimals)}
                  </td>
                  <td className="num py-3.5 pr-4 text-right align-baseline text-sm text-say-3">
                    {amountCell(token.actualBalance, decimals)}
                  </td>
                  <td className="num py-3.5 text-right align-baseline text-sm text-say-3">
                    {amountCell(token.aquaAllowance, decimals)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-5 max-w-prose text-sm leading-relaxed text-say-2">
        Aqua virtual balances are accounting entries, not collateral. What a
        taker can actually receive is the{" "}
        <strong className="font-medium text-say-1">executable</strong> balance:
        the smallest of the virtual balance, the maker&apos;s wallet balance, and
        the allowance granted to Aqua. Coverage is currently{" "}
        {basisPointsToPercent(health.coverageBps)}.
      </p>
    </Panel>
  );
}

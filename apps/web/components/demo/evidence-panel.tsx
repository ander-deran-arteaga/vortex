import { SourceBadge } from "@/components/source-badge";
import { truncateAddress } from "@/lib/format";
import type { EvidenceEntry } from "@/lib/demo/demoMachine";

/**
 * Sponsor evidence, collected from what the run actually observed. Nothing is
 * listed here that a step did not return — an empty panel means no evidence
 * was produced, which is itself the honest answer.
 */
export function EvidencePanel({ entries }: { entries: EvidenceEntry[] }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <header className="mb-4">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          API evidence
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Uniswap Trade API request IDs and transaction hashes captured during
          the run, each with the provenance of the leg that produced it.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No request IDs or transaction hashes captured yet. Run the demo to
          collect them.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase tracking-widest text-zinc-500">
                <th scope="col" className="pb-2 pr-4 font-medium">Step</th>
                <th scope="col" className="pb-2 pr-4 font-medium">Uniswap request ID</th>
                <th scope="col" className="pb-2 pr-4 font-medium">Transaction</th>
                <th scope="col" className="pb-2 font-medium">Provenance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {entries.map((entry) => (
                <tr key={entry.stepId}>
                  <th scope="row" className="py-2 pr-4 text-sm font-normal text-zinc-300">
                    {entry.label}
                  </th>
                  <td className="py-2 pr-4 font-mono text-xs tabular-nums text-zinc-100">
                    {entry.uniswapRequestId ?? "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs tabular-nums text-zinc-400">
                    {entry.txHash === undefined ? (
                      "—"
                    ) : (
                      <span title={entry.txHash}>{truncateAddress(entry.txHash)}</span>
                    )}
                  </td>
                  <td className="py-2">
                    {entry.source === undefined ? (
                      <span className="text-xs text-zinc-600">—</span>
                    ) : (
                      <SourceBadge source={entry.source} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

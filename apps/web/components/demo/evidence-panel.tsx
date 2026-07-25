import { SourceBadge } from "@/components/source-badge";
import { Panel, StatusMark } from "@/components/ui/primitives";
import { truncateAddress } from "@/lib/format";
import type { EvidenceEntry } from "@/lib/demo/demoMachine";

/**
 * Sponsor evidence, collected from what the run actually observed. Nothing is
 * listed here that a step did not return: an empty panel means no evidence was
 * produced, which is itself the honest answer.
 *
 * Provenance is per row, because one run routinely carries a fixture leg beside
 * a live one and a single badge on the panel would flatten that away.
 */
export function EvidencePanel({ entries }: { entries: EvidenceEntry[] }) {
  return (
    <Panel
      title="API evidence"
      cut
      aside={
        <span className="text-xs text-say-3">
          <span className="num text-say-2">{entries.length}</span> captured
        </span>
      }
    >
      <p className="text-sm leading-relaxed text-say-2">
        Uniswap Trade API request IDs and transaction hashes captured during the
        run, each with the provenance of the leg that produced it.
      </p>

      {entries.length === 0 ? (
        <div className="panel-raised mt-4 flex gap-3 p-4">
          <StatusMark tone="muted" className="mt-[7px] shrink-0" />
          <p className="text-sm leading-relaxed text-say-2">
            No request IDs or transaction hashes captured yet. Run the demo to
            collect them: whatever the steps return appears here, and nothing
            else does.
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left">
            <thead>
              <tr className="text-xs text-say-3">
                <th scope="col" className="pb-3.5 pr-5 font-normal">
                  Step
                </th>
                <th scope="col" className="pb-3.5 pr-5 font-normal">
                  Uniswap request ID
                </th>
                <th scope="col" className="pb-3.5 pr-5 font-normal">
                  Transaction
                </th>
                <th scope="col" className="pb-3.5 font-normal">
                  Provenance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(255,238,222,0.05)]">
              {entries.map((entry) => (
                <tr key={entry.stepId}>
                  <th
                    scope="row"
                    className="py-3 pr-5 align-top text-sm font-normal text-say-2"
                  >
                    {entry.label}
                  </th>
                  <td className="py-3 pr-5 align-top text-xs">
                    {entry.uniswapRequestId === undefined ? (
                      <span className="text-say-3">Not captured</span>
                    ) : (
                      <span className="num break-all text-say-1">
                        {entry.uniswapRequestId}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-5 align-top text-xs">
                    {entry.txHash === undefined ? (
                      <span className="text-say-3">Not captured</span>
                    ) : (
                      <span className="num text-say-1" title={entry.txHash}>
                        {truncateAddress(entry.txHash)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 align-top">
                    {entry.source === undefined ? (
                      <span className="text-xs text-say-3">Not stated</span>
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
    </Panel>
  );
}

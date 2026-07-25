import type { ReactNode } from "react";
import { PhaseBadge } from "@/components/phase-badge";

type PlaceholderPanelProps = {
  title: string;
  phase: number;
  children?: ReactNode;
};

export function PlaceholderPanel({ title, phase, children }: PlaceholderPanelProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">{title}</h2>
        <PhaseBadge phase={phase} />
      </div>
      <div className="mt-4">
        {children ?? (
          <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm leading-relaxed text-zinc-500">
            {title} arrives in Phase {phase}.
          </div>
        )}
      </div>
    </section>
  );
}

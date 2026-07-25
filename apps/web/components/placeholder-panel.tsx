import type { ReactNode } from "react";
import { PhaseBadge } from "@/components/phase-badge";
import { Panel } from "@/components/ui/primitives";

/**
 * A surface for something the build has not reached yet. It says what would be
 * here and which phase brings it, rather than showing a dashed rectangle.
 */
type PlaceholderPanelProps = {
  title: string;
  phase: number;
  children?: ReactNode;
};

export function PlaceholderPanel({ title, phase, children }: PlaceholderPanelProps) {
  return (
    <Panel title={title} aside={<PhaseBadge phase={phase} />}>
      {children ?? (
        <div className="panel-raised p-4 text-sm leading-relaxed text-say-2">
          {title} arrives in Phase {phase}. Nothing is rendered here until it
          exists, so this page never shows a value it did not measure.
        </div>
      )}
    </Panel>
  );
}

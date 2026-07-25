import type { ReactNode } from "react";

type PageHeaderProps = {
  overline?: string;
  title: string;
  description?: string;
  badge?: ReactNode;
};

export function PageHeader({ overline, title, description, badge }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3">
      {overline ? (
        <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">{overline}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">{title}</h1>
        {badge}
      </div>
      {description ? (
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">{description}</p>
      ) : null}
    </header>
  );
}

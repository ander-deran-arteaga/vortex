import type { ReactNode } from "react";
import { PageHead } from "@/components/ui/primitives";

/**
 * Legacy shim. Pages predating the design system call this; it now defers to
 * the `PageHead` primitive so every page opens with the same type and rhythm.
 *
 * `overline` is accepted so existing call sites keep compiling, but it is not
 * rendered: the system does not open a page with a small tracked-out label
 * above the heading.
 */
type PageHeaderProps = {
  overline?: string;
  title: string;
  description?: string;
  badge?: ReactNode;
};

export function PageHeader({ title, description, badge }: PageHeaderProps) {
  return <PageHead title={title} lead={description} aside={badge} />;
}

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhaseBadge } from "@/components/phase-badge";

describe("dom test harness", () => {
  it("renders a client component into jsdom", () => {
    render(<PhaseBadge phase={4} />);
    expect(screen.getByText(/Awaiting Phase 4/i)).toBeInTheDocument();
  });
});

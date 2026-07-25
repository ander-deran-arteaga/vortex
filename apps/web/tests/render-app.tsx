import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * Renders a page component the way the app actually mounts it.
 *
 * The client pages read `GET /api/v1/config` (to learn which token addresses
 * the served chain uses), so they need a QueryClient exactly as they do under
 * `app/providers.tsx`. Retries are off so a failing fetch surfaces immediately
 * instead of stalling the test.
 */
export function renderApp(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

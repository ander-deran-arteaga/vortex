import { FIXTURE_GROW_STRATEGY_HASH, FIXTURE_STRATEGY_HASH } from "@/lib/api/fixtures";

/**
 * Which strategy the UI quotes against.
 *
 * The fixture hashes are placeholders that exist only in this app — quoting
 * them against a real deployment returns `AQUA_ORDER_UNAVAILABLE`, because no
 * such strategy was ever shipped. A real run therefore needs the hash the
 * demo seeding actually produced.
 *
 * The API does not expose it yet (`GET /api/v1/config` carries contracts but
 * no strategy, and `GET /api/v1/strategies` is unregistered), so it comes from
 * the environment for now. When backend adds it to the config payload,
 * `resolveStrategyHashes` should prefer that and this env fallback can go.
 */
export interface StrategyHashes {
  swap: string;
  grow: string;
  /** True when we are still on placeholder hashes, so the UI can say so. */
  isPlaceholder: boolean;
}

export function resolveStrategyHashes(
  configured?: { swap?: string; grow?: string },
): StrategyHashes {
  const swap =
    configured?.swap ??
    process.env.NEXT_PUBLIC_DEMO_STRATEGY_HASH ??
    FIXTURE_STRATEGY_HASH;
  const grow =
    configured?.grow ??
    process.env.NEXT_PUBLIC_DEMO_GROW_STRATEGY_HASH ??
    FIXTURE_GROW_STRATEGY_HASH;

  return {
    swap,
    grow,
    isPlaceholder:
      swap === FIXTURE_STRATEGY_HASH || grow === FIXTURE_GROW_STRATEGY_HASH,
  };
}

export const STRATEGY_HASHES = resolveStrategyHashes();

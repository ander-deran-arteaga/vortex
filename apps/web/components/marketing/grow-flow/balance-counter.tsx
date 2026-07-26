"use client";

import { useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";

/**
 * A balance that counts toward its new value.
 *
 * The displayed figure is always derived from the step state, so if the
 * animation never runs the correct number is still on screen: the count is
 * decoration over a value that is already true. Under reduced motion it snaps
 * immediately. Digits are tabular so they cannot jitter.
 */
export function BalanceCounter({
  value,
  decimals,
  displayDecimals,
  className = "",
  suffix,
}: {
  /** Base units. */
  value: string;
  decimals: number;
  displayDecimals?: number;
  className?: string;
  suffix?: string;
}) {
  const target = BigInt(value);
  const [shown, setShown] = useState(target);
  const frame = useRef<number | undefined>(undefined);
  const from = useRef(target);

  useEffect(() => {
    const start = from.current;
    if (start === target) {
      return;
    }

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (reduced) {
      from.current = target;
      setShown(target);
      return;
    }

    const DURATION = 420;
    const began = performance.now();
    const delta = target - start;

    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / DURATION);
      // Ease-out so the number settles rather than stopping dead.
      const eased = 1 - (1 - t) * (1 - t);
      // Interpolate in base units, in bigint, so no float ever touches money.
      const current = start + (delta * BigInt(Math.round(eased * 10_000))) / 10_000n;
      setShown(current);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        from.current = target;
        setShown(target);
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
      }
      // Whatever happens, the true value is what remains on screen.
      from.current = target;
    };
  }, [target]);

  return (
    <span className={`num tabular-nums ${className}`} aria-live="off">
      {formatTokenAmount(shown, decimals, displayDecimals)}
      {suffix === undefined ? null : <span className="ml-1.5 text-say-3">{suffix}</span>}
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * Wall-clock milliseconds, refreshed every `intervalMs`. Returns 0 until mounted, so server and
 * prerender output never depend on the current time (Cache Components forbids that in render).
 */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

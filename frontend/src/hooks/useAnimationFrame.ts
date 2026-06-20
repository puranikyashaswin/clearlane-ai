"use client";

import { useEffect, useRef } from "react";

/**
 * Frame-synced callback loop. Only ticks while the document is visible,
 * pauses cleanly on tab-hide, and never re-creates the rAF handle when
 * the callback identity changes (callback always read from a ref).
 *
 * Pass `enabled: false` to stop the loop without unmounting the consumer.
 */
export function useAnimationFrame(
  callback: (deltaMs: number, timestampMs: number) => void,
  enabled: boolean = true
): void {
  const cbRef = useRef(callback);

  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    let rafId = 0;
    let lastTs = 0;

    const tick = (ts: number): void => {
      if (document.visibilityState !== "visible") {
        lastTs = ts;
        rafId = requestAnimationFrame(tick);
        return;
      }
      const delta = lastTs === 0 ? 0 : ts - lastTs;
      lastTs = ts;
      cbRef.current(delta, ts);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [enabled]);
}

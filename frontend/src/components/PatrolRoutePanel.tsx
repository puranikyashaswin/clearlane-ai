"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchPatrolRoute, type PatrolRoute } from "@/lib/api";
import { Route, MapPin, ChevronRight, AlertTriangle } from "lucide-react";

export function PatrolRoutePanel({ hour }: { hour: number | null }) {
  const [route, setRoute] = useState<PatrolRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    fetchPatrolRoute(hour)
      .then((data) => {
        if (mounted) {
          setRoute(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [hour]);

  const handlePanTo = useCallback((lng: number, lat: number, h3Index: string, placeName: string | null) => {
    window.dispatchEvent(
      new CustomEvent("clearlane:pan-to-zone", {
        detail: { center: [lng, lat], h3_index: h3Index, place_name: placeName },
      }),
    );
  }, []);

  // Loading state
  if (loading) {
    return (
      <section className="px-6 py-4">
        <header className="mb-3 flex items-center gap-2">
          <Route className="h-3.5 w-3.5 text-cyan-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Recommended Patrol Route
          </h2>
        </header>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-900/60" />
          ))}
        </div>
      </section>
    );
  }

  // Error state
  if (error) {
    return (
      <section className="px-6 py-4">
        <header className="mb-3 flex items-center gap-2">
          <Route className="h-3.5 w-3.5 text-cyan-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Recommended Patrol Route
          </h2>
        </header>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-xs text-zinc-400">Route data unavailable</span>
        </div>
      </section>
    );
  }

  // Empty state
  if (!route || route.waypoints.length === 0) {
    return (
      <section className="px-6 py-4">
        <header className="mb-3 flex items-center gap-2">
          <Route className="h-3.5 w-3.5 text-cyan-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Recommended Patrol Route
          </h2>
        </header>
        <p className="text-xs text-zinc-600">No patrol route recommendations available</p>
      </section>
    );
  }

  return (
    <section className="px-6 py-4">
      <header className="mb-3 flex items-center gap-2">
        <Route className="h-3.5 w-3.5 text-cyan-500" />
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
          Recommended Patrol Route
        </h2>
      </header>
      <p className="mb-3 text-[10px] leading-relaxed text-zinc-600">
        Top 5 priority stops ranked by impact score. Click a stop to navigate the map.
      </p>
      <div className="space-y-2">
        {route.waypoints.map((wp, i) => (
          <button
            key={wp.h3_index}
            type="button"
            onClick={() => handlePanTo(wp.lng, wp.lat, wp.h3_index, wp.place_name)}
            className="group flex w-full items-start gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2.5 text-left transition hover:border-zinc-700 hover:bg-zinc-900/80"
          >
            {/* Rank number */}
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-800 font-mono text-[11px] font-bold text-zinc-400">
              {i + 1}
            </span>
            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3 shrink-0 text-zinc-500" />
                <span className="truncate text-sm font-medium text-zinc-200 group-hover:text-zinc-100">
                  {wp.place_name || `Zone ${wp.h3_index.slice(0, 8)}`}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-zinc-500">
                <span className="tabular-nums">
                  Impact: <span className="text-cyan-400">{wp.estimated_delay_mins.toFixed(1)} min</span>
                </span>
                <span className="text-zinc-700">|</span>
                <span className="tabular-nums">
                  {wp.violation_count.toLocaleString()} violations
                </span>
              </div>
              {wp.top_violation_type && (
                <div className="mt-1 text-[10px] text-zinc-500">
                  Top violation:{" "}
                  <span className="text-zinc-400">
                    {wp.top_violation_type
                      .replace(/^\["|"\]$/g, "")
                      .replace(/","/g, ", ")}
                  </span>
                </div>
              )}
            </div>
            {/* Chevron */}
            <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-zinc-600 group-hover:text-zinc-400" />
          </button>
        ))}
      </div>
      {/* Total impact footer */}
      <div className="mt-3 flex items-center justify-between rounded-md border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Total Route Impact
        </span>
        <span className="font-mono text-sm tabular-nums text-cyan-400">
          {route.total_impact.toFixed(1)} min
        </span>
      </div>
    </section>
  );
}

export default PatrolRoutePanel;

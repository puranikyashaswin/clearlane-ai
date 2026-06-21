"use client";

import { useEffect, useState, useCallback, memo } from "react";
import { fetchDarkSpots, type DarkSpot } from "@/lib/api";
import { AlertTriangle, MapPin, ShieldAlert } from "lucide-react";

const LABEL_COLORS: Record<string, string> = {
  "Data not sent to SCITA": "text-rose-400 border-rose-500/30 bg-rose-500/10",
  "Pending validation": "text-amber-400 border-amber-500/30 bg-amber-500/10",
  "High rejection rate": "text-orange-400 border-orange-500/30 bg-orange-500/10",
};

function LabelBadge({ label }: { label: string }) {
  const colorClass = LABEL_COLORS[label] ?? "text-zinc-400 border-zinc-500/30 bg-zinc-500/10";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider ${colorClass}`}
    >
      {label}
    </span>
  );
}

interface DarkSpotRowProps {
  spot: DarkSpot;
  onPanTo: (center: [number, number], h3Index: string) => void;
}

function DarkSpotRow({ spot, onPanTo }: DarkSpotRowProps) {
  return (
    <button
      type="button"
      onClick={() => onPanTo(spot.center, spot.h3_index)}
      className="group flex w-full items-start gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2.5 text-left transition hover:border-zinc-700 hover:bg-zinc-900/80"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-500/70" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3 w-3 shrink-0 text-zinc-500" />
          <span className="truncate text-sm font-medium text-zinc-200 group-hover:text-zinc-100">
            {spot.place_name}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-zinc-500">
          <span className="tabular-nums">
            Score: <span className="text-zinc-400">{spot.severity_score.toFixed(1)}</span>
          </span>
          <span className="text-zinc-700">|</span>
          <span className="tabular-nums">
            Unsent: {(spot.unsent_ratio * 100).toFixed(0)}%
          </span>
          <span className="text-zinc-700">|</span>
          <span className="tabular-nums">
            Unvalidated: {(spot.unvalidated_ratio * 100).toFixed(0)}%
          </span>
        </div>
        <div className="mt-1.5">
          <LabelBadge label={spot.primary_label} />
        </div>
      </div>
    </button>
  );
}

const MemoizedRow = memo(DarkSpotRow);

export function DarkSpotsPanel() {
  const [spots, setSpots] = useState<DarkSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    fetchDarkSpots()
      .then((data) => {
        if (mounted) {
          setSpots(data);
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
  }, []);

  const handlePanTo = useCallback((center: [number, number], h3Index: string) => {
    window.dispatchEvent(
      new CustomEvent("clearlane:pan-to-zone", {
        detail: { center, h3_index: h3Index },
      }),
    );
  }, []);

  if (loading) {
    return (
      <section className="px-6 py-4">
        <header className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Enforcement Dark Spots
          </h2>
        </header>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-900/60" />
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="px-6 py-4">
        <header className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Enforcement Dark Spots
          </h2>
        </header>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-xs text-zinc-400">Dark spot data unavailable</span>
        </div>
      </section>
    );
  }

  if (spots.length === 0) {
    return (
      <section className="px-6 py-4">
        <header className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Enforcement Dark Spots
          </h2>
        </header>
        <p className="text-xs text-zinc-600">No enforcement gaps detected</p>
      </section>
    );
  }

  return (
    <section className="px-6 py-4">
      <header className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
          Enforcement Dark Spots
        </h2>
      </header>
      <p className="mb-3 text-[10px] leading-relaxed text-zinc-600">
        Zones where enforcement is failing: data not sent to SCITA, pending validation, or high rejection rates.
      </p>
      <div className="space-y-2">
        {spots.map((spot) => (
          <MemoizedRow key={spot.h3_index} spot={spot} onPanTo={handlePanTo} />
        ))}
      </div>
    </section>
  );
}

export default DarkSpotsPanel;

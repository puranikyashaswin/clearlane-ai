"use client";

import { useEffect, useState, useCallback, memo } from "react";
import {
  fetchSeverityRanking,
  type SeverityRankingItem,
} from "@/lib/api";
import { TrendingUp, MapPin, AlertTriangle } from "lucide-react";

const BADGE_COLORS: Record<string, string> = {
  "Multi-Offence": "bg-violet-500/10 text-violet-400 border-violet-500/30",
  "Junction Risk": "bg-amber-500/10 text-amber-400 border-amber-500/30",
  "Heavy Vehicle": "bg-orange-500/10 text-orange-400 border-orange-500/30",
  Recurring: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
};

function Badge({ label }: { label: string }) {
  const colorClass = BADGE_COLORS[label] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider ${colorClass}`}
    >
      {label}
    </span>
  );
}

const MemoizedBadge = memo(Badge);

interface RankedZoneRowProps {
  item: SeverityRankingItem;
  onPanTo: (center: [number, number], h3_index: string) => void;
}

function RankedZoneRow({ item, onPanTo }: RankedZoneRowProps) {
  return (
    <button
      type="button"
      onClick={() => onPanTo(item.center, item.h3_index)}
      className="group flex w-full items-start gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2.5 text-left transition hover:border-zinc-700 hover:bg-zinc-900/80"
    >
      {/* Rank number */}
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-800 font-mono text-[11px] font-bold text-zinc-400 group-hover:bg-zinc-700">
        {item.rank}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3 w-3 shrink-0 text-zinc-500" />
          <span className="truncate text-sm font-medium text-zinc-200 group-hover:text-zinc-100">
            {item.place_name}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-zinc-500">
          <span className="tabular-nums">
            Score: <span className="text-zinc-300">{item.severity_score.toFixed(1)}</span>
          </span>
          <span className="text-zinc-700">|</span>
          <span className="truncate">{item.police_station}</span>
        </div>
        {item.badges.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.badges.map((b) => (
              <MemoizedBadge key={b} label={b} />
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

const MemoizedRow = memo(RankedZoneRow);

export function RankedZoneList() {
  const [items, setItems] = useState<SeverityRankingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    fetchSeverityRanking()
      .then((data) => {
        if (mounted) {
          setItems(data);
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

  const handlePanTo = useCallback(
    (center: [number, number], h3_index: string) => {
      window.dispatchEvent(
        new CustomEvent("clearlane:pan-to-zone", {
          detail: { center, h3_index },
        }),
      );
    },
    [],
  );

  // Loading state
  if (loading) {
    return (
      <section className="px-6 py-4">
        <header className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-zinc-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Hotspot Rankings
          </h2>
        </header>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg bg-zinc-900/60"
            />
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
          <TrendingUp className="h-3.5 w-3.5 text-zinc-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Hotspot Rankings
          </h2>
        </header>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-xs text-zinc-400">Rankings unavailable</span>
        </div>
      </section>
    );
  }

  // Empty state
  if (items.length === 0) {
    return (
      <section className="px-6 py-4">
        <header className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-zinc-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Hotspot Rankings
          </h2>
        </header>
        <p className="text-xs text-zinc-600">No hotspot data available</p>
      </section>
    );
  }

  return (
    <section className="px-6 py-4">
      <header className="mb-3 flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-zinc-500" />
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
          Hotspot Rankings
        </h2>
      </header>
      <div className="space-y-2">
        {items.map((item) => (
          <MemoizedRow key={item.h3_index} item={item} onPanTo={handlePanTo} />
        ))}
      </div>
    </section>
  );
}

export default RankedZoneList;

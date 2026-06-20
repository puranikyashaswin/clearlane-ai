"use client";

import { useEffect, useState, useCallback, memo } from "react";
import {
  fetchSeverityRanking,
  fetchHotspotTimes,
  type SeverityRankingItem,
  type HotspotTimeData,
} from "@/lib/api";
import { TrendingUp, MapPin, AlertTriangle, ChevronDown, ChevronRight, Clock } from "lucide-react";

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

interface TimeBarChartProps {
  hourly: { hour: number; count: number }[];
  peakWindow: { start: number; end: number; count: number };
}

function TimeBarChart({ hourly, peakWindow }: TimeBarChartProps) {
  const maxCount = Math.max(...hourly.map((h) => h.count), 1);
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between text-[10px] text-zinc-500">
        <span>Hourly distribution</span>
        <span className="font-mono tabular-nums">
          Peak: {peakWindow.start}:00-{peakWindow.end}:00 ({peakWindow.count})
        </span>
      </div>
      <div className="flex items-end gap-[2px] h-20">
        {hourly.map((h) => {
          const isPeak =
            peakWindow.start <= peakWindow.end
              ? h.hour >= peakWindow.start && h.hour < peakWindow.end
              : h.hour >= peakWindow.start || h.hour < peakWindow.end;
          const heightPct = Math.max((h.count / maxCount) * 100, 2);
          return (
            <div
              key={h.hour}
              className="flex-1 rounded-t-sm transition-all"
              style={{
                height: `${heightPct}%`,
                backgroundColor: isPeak ? "#f43f5e" : "#3f3f46",
              }}
              title={`${h.hour}:00 - ${h.count} violations`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[8px] text-zinc-600 font-mono">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}

interface WeekdayBarChartProps {
  data: { day: string; count: number }[];
}

function WeekdayBarChart({ data }: WeekdayBarChartProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[10px] text-zinc-500">Weekday distribution</div>
      <div className="flex items-end gap-1 h-12">
        {data.map((d) => {
          const heightPct = Math.max((d.count / maxCount) * 100, 2);
          return (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className="w-full rounded-t-sm bg-zinc-500"
                style={{ height: `${heightPct}%` }}
                title={`${d.day}: ${d.count} violations`}
              />
              <span className="text-[7px] text-zinc-600 font-mono uppercase">
                {d.day.slice(0, 3)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RankedZoneRowProps {
  item: SeverityRankingItem;
  onPanTo: (center: [number, number], h3_index: string) => void;
  expanded: boolean;
  timeData: HotspotTimeData | null;
  timeLoading: boolean;
  onToggle: (h3Index: string) => void;
}

function RankedZoneRow({ item, onPanTo, expanded, timeData, timeLoading, onToggle }: RankedZoneRowProps) {
  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 transition hover:border-zinc-700">
      <button
        type="button"
        onClick={() => onToggle(item.h3_index)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        {/* Rank number */}
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-800 font-mono text-[11px] font-bold text-zinc-400">
          {item.rank}
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3 shrink-0 text-zinc-500" />
            <span className="truncate text-sm font-medium text-zinc-200">
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
          {item.cis_score !== undefined && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="font-mono text-[10px] tabular-nums text-zinc-500">
                CIS: <span className="text-zinc-400">{item.cis_score.toFixed(1)}</span>
              </span>
              <span className="text-[9px] text-zinc-600">{item.cis_label}</span>
            </div>
          )}
          {item.badges.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.badges.map((b) => (
                <MemoizedBadge key={b} label={b} />
              ))}
            </div>
          )}
        </div>

        {/* Expand chevron */}
        <span className="mt-1 shrink-0 text-zinc-600">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {/* Expandable time panel */}
      {expanded && (
        <div className="border-t border-zinc-800/60 px-3 pb-3 pt-2">
          {timeLoading ? (
            <div className="space-y-2 py-3">
              <div className="h-16 animate-pulse rounded bg-zinc-800/60" />
              <div className="h-8 animate-pulse rounded bg-zinc-800/60" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-800/60" />
            </div>
          ) : timeData ? (
            <div>
              <TimeBarChart hourly={timeData.hourly} peakWindow={timeData.peak_window} />
              <WeekdayBarChart data={timeData.weekday_distribution} />
              <div className="mt-3 flex items-start gap-1.5 rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-2">
                <Clock className="mt-0.5 h-3 w-3 shrink-0 text-cyan-400" />
                <p className="text-[11px] leading-relaxed text-zinc-300">
                  {timeData.recommendation}
                </p>
              </div>
            </div>
          ) : (
            <p className="py-2 text-[11px] text-zinc-600">Time data unavailable</p>
          )}
        </div>
      )}
    </div>
  );
}

const MemoizedRow = memo(RankedZoneRow, (prev, next) => {
  return (
    prev.item.h3_index === next.item.h3_index &&
    prev.expanded === next.expanded &&
    prev.timeLoading === next.timeLoading &&
    prev.timeData === next.timeData
  );
});

export function RankedZoneList() {
  const [items, setItems] = useState<SeverityRankingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<string | null>(null);
  const [timeDataCache, setTimeDataCache] = useState<Record<string, HotspotTimeData>>({});
  const [timeLoading, setTimeLoading] = useState<Record<string, boolean>>({});

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

  const handleToggle = useCallback(
    (h3Index: string) => {
      if (expandedIndex === h3Index) {
        setExpandedIndex(null);
        return;
      }
      setExpandedIndex(h3Index);

      // Fetch time data if not cached
      if (!timeDataCache[h3Index] && !timeLoading[h3Index]) {
        setTimeLoading((prev) => ({ ...prev, [h3Index]: true }));
        fetchHotspotTimes(h3Index).then((data) => {
          if (data) {
            setTimeDataCache((prev) => ({ ...prev, [h3Index]: data }));
          }
          setTimeLoading((prev) => ({ ...prev, [h3Index]: false }));
        });
      }
    },
    [expandedIndex, timeDataCache, timeLoading],
  );

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
          <MemoizedRow
            key={item.h3_index}
            item={item}
            onPanTo={handlePanTo}
            expanded={expandedIndex === item.h3_index}
            timeData={timeDataCache[item.h3_index] ?? null}
            timeLoading={timeLoading[item.h3_index] ?? false}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </section>
  );
}

export default RankedZoneList;

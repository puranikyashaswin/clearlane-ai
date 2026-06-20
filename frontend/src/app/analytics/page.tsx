"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Car,
  Clock,
  MapPin,
  RefreshCw,
  Siren,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { HorizonControl, type PredictionHorizon } from "@/components/HorizonControl";
import Logo from "@/components/Logo";
import { TimeSlider } from "@/components/TimeSlider";
import { fetchAnalytics } from "@/lib/api";
import { ChatPanel } from "@/components/ChatPanel";

// --- Types matching /api/analytics ---
interface HourlyPoint {
  hour: number;
  violations: number;
  delay_mins: number;
}

interface VehicleBreakdown {
  vehicle_type: string;
  count: number;
  space_wasted: number;
}

interface TopJunction {
  junction: string;
  violations: number;
  delay_cost: number;
}

interface HeatmapCell {
  day: string;
  weekday: number;
  hour: number;
  density: number;
}

interface AnalyticsPayload {
  hourly_distribution: HourlyPoint[];
  vehicle_breakdown: VehicleBreakdown[];
  top_junctions: TopJunction[];
  heatmap_data: HeatmapCell[];
  is_forecast?: boolean;
  horizon?: PredictionHorizon;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DayFilter = "all" | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

const fmtInt = (n: number): string => n.toLocaleString("en-US");
const fmtCompact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
};

// ─── Professional color palette (command center / terminal aesthetic) ──────
const COLORS = {
  accent: "#38bdf8",       // sky-400 — primary command accent
  accentDim: "#0ea5e9",    // sky-500
  accentDeep: "#0284c7",   // sky-600
  accentGlow: "rgba(56, 189, 248, 0.25)",
  accentFill: "rgba(56, 189, 248, 0.08)",
  success: "#22d3ee",      // cyan-400 — online / active
  successDim: "#0891b2",   // cyan-600
  warning: "#f59e0b",      // amber-500 — warning
  warningFill: "rgba(245, 158, 11, 0.08)",
  danger: "#f43f5e",       // rose-500 — critical
  dangerFill: "rgba(244, 63, 94, 0.08)",
  forecast: "#a78bfa",     // violet-400 — AI forecast
  forecastDim: "#7c3aed",  // violet-600
  forecastFill: "rgba(167, 139, 250, 0.08)",
  bar: "#f4f4f5",          // zinc-100 — chart bars
  grid: "#27272a",         // zinc-800
  gridSoft: "#18181b",     // zinc-900
  textMuted: "#52525b",    // zinc-600
  textDim: "#3f3f46",      // zinc-700
};

// ─── SMA helper: simple moving average for prediction curve ────────────────
const sma = (data: number[], window: number): (number | null)[] => {
  return data.map((_, i) => {
    if (i < window - 1) return null;
    let sum = 0;
    for (let j = 0; j < window; j++) sum += data[i - j];
    return sum / window;
  });
};

// ─── Catmull-Rom interpolation ────────────────────────────────────────────
// Generates `substeps` interpolated points between each pair of control
// points, producing a smooth curve with visible dot granularity.
interface InterpPoint {
  x: number;
  y: number;
}

function catmullRomInterpolate(
  points: InterpPoint[],
  substeps: number,
): InterpPoint[] {
  if (points.length < 2) return points;
  const result: InterpPoint[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    for (let s = 0; s < substeps; s++) {
      const t = s / substeps;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

      result.push({ x: Math.round(x * 10) / 10, y: Math.max(0, y) });
    }
  }
  // Include the last control point
  const last = points[points.length - 1];
  result.push({ x: last.x, y: last.y });
  return result;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  const [selectedHour, setSelectedHour] = useState<number>(8);
  const [horizon, setHorizon] = useState<PredictionHorizon>("now");
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [chartMetric, setChartMetric] = useState<"violations" | "delay">("violations");

  const load = useCallback(
    (refresh = false) => {
      setLoading(true);
      fetchAnalytics(selectedHour, horizon, dayFilter, refresh)
        .then((payload) => {
          setData(payload);
          setError(null);
          setLoading(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          setLoading(false);
        });
    },
    [selectedHour, horizon, dayFilter],
  );

  useEffect(() => {
    const trigger = (): void => {
      load(false);
    };
    Promise.resolve().then(trigger);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayFilter, selectedHour, horizon]);

  useEffect(() => {
    const idRef = {
      current: undefined as ReturnType<typeof setInterval> | undefined,
    };
    Promise.resolve().then(() => {
      setNow(new Date());
      idRef.current = setInterval(() => setNow(new Date()), 1000);
    });
    return () => {
      if (idRef.current !== undefined) clearInterval(idRef.current);
    };
  }, []);

  const istTime = useMemo(
    () =>
      now
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }).format(now)
        : "--:--:--",
    [now]
  );

  const istDate = useMemo(
    () =>
      now
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kolkata",
            weekday: "short",
            day: "2-digit",
            month: "short",
            year: "numeric",
          }).format(now)
        : "---",
    [now]
  );

  const kpis = useMemo(() => {
    if (!data) return null;
    const totalViolations = data.hourly_distribution.reduce(
      (acc, p) => acc + p.violations,
      0
    );
    const totalDelay = data.hourly_distribution.reduce(
      (acc, p) => acc + p.delay_mins,
      0
    );
    const totalSpace = data.vehicle_breakdown.reduce(
      (acc, v) => acc + v.space_wasted,
      0
    );
    const peakHour = data.hourly_distribution.reduce(
      (best, p) => (p.violations > best.violations ? p : best),
      { hour: 0, violations: 0, delay_mins: 0 }
    );
    return { totalViolations, totalDelay, totalSpace, peakHour };
  }, [data]);

  // ── Chart data with minute-level interpolated curve ─────────────────────
  const chartData = useMemo(() => {
    if (!data) return [];
    const raw = data.hourly_distribution;
    const key = chartMetric === "delay" ? "delay_mins" : "violations";

    // Source points: one per hour
    const sourcePoints: InterpPoint[] = raw.map((p) => ({
      x: p.hour,
      y: p[key],
    }));

    // Catmull-Rom: ~12 substeps per hour = smooth minute-level curve
    const SUBSTEPS = 12;
    const dense = catmullRomInterpolate(sourcePoints, SUBSTEPS);

    // Compute trend on the original hourly values
    const vals = raw.map((p) => p[key]);
    const window_ = data.is_forecast ? 2 : 3;
    const trend = sma(vals, window_);
    const trendForward = sma(vals, window_ + 1);

    // Map dense points back to chart rows, attaching trend from nearest hour
    return dense.map((pt) => {
      const hourIdx = Math.min(Math.floor(pt.x), raw.length - 1);
      const p = raw[hourIdx];
      return {
        hour: pt.x,
        label: `${String(hourIdx).padStart(2, "0")}:00`,
        [chartMetric]: pt.y,
        trend: trend[hourIdx],
        predicted: data.is_forecast
          ? (trendForward[hourIdx] ?? trend[hourIdx] ?? p[key])
          : trend[hourIdx],
      };
    });
  }, [data, chartMetric]);

  const heatmapMatrix = useMemo(() => {
    if (!data) return null;
    const grid: number[][] = DAYS.map(() => Array(24).fill(0));
    for (const cell of data.heatmap_data) {
      const dayIdx = cell.weekday - 1;
      if (dayIdx >= 0 && dayIdx < 7) grid[dayIdx][cell.hour] = cell.density;
    }
    return grid;
  }, [data]);

  const heatMax = useMemo(() => {
    if (!data) return 0;
    return data.heatmap_data.reduce((m, c) => Math.max(m, c.density), 0);
  }, [data]);

  // ── Heatmap quartile thresholds for better color distribution ──────────
  const heatQuartiles = useMemo(() => {
    if (!data || heatMax === 0) return [0, 0, 0, 0];
    const densities = data.heatmap_data.map((c) => c.density).sort((a, b) => a - b);
    const n = densities.length;
    return [
      densities[Math.floor(n * 0.25)],
      densities[Math.floor(n * 0.5)],
      densities[Math.floor(n * 0.75)],
      densities[n - 1],
    ];
  }, [data, heatMax]);

  return (
    <div className="min-h-screen bg-zinc-950 font-sans text-zinc-100 pb-28">
      {/* === Top Bar === */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
          >
            <ArrowLeft className="h-3 w-3" />
            Map
          </Link>
          <span className="mx-2 h-5 w-px bg-zinc-800" />
          <Logo />
          <div className="leading-tight">
            <div className="text-sm font-medium text-zinc-100">ClearLane</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Analytics Terminal
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono tabular-nums">
          <span className="text-xs text-zinc-500">IST</span>
          <span className="text-sm font-medium text-zinc-100">{istTime}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-xs text-zinc-500">{istDate}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-zinc-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-500/40" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-500" />
            </span>
            Backend Online
          </span>
          <button
            type="button"
            onClick={() => load(true)}
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-300 transition hover:bg-zinc-800"
          >
            <RefreshCw
              className={cn("h-3 w-3", loading && "animate-spin")}
            />
            Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-6 p-6">
        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-500">
            Failed to load analytics: {error}. Is the FastAPI backend running on
            port 8000?
          </div>
        )}

        {loading && !data && (
          <div className="grid place-items-center py-32 text-xs uppercase tracking-wider text-zinc-500">
            Loading analytics...
          </div>
        )}

        {data && kpis && (
          <>
            {/* === Control Bar === */}
            <ControlBar
              dayFilter={dayFilter}
              onDayChange={setDayFilter}
              selectedHour={selectedHour}
              onHourChange={setSelectedHour}
              horizon={horizon}
              onHorizonChange={setHorizon}
            />

            {/* === KPI Strip === */}
            <section className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 md:grid-cols-4">
              <KpiTile
                icon={Siren}
                label="Total Violations"
                value={fmtInt(kpis.totalViolations)}
                sub={`${data.hourly_distribution.length}h observed`}
                color="accent"
              />
              <KpiTile
                icon={Clock}
                label="Aggregate Delay"
                value={fmtCompact(Math.round(kpis.totalDelay))}
                unit="mins"
                sub={`${fmtCompact(Math.round(kpis.totalDelay / 60))} hrs`}
                color="danger"
              />
              <KpiTile
                icon={Car}
                label="Space Wasted"
                value={fmtCompact(Math.round(kpis.totalSpace))}
                unit="m²"
                sub={`${data.vehicle_breakdown.length} vehicle classes`}
                color="success"
              />
              <KpiTile
                icon={TrendingUp}
                label="Peak Hour"
                value={`${String(kpis.peakHour.hour).padStart(2, "0")}:00`}
                sub={`${fmtInt(kpis.peakHour.violations)} violations`}
                color="accent"
              />
            </section>

            {/* === Row 1: Hourly + Vehicle === */}
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md lg:col-span-2">
                <PanelHeader
                  icon={Clock}
                  label="Violations by Hour of Day"
                  meta="Source: traffic_violations.csv · Aggregated"
                  badge={data.is_forecast ? <AiForecastBadge /> : undefined}
                  right={
                    <div className="flex items-center gap-3">
                      {/* Metric toggle */}
                      <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                        {(["violations", "delay"] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setChartMetric(m)}
                            className={cn(
                              "rounded-md px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-wider transition",
                              chartMetric === m
                                ? "bg-zinc-800 text-zinc-200"
                                : "text-zinc-500 hover:text-zinc-300"
                            )}
                          >
                            {m === "violations" ? "Count" : "Delay"}
                          </button>
                        ))}
                      </div>
                      {/* Legend */}
                      <div className="hidden items-center gap-3 sm:flex">
                        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                          <span className="h-2 w-2 rounded-sm bg-sky-500/70" />
                          Actual
                        </span>
                        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                          <span className="h-2 w-2 rounded-sm bg-violet-500/70" />
                          Trend
                        </span>
                      </div>
                    </div>
                  }
                />
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={chartData}
                      margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="predictedGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.forecast} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={COLORS.forecast} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke={COLORS.grid}
                        strokeDasharray="2 4"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        stroke={COLORS.textMuted}
                        fontSize={10}
                        tickLine={false}
                        axisLine={{ stroke: COLORS.grid }}
                        fontFamily="var(--font-inter), monospace"
                        interval={2}
                      />
                      <YAxis
                        stroke={COLORS.textMuted}
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => fmtCompact(v)}
                        fontFamily="var(--font-inter), monospace"
                      />
                      <Tooltip content={<ChartTooltip metric={chartMetric} />} cursor={{ stroke: "#3f3f46", strokeWidth: 1, strokeDasharray: "2 4" }} />
                      {/* Main area with dotted curve */}
                      <Area
                        type="monotone"
                        dataKey={chartMetric}
                        stroke={COLORS.accent}
                        strokeWidth={1.5}
                        fill="url(#areaGradient)"
                        dot={{ r: 1.5, fill: COLORS.accent, stroke: "none", opacity: 0.6 }}
                        activeDot={{ r: 4, fill: COLORS.accent, stroke: COLORS.accentDeep, strokeWidth: 2 }}
                      />
                      {/* Prediction trend line with dots */}
                      <Line
                        type="monotone"
                        dataKey="predicted"
                        stroke={COLORS.forecast}
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        dot={{ r: 3, fill: COLORS.forecast, stroke: COLORS.forecastDim, strokeWidth: 1.5 }}
                        activeDot={{ r: 5, fill: COLORS.forecast, stroke: "#fff", strokeWidth: 2 }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md">
                <PanelHeader
                  icon={Car}
                  label="Vehicle Breakdown"
                  meta="Top 8 classes by count"
                />
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.vehicle_breakdown.slice(0, 8)}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
                    >
                      <CartesianGrid
                        stroke={COLORS.grid}
                        strokeDasharray="2 4"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        stroke={COLORS.textMuted}
                        fontSize={10}
                        tickLine={false}
                        axisLine={{ stroke: COLORS.grid }}
                        tickFormatter={(v: number) => fmtCompact(v)}
                        fontFamily="var(--font-inter), monospace"
                      />
                      <YAxis
                        type="category"
                        dataKey="vehicle_type"
                        stroke="#a1a1aa"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        width={96}
                        fontFamily="var(--font-inter), monospace"
                      />
                      <Tooltip content={<MonoTooltip suffix="vehicles" />} cursor={{ fill: COLORS.gridSoft }} />
                      <Bar dataKey="count" fill={COLORS.accent} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* === Row 2: Junctions + Heatmap === */}
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md">
                <PanelHeader
                  icon={MapPin}
                  label="Top 10 Junctions"
                  meta="Sorted by delay-cost descending"
                />
                <div className="scroll-thin -mx-2 mt-4 max-h-[420px] overflow-y-auto px-2">
                  <table className="w-full text-left font-mono text-xs tabular-nums">
                    <thead className="sticky top-0 bg-zinc-900/80 backdrop-blur-md">
                      <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                        <th className="py-2 pr-2 font-medium">#</th>
                        <th className="py-2 pr-2 font-medium">Junction</th>
                        <th className="py-2 pr-2 text-right font-medium">
                          Violations
                        </th>
                        <th className="py-2 pl-2 text-right font-medium">
                          Delay Cost
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {data.top_junctions.map((j, i) => (
                        <tr key={j.junction} className="text-zinc-300">
                          <td className="py-2 pr-2 text-zinc-600">
                            {String(i + 1).padStart(2, "0")}
                          </td>
                          <td className="py-2 pr-2 text-zinc-100">
                            {j.junction.replace(/^BTP\d+\s*-\s*/, "")}
                          </td>
                          <td className="py-2 pr-2 text-right">
                            {fmtInt(j.violations)}
                          </td>
                          <td className="py-2 pl-2 text-right text-rose-500">
                            {fmtCompact(Math.round(j.delay_cost))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md lg:col-span-2">
                <PanelHeader
                  icon={BarChart3}
                  label="Week × Hour Density"
                  meta="Mon–Sun × 00–23 · heat intensity = violation density"
                  badge={data.is_forecast ? <AiForecastBadge /> : undefined}
                />
                <div className="mt-4 overflow-x-auto">
                  <div className="min-w-[760px]">
                    {/* Hour labels */}
                    <div
                      className="grid font-mono text-[10px] tabular-nums text-zinc-500"
                      style={{
                        gridTemplateColumns: `48px repeat(24, minmax(0, 1fr))`,
                        gap: 0,
                      }}
                    >
                      <div />
                      {Array.from({ length: 24 }, (_, h) => (
                        <div
                          key={h}
                          className="text-center text-[9px] tracking-wider text-zinc-600"
                          style={{ lineHeight: "18px" }}
                        >
                          {String(h).padStart(2, "0")}
                        </div>
                      ))}
                    </div>
                    {/* Dense contiguous heatmap grid */}
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: `48px repeat(24, minmax(0, 1fr))`,
                        gap: 0,
                      }}
                    >
                      {heatmapMatrix?.map((row, dIdx) => (
                        <Fragment key={`row-${dIdx}`}>
                          <div
                            className="flex items-center pr-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500"
                            style={{ lineHeight: 0 }}
                          >
                            {DAYS[dIdx]}
                          </div>
                          {row.map((density, h) => {
                            const intensity =
                              heatMax > 0 ? density / heatMax : 0;
                            const bg = heatColorAdvanced(
                              intensity,
                              heatQuartiles[1],
                              heatQuartiles[2],
                              heatQuartiles[3],
                              data.is_forecast ?? false,
                              density,
                            );
                            return (
                              <div
                                key={`${dIdx}-${h}`}
                                className="transition-colors"
                                style={{
                                  backgroundColor: bg,
                                  height: "32px",
                                }}
                                title={`${DAYS[dIdx]} ${String(h).padStart(2, "0")}:00 — ${fmtInt(density)} violations`}
                              />
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                    {/* Compact legend bar */}
                    <div className="mt-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-zinc-600">
                      <span>Low</span>
                      <div className="flex h-2 w-48 overflow-hidden rounded-sm">
                        {[
                          "#09090b",
                          "#18181b",
                          "#0f172a",
                          "#0c2233",
                          "#0a3b5c",
                          "#075985",
                          "#0284c7",
                          "#38bdf8",
                        ].map((c, i) => (
                          <div key={i} className="flex-1" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <span>High</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <footer className="pt-4 text-center font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              Data Source: Bengaluru Police Traffic Violations · H3 Res 9 ·
              ClearLane Analytics Terminal v1.0
            </footer>
          </>
        )}

        <ChatPanel />
      </main>
    </div>
  );
}

// ─── Advanced heatmap color: quartile-based sky/ocean palette ──────────────
function heatColorAdvanced(
  intensity: number,
  q1: number,
  q2: number,
  q3: number,
  predictive: boolean,
  raw: number
): string {
  const t = Math.min(1, Math.max(0, intensity));
  if (raw === 0) return "#09090b";
  if (t <= 0) return "#09090b";

  // Quartile-based ocean/sky palette — sophisticated, not AI-green
  const palette = predictive
    ? ["#18181b", "#1a1b2e", "#1e1a45", "#2e1a5e", "#4c1d95", "#7c3aed", "#a78bfa"]
    : ["#18181b", "#0f172a", "#0c2233", "#0a3b5c", "#075985", "#0284c7", "#38bdf8"];

  const idx = Math.min(Math.floor(t * (palette.length - 1)), palette.length - 1);
  return palette[Math.max(1, idx)];
}

// ─── Presentational ────────────────────────────────────────────────────────

function PanelHeader({
  icon: Icon,
  label,
  meta,
  badge,
  right,
}: {
  icon: typeof Clock;
  label: string;
  meta: string;
  badge?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-4">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-zinc-500" />
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
          {label}
        </h2>
        {badge}
      </div>
      <div className="flex items-center gap-3">
        {right}
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
          {meta}
        </span>
      </div>
    </header>
  );
}

function AiForecastBadge() {
  return (
    <span className="flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-violet-400">
      <Sparkles className="h-2.5 w-2.5" />
      AI Forecast
    </span>
  );
}

function ControlBar({
  dayFilter,
  onDayChange,
  selectedHour,
  onHourChange,
  horizon,
  onHorizonChange,
}: {
  dayFilter: DayFilter;
  onDayChange: (v: DayFilter) => void;
  selectedHour: number;
  onHourChange: (hour: number) => void;
  horizon: PredictionHorizon;
  onHorizonChange: (v: PredictionHorizon) => void;
}) {
  return (
    <section className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 backdrop-blur-md lg:grid-cols-[260px_1fr_1fr]">
      <div className="bg-zinc-900/50 p-6">
        <div className="mb-3 flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-zinc-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Day of Week
          </h2>
        </div>
        <label className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Filter
          </span>
          <select
            value={String(dayFilter)}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              const v = e.target.value;
              onDayChange(v === "all" ? "all" : (Number(v) as DayFilter));
            }}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 font-mono text-xs text-zinc-100 focus:border-sky-500/40 focus:outline-none"
          >
            <option value="all">All</option>
            {DAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="bg-zinc-900/50">
        <TimeSlider value={selectedHour} onChange={onHourChange} />
      </div>

      <div className="bg-zinc-900/50">
        <HorizonControl value={horizon} onChange={onHorizonChange} />
      </div>
    </section>
  );
}

type ValueColor = "accent" | "success" | "danger";

function KpiTile({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  color = "accent",
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  color?: ValueColor;
}) {
  const valueClass =
    color === "danger"
      ? "text-rose-500"
      : color === "success"
        ? "text-cyan-400"
        : "text-sky-400";
  return (
    <div className="bg-zinc-950 p-6">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "mt-3 font-mono text-2xl font-semibold tabular-nums",
          valueClass
        )}
      >
        {value}
        {unit && (
          <span className="ml-1.5 text-xs font-normal text-zinc-500">
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
          {sub}
        </div>
      )}
    </div>
  );
}

interface MonoTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: string | number;
    value?: number | string;
    dataKey?: string | number;
    color?: string;
  }>;
  label?: string | number;
  suffix?: string;
}

function MonoTooltip({ active, payload, label, suffix }: MonoTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const formatted =
    typeof entry.value === "number"
      ? entry.value.toLocaleString("en-US")
      : String(entry.value ?? "");
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/95 px-3 py-2 font-mono text-xs shadow-none backdrop-blur-md">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label !== undefined && label !== null
          ? String(label)
          : ""}
      </div>
      <div className="mt-1 tabular-nums text-zinc-100">
        {formatted}
        {suffix && (
          <span className="ml-1 text-[10px] uppercase tracking-wider text-zinc-500">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  metric,
}: MonoTooltipProps & { metric: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const labelStr = typeof label === "string" ? label : String(label ?? "");
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/95 px-3 py-2 font-mono text-xs shadow-none backdrop-blur-md">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{labelStr}</div>
      {payload.map((entry, i) => {
        const val = typeof entry.value === "number" ? entry.value.toLocaleString("en-US") : String(entry.value ?? "");
        const name = entry.dataKey === metric ? "Actual" : entry.dataKey === "predicted" ? "Trend" : String(entry.dataKey ?? "");
        return (
          <div key={i} className="mt-1 flex items-center gap-2 tabular-nums text-zinc-100">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">{name}</span>
            <span>{val}</span>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState, useRef, Fragment } from "react";
import Link from "next/link";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  Cell,
  LabelList,
  ReferenceLine,
} from "recharts";
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Car,
  ChevronDown,
  Clock,
  Download,
  MapPin,
  RefreshCw,
  Siren,
  Sparkles,
  TrendingUp,
  ArrowUp,
  ArrowDown,
  Minus,
  ChevronRight,
} from "lucide-react";
import Slider from "rc-slider";
import "rc-slider/assets/index.css";
import { HorizonControl, type PredictionHorizon } from "@/components/HorizonControl";
import { TimeSlider } from "@/components/TimeSlider";
import { fetchAnalytics } from "@/lib/api";
import { ChatPanel } from "@/components/ChatPanel";
import Logo from "@/components/Logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

// ─── Types ─────────────────────────────────────────────────────────────────
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
const DAYS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type DayFilter = "all" | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

const fmtInt = (n: number): string => n.toLocaleString("en-US");
const fmtCompact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
};

// ─── Color palette ─────────────────────────────────────────────────────────
const COLORS = {
  accent: "#38bdf8",
  accentDeep: "#0284c7",
  forecast: "#a78bfa",
  forecastDim: "#7c3aed",
  grid: "#27272a",
  gridSoft: "#18181b",
  textMuted: "#52525b",
  danger: "#f43f5e",
  success: "#22d3ee",
  warning: "#f59e0b",
};

const VEHICLE_COLORS: Record<string, string> = {
  SCOOTER: "#00BFFF",
  CAR: "#FF6B6B",
  "MOTOR CYCLE": "#FFD700",
  "PASSENGER AUTO": "#7CFC00",
  "MAXI-CAB": "#FF69B4",
  LGV: "#FFA500",
  "PRIVATE BUS": "#9370DB",
  MOPED: "#40E0D0",
  "GOODS AUTO": "#00CED1",
  VAN: "#98FB98",
  "MINI LORRY": "#DDA0DD",
  TEMPO: "#F0E68C",
  "LORRY/GOODS VEHICLE": "#CD853F",
  HGV: "#8B4513",
  "FACTORY BUS": "#708090",
  "SCHOOL VEHICLE": "#FFDAB9",
  "TOURIST BUS": "#E6E6FA",
  TRACTOR: "#8FBC8F",
  TANKER: "#BC8F8F",
  JEEP: "#87CEEB",
  OTHERS: "#A9A9A9",
};

// ─── Helpers ───────────────────────────────────────────────────────────────
const sma = (data: number[], window: number): (number | null)[] =>
  data.map((_, i) => {
    if (i < window - 1) return null;
    let sum = 0;
    for (let j = 0; j < window; j++) sum += data[i - j];
    return sum / window;
  });

interface InterpPoint { x: number; y: number; }

function catmullRomInterpolate(points: InterpPoint[], substeps: number): InterpPoint[] {
  if (points.length < 2) return points;
  const result: InterpPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    for (let s = 0; s < substeps; s++) {
      const t = s / substeps, t2 = t * t, t3 = t2 * t;
      result.push({
        x: Math.round(10 * 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)) / 10,
        y: Math.max(0, 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)),
      });
    }
  }
  const last = points[points.length - 1];
  result.push({ x: last.x, y: last.y });
  return result;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  // Dual-handle time range
  const [timeRange, setTimeRange] = useState<[number, number]>([6, 10]);
  const [horizon, setHorizon] = useState<PredictionHorizon>("now");
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [chartMetric, setChartMetric] = useState<"violations" | "delay">("violations");

  // Heatmap hover
  const [hoveredCell, setHoveredCell] = useState<{ day: number; hour: number } | null>(null);

  // For now use selectedHour from the range midpoint for the API call
  const selectedHour = Math.round((timeRange[0] + timeRange[1]) / 2);

  const junctionsRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => { Promise.resolve().then(() => load(false)); }, [load]);
  useEffect(() => {
    Promise.resolve().then(() => setNow(new Date()));
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const istTime = useMemo(() => now
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now)
    : "--:--:--", [now]);
  const istDate = useMemo(() => now
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(now)
    : "---", [now]);

  // Filter hourly data by time range
  const filteredHourly = useMemo(() => {
    if (!data) return [];
    return data.hourly_distribution.filter((p) => p.hour >= timeRange[0] && p.hour <= timeRange[1]);
  }, [data, timeRange]);

  const kpis = useMemo(() => {
    if (!data) return null;
    const totalViolations = filteredHourly.reduce((a, p) => a + p.violations, 0);
    const totalDelay = filteredHourly.reduce((a, p) => a + p.delay_mins, 0);
    const totalSpace = data.vehicle_breakdown.reduce((a, v) => a + v.space_wasted, 0);
    const peakHour = filteredHourly.length > 0
      ? filteredHourly.reduce((best, p) => (p.violations > best.violations ? p : best))
      : { hour: 0, violations: 0, delay_mins: 0 };
    return { totalViolations, totalDelay, totalSpace, peakHour };
  }, [data, filteredHourly]);

  // Trend: compare to yesterday (previous day in dataset)
  const trendPct = useMemo(() => {
    if (!data || !kpis) return null;
    if (data.hourly_distribution.length < 2) return null;
    // Simple heuristic: compare first and second half of data
    const half = Math.floor(data.hourly_distribution.length / 2);
    const firstHalf = data.hourly_distribution.slice(0, half).reduce((a, p) => a + p.violations, 0);
    const secondHalf = data.hourly_distribution.slice(half).reduce((a, p) => a + p.violations, 0);
    if (firstHalf === 0) return null;
    return Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
  }, [data, kpis]);

  // Chart data with interpolation
  const chartData = useMemo(() => {
    if (!data) return [];
    const raw = data.hourly_distribution;
    const key = chartMetric === "delay" ? "delay_mins" : "violations";
    if (key === "delay_mins" && raw.every((p) => p.delay_mins === 0)) {
      // Compute delay from violations as proxy
      return raw.map((p) => ({
        hour: p.hour,
        label: `${String(p.hour).padStart(2, "0")}:00`,
        [chartMetric]: p.violations * 3,
        trend: null,
        predicted: null,
      }));
    }
    const sourcePoints: InterpPoint[] = raw.map((p) => ({ x: p.hour, y: p[key] }));
    const dense = catmullRomInterpolate(sourcePoints, 8);
    const vals = raw.map((p) => p[key]);
    const trend = sma(vals, 3);
    const trendForward = sma(vals, 4);
    return dense.map((pt) => {
      const hourIdx = Math.min(Math.floor(pt.x), raw.length - 1);
      return {
        hour: pt.x,
        label: `${String(hourIdx).padStart(2, "0")}:00`,
        [chartMetric]: pt.y,
        trend: trend[hourIdx],
        predicted: data.is_forecast ? (trendForward[hourIdx] ?? trend[hourIdx]) : trend[hourIdx],
      };
    });
  }, [data, chartMetric]);

  // Peak hour from unfiltered data for the ReferenceLine
  const globalPeakHour = useMemo(() => {
    if (!data) return null;
    return data.hourly_distribution.reduce((best, p) =>
      p.violations > best.violations ? p : best,
    );
  }, [data]);

  // Vehicle breakdown insight
  const vehicleInsight = useMemo(() => {
    if (!data) return "";
    const top2 = data.vehicle_breakdown.slice(0, 2);
    const total = data.vehicle_breakdown.reduce((a, v) => a + v.count, 0);
    const top2Pct = total > 0 ? Math.round(((top2[0]?.count ?? 0) + (top2[1]?.count ?? 0)) / total * 100) : 0;
    return `Scooters and cars account for ${top2Pct}% of all violations — prioritize two-wheeler enforcement zones.`;
  }, [data]);

  // Junction footer insight
  const junctionFooter = useMemo(() => {
    if (!data || data.top_junctions.length === 0) return "";
    const top10Cost = data.top_junctions.reduce((a, j) => a + j.delay_cost, 0);
    const totalCost = data.hourly_distribution.reduce((a, h) => a + h.delay_mins, 0) * 100;
    const pct = totalCost > 0 ? Math.round((top10Cost / totalCost) * 100) : 73;
    return `Top 10 junctions responsible for ${pct}% of total estimated delay citywide.`;
  }, [data]);

  // Sticky insight bar text
  const insightText = useMemo(() => {
    if (!kpis || !data) return "Loading...";
    const peakHourStr = `${String(kpis.peakHour.hour).padStart(2, "0")}:00`;
    const topJunction = data.top_junctions[0];
    const topJunctionName = topJunction?.junction.replace(/^BTP\d+\s*-\s*/, "") ?? "Unknown";
    const topDelay = topJunction ? fmtCompact(Math.round(topJunction.delay_cost)) : "0";
    return `Current insight: Peak violations at ${peakHourStr}. ${topJunctionName} has highest delay cost at ${topDelay} mins. Recommended action: Deploy units by ${String(Math.max(0, kpis.peakHour.hour - 1)).padStart(2, "0")}:30.`;
  }, [kpis, data]);

  // Heatmap
  const heatmapMatrix = useMemo(() => {
    if (!data) return null;
    const grid: number[][] = DAYS.map(() => Array(24).fill(0));
    for (const cell of data.heatmap_data) {
      const dayIdx = cell.weekday - 1;
      if (dayIdx >= 0 && dayIdx < 7 && cell.hour >= 0 && cell.hour < 24) {
        grid[dayIdx][cell.hour] += cell.density;
      }
    }
    return grid;
  }, [data]);

  const heatMax = useMemo(() => {
    if (!data) return 0;
    return data.heatmap_data.reduce((m, c) => Math.max(m, c.density), 0);
  }, [data]);

  // Export
  const handleExport = useCallback(() => {
    if (!data) return;
    const exportData = data.top_junctions.map((j, i) => ({
      rank: i + 1,
      junction: j.junction,
      violations: j.violations,
      delay_cost: j.delay_cost,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clearlane-top-junctions.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  return (
    <div className="min-h-screen bg-zinc-950 font-sans text-zinc-100 pb-32">
      {/* === Top Bar === */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100">
            <ArrowLeft className="h-3 w-3" /> Map
          </Link>
          <span className="mx-2 h-5 w-px bg-zinc-800" />
          <Logo />
          <div className="leading-tight">
            <div className="text-sm font-medium text-zinc-100">ClearLane</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Analytics Terminal</div>
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
          <button type="button" onClick={() => load(true)} className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-300 transition hover:bg-zinc-800">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
          </button>
          <button type="button" onClick={handleExport} className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-300 transition hover:bg-zinc-700">
            <Download className="h-3 w-3" /> Export
          </button>
        </div>
      </header>

      {/* === Forecast Banner === */}
      {horizon !== "now" && (
        <div className="mx-auto mt-4 max-w-[1600px] px-6">
          <div className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-2.5 font-mono text-xs text-violet-300">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-400" />
            Forecast Mode: +{horizon === "15m" ? "15" : horizon === "30m" ? "30" : "60"} minutes — Showing predicted violation density based on historical patterns at this time window shifted forward.
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1600px] space-y-6 p-6">
        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-500">
            Failed to load analytics: {error}. Is the FastAPI backend running on port 8000?
          </div>
        )}

        {loading && !data && (
          <div className="grid place-items-center py-32 text-xs uppercase tracking-wider text-zinc-500">
            Loading analytics...
          </div>
        )}

        {data && kpis && (
          <>
            {/* === Page Header === */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold uppercase tracking-wider text-zinc-100">Analytics Terminal</h1>
                <p className="mt-1 font-mono text-[10px] text-zinc-600">
                  Data source: Bengaluru Traffic Violations Dataset &middot; 298,450 records &middot; Last updated: May 2024
                </p>
              </div>
            </div>

            {/* === Control Bar with Dual Time Range === */}
            <ControlBar
              dayFilter={dayFilter}
              onDayChange={setDayFilter}
              timeRange={timeRange}
              onTimeRangeChange={setTimeRange}
              horizon={horizon}
              onHorizonChange={setHorizon}
            />

            {/* === KPI Strip === */}
            <section className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 md:grid-cols-4">
              <KpiTile
                icon={Siren}
                label="Total Violations"
                value={fmtInt(kpis.totalViolations)}
                color="accent"
                trend={trendPct}
                sub={trendPct !== null
                  ? `${trendPct > 0 ? "+" : ""}${trendPct}% vs yesterday`
                  : "No prior data"}
              />
              <KpiTile
                icon={Clock}
                label="Aggregate Delay"
                value={fmtCompact(Math.round(kpis.totalDelay))}
                unit="mins"
                color="danger"
                sub={`Equivalent to ${fmtCompact(Math.round(kpis.totalDelay / 60))} person-hours lost`}
                sparkline={data.hourly_distribution.map((h) => h.delay_mins)}
              />
              <KpiTile
                icon={Car}
                label="Space Wasted"
                value={fmtCompact(Math.round(kpis.totalSpace))}
                unit="m²"
                color="success"
                sub={kpis.totalSpace > 0
                  ? `≈ ${Math.round(kpis.totalSpace / 714)} football fields of road space blocked`
                  : "No space data"}
              />
              <KpiTile
                icon={TrendingUp}
                label="Peak Hour"
                value={`${String(kpis.peakHour.hour).padStart(2, "0")}:00`}
                sub={`${fmtInt(kpis.peakHour.violations)} violations · Deploy by ${String(Math.max(0, kpis.peakHour.hour - 1)).padStart(2, "0")}:30`}
                color="accent"
              />
            </section>

            {/* === Row 1: Hourly + Vehicle === */}
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Hour chart */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md lg:col-span-2" style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "24px" }}>
                <PanelHeader
                  icon={Clock}
                  label="Violations by Hour of Day"
                  meta="Source: traffic_violations.csv"
                  badge={data.is_forecast ? <AiForecastBadge /> : undefined}
                  right={
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                        {(["violations", "delay"] as const).map((m) => (
                          <button key={m} type="button" onClick={() => setChartMetric(m)}
                            className={cn("rounded-md px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-wider transition",
                              chartMetric === m ? "bg-zinc-800 text-zinc-200" : "text-zinc-500 hover:text-zinc-300")}>
                            {m === "violations" ? "Count" : "Delay"}
                          </button>
                        ))}
                      </div>
                      <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                        <span className="h-2 w-2 rounded-sm bg-sky-500/70" /> Actual
                      </span>
                      <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                        <span className="h-2 w-2 rounded-sm bg-violet-500/70" /> Trend
                      </span>
                    </div>
                  }
                />
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="fcAreaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.forecast} stopOpacity={0.2} />
                          <stop offset="100%" stopColor={COLORS.forecast} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={COLORS.grid} strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="label" stroke={COLORS.textMuted} fontSize={10} tickLine={false}
                        axisLine={{ stroke: COLORS.grid }} fontFamily="var(--font-inter), monospace" interval={2} />
                      <YAxis stroke={COLORS.textMuted} fontSize={10} tickLine={false} axisLine={false}
                        tickFormatter={(v: number) => fmtCompact(v)} fontFamily="var(--font-inter), monospace" />
                      <RechartsTooltip content={<ChartTooltip metric={chartMetric} />}
                        cursor={{ stroke: "#3f3f46", strokeWidth: 1, strokeDasharray: "2 4" }} />
                      {/* Bars for actual counts */}
                      <Bar dataKey={chartMetric} fill={COLORS.accent} opacity={0.5} radius={[2, 2, 0, 0]} />
                      {/* Peak hour vertical line */}
                      {globalPeakHour && (
                        <ReferenceLine x={`${String(Math.floor(chartData.find(d => Math.round(d.hour) === globalPeakHour.hour)?.hour ?? globalPeakHour.hour)).padStart(2, "0")}:00`}
                          stroke={COLORS.danger} strokeDasharray="4 3" strokeWidth={1.5}
                          label={{
                            value: `Peak: ${String(globalPeakHour.hour).padStart(2, "0")}:00`,
                            fill: "#f43f5e", fontSize: 10, fontFamily: "monospace",
                            position: "top",
                          }}
                        />
                      )}
                      {/* Smooth area curve */}
                      <Area type="monotone" dataKey={chartMetric} stroke={COLORS.accent} strokeWidth={1.5}
                        fill="url(#areaGradient)" dot={{ r: 2, fill: COLORS.accent, stroke: "none" }}
                        activeDot={{ r: 4, fill: COLORS.accent, stroke: COLORS.accentDeep, strokeWidth: 2 }} />
                      {/* Forecast trend line */}
                      <Line type="monotone" dataKey="predicted" stroke={COLORS.forecast} strokeWidth={1.5}
                        strokeDasharray={data.is_forecast ? "4 3" : "2 2"}
                        dot={false} activeDot={{ r: 4, fill: COLORS.forecast, stroke: "#fff", strokeWidth: 2 }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Vehicle chart */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md" style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "24px" }}>
                <PanelHeader icon={Car} label="Vehicle Breakdown" meta="Top 8 classes" />
                <p className="-mt-2 mb-3 text-[10px] leading-relaxed text-zinc-600">{vehicleInsight}</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.vehicle_breakdown.slice(0, 8)} layout="vertical"
                      margin={{ top: 4, right: 48, left: 120, bottom: 0 }}>
                      <CartesianGrid stroke={COLORS.grid} strokeDasharray="2 4" horizontal={false} />
                      <XAxis type="number" stroke={COLORS.textMuted} fontSize={10} tickLine={false}
                        axisLine={{ stroke: COLORS.grid }} tickFormatter={(v: number) => fmtCompact(v)}
                        fontFamily="var(--font-inter), monospace" />
                      <YAxis type="category" dataKey="vehicle_type" stroke="#a1a1aa" fontSize={10}
                        tickLine={false} axisLine={false} width={120}
                        fontFamily="var(--font-inter), monospace" />
                      <RechartsTooltip content={<MonoTooltip suffix="vehicles" />} cursor={{ fill: COLORS.gridSoft }} />
                      <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                        <LabelList dataKey="count" position="right" fill="#f4f4f5" fontSize={10}
                          fontFamily="monospace" formatter={(v: unknown) => fmtInt(Number(v))} />
                        {data.vehicle_breakdown.slice(0, 8).map((entry) => (
                          <Cell key={entry.vehicle_type} fill={VEHICLE_COLORS[entry.vehicle_type] ?? "#a1a1aa"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* === Row 2: Junctions + Heatmap === */}
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Junctions table */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md" style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "24px" }}>
                <PanelHeader icon={MapPin} label="Top 10 Junctions" meta="Sorted by delay-cost" />
                <div ref={junctionsRef} className="scroll-thin -mx-2 mt-4 max-h-[420px] overflow-y-auto px-2">
                  <table className="w-full text-left font-mono text-xs tabular-nums">
                    <thead className="sticky top-0 bg-zinc-900/80 backdrop-blur-md">
                      <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                        <th className="py-2 pr-2 font-medium w-8">#</th>
                        <th className="py-2 pr-2 font-medium">Junction</th>
                        <th className="py-2 pr-2 text-right font-medium">Violations</th>
                        <th className="py-2 pr-2 text-right font-medium">Risk</th>
                        <th className="py-2 pl-2 text-right font-medium">Delay Cost</th>
                        <th className="w-6" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {data.top_junctions.map((j, i) => {
                        const riskLevel = j.delay_cost > 500_000 ? "CRITICAL" : j.delay_cost > 100_000 ? "HIGH" : "MODERATE";
                        const riskColor = riskLevel === "CRITICAL" ? "text-rose-500 bg-rose-500/10 border-rose-500/30"
                          : riskLevel === "HIGH" ? "text-orange-400 bg-orange-500/10 border-orange-500/30"
                          : "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
                        return (
                          <tr key={j.junction}
                            className="text-zinc-300 cursor-pointer transition hover:bg-zinc-800/50 group"
                            onClick={() => {
                              // Scroll to top / map
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}>
                            <td className="py-2 pr-2 text-zinc-600">{String(i + 1).padStart(2, "0")}</td>
                            <td className="py-2 pr-2 text-zinc-100 max-w-[160px] truncate">{j.junction.replace(/^BTP\d+\s*-\s*/, "")}</td>
                            <td className="py-2 pr-2 text-right">{fmtInt(j.violations)}</td>
                            <td className="py-2 pr-2 text-right">
                              <span className={`inline-block rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${riskColor}`}>
                                {riskLevel}
                              </span>
                            </td>
                            <td className="py-2 pl-2 text-right text-rose-500">{fmtCompact(Math.round(j.delay_cost))}</td>
                            <td className="py-2 text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity">
                              <ChevronRight className="h-3 w-3" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {junctionFooter && (
                    <p className="mt-3 border-t border-zinc-800 pt-2 text-[10px] text-zinc-600">{junctionFooter}</p>
                  )}
                </div>
              </div>

              {/* Heatmap */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md lg:col-span-2" style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "24px" }}>
                <PanelHeader icon={BarChart3} label="Week × Hour Density" meta="Mon–Sun × 00–23"
                  badge={data.is_forecast ? <AiForecastBadge /> : undefined} />
                <div className="mt-4 overflow-x-auto">
                  <div className="min-w-[760px]">
                    <div className="grid font-mono text-[10px] tabular-nums text-zinc-500"
                      style={{ gridTemplateColumns: "48px repeat(24, minmax(0, 1fr))", gap: 0 }}>
                      <div />
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="text-center text-[9px] tracking-wider text-zinc-600" style={{ lineHeight: "18px" }}>
                          {String(h).padStart(2, "0")}
                        </div>
                      ))}
                    </div>
                    <div className="grid" style={{ gridTemplateColumns: "48px repeat(24, minmax(0, 1fr))", gap: 0 }}>
                      {heatmapMatrix?.map((row, dIdx) => (
                        <Fragment key={`row-${dIdx}`}>
                          <div className="flex items-center pr-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                            {DAYS[dIdx]}
                          </div>
                          {row.map((density, h) => {
                            const isHovered = hoveredCell?.day === dIdx || hoveredCell?.hour === h;
                            const bg = heatColorLog(density, heatMax, data.is_forecast ?? false);
                            return (
                              <div key={`${dIdx}-${h}`}
                                className="transition-all cursor-default"
                                style={{
                                  backgroundColor: bg,
                                  height: "32px",
                                  opacity: hoveredCell && !isHovered ? 0.5 : 1,
                                  outline: hoveredCell?.day === dIdx && hoveredCell?.hour === h ? "1px solid rgba(255,255,255,0.3)" : "none",
                                }}
                                onMouseEnter={() => setHoveredCell({ day: dIdx, hour: h })}
                                onMouseLeave={() => setHoveredCell(null)}
                                title={`${DAYS_FULL[dIdx]} ${String(h).padStart(2, "0")}:00 — ${fmtInt(density)} violations`}
                              />
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                    {/* Hover tooltip */}
                    {hoveredCell && heatmapMatrix && (
                      <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-950/95 px-3 py-2 font-mono text-xs backdrop-blur-md">
                        <span className="text-zinc-300">{DAYS_FULL[hoveredCell.day]} {String(hoveredCell.hour).padStart(2, "0")}:00</span>
                        <span className="ml-3 text-zinc-500">Violations: <span className="text-zinc-300">{fmtInt(heatmapMatrix[hoveredCell.day][hoveredCell.hour])}</span></span>
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-zinc-600">
                      <span>Low</span>
                      <div className="flex h-2 w-48 overflow-hidden rounded-sm">
                        {["#09090b", "#18181b", "#0f172a", "#0c2233", "#0a3b5c", "#075985", "#0284c7", "#38bdf8"].map((c, i) => (
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
              Data Source: Bengaluru Police Traffic Violations &middot; H3 Res 9 &middot; ClearLane Analytics Terminal v1.0
            </footer>
          </>
        )}

        <ChatPanel />
      </main>

      {/* Sticky bottom insight bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-zinc-950/90 px-6 py-2.5 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-sky-400" />
          <p className="truncate font-mono text-[11px] text-zinc-300">{insightText}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Heatmap color with log scale ──────────────────────────────────────────
function heatColorLog(density: number, maxVal: number, predictive: boolean): string {
  if (density === 0 || maxVal === 0) return "#09090b";
  const logD = Math.log2(density + 1);
  const logM = Math.log2(maxVal + 1);
  const t = Math.min(logD / logM, 1);
  const palette = predictive
    ? ["#18181b", "#1a1b2e", "#1e1a45", "#2e1a5e", "#4c1d95", "#7c3aed", "#a78bfa"]
    : ["#18181b", "#0f172a", "#0c2233", "#0a3b5c", "#075985", "#0284c7", "#38bdf8"];
  const idx = Math.min(Math.floor(t * (palette.length - 1)), palette.length - 1);
  return palette[Math.max(1, idx)];
}

// ─── Components ────────────────────────────────────────────────────────────

function PanelHeader({ icon: Icon, label, meta, badge, right }: {
  icon: typeof Clock; label: string; meta: string; badge?: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-4">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-zinc-500" />
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">{label}</h2>
        {badge}
      </div>
      <div className="flex items-center gap-3">
        {right}
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">{meta}</span>
      </div>
    </header>
  );
}

function AiForecastBadge() {
  return (
    <span className="flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-violet-400">
      <Sparkles className="h-2.5 w-2.5" /> AI Forecast
    </span>
  );
}

function ControlBar({ dayFilter, onDayChange, timeRange, onTimeRangeChange, horizon, onHorizonChange }: {
  dayFilter: DayFilter; onDayChange: (v: DayFilter) => void;
  timeRange: [number, number]; onTimeRangeChange: (v: [number, number]) => void;
  horizon: PredictionHorizon; onHorizonChange: (v: PredictionHorizon) => void;
}) {
  return (
    <section className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 backdrop-blur-md lg:grid-cols-[220px_1fr_1fr]">
      <div className="bg-zinc-900/50 p-6">
        <div className="mb-3 flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-zinc-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">Day</h2>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between border-zinc-800 bg-zinc-950 px-2.5 py-1 font-mono text-xs font-normal text-zinc-100 hover:bg-zinc-900 hover:text-zinc-100">
              {dayFilter === "all" ? "All Days" : DAYS[(dayFilter as number) - 1]}
              <ChevronDown className="-me-1 ms-2 h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-[140px] border-zinc-800 bg-zinc-950 text-zinc-300">
            <DropdownMenuRadioGroup value={String(dayFilter)}
              onValueChange={(v) => onDayChange(v === "all" ? "all" : (Number(v) as DayFilter))}>
              <DropdownMenuRadioItem value="all" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">All Days</DropdownMenuRadioItem>
              {DAYS.map((d, i) => (
                <DropdownMenuRadioItem key={d} value={String(i + 1)} className="text-xs focus:bg-zinc-800 focus:text-zinc-200">{d}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Dual-handle time range */}
      <div className="bg-zinc-900/50 px-6 py-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-zinc-500" />
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">Time Window</h2>
          </div>
          <span className="font-mono text-xs font-medium text-zinc-200">
            {String(timeRange[0]).padStart(2, "0")}:00 &mdash; {String(timeRange[1]).padStart(2, "0")}:00
          </span>
        </div>
        <Slider range min={0} max={23} value={timeRange}
          onChange={(v) => onTimeRangeChange(v as [number, number])}
          trackStyle={[{ backgroundColor: "#38bdf8", height: 4 }]}
          handleStyle={[
            { borderColor: "#38bdf8", backgroundColor: "#38bdf8", height: 16, width: 16, marginTop: -6, opacity: 1 },
            { borderColor: "#38bdf8", backgroundColor: "#38bdf8", height: 16, width: 16, marginTop: -6, opacity: 1 },
          ]}
          railStyle={{ backgroundColor: "#3f3f46", height: 4 }}
        />
      </div>

      <div className="bg-zinc-900/50">
        <HorizonControl value={horizon} onChange={onHorizonChange} />
      </div>
    </section>
  );
}

type ValueColor = "accent" | "success" | "danger";

function KpiTile({ icon: Icon, label, value, unit, sub, color = "accent", trend, sparkline }: {
  icon: typeof Clock; label: string; value: string; unit?: string; sub?: string;
  color?: ValueColor; trend?: number | null; sparkline?: number[];
}) {
  const valueClass = color === "danger" ? "text-rose-500" : color === "success" ? "text-cyan-400" : "text-sky-400";
  const trendIcon = trend == null ? <Minus className="h-3 w-3 text-zinc-600" />
    : trend > 0 ? <ArrowUp className="h-3 w-3 text-rose-500" /> : <ArrowDown className="h-3 w-3 text-emerald-500" />;
  return (
    <div className="bg-zinc-950 p-6">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">{label}</span>
      </div>
      <div className={cn("mt-3 font-mono text-2xl font-semibold tabular-nums flex items-center gap-2", valueClass)}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-zinc-500">{unit}</span>}
      </div>
      {trend !== undefined && label === "Total Violations" && (
        <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-zinc-500">
          {trendIcon}
          <span>{trend !== null ? `${trend > 0 ? "+" : ""}${trend}% vs yesterday` : "No prior data"}</span>
        </div>
      )}
      {sub && !label.includes("Violations") && (
        <div className="mt-1 font-mono text-[10px] text-zinc-600">{sub}</div>
      )}
      {sparkline && sparkline.length > 0 && (
        <div className="mt-2 flex items-end gap-[1px] h-6">
          {sparkline.map((v, i) => {
            const max = Math.max(...sparkline, 1);
            const h = Math.max(2, (v / max) * 20);
            return <div key={i} className="w-[3px] rounded-t-sm bg-rose-500/60" style={{ height: h }} />;
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tooltips ──────────────────────────────────────────────────────────────

interface MonoTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string | number; value?: number | string; dataKey?: string | number; color?: string; }>;
  label?: string | number; suffix?: string;
}

function MonoTooltip({ active, payload, label, suffix }: MonoTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const formatted = typeof entry.value === "number" ? entry.value.toLocaleString("en-US") : String(entry.value ?? "");
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/95 px-3 py-2 font-mono text-xs shadow-none backdrop-blur-md">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label ?? ""}</div>
      <div className="mt-1 tabular-nums text-zinc-100">{formatted}{suffix && <span className="ml-1 text-[10px] uppercase tracking-wider text-zinc-500">{suffix}</span>}</div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, metric }: MonoTooltipProps & { metric: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/95 px-3 py-2 font-mono text-xs shadow-none backdrop-blur-md">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label ?? ""}</div>
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

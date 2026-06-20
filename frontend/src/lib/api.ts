/**
 * ClearLane API client.
 *
 * Tries the live backend first (with a short timeout). Falls back to
 * pre-computed demo data served from /demo-data/ when the backend is
 * unreachable or NEXT_PUBLIC_DEMO_MODE is set to "true".
 */

// Use 127.0.0.1 instead of localhost to avoid IPv6 issues on macOS/Linux
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const DEMO_MODE =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
  typeof window === "undefined";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface HotspotProperties {
  h3_index: string;
  violation_count: number;
  total_space_wasted: number;
  peak_violations: number;
  estimated_delay_mins: number;
  predicted_delay?: number;
  center: [number, number];
  primary_vehicle: string;
  place_name: string | null;
  top_violation_type?: string;
  police_station?: string;
  vehicle_breakdown?: Record<string, number>;
}

export interface SeverityRankingItem {
  rank: number;
  place_name: string;
  severity_score: number;
  badges: string[];
  police_station: string;
  h3_index: string;
  center: [number, number];
  cis_score?: number;
  cis_label?: string;
}

export interface HotspotTimeData {
  hourly: { hour: number; count: number }[];
  peak_window: { start: number; end: number; count: number };
  weekday_distribution: { day: string; count: number }[];
  recommendation: string;
}

export interface DarkSpot {
  h3_index: string;
  place_name: string;
  severity_score: number;
  unsent_ratio: number;
  unvalidated_ratio: number;
  rejected_ratio: number;
  primary_label: string;
  center: [number, number];
}

export type GeoJSON = GeoJSON.FeatureCollection<
  GeoJSON.Polygon,
  HotspotProperties
>;

export interface Stats {
  total_active_hotspots: number;
  total_violations_recorded: number;
  total_estimated_delay_hours: number;
}

export interface Waypoint {
  lng: number;
  lat: number;
  estimated_delay_mins: number;
  violation_count: number;
  h3_index: string;
  primary_vehicle: string;
}

export interface PatrolRoute {
  waypoints: Waypoint[];
  total_impact: number;
}

export type PredictionHorizon = "now" | "15m" | "30m" | "60m";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeoutSignal(ms: number): AbortController {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl;
}

async function fetchOrDemo<T>(
  url: string,
  demoPath: string,
  transform?: (raw: unknown) => T,
): Promise<T> {
  if (DEMO_MODE) {
    const res = await fetch(demoPath);
    if (!res.ok) throw new Error(`Demo data not found: ${demoPath}`);
    const raw = await res.json();
    return transform ? transform(raw) : (raw as T);
  }

  try {
    const ctrl = timeoutSignal(3000);
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return transform ? transform(raw) : (raw as T);
  } catch {
    // Fall back to demo data
    const res = await fetch(demoPath);
    if (!res.ok) throw new Error(`Backend unreachable and no demo data`);
    const raw = await res.json();
    return transform ? transform(raw) : (raw as T);
  }
}

/* ------------------------------------------------------------------ */
/*  API functions                                                      */
/* ------------------------------------------------------------------ */

export async function fetchHotspots(
  hour: number | null,
  horizon: PredictionHorizon = "now",
): Promise<GeoJSON> {
  const params = new URLSearchParams();
  if (hour !== null) params.set("hour", String(hour));
  const endpoint = horizon === "now" ? "hotspots" : "predict-horizon";
  if (horizon !== "now") {
    params.set("horizon", horizon);
    params.set("hour", String(hour ?? 8));
  }
  const url = `${API_BASE}/api/${endpoint}?${params.toString()}`;
  return fetchOrDemo<GeoJSON>(url, "/demo-data/hotspots.json");
}

export async function fetchStats(hour: number | null): Promise<Stats> {
  const params = new URLSearchParams();
  if (hour !== null) params.set("hour", String(hour));
  const url = `${API_BASE}/api/stats?${params.toString()}`;
  return fetchOrDemo<Stats>(url, "/demo-data/stats.json");
}

export async function fetchPatrolRoute(
  hour: number | null,
): Promise<PatrolRoute> {
  const params = new URLSearchParams();
  if (hour !== null) params.set("hour", String(hour));
  const url = `${API_BASE}/api/patrol-route?${params.toString()}`;
  // Compute patrol route from hotspots in demo mode
  return fetchOrDemo<PatrolRoute>(
    url,
    "/demo-data/hotspots.json",
    (raw: unknown) => {
      const fc = raw as GeoJSON;
      const sorted = [...fc.features].sort(
        (a, b) => b.properties.estimated_delay_mins - a.properties.estimated_delay_mins,
      );
      const waypoints = sorted.slice(0, 5).map((f) => ({
        lng: f.properties.center[0],
        lat: f.properties.center[1],
        estimated_delay_mins: f.properties.estimated_delay_mins,
        violation_count: f.properties.violation_count,
        h3_index: f.properties.h3_index,
        primary_vehicle: f.properties.primary_vehicle,
      }));
      return {
        waypoints,
        total_impact: round(waypoints.reduce((s, w) => s + w.estimated_delay_mins, 0), 2),
      } as PatrolRoute;
    },
  );
}

export async function fetchAnalytics(
  hour: number,
  horizon: PredictionHorizon,
  day: number | "all",
  refresh = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const params = new URLSearchParams();
  params.set("hour", String(hour));
  params.set("horizon", horizon);
  if (day !== "all") params.set("day", String(day));
  if (refresh) params.set("refresh", "true");
  const url = `${API_BASE}/api/analytics?${params.toString()}`;
  return fetchOrDemo(url, "/demo-data/analytics.json");
}

export async function fetchSeverityRanking(): Promise<SeverityRankingItem[]> {
  return fetchOrDemo<SeverityRankingItem[]>(
    `${API_BASE}/api/severity-ranking`,
    "/demo-data/severity-ranking.json",
  );
}

export async function fetchHotspotTimes(
  h3Index: string,
): Promise<HotspotTimeData | null> {
  try {
    return await fetchOrDemo<HotspotTimeData>(
      `${API_BASE}/api/hotspot-times?h3_index=${encodeURIComponent(h3Index)}`,
      `/demo-data/hotspot-times/${h3Index}.json`,
    );
  } catch {
    return null;
  }
}

export async function fetchDarkSpots(): Promise<DarkSpot[]> {
  return fetchOrDemo<DarkSpot[]>(
    `${API_BASE}/api/dark-spots`,
    "/demo-data/dark-spots.json",
  );
}

/** Fetch the comprehensive data summary used for LLM chat context. */
export async function fetchContextSummary(): Promise<Record<string, unknown> | null> {
  try {
    return await fetchOrDemo<Record<string, unknown>>(
      `${API_BASE}/api/context-summary`,
      "/demo-data/context-summary.json",
    );
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Utils                                                              */
/* ------------------------------------------------------------------ */

function round(n: number, d: number): number {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

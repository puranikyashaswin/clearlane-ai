"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer, PathLayer } from "@deck.gl/layers";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import type { Feature, Geometry } from "geojson";
import { Map, NavigationControl } from "react-map-gl";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  MapPin,
  Send,
  Siren,
} from "lucide-react";
import Link from "next/link";
import { DispatchNotification } from "@/components/DispatchNotification";
import { ExportActionsPanel } from "@/components/ExportActionsPanel";
import {
  HorizonControl,
  type PredictionHorizon,
} from "@/components/HorizonControl";
import Logo from "@/components/Logo";
import { TimeSlider } from "@/components/TimeSlider";
import { fetchHotspots, fetchStats } from "@/lib/api";
import { ChatPanel } from "@/components/ChatPanel";
import { RankedZoneList } from "@/components/RankedZoneList";
import { DarkSpotsPanel } from "@/components/DarkSpotsPanel";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import "mapbox-gl/dist/mapbox-gl.css" with { turbopackModuleType: "css" };

// --- Enterprise Type Definitions ---
interface HotspotProperties {
  h3_index: string;
  violation_count: number;
  estimated_delay_mins: number;
  predicted_delay?: number;
  center: [number, number];
  primary_vehicle: string;
  place_name?: string | null;
  top_violation_type?: string;
  police_station?: string;
  vehicle_breakdown?: Record<string, number>;
  cis_score?: number;
  cis_label?: string;
}

interface GeoJSONFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: HotspotProperties;
}

interface GeoJSON {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

interface Stats {
  total_active_hotspots: number;
  total_estimated_delay_hours: number;
  total_violations_recorded: number;
}

interface HoverInfo {
  object: GeoJSONFeature;
  x: number;
  y: number;
}

interface ActiveHex {
  h3_index: string;
  center: [number, number];
  placeName?: string | null;
}

type Severity = "critical" | "high" | "normal";

const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

// Dispatch feed is read-only in this iteration — drive the camera
// through the viewState controller rather than imperative fly-to calls.
interface RouteGeometry {
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
}

interface ClickedHotspot {
  h3_index: string;
  center: [number, number];
  properties: HotspotProperties;
}

interface DispatchAlert {
  id: string;
  station: string;
  zone: string;
  violations: number;
  delayMins: number;
  severity: Severity;
  timestamp: number;
  hour: number;
  center: [number, number];
  placeName?: string | null;
}

// --- Map Configuration (Bengaluru Lock) ---
const BENGALURU_BOUNDS = {
  minLon: 77.45,
  maxLon: 77.85,
  minLat: 12.85,
  maxLat: 13.15,
};
const MIN_ZOOM = 10.5;
const MAX_ZOOM = 16;
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [BENGALURU_BOUNDS.minLon, BENGALURU_BOUNDS.minLat],
  [BENGALURU_BOUNDS.maxLon, BENGALURU_BOUNDS.maxLat],
];

const MG_ROAD_ORIGIN: [number, number] = [77.6068, 12.9756];

const HOTSPOT_COLORS = {
  normal: [250, 204, 21, 170] as [number, number, number, number],
  high: [234, 88, 12, 200] as [number, number, number, number],
  critical: [220, 38, 38, 220] as [number, number, number, number],
};

const severityFromCount = (count: number): Severity =>
  count > 100 ? "critical" : count > 20 ? "high" : "normal";

const colorForSeverity = (s: Severity): [number, number, number, number] => {
  if (s === "critical") return HOTSPOT_COLORS.critical;
  if (s === "high") return HOTSPOT_COLORS.high;
  return HOTSPOT_COLORS.normal;
};

const fetchRoute = async (
  origin: [number, number],
  destination: [number, number],
  token: string
): Promise<RouteGeometry | null> => {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${origin[0]},${origin[1]};${destination[0]},${destination[1]}` +
    `?geometries=geojson&overview=full&access_token=${token}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json: {
      routes?: Array<{
        geometry: { coordinates: [number, number][] };
        distance: number;
        duration: number;
      }>;
    } = await res.json();
    const route = json.routes?.[0];
    if (!route) return null;
    return {
      coordinates: route.geometry.coordinates,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    };
  } catch {
    return null;
  }
};

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 77.5946,
  latitude: 12.9716,
  zoom: 11.5,
  pitch: 50,
  bearing: -15,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  maxPitch: 60,
};

const POLICE_STATIONS = [
  "MG Road PS",
  "Indiranagar PS",
  "Koramangala PS",
  "Jayanagar PS",
  "Whitefield PS",
  "Hebbal PS",
  "Malleshwaram PS",
  "Banashankari PS",
  "HSR Layout PS",
  "Yeshwanthpur PS",
];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const IST_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const IST_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const TIME_PLACEHOLDER = "--:--:--";
const DATE_PLACEHOLDER = "---";

const severityFor = (violations: number): Severity =>
  violations > 100 ? "critical" : violations > 20 ? "high" : "normal";

const buildAlert = (
  feature: GeoJSONFeature,
  index: number,
  timestamp: number,
  hour: number
): DispatchAlert => {
  const props = feature.properties;
  const violations = props.violation_count || 0;
  return {
    id: `${props.h3_index}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    station: POLICE_STATIONS[index % POLICE_STATIONS.length],
    zone: props.h3_index,
    violations,
    delayMins: props.estimated_delay_mins || 0,
    severity: severityFor(violations),
    timestamp,
    hour,
    center: [props.center[0], props.center[1]] as [number, number],
    placeName: props.place_name ?? null,
  };
};

// --- Memoized presentational components (React.memo + custom equality) ---

const MemoDispatchNotification = memo(
  DispatchNotification,
  (prev, next) =>
    prev.alert.id === next.alert.id &&
    prev.alert.severity === next.alert.severity &&
    prev.alert.violations === next.alert.violations &&
    prev.alert.delayMins === next.alert.delayMins &&
    prev.alert.placeName === next.alert.placeName &&
    prev.alert.timestamp === next.alert.timestamp &&
    prev.now === next.now
);

interface DashboardShellProps {
  onHorizonChange?: (val: PredictionHorizon) => void;
  onHourChange?: (hour: number) => void;
}

export function DashboardShell({
  onHorizonChange,
  onHourChange,
}: DashboardShellProps) {
  const [data, setData] = useState<GeoJSON | undefined>(undefined);
  const [dataLoadedAt, setDataLoadedAt] = useState<number>(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedHour, setSelectedHour] = useState<number>(8);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportPanelData, setExportPanelData] = useState<ActiveHex | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelHoveredRef = useRef(false);

  const [now, setNow] = useState<Date | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);
  const [horizon, setHorizon] = useState<PredictionHorizon>("now");
  const [liveFeed, setLiveFeed] = useState<DispatchAlert[]>([]);

  const [clickedHotspot, setClickedHotspot] = useState<ClickedHotspot | null>(
    null
  );
  const [route, setRoute] = useState<RouteGeometry | null>(null);
  const [, setRouteLoading] = useState<boolean>(false);

  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);

  // Feature 1: Filter state
  const [violationTypeFilter, setViolationTypeFilter] = useState<string>("all");
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<string>("all");

  // useTransition for horizon + hour changes. The heavy work (deck.gl
  // re-derive + new fetch) can take 80–150ms; we keep the UI responsive
  // by marking the resulting render as a low-priority transition.
  const [, startTransition] = useTransition();

  const handleHorizonChange = useCallback(
    (val: PredictionHorizon) => {
      startTransition(() => {
        setHorizon(val);
        onHorizonChange?.(val);
      });
    },
    [onHorizonChange]
  );

  const handleHourChange = useCallback(
    (hour: number) => {
      startTransition(() => {
        setSelectedHour(hour);
        onHourChange?.(hour);
      });
    },
    [onHourChange]
  );

  // Wire DOM events from the page-level transition wrappers so we can use
  // startTransition without prop-drilling the setter.
  useEffect(() => {
    const onHorizon = (e: Event): void => {
      const detail = (e as CustomEvent<PredictionHorizon>).detail;
      handleHorizonChange(detail);
    };
    const onHour = (e: Event): void => {
      const detail = (e as CustomEvent<number>).detail;
      handleHourChange(detail);
    };
    const onPanTo = (e: Event): void => {
      const { center } = (e as CustomEvent<{ center: [number, number] }>).detail;
      setViewState((prev) => ({
        ...prev,
        longitude: center[0],
        latitude: center[1],
        zoom: 15,
        transitionDuration: 800,
      }));
    };
    window.addEventListener("clearlane:horizon-change", onHorizon);
    window.addEventListener("clearlane:hour-change", onHour);
    window.addEventListener("clearlane:pan-to-zone", onPanTo);
    return () => {
      window.removeEventListener("clearlane:horizon-change", onHorizon);
      window.removeEventListener("clearlane:hour-change", onHour);
      window.removeEventListener("clearlane:pan-to-zone", onPanTo);
    };
  }, [handleHorizonChange, handleHourChange]);

  useEffect(() => {
    const load = async () => {
      try {
        const d = await fetchHotspots(selectedHour, horizon);
        setData(d as unknown as GeoJSON);
        setDataLoadedAt(Date.now());
      } catch (err) {
        console.error("Failed to fetch hotspots", err);
      }
      try {
        const s = await fetchStats(selectedHour);
        setStats(s);
      } catch (err) {
        console.error("Failed to fetch stats", err);
      }
    };
    load();
  }, [selectedHour, horizon]);

  // rAF-driven clock. Replaces setInterval(1000) with a single frame-synced
  // loop that pauses while the tab is hidden.
  useEffect(() => {
    Promise.resolve().then(() => setNow(new Date()));
  }, []);
  useAnimationFrame(() => {
    setNow(new Date());
  });

  const baseFeed = useMemo<DispatchAlert[]>(() => {
    if (!data || data.features.length === 0 || dataLoadedAt === 0) return [];
    const sorted = [...data.features].sort(
      (a, b) => b.properties.violation_count - a.properties.violation_count
    );
    return sorted
      .slice(0, 6)
      .map((feature, index) =>
        buildAlert(feature, index, dataLoadedAt - index * 5000, selectedHour)
      );
  }, [data, selectedHour, dataLoadedAt]);

  // Live dispatch feed — rAF-driven, batches 1 alert every ~5s of *visible*
  // time. Pauses automatically when the tab is hidden (see useAnimationFrame).
  const lastInsertRef = useRef<number>(0);
  useAnimationFrame((deltaMs) => {
    if (!data || data.features.length === 0) return;
    lastInsertRef.current += deltaMs;
    if (lastInsertRef.current < 5000) return;
    lastInsertRef.current = 0;
    const feature =
      data.features[Math.floor(Math.random() * data.features.length)];
    setLiveFeed((prev) =>
      [
        buildAlert(
          feature,
          Math.floor(Math.random() * POLICE_STATIONS.length),
          Date.now(),
          selectedHour
        ),
        ...prev,
      ].slice(0, 20)
    );
  });

  const dispatchFeed = useMemo<DispatchAlert[]>(
    () =>
      [...liveFeed.filter((a) => a.hour === selectedHour), ...baseFeed].slice(
        0,
        14
      ),
    [liveFeed, baseFeed, selectedHour]
  );

  // Feature 1: Client-side filter for violation type and vehicle type
  const filteredData = useMemo(() => {
    if (!data) return undefined;
    if (violationTypeFilter === "all" && vehicleTypeFilter === "all") return data;

    const filtered = {
      ...data,
      features: data.features.filter((f) => {
        if (violationTypeFilter !== "all") {
          const topVt = f.properties.top_violation_type ?? "";
          if (!topVt.toLowerCase().includes(violationTypeFilter.toLowerCase())) {
            // Also check vehicle_breakdown keys for matching violation type
            // But mostly we match on top_violation_type
            return false;
          }
        }
        if (vehicleTypeFilter !== "all") {
          const pv = f.properties.primary_vehicle ?? "";
          if (pv.toLowerCase() !== vehicleTypeFilter.toLowerCase()) {
            return false;
          }
        }
        return true;
      }),
    };
    return filtered;
  }, [data, violationTypeFilter, vehicleTypeFilter]);

  // Layers memoized with primitive-only deps so the deck.gl layer instances
  // only rebuild when something user-visible changed.
  const layers = useMemo<Layer[]>(() => {
    const baseLayers: Layer[] = [];

    const layerData = filteredData ?? data;
    if (layerData) {
      baseLayers.push(
        new GeoJsonLayer<HotspotProperties>({
          id: "geojson-layer",
          data: layerData,
          filled: true,
          extruded: true,
          wireframe: true,
          getElevation: (f: Feature<Geometry, HotspotProperties>) => {
            const props = f.properties;
            const delay =
              typeof props.predicted_delay === "number" &&
              props.predicted_delay > 0
                ? props.predicted_delay
                : props.estimated_delay_mins || 0;
            return delay * 15;
          },
          getFillColor: (f: Feature<Geometry, HotspotProperties>) => {
            const count = f.properties.violation_count || 0;
            return colorForSeverity(severityFromCount(count));
          },
          pickable: true,
          autoHighlight: true,
          opacity: 0.55,
          onHover: (info: PickingInfo) => {
            if (info.object) {
              const feature = info.object as GeoJSONFeature;
              const props = feature.properties;
              setHoverInfo({ object: feature, x: info.x, y: info.y });
              // Show export panel immediately on hover
              setExportPanelData({
                h3_index: props.h3_index,
                center: [props.center[0], props.center[1]] as [number, number],
                placeName: props.place_name ?? null,
              });
              setShowExportPanel(true);
              if (dismissTimerRef.current !== null) {
                clearTimeout(dismissTimerRef.current);
                dismissTimerRef.current = null;
              }
            } else {
              setHoverInfo(null);
              // Start 2s dismiss timer — cursor has 2s to reach the panel
              dismissTimerRef.current = setTimeout(() => {
                if (!panelHoveredRef.current) {
                  setShowExportPanel(false);
                }
              }, 2000);
            }
          },
          onClick: (info: PickingInfo) => {
            const feature = info.object as GeoJSONFeature | undefined;
            if (!feature) return;
            const props = feature.properties;
            setClickedHotspot({
              h3_index: props.h3_index,
              center: [props.center[0], props.center[1]] as [number, number],
              properties: props,
            });
            setRoute(null);
            const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
            if (!token) return;
            setRouteLoading(true);
            void fetchRoute(MG_ROAD_ORIGIN, props.center, token).then((r) => {
              setRoute(r);
              setRouteLoading(false);
            });
          },
          updateTriggers: {
            getFillColor: [
              data ? data.features.length : 0,
              clickedHotspot?.h3_index,
            ],
            getElevation: [data ? data.features.length : 0, horizon],
          },
        })
      );
    }

    if (route && route.coordinates.length > 0) {
      baseLayers.push(
        new PathLayer<{ path: [number, number][] }>({
          id: "clicked-hotspot-route",
          data: [{ path: route.coordinates }],
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: [37, 99, 235, 230],
          getWidth: 5,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
        })
      );
    }

    return baseLayers;
  }, [data, route, clickedHotspot?.h3_index, horizon]);

  const istTime = useMemo(
    () => (now ? IST_TIME_FORMAT.format(now) : TIME_PLACEHOLDER),
    [now]
  );

  const istDate = useMemo(
    () => (now ? IST_DATE_FORMAT.format(now) : DATE_PLACEHOLDER),
    [now]
  );

  const criticalCount = dispatchFeed.filter(
    (a) => a.severity === "critical"
  ).length;
  const horizonLabel =
    horizon === "now"
      ? "Now"
      : horizon === "15m"
        ? "+15m"
        : horizon === "30m"
          ? "+30m"
          : "+60m";

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950 font-sans text-zinc-100 pb-28">
      {/* === Top Bar === */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="leading-tight">
            <div className="text-sm font-medium text-zinc-100">ClearLane</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Traffic Command
            </div>
          </div>
          <span className="mx-3 h-5 w-px bg-zinc-800" />
          <nav className="flex items-center gap-1">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-300 transition hover:bg-zinc-900"
            >
              <MapPin className="h-3 w-3" />
              Map
            </Link>
            <Link
              href="/analytics"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300"
            >
              <BarChart3 className="h-3 w-3" />
              Analytics
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3 font-mono tabular-nums">
          <span className="text-xs text-zinc-500">IST</span>
          <span className="text-sm font-medium text-zinc-100">{istTime}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-xs text-zinc-500">{istDate}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2">
            {process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-zinc-500" />
                </span>
                <span className="text-xs uppercase tracking-wider text-zinc-500">
                  Demo Mode
                </span>
              </>
            ) : (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-500/40" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-500" />
                </span>
                <span className="text-xs uppercase tracking-wider text-zinc-400">
                  System Online
                </span>
              </>
            )}
          </span>
          <button
            type="button"
            aria-label="Info"
            title="About ClearLane"
            className="grid h-7 w-7 place-items-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* === Left Sidebar === */}
      <aside className="scroll-thin fixed bottom-0 left-0 top-14 z-30 flex w-80 flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-950/80 backdrop-blur-md pb-28">
        <section className="p-6">
          <header className="mb-5 flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-zinc-500" />
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
              Global Stats
            </h2>
          </header>
          {stats ? (
            <div className="space-y-5">
              <StatRow
                label="Est. Commuter Delay"
                value={stats.total_estimated_delay_hours}
                unit="hrs"
                tone="critical"
              />
              <StatRow
                label="Active Hotspots"
                value={stats.total_active_hotspots}
              />
              <StatRow
                label="Total Violations"
                value={stats.total_violations_recorded}
              />
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Syncing with backend...</p>
          )}
        </section>

        <Divider />

        {/* Feature 1: Filter dropdowns */}
        <section className="px-6 py-4 space-y-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Filters
          </h3>
          <div className="space-y-2">
            <select
              value={violationTypeFilter}
              onChange={(e) => setViolationTypeFilter(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-zinc-600"
            >
              <option value="all">All Violation Types</option>
              <option value="WRONG PARKING">Wrong Parking</option>
              <option value="NO PARKING">No Parking</option>
              <option value="PARKING IN A MAIN ROAD">Parking in Main Road</option>
              <option value="DOUBLE PARKING">Double Parking</option>
              <option value="PARKING OPPOSITE TO ANOTHER PARKED VEHICLE">Parking Opposite</option>
              <option value="PARKING NEAR BUSTOP/SCHOOL/HOSPITAL ETC">Near Bus Stop/School</option>
            </select>
            <select
              value={vehicleTypeFilter}
              onChange={(e) => setVehicleTypeFilter(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-zinc-600"
            >
              <option value="all">All Vehicle Types</option>
              <option value="CAR">Car</option>
              <option value="SCOOTER">Scooter</option>
              <option value="MOTOR CYCLE">Motor Cycle</option>
              <option value="PASSENGER AUTO">Passenger Auto</option>
              <option value="GOODS AUTO">Goods Auto</option>
              <option value="BUS (BMTC/KSRTC)">Bus</option>
              <option value="LORRY/GOODS VEHICLE">Lorry/Goods Vehicle</option>
              <option value="VAN">Van</option>
            </select>
          </div>
          {(violationTypeFilter !== "all" || vehicleTypeFilter !== "all") && (
            <p className="text-[10px] text-zinc-600">
              {filteredData?.features.length ?? 0} hotspots match
            </p>
          )}
        </section>

        <Divider />

        <RankedZoneList />

        <Divider />

        <DarkSpotsPanel />

        <Divider />

        <TimeSlider value={selectedHour} onChange={handleHourChange} />

        <Divider />

        <HorizonControl value={horizon} onChange={handleHorizonChange} />
      </aside>

      {/* === Main Canvas === */}
      <main
        className={cn(
          "absolute bottom-0 top-14 transition-all duration-200",
          drawerOpen ? "left-80 right-96" : "left-80 right-0"
        )}
      >
        <DeckGL
          viewState={viewState}
          controller={true}
          layers={layers}
          onViewStateChange={({ viewState: next }) => {
            if (!("longitude" in next)) return;
            setViewState({
              ...next,
              longitude: clamp(
                next.longitude,
                BENGALURU_BOUNDS.minLon,
                BENGALURU_BOUNDS.maxLon
              ),
              latitude: clamp(
                next.latitude,
                BENGALURU_BOUNDS.minLat,
                BENGALURU_BOUNDS.maxLat
              ),
            });
          }}
        >
          <Map
            mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
            mapStyle="mapbox://styles/mapbox/dark-v11"
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            maxBounds={MAX_BOUNDS}
            style={{ width: "100%", height: "100%" }}
          >
            <NavigationControl position="top-right" />
          </Map>
        </DeckGL>

        {hoverInfo && <HoverTooltip info={hoverInfo} />}

        {showExportPanel && exportPanelData && (
          <ExportActionsPanel
            destination={{
              lat: exportPanelData.center[1],
              lng: exportPanelData.center[0],
            }}
            destinationLabel={exportPanelData.placeName}
            className="bottom-4"
            onMouseEnter={() => {
              panelHoveredRef.current = true;
              if (dismissTimerRef.current !== null) {
                clearTimeout(dismissTimerRef.current);
                dismissTimerRef.current = null;
              }
            }}
            onMouseLeave={() => {
              panelHoveredRef.current = false;
              setShowExportPanel(false);
            }}
          />
        )}

        <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400 backdrop-blur-md">
          <MapPin className="h-3 w-3 text-zinc-500" />
          Bengaluru · Camera Locked
        </div>
      </main>

      {/* === Right Drawer Toggle === */}
      <button
        type="button"
        onClick={() => setDrawerOpen((open) => !open)}
        aria-label={
          drawerOpen ? "Collapse dispatch feed" : "Expand dispatch feed"
        }
        className={cn(
          "fixed top-1/2 z-40 grid h-12 w-5 -translate-y-1/2 place-items-center border border-r-0 border-zinc-800 bg-zinc-900 text-zinc-400 backdrop-blur-md transition hover:text-zinc-100",
          drawerOpen ? "right-96" : "right-0 rounded-l-md"
        )}
      >
        {drawerOpen ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>

      {/* === Right Drawer === */}
      <aside
        className={cn(
          "fixed bottom-0 right-0 top-14 z-30 flex w-96 flex-col border-l border-zinc-800 bg-zinc-950/80 backdrop-blur-md transition-transform duration-200",
          drawerOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Siren className="h-3.5 w-3.5 text-rose-500" />
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
              Live Dispatch Feed
            </h2>
          </div>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            Live
          </span>
        </header>

        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3 font-mono text-[11px] tabular-nums text-zinc-500">
          <span>
            Horizon: <span className="text-zinc-300">{horizonLabel}</span>
          </span>
          <span>
            {dispatchFeed.length} alerts · {criticalCount} critical
          </span>
        </div>

        <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-4 pb-28">
          {dispatchFeed.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-zinc-600">
              <Send className="mb-3 h-5 w-5" />
              <p className="text-xs">Awaiting hotspot telemetry...</p>
            </div>
          ) : (
            dispatchFeed.map((alert) => (
              <MemoDispatchNotification
                key={alert.id}
                alert={alert}
                now={now ? now.getTime() : 0}
              />
            ))
          )}
        </div>
      </aside>

      <ChatPanel />
    </div>
  );
}

// --- Presentational Components ---

function Divider() {
  return <div className="h-px w-full bg-zinc-800" />;
}

type Tone = "default" | "success" | "critical";

function StatRow({
  label,
  value,
  unit,
  tone = "default",
  decimals = 0,
}: {
  label: string;
  value: number;
  unit?: string;
  tone?: Tone;
  decimals?: number;
}) {
  const valueClass =
    tone === "critical"
      ? "text-rose-500"
      : tone === "success"
        ? "text-cyan-400"
        : "text-zinc-100";

  const formatted =
    decimals > 0
      ? value.toFixed(decimals)
      : value.toLocaleString();

  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-2xl font-semibold tabular-nums",
          valueClass
        )}
      >
        {formatted}
        {unit && (
          <span className="ml-1.5 text-xs font-normal text-zinc-500">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function HoverTooltip({ info }: { info: HoverInfo }) {
  const props = info.object.properties;
  const isCritical = props.violation_count > 100;
  const placeName = props.place_name?.trim() || "Unknown Intersection";
  const showPredicted =
    typeof props.predicted_delay === "number" &&
    props.predicted_delay !== props.estimated_delay_mins;

  const vt = props.top_violation_type?.trim();
  const cleanedVt = vt
    ? vt.replace(/^\["|"\]$/g, "").replace(/","/g, ", ")
    : null;

  // Build vehicle breakdown string
  const vb = props.vehicle_breakdown;
  const vbEntries = vb && Object.keys(vb).length > 0
    ? Object.entries(vb)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, c]) => `${t}: ${c}`)
        .join(", ")
    : null;

  const cisScore = props.cis_score;
  const cisLabel = props.cis_label;

  return (
    <div
      className="pointer-events-none absolute z-20 min-w-[280px] rounded-lg border border-zinc-800 bg-zinc-950/95 p-5 backdrop-blur-md"
      style={{ left: info.x + 12, top: info.y + 12 }}
    >
      <div className="mb-1 flex items-center gap-2">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span
          className="text-sm font-semibold text-zinc-100"
          title={placeName}
        >
          {placeName}
        </span>
      </div>
      <div className="mb-4 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        Zone {props.h3_index}
      </div>
      <dl className="space-y-3 font-mono text-sm tabular-nums">
        <TooltipRow
          label="Violations"
          value={props.violation_count.toLocaleString()}
          tone={isCritical ? "critical" : "default"}
        />
        <TooltipRow
          label="Est. Delay"
          value={`${props.estimated_delay_mins.toFixed(1)} min`}
        />
        {showPredicted && (
          <TooltipRow
            label="Predicted Delay"
            value={`${(props.predicted_delay ?? 0).toFixed(1)} min`}
            tone="critical"
          />
        )}
        <TooltipRow label="Vehicle" value={props.primary_vehicle || "Mixed"} />
        {cleanedVt && (
          <TooltipRow label="Violation Type" value={cleanedVt} />
        )}
        {props.police_station && props.police_station !== "Unknown" && (
          <TooltipRow label="Police Station" value={props.police_station} />
        )}
        {vbEntries && (
          <TooltipRow label="Top Vehicles" value={vbEntries} />
        )}
        {cisScore !== undefined && (
          <div className="flex items-baseline justify-between pt-1 border-t border-zinc-800">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Carriageway Impact
            </dt>
            <dd className="text-right">
              <span className="font-mono text-sm tabular-nums text-zinc-100">
                {cisScore}
              </span>
              <span className="ml-1 text-[10px] text-zinc-500">{cisLabel}</span>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function TooltipRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  const valueClass = tone === "critical" ? "text-rose-500" : "text-zinc-100";
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
        {label}
      </dt>
      <dd className={cn("font-mono text-sm tabular-nums", valueClass)}>
        {value}
      </dd>
    </div>
  );
}

export default DashboardShell;

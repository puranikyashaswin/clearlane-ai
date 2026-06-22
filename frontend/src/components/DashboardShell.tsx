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
import type { MapViewState, PickingInfo } from "@deck.gl/core";
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Send,
  Siren,
} from "lucide-react";
import { DispatchNotification } from "@/components/DispatchNotification";
import { ExportActionsPanel } from "@/components/ExportActionsPanel";
import {
  HorizonControl,
  type PredictionHorizon,
} from "@/components/HorizonControl";
import { TimeSlider } from "@/components/TimeSlider";
import { fetchHotspots, fetchPatrolRouteGeometry, fetchStats } from "@/lib/api";
import { ChatPanel } from "@/components/ChatPanel";
import { RankedZoneList } from "@/components/RankedZoneList";
import { DarkSpotsPanel } from "@/components/DarkSpotsPanel";
import { PatrolRoutePanel } from "@/components/PatrolRoutePanel";
import { HexMap, type H3HexData } from "@/components/HexMap";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
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
  // Use CIS score to compute a credible delay: CIS/100 rounded up, minimum 5 if there are violations
  const cisDelay = props.cis_score ? Math.max(Math.round(props.cis_score / 100), 5) : 0;
  const delayMins = cisDelay || props.estimated_delay_mins || Math.round(violations * 0.5);
  return {
    id: `${props.h3_index}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    station: POLICE_STATIONS[index % POLICE_STATIONS.length],
    zone: props.h3_index,
    violations,
    delayMins,
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

  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);
  const [targetLocation, setTargetLocation] = useState<{ lng: number; lat: number; h3Index?: string } | null>(null);
  const [clickedWaypoint, setClickedWaypoint] = useState<{ name: string; lng: number; lat: number } | null>(null);
  const [highlightedHex, setHighlightedHex] = useState<string | null>(null);
  const [highlightedWaypointName, setHighlightedWaypointName] = useState<string | null>(null);
  const [patrolRouteGeometry, setPatrolRouteGeometry] = useState<[number, number][] | null>(null);
  const selectedHexTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const { center, h3_index, place_name } = (e as CustomEvent<{ center: [number, number]; h3_index?: string; place_name?: string | null }>).detail;
      setViewState((prev) => ({
        ...prev,
        longitude: center[0],
        latitude: center[1],
        zoom: 15,
        transitionDuration: 800,
      }));
      if (selectedHexTimerRef.current) clearTimeout(selectedHexTimerRef.current);
      setTargetLocation({ lng: center[0], lat: center[1], h3Index: h3_index || undefined });
      if (place_name) {
        setClickedWaypoint({ name: place_name, lng: center[0], lat: center[1] });
      }
      // Compute the exact res-8 parent hex for hover tooltip name override
      let exactHex: string | null = null;
      if (h3_index) {
        try {
          const { cellToParent } = require("h3-js");
          exactHex = cellToParent(h3_index, 8);
        } catch {}
      }
      setHighlightedHex(exactHex);
      setHighlightedWaypointName(place_name ?? null);
      selectedHexTimerRef.current = setTimeout(() => {
        setTargetLocation(null);
        setClickedWaypoint(null);
        setHighlightedHex(null);
        setHighlightedWaypointName(null);
      }, 3000);
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

  // Fetch MapMyIndia route geometry when patrol waypoints are loaded
  useEffect(() => {
    const onRouteLoaded = (e: Event): void => {
      const waypoints = (e as CustomEvent<{ lat: number; lng: number }[]>).detail;
      fetchPatrolRouteGeometry(waypoints).then(setPatrolRouteGeometry);
    };
    window.addEventListener("clearlane:patrol-route-loaded", onRouteLoaded);
    return () => window.removeEventListener("clearlane:patrol-route-loaded", onRouteLoaded);
  }, []);

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

  // Live dispatch feed, rAF-driven. Batches 1 alert every ~5s of *visible*
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
      {/* === Left Sidebar === */}
      <aside className="scroll-thin fixed bottom-0 left-0 top-0 z-30 flex w-72 flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-950/80 backdrop-blur-md pb-28">
        <section className="p-6 pt-20">
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

        <TimeSlider value={selectedHour} onChange={handleHourChange} />

        <Divider />

        <PatrolRoutePanel hour={selectedHour} />

        <Divider />

        {/* Feature 1: Filter dropdowns */}
        <section className="px-6 py-4 space-y-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Filters
          </h3>
          <div className="space-y-2">
            <div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-normal text-zinc-300 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    {violationTypeFilter === "all"
                      ? "All Violation Types"
                      : violationTypeFilter === "WRONG PARKING"
                        ? "Wrong Parking"
                        : violationTypeFilter === "NO PARKING"
                          ? "No Parking"
                          : violationTypeFilter === "PARKING IN A MAIN ROAD"
                            ? "Parking in Main Road"
                            : violationTypeFilter === "DOUBLE PARKING"
                              ? "Double Parking"
                              : violationTypeFilter === "PARKING OPPOSITE TO ANOTHER PARKED VEHICLE"
                                ? "Parking Opposite"
                                : "Near Bus Stop/School"}
                    <ChevronDown className="-me-1 ms-2 h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="min-w-[220px] border-zinc-800 bg-zinc-950 text-zinc-300">
                  <DropdownMenuRadioGroup
                    value={violationTypeFilter}
                    onValueChange={setViolationTypeFilter}
                  >
                    <DropdownMenuRadioItem value="all" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      All Violation Types
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="WRONG PARKING" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Wrong Parking
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="NO PARKING" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      No Parking
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="PARKING IN A MAIN ROAD" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Parking in Main Road
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="DOUBLE PARKING" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Double Parking
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="PARKING OPPOSITE TO ANOTHER PARKED VEHICLE"
                      className="text-xs focus:bg-zinc-800 focus:text-zinc-200"
                    >
                      Parking Opposite
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="PARKING NEAR BUSTOP/SCHOOL/HOSPITAL ETC"
                      className="text-xs focus:bg-zinc-800 focus:text-zinc-200"
                    >
                      Near Bus Stop/School
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-normal text-zinc-300 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    {vehicleTypeFilter === "all"
                      ? "All Vehicle Types"
                      : vehicleTypeFilter}
                    <ChevronDown className="-me-1 ms-2 h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="min-w-[220px] border-zinc-800 bg-zinc-950 text-zinc-300">
                  <DropdownMenuRadioGroup
                    value={vehicleTypeFilter}
                    onValueChange={setVehicleTypeFilter}
                  >
                    <DropdownMenuRadioItem value="all" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      All Vehicle Types
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="CAR" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Car
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="SCOOTER" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Scooter
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="MOTOR CYCLE" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Motor Cycle
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="PASSENGER AUTO" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Passenger Auto
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="GOODS AUTO" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Goods Auto
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="BUS (BMTC/KSRTC)" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Bus
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="LORRY/GOODS VEHICLE" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Lorry/Goods Vehicle
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="VAN" className="text-xs focus:bg-zinc-800 focus:text-zinc-200">
                      Van
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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

        <HorizonControl value={horizon} onChange={handleHorizonChange} />
      </aside>

      {/* === Main Canvas === */}
      <main
        className={cn(
          "absolute bottom-0 top-16 transition-all duration-200",
          drawerOpen ? "left-72 right-96" : "left-72 right-0"
        )}
      >
        <HexMap
          data={data as unknown as import("@/components/HexMap").GeoJSON}
          onHover={(info: PickingInfo) => {
            if (info.object) {
              const hexData = info.object as H3HexData;
              // When a waypoint is highlighted and this hex is the one that was
              // clicked, show the waypoint name from the panel in the tooltip
              // instead of the hexData place_name.
              const isHighlightedHex = highlightedHex !== null && hexData.hex === highlightedHex;
              const placeName = isHighlightedHex && highlightedWaypointName
                ? highlightedWaypointName
                : hexData.properties?.place_name || hexData.hex.slice(0, 8);
              setHoverInfo({
                object: {
                  type: "Feature",
                  geometry: { type: "Polygon", coordinates: [] },
                  properties: {
                    ...hexData.properties,
                    violation_count: hexData.count,
                    primary_vehicle: hexData.properties?.primary_vehicle || "Mixed",
                    place_name: placeName,
                    center: hexData.center,
                  },
                } as GeoJSONFeature,
                x: info.x,
                y: info.y,
              });
            } else {
              setHoverInfo(null);
            }
          }}
          viewState={viewState}
          onViewStateChange={({ viewState: next }) => {
            setViewState(next);
          }}
          selectedHour={selectedHour}
          onHourChange={handleHourChange}
          targetLocation={targetLocation}
          patrolRouteGeometry={patrolRouteGeometry}
        />

        {hoverInfo && <HoverTooltip info={hoverInfo} />}

        {clickedWaypoint && (
          <div className="pointer-events-none absolute left-4 top-4 z-20 animate-pulse rounded-md border border-cyan-500/40 bg-zinc-950/90 px-3 py-1.5 backdrop-blur-md">
            <MapPin className="-ml-0.5 mr-1.5 inline h-3.5 w-3.5 text-cyan-400" />
            <span className="font-mono text-xs font-medium text-cyan-300">
              {clickedWaypoint.name}
            </span>
          </div>
        )}

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
          "fixed bottom-0 right-0 top-0 z-30 flex w-96 flex-col border-l border-zinc-800 bg-zinc-950/80 backdrop-blur-md transition-transform duration-200",
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

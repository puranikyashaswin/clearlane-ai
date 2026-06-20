"use client";

import { useMemo, useState, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { ContourLayer } from "@deck.gl/aggregation-layers";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import { Map as MapGL, NavigationControl } from "react-map-gl";
import { Hexagon, Layers } from "lucide-react";

// --- Types ---
export interface HotspotProperties {
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

export interface GeoJSONFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: HotspotProperties;
}

export interface GeoJSON {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export interface H3HexData {
  hex: string;
  count: number;
  topViolationType: string;
  junctionPct: number;
  center: [number, number];
  properties: HotspotProperties;
}

interface HexMapProps {
  data: GeoJSON | undefined;
  onHover?: (info: PickingInfo) => void;
  onClick?: (info: PickingInfo) => void;
  viewState: MapViewState;
  onViewStateChange: (params: { viewState: MapViewState }) => void;
  extraLayers?: Layer[];
}

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

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

// Colour scale: dark navy → amber → bright red (logarithmic)
function hexColor(count: number, maxCount: number): [number, number, number, number] {
  if (maxCount === 0) return [10, 10, 40, 180];
  // Log scale so mid-density zones are visible
  const logCount = Math.log2(count + 1);
  const logMax = Math.log2(maxCount + 1);
  const t = Math.min(logCount / logMax, 1);

  if (t < 0.33) {
    // Navy → amber
    const lt = t / 0.33;
    return [
      Math.round(10 + (255 - 10) * lt),
      Math.round(10 + (140 - 10) * lt),
      Math.round(40 + (0 - 40) * lt),
      180 + Math.round(40 * lt),
    ];
  } else if (t < 0.66) {
    // Amber → orange-red
    const lt = (t - 0.33) / 0.33;
    return [
      255,
      Math.round(140 - 140 * lt),
      Math.round(0),
      200 + Math.round(20 * lt),
    ];
  } else {
    // Orange-red → bright red
    const lt = (t - 0.66) / 0.34;
    return [
      255,
      Math.round(0),
      Math.round(0),
      220 + Math.round(10 * lt),
    ];
  }
}

export function HexMap({ data, onHover, onClick, viewState, onViewStateChange, extraLayers }: HexMapProps) {
  const [viewMode, setViewMode] = useState<"hex" | "contour">("hex");

  // Aggregate data into H3 hexagons at resolution 8 (~500m)
  const hexData = useMemo<H3HexData[]>(() => {
    if (!data || !data.features) return [];

    // Build hex map from feature centers
    const hexMap = new Map<string, {
      count: number;
      violationTypes: Map<string, number>;
      junctionCount: number;
      center: [number, number];
      properties: HotspotProperties;
    }>();

    for (const feature of data.features) {
      const props = feature.properties;
      const [lng, lat] = props.center;
      if (!lng || !lat) continue;

      // Use h3-js for latLngToCell
      const { latLngToCell } = require("h3-js");
      const hex = latLngToCell(lat, lng, 8);

      if (!hexMap.has(hex)) {
        hexMap.set(hex, {
          count: 0,
          violationTypes: new Map(),
          junctionCount: 0,
          center: [lng, lat],
          properties: props,
        });
      }

      const entry = hexMap.get(hex)!;
      entry.count += props.violation_count ?? 1;

      // Track violation types
      const vt = props.top_violation_type;
      if (vt) {
        entry.violationTypes.set(vt, (entry.violationTypes.get(vt) ?? 0) + 1);
      }

      // Track junction-related (features near named junctions have place_name)
      if (props.place_name && !props.place_name.includes("Road") && !props.place_name.includes("Street")) {
        entry.junctionCount += 1;
      }

      // Keep the most recent center and properties
      entry.center = [lng, lat];
      entry.properties = props;
    }

    // Convert to array
    const result: H3HexData[] = [];
    for (const [hex, entry] of hexMap) {
      const maxVt = [...entry.violationTypes.entries()].sort((a, b) => b[1] - a[1]);
      result.push({
        hex,
        count: entry.count,
        topViolationType: maxVt.length > 0 ? maxVt[0][0] : "Unknown",
        junctionPct: entry.count > 0 ? Math.round((entry.junctionCount / entry.count) * 100) : 0,
        center: entry.center,
        properties: entry.properties,
      });
    }

    result.sort((a, b) => b.count - a.count);
    return result;
  }, [data]);

  // Compute max count for colour scale
  const maxCount = useMemo(() => {
    if (hexData.length === 0) return 0;
    return hexData[0].count;
  }, [hexData]);

  // Build deck.gl layers
  const layers = useMemo<Layer[]>(() => {
    const result: Layer[] = [];

    if (viewMode === "hex") {
      result.push(
        new H3HexagonLayer<H3HexData>({
          id: "h3-hex-layer",
          data: hexData,
          pickable: true,
          wireframe: false,
          filled: true,
          extruded: false,
          coverage: 0.92,
          getHexagon: (d: H3HexData) => d.hex,
          getFillColor: (d: H3HexData) => hexColor(d.count, maxCount),
          getLineColor: [255, 255, 255, 30],
          getLineWidth: 1,
          onHover: onHover,
          onClick: onClick,
          updateTriggers: {
            getFillColor: [hexData.length, maxCount],
          },
        }),
      );
    } else {
      // Contour view
      const points = hexData.map((d) => [d.center[0], d.center[1], d.count] as [number, number, number]);
      result.push(
        new ContourLayer({
          id: "contour-layer",
          data: points,
          getPosition: (d: [number, number, number]) => [d[0], d[1]],
          getWeight: (d: [number, number, number]) => d[2],
          cellSize: 500,
          contours: [
            { threshold: 10, color: [255, 200, 50, 100], strokeWidth: 0 },
            { threshold: 50, color: [255, 140, 0, 130], strokeWidth: 0 },
            { threshold: 150, color: [255, 30, 0, 160], strokeWidth: 0 },
          ],
          pickable: false,
        }),
      );
    }

    // Append extra layers (e.g. route paths)
    if (extraLayers) {
      for (const layer of extraLayers) {
        result.push(layer);
      }
    }

    return result;
  }, [hexData, maxCount, viewMode, onHover, onClick, extraLayers]);

  return (
    <div className="relative h-full w-full">
      <DeckGL
        viewState={viewState}
        controller={true}
        layers={layers}
        onViewStateChange={({ viewState: next }) => {
          const vs = next as MapViewState;
          onViewStateChange({
            viewState: {
              longitude: clamp(vs.longitude, BENGALURU_BOUNDS.minLon, BENGALURU_BOUNDS.maxLon),
              latitude: clamp(vs.latitude, BENGALURU_BOUNDS.minLat, BENGALURU_BOUNDS.maxLat),
              zoom: vs.zoom,
              pitch: vs.pitch ?? 0,
              bearing: vs.bearing ?? 0,
              minZoom: vs.minZoom ?? MIN_ZOOM,
              maxZoom: vs.maxZoom ?? MAX_ZOOM,
              maxPitch: vs.maxPitch ?? 60,
            },
          });
        }}
      >
        <MapGL
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          maxBounds={MAX_BOUNDS}
          style={{ width: "100%", height: "100%" }}
        >
          <NavigationControl position="top-right" />
        </MapGL>
      </DeckGL>

      {/* View toggle buttons */}
      <div className="absolute right-4 top-4 z-10 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950/80 p-1 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setViewMode("hex")}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
            viewMode === "hex"
              ? "bg-white text-zinc-900"
              : "border border-zinc-700 bg-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Hexagon className="h-3.5 w-3.5" />
          Hex View
        </button>
        <button
          type="button"
          onClick={() => setViewMode("contour")}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
            viewMode === "contour"
              ? "bg-white text-zinc-900"
              : "border border-zinc-700 bg-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Contour View
        </button>
      </div>

      {/* Legend */}
      {viewMode === "hex" && maxCount > 0 && (
        <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 backdrop-blur-md">
          <div className="flex items-center gap-1">
            <div className="h-2 w-6 rounded-sm" style={{ background: "rgb(10, 10, 40)" }} />
            <div className="h-2 w-6 rounded-sm" style={{ background: "rgb(255, 140, 0)" }} />
            <div className="h-2 w-6 rounded-sm" style={{ background: "rgb(255, 30, 0)" }} />
          </div>
          <span className="font-mono text-[10px] text-zinc-500">
            Low
          </span>
          <span className="mx-1 font-mono text-[10px] text-zinc-500">→</span>
          <span className="font-mono text-[10px] text-zinc-500">High</span>
          <span className="mx-2 text-zinc-700">|</span>
          <span className="font-mono text-[10px] text-zinc-600">
            {hexData.length.toLocaleString()} hexagons
          </span>
        </div>
      )}
    </div>
  );
}

export default HexMap;

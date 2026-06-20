"use client";

import { motion } from "framer-motion";
import { ChevronRight, Truck, X } from "lucide-react";

export interface MiniMapWaypoint {
  lng: number;
  lat: number;
  status: "pending" | "completed";
}

interface PatrolMiniMapProps {
  waypoints: MiniMapWaypoint[];
  activeIndex: number;
  onClose?: () => void;
}

const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

/**
 * Bottom-right mini-map preview of the patrol route. Shows the unit's current
 * position (animated truck), the next destination (pulsing hexagon), the
 * completed route segments (dashed line) and a live progress indicator.
 */
export function PatrolMiniMap({
  waypoints,
  activeIndex,
  onClose,
}: PatrolMiniMapProps) {
  if (waypoints.length === 0) return null;

  // Project the geo points into a 160×96 SVG viewport. We centre the bounding
  // box on the active waypoint so the truck + next destination are always in
  // frame, and fall back to the whole route bounds otherwise.
  const W = 160;
  const H = 96;
  const padding = 14;
  const allPoints = waypoints;
  const lngs = allPoints.map((w) => w.lng);
  const lats = allPoints.map((w) => w.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngRange = Math.max(0.0001, maxLng - minLng);
  const latRange = Math.max(0.0001, maxLat - minLat);
  const innerW = W - padding * 2;
  const innerH = H - padding * 2;
  const scale = Math.min(innerW / lngRange, innerH / latRange);
  const project = (lng: number, lat: number): [number, number] => {
    const x = padding + (lng - minLng) * scale;
    const y = padding + (maxLat - lat) * scale; // invert y
    return [x, y];
  };

  const projected = waypoints.map((w) => ({ wp: w, pos: project(w.lng, w.lat) }));
  const active = projected[Math.min(activeIndex, projected.length - 1)];
  const next =
    activeIndex < projected.length - 1 ? projected[activeIndex + 1] : null;

  // Dashed path across the entire route
  const routePath = projected.map((p) => `${p.pos[0]},${p.pos[1]}`).join(" ");

  // Build a polyline from start → active (solid) + active → end (dashed)
  const completedPath = projected
    .slice(0, Math.min(activeIndex + 1, projected.length))
    .map((p) => `${p.pos[0]},${p.pos[1]}`)
    .join(" ");

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "group/mimimap pointer-events-auto absolute bottom-4 right-4 z-20",
        "w-[180px] rounded-lg border border-zinc-800 bg-zinc-950/85 p-2.5",
        "shadow-2xl backdrop-blur-md"
      )}
      aria-label="Patrol mini-map"
    >
      <header className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
          <Truck className="h-2.5 w-2.5 text-sky-400" />
          Patrol Route
        </div>
        {onClose && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onClose();
            }}
            className="grid h-4 w-4 place-items-center rounded text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-2.5 w-2.5" />
          </span>
        )}
      </header>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-24 w-full rounded border border-zinc-800 bg-zinc-950/70"
        aria-hidden="true"
      >
        {/* Faint road grid */}
        <line x1="0" y1="24" x2={W} y2="24" stroke="#27272a" strokeWidth="0.5" />
        <line x1="0" y1="48" x2={W} y2="48" stroke="#27272a" strokeWidth="0.5" />
        <line x1="0" y1="72" x2={W} y2="72" stroke="#27272a" strokeWidth="0.5" />
        <line x1="40" y1="0" x2="40" y2={H} stroke="#27272a" strokeWidth="0.5" />
        <line x1="80" y1="0" x2="80" y2={H} stroke="#27272a" strokeWidth="0.5" />
        <line x1="120" y1="0" x2="120" y2={H} stroke="#27272a" strokeWidth="0.5" />

        {/* Full planned route (dim dashed) */}
        <polyline
          points={routePath}
          fill="none"
          stroke="#3f3f46"
          strokeWidth="0.8"
          strokeDasharray="3 2"
        />

        {/* Completed segment */}
        {completedPath && (
          <polyline
            points={completedPath}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1.4"
          />
        )}

        {/* Destination hex for each waypoint (small) */}
        {projected.map((p, i) => (
          <polygon
            key={`hex-${i}`}
            points="3,0 1.5,1.3 1.5,3.9 3,5.2 4.5,3.9 4.5,1.3"
            transform={`translate(${p.pos[0] - 3}, ${p.pos[1] - 2.6})`}
            fill={
              i < activeIndex
                ? "#38bdf844"
                : i === activeIndex
                  ? "#3f3f46"
                  : "#27272a"
            }
            stroke={
              i === activeIndex
                ? "#38bdf8"
                : i < activeIndex
                  ? "#38bdf8"
                  : "#52525b"
            }
            strokeWidth="0.5"
          />
        ))}

        {/* Pulsing destination ring around next waypoint */}
        {next && (
          <motion.circle
            cx={next.pos[0]}
            cy={next.pos[1]}
            r="3.5"
            fill="none"
            stroke="#f43f5e"
            strokeWidth="0.8"
            initial={{ scale: 0.8, opacity: 0.9 }}
            animate={{ scale: [0.8, 1.4, 0.8], opacity: [0.9, 0.4, 0.9] }}
            transition={{ duration: 1.6, repeat: Infinity }}
            style={{ transformOrigin: `${next.pos[0]}px ${next.pos[1]}px` }}
          />
        )}

        {/* Animated truck at the active waypoint */}
        <motion.g
          animate={{
            x: active.pos[0] - 4,
            y: active.pos[1] - 4,
          }}
          transition={{ type: "spring", stiffness: 80, damping: 18 }}
        >
          <circle cx="4" cy="4" r="4" fill="#38bdf8" stroke="#0A0F1D" strokeWidth="0.6" />
          <path
            d="M2.5,4 L4,2.5 L5.5,4 L4,5.5 Z"
            fill="#0A0F1D"
          />
        </motion.g>
      </svg>

      <footer className="mt-1.5 flex items-center justify-between font-mono text-[9px] tabular-nums text-zinc-500">
        <span>
          {Math.min(activeIndex + 1, waypoints.length)} / {waypoints.length}
        </span>
        <span className="flex items-center gap-0.5 text-cyan-400">
          <ChevronRight className="h-2.5 w-2.5" />
        </span>
      </footer>
    </motion.button>
  );
}

export default PatrolMiniMap;
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, GripVertical, MapPin, Save, Truck, Zap } from "lucide-react";

export interface BuilderWaypoint {
  lng: number;
  lat: number;
  estimated_delay_mins: number;
  violation_count: number;
  h3_index: string;
  primary_vehicle: string;
  place_name?: string | null;
  status: "pending" | "completed";
}

interface PatrolRouteBuilderProps {
  waypoints: BuilderWaypoint[];
  lengthKm: number;
  totalDelayMins: number;
  hoursSaved: number;
  onReorder: (from: number, to: number) => void;
  onMarkCompleted: (index: number) => void;
  onSave: () => void;
}

const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

const fmt = (n: number): string => {
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString("en-US");
};

const PRIORITY_STYLES = {
  critical: {
    border: "border-rose-500/40",
    text: "text-rose-400",
    dot: "bg-rose-500",
    glow: "shadow-[0_0_12px_-4px_rgba(244,63,94,0.6)]",
  },
  high: {
    border: "border-amber-500/40",
    text: "text-amber-400",
    dot: "bg-amber-500",
    glow: "",
  },
  normal: {
    border: "border-zinc-800",
    text: "text-zinc-400",
    dot: "bg-zinc-500",
    glow: "",
  },
} as const;

const priorityOf = (count: number): keyof typeof PRIORITY_STYLES =>
  count > 100 ? "critical" : count > 20 ? "high" : "normal";

export function PatrolRouteBuilder({
  waypoints,
  lengthKm,
  totalDelayMins,
  hoursSaved,
  onReorder,
  onMarkCompleted,
  onSave,
}: PatrolRouteBuilderProps) {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  if (waypoints.length === 0) return null;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 backdrop-blur-md">
      <header className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <Truck className="h-3.5 w-3.5 text-sky-400" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Patrol Sequence
          </h2>
          <span className="font-mono text-[10px] tabular-nums text-zinc-600">
            {waypoints.length} stops
          </span>
        </div>
        <button
          type="button"
          onClick={onSave}
          className="flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-sky-300 transition hover:bg-sky-500/25"
        >
          <Save className="h-3 w-3" />
          Save Route
        </button>
      </header>

      {/* Route metrics */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <MetricPill
          icon={MapPin}
          label="Length"
          value={`${lengthKm.toFixed(1)}`}
          unit="km"
        />
        <MetricPill
          icon={Clock}
          label="Delay"
          value={fmt(Math.round(totalDelayMins))}
          unit="min"
          variant="amber"
        />
        <MetricPill
          icon={Zap}
          label="Saved"
          value={hoursSaved.toFixed(1)}
          unit="hrs"
        />
      </div>

      {/* Drag-and-drop waypoint list */}
      <ol className="space-y-2">
        <AnimatePresence>
          {waypoints.map((wp, i) => {
            const priority = priorityOf(wp.violation_count);
            const styles = PRIORITY_STYLES[priority];
            const isDragging = draggingIdx === i;
            const isOver = overIdx === i && draggingIdx !== null && draggingIdx !== i;
            return (
              <motion.li
                key={`${wp.h3_index}-${i}`}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                draggable
                onDragStart={() => setDraggingIdx(i)}
                onDragOver={(e: React.DragEvent<HTMLLIElement>) => {
                  e.preventDefault();
                  setOverIdx(i);
                }}
                onDragLeave={() => {
                  if (overIdx === i) setOverIdx(null);
                }}
                onDrop={(e: React.DragEvent<HTMLLIElement>) => {
                  e.preventDefault();
                  if (draggingIdx !== null && draggingIdx !== i) {
                    onReorder(draggingIdx, i);
                  }
                  setDraggingIdx(null);
                  setOverIdx(null);
                }}
                onDragEnd={() => {
                  setDraggingIdx(null);
                  setOverIdx(null);
                }}
                className={cn(
                  "group/way relative rounded-md border bg-zinc-950/60 p-3 transition",
                  styles.border,
                  styles.glow,
                  wp.status === "completed" && "opacity-60",
                  isDragging && "scale-[0.98] cursor-grabbing opacity-60",
                  isOver && "ring-1 ring-sky-500/60"
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 grid h-5 w-5 shrink-0 cursor-grab place-items-center rounded text-zinc-500 transition group-hover/way:text-zinc-300">
                    <GripVertical className="h-3.5 w-3.5" />
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[10px] tabular-nums",
                      priority === "critical"
                        ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                        : priority === "high"
                          ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                          : "border-zinc-700 bg-zinc-900 text-zinc-400"
                    )}
                  >
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate font-mono text-[11px] tabular-nums",
                          styles.text
                        )}
                      >
                        {wp.place_name?.trim() || wp.h3_index.slice(0, 8)}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-zinc-600">
                        {wp.violation_count.toLocaleString()} v
                      </span>
                      {wp.status === "completed" && (
                        <Check className="h-3 w-3 text-sky-400" />
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[10px] tabular-nums text-zinc-500">
                      {wp.estimated_delay_mins.toFixed(0)} min delay · {wp.primary_vehicle}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {wp.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => onMarkCompleted(i)}
                        className="rounded-md border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-sky-300 transition hover:bg-sky-500/20"
                      >
                        Done
                      </button>
                    )}
                  </div>
                </div>

                {/* Connector to next stop */}
                {i < waypoints.length - 1 && (
                  <div className="pointer-events-none absolute -bottom-2 left-6 top-full h-2 w-px bg-sky-500/40" />
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </section>
  );
}

function MetricPill({
  icon: Icon,
  label,
  value,
  unit,
  variant = "sky",
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  unit: string;
  variant?: "sky" | "amber";
}) {
  const toneClass = variant === "sky" ? "text-sky-400" : "text-amber-400";
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
      <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
        <Icon className="h-2.5 w-2.5" />
        {label}
      </div>
      <div className={cn("mt-1 font-mono text-sm font-semibold tabular-nums", toneClass)}>
        {value}
        <span className="ml-1 text-[10px] font-normal text-zinc-500">{unit}</span>
      </div>
    </div>
  );
}

export default PatrolRouteBuilder;
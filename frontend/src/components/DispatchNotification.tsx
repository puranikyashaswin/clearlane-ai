"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Siren, Clock } from "lucide-react";

export type DispatchStatus = "idle" | "dispatched" | "en_route" | "resolved";

export interface DispatchNotificationData {
  id: string;
  station: string;
  zone: string;
  violations: number;
  delayMins: number;
  severity: "critical" | "high" | "normal";
  timestamp: number;
  center?: [number, number];
  placeName?: string | null;
}

interface DispatchNotificationProps {
  alert: DispatchNotificationData;
  now: number;
}

const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

const SEVERITY_STYLES = {
  critical: {
    badgeBg: "bg-rose-500/15",
    badgeBorder: "border-rose-500/30",
    badgeText: "text-rose-400",
    dot: "bg-rose-500",
    icon: Siren,
    label: "Critical",
    accentRing: "ring-rose-500/20",
  },
  high: {
    badgeBg: "bg-amber-500/15",
    badgeBorder: "border-amber-500/30",
    badgeText: "text-amber-400",
    dot: "bg-amber-500",
    icon: AlertTriangle,
    label: "High",
    accentRing: "ring-amber-500/20",
  },
  normal: {
    badgeBg: "bg-zinc-500/15",
    badgeBorder: "border-zinc-500/30",
    badgeText: "text-zinc-400",
    dot: "bg-zinc-500",
    icon: Clock,
    label: "Normal",
    accentRing: "ring-zinc-500/20",
  },
} as const;

const SEVERITY_GRADIENT = {
  critical:
    "bg-gradient-to-b from-rose-500/5 to-transparent",
  high:
    "bg-gradient-to-b from-amber-500/5 to-transparent",
  normal:
    "bg-gradient-to-b from-zinc-500/[0.03] to-transparent",
};

const formatRelative = (timestamp: number, now: number): string => {
  const diffMs = Math.max(0, now - timestamp);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
};

export function DispatchNotification({ alert, now }: DispatchNotificationProps) {
  const style = SEVERITY_STYLES[alert.severity];
  const Icon = style.icon;
  const placeName = alert.placeName?.trim() || "Unknown Intersection";

  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/70 shadow-sm backdrop-blur-sm",
        "transition-all duration-200 hover:border-zinc-700/80 hover:shadow-md",
        "ring-1 ring-inset ring-white/[0.02]"
      )}
    >
      {/* Top accent gradient */}
      <div className={cn("h-0.5 w-full", SEVERITY_GRADIENT[alert.severity])} />

      <div className="p-4 pt-3">
        {/* Severity badge + timestamp */}
        <div className="mb-2.5 flex items-center justify-between">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]",
              style.badgeBg,
              style.badgeBorder,
              style.badgeText
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
            {style.label}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-zinc-600">
            {formatRelative(alert.timestamp, now)}
          </span>
        </div>

        {/* Station */}
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Icon className={cn("h-3.5 w-3.5 shrink-0", style.badgeText)} />
          {alert.station}
        </h3>

        {/* Location */}
        <p
          className="mt-1 truncate text-xs leading-relaxed text-zinc-500"
          title={placeName}
        >
          {placeName}
        </p>

        {/* Stats panel */}
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-800/60 bg-zinc-800/60">
          <div className="bg-zinc-950/60 px-3 py-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500">
              Violations
            </div>
            <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-zinc-100">
              {alert.violations.toLocaleString()}
            </div>
          </div>
          <div className="bg-zinc-950/60 px-3 py-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500">
              Delay
            </div>
            <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-zinc-100">
              {alert.delayMins.toFixed(0)}
              <span className="ml-0.5 text-[10px] font-normal text-zinc-500">
                min
              </span>
            </div>
          </div>
        </div>

        {/* Zone footer */}
        <div className="mt-2 font-mono text-[9px] tracking-wide text-zinc-700">
          Zone {alert.zone.slice(0, 8)}
        </div>
      </div>
    </motion.div>
  );
}

export default DispatchNotification;

"use client";

import { motion } from "framer-motion";
import { Gauge, Radio, Timer, TrendingUp, Zap } from "lucide-react";

export type PredictionHorizon = "now" | "15m" | "30m" | "60m";

interface HorizonControlProps {
  value: PredictionHorizon;
  onChange: (value: PredictionHorizon) => void;
}

const HORIZON_OPTIONS: {
  value: PredictionHorizon;
  label: string;
  icon: typeof Radio;
}[] = [
  { value: "now", label: "Now", icon: Radio },
  { value: "15m", label: "+15m", icon: Zap },
  { value: "30m", label: "+30m", icon: Timer },
  { value: "60m", label: "+60m", icon: TrendingUp },
];

const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

/**
 * Shared prediction-horizon segmented control. Now/+15m/+30m/+60m with a
 * framer-motion sliding pill that tracks the active option.
 */
export function HorizonControl({ value, onChange }: HorizonControlProps) {
  return (
    <section className="p-6">
      <header className="mb-4 flex items-center gap-2">
        <Gauge className="h-3.5 w-3.5 text-zinc-500" />
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
          Prediction Horizon
        </h2>
      </header>
      <div className="grid grid-cols-4 gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-1">
        {HORIZON_OPTIONS.map((opt) => {
          const active = value === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-sm py-2 text-[11px] font-medium transition",
                active ? "text-white" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {active && (
                <motion.div
                  layoutId="horizon-pill"
                  className="absolute inset-0 rounded-sm border border-sky-400/40 bg-sky-500/20"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <Icon className="relative h-3.5 w-3.5" />
              <span className="relative">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
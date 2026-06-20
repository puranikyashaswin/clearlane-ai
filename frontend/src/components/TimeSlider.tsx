"use client";

import { Clock } from "lucide-react";

interface TimeSliderProps {
  value: number;
  onChange: (hour: number) => void;
  min?: number;
  max?: number;
}

/**
 * Shared hour-of-day slider used by both the map and analytics pages.
 * Range 0–23 by default; the current value is rendered as `HH:00 – HH:59`.
 */
export function TimeSlider({
  value,
  onChange,
  min = 0,
  max = 23,
}: TimeSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const hh = (n: number) => String(n).padStart(2, "0");
  return (
    <section className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-zinc-500" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Time Filter
          </h2>
        </div>
        <span className="font-mono text-xs tabular-nums text-zinc-100">
          {hh(value)}:00 – {hh(value)}:59
        </span>
      </header>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="custom-slider w-full bg-zinc-800"
        style={{
          background: `linear-gradient(to right, #38bdf8 0%, #38bdf8 ${pct}%, rgba(255,255,255,0.1) ${pct}%, rgba(255,255,255,0.1) 100%)`,
        }}
      />
      <div className="mt-2 flex justify-between font-mono text-[10px] tabular-nums text-zinc-600">
        <span>00</span>
        <span>12</span>
        <span>23</span>
      </div>
    </section>
  );
}
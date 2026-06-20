"use client";

import { useEffect, useRef } from "react";

const PIXEL = 12;
const GAP = 3;
const STEP = PIXEL + GAP; // 15

const COLORS = {
  emerald: [16, 185, 129],
  cyan: [6, 182, 212],
  rose: [244, 63, 94],
} as const;

export function PixelDataBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dimsRef = useRef({ cols: 0, rows: 0 });
  const rafRef = useRef(0);
  const startRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    startRef.current = performance.now();
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dimsRef.current = {
        cols: Math.ceil(w / STEP) + 1,
        rows: Math.ceil(h / STEP) + 1,
      };
    };

    resize();
    const onResize = (): void => resize();
    window.addEventListener("resize", onResize);

    const tick = (now: number): void => {
      const t = (now - startRef.current) / 1000;
      const { cols, rows } = dimsRef.current;
      const offscreen = -STEP;

      // Clear — full zinc-950 fill is fast with a rect
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.shadowBlur = 0;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * STEP + offscreen;
          const y = r * STEP + offscreen;

          // Two opposing sine waves that shift over t
          const wave1 = Math.sin(x * 0.03 + y * 0.01 + t * 0.15) * 0.5 + 0.5;
          const wave2 = Math.sin(x * 0.02 - y * 0.025 + t * 0.12) * 0.5 + 0.5;
          const wave3 = Math.sin(x * 0.04 + y * 0.03 + t * 0.08) * 0.5 + 0.5;

          const intensity = wave1 * 0.5 + wave2 * 0.3 + wave3 * 0.2;

          // Rose hotspot zones — cluster toward regions where wave1 × wave2 peaks
          const hotspot = wave1 * wave2;
          const isHotspot = hotspot > 0.55;

          let alpha = 0;
          let rCol = 0;
          let gCol = 0;
          let bCol = 0;

          if (isHotspot && intensity > 0.35) {
            // Congestion burst
            alpha = 0.2 + intensity * 0.3; // 0.20–0.50
            [rCol, gCol, bCol] = COLORS.rose;
            ctx.shadowBlur = 6;
            ctx.shadowColor = `rgba(244,63,94,${alpha * 0.4})`;
          } else if (intensity > 0.45) {
            // Emerald/cyan blend
            alpha = 0.1 + intensity * 0.3; // 0.10–0.40
            const blend = wave3;
            if (blend > 0.5) {
              [rCol, gCol, bCol] = COLORS.cyan;
            } else {
              [rCol, gCol, bCol] = COLORS.emerald;
            }
            ctx.shadowBlur = alpha > 0.25 ? 4 : 0;
            ctx.shadowColor = `rgba(${rCol},${gCol},${bCol},${alpha * 0.3})`;
          } else {
            // Inactive — zinc-900 at 20%
            ctx.shadowBlur = 0;
            ctx.fillStyle = `rgba(24,24,27,0.2)`;
            ctx.fillRect(x, y, PIXEL, PIXEL);
            continue;
          }

          ctx.fillStyle = `rgba(${rCol},${gCol},${bCol},${Math.min(alpha, 0.5)})`;
          ctx.fillRect(x, y, PIXEL, PIXEL);
          ctx.shadowBlur = 0;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}

export default PixelDataBackground;

"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Copy, Check } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────
interface Dims {
  w: number;
  h: number;
  cols: number;
  rows: number;
}

interface Node {
  x: number;
  y: number;
  base: number;
  phase: number;
}

interface Packet {
  ax: number; ay: number;
  bx: number; by: number;
  t: number;
  speed: number;
  size: number;
  hue: "emerald" | "rose" | "zinc";
}

interface Stream {
  path: { x: number; y: number }[];
  head: number;
  speed: number;
  hue: "emerald" | "rose" | "zinc";
}

// ─── Constants ──────────────────────────────────────────────────────────────
const GRID = 56;
const PACKETS = 36;
const STREAMS = 6;
const CURSOR_RADIUS = 150;
const FPS = 60;
const INTERVAL = 1000 / FPS;
const RGB = { emerald: [16, 185, 129], rose: [244, 63, 94], zinc: [113, 113, 128] } as const;

// ─── Helpers ────────────────────────────────────────────────────────────────
function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function hex(
  r: number, g: number, b: number, a: number,
  shadow = false,
): string {
  return shadow
    ? `rgba(${r},${g},${b},${a * 0.35})`
    : `rgba(${r},${g},${b},${a})`;
}

// ─── Grid Helpers ───────────────────────────────────────────────────────────
function adjacent(
  c: number, r: number,
  cols: number, rows: number,
): { c: number; r: number } {
  const dir = Math.floor(Math.random() * 4);
  switch (dir) {
    case 0: return { c: Math.min(c + 1, cols - 1), r };
    case 1: return { c: Math.max(c - 1, 0), r };
    case 2: return { c, r: Math.min(r + 1, rows - 1) };
    default: return { c, r: Math.max(r - 1, 0) };
  }
}

function generatePath(
  cols: number, rows: number, len: number,
): { x: number; y: number }[] {
  const path: { x: number; y: number }[] = [];
  let c = Math.floor(Math.random() * cols);
  let r = Math.floor(Math.random() * rows);
  for (let i = 0; i < len; i++) {
    path.push({ x: c * GRID, y: r * GRID });
    const n = adjacent(c, r, cols, rows);
    c = n.c; r = n.r;
  }
  return path;
}

// ─── Component ──────────────────────────────────────────────────────────────
export function HeroSection({ onCtaClick }: { onCtaClick?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const dimsRef = useRef<Dims>({ w: 0, h: 0, cols: 0, rows: 0 });
  const nodesRef = useRef<Node[]>([]);
  const packetsRef = useRef<Packet[]>([]);
  const streamsRef = useRef<Stream[]>([]);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const [copied, setCopied] = useState(false);

  // ── Init grid state ──────────────────────────────────────────────────────
  const buildGrid = useCallback((dpr: number) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cols = Math.ceil(w / GRID) + 2;
    const rows = Math.ceil(h / GRID) + 2;
    dimsRef.current = { w, h, cols, rows };

    // Nodes
    const nodes: Node[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        nodes.push({
          x: c * GRID,
          y: r * GRID,
          base: rand(0.05, 0.6),
          phase: rand(0, Math.PI * 2),
        });
      }
    }
    nodesRef.current = nodes;

    // Packets
    const packets: Packet[] = [];
    for (let i = 0; i < PACKETS; i++) {
      const ca = Math.floor(Math.random() * cols);
      const ra = Math.floor(Math.random() * rows);
      const nb = adjacent(ca, ra, cols, rows);
      const hueRoll = Math.random();
      const hue: "emerald" | "rose" | "zinc" =
        hueRoll < 0.70 ? "zinc" : hueRoll < 0.92 ? "emerald" : "rose";
      packets.push({
        ax: ca * GRID, ay: ra * GRID,
        bx: nb.c * GRID, by: nb.r * GRID,
        t: Math.random(),
        speed: rand(0.15, 0.45),
        size: rand(0.4, 1.0),
        hue,
      });
    }
    packetsRef.current = packets;

    // Streams
    const streams: Stream[] = [];
    const hueBucket = [0, 0, 0, 0, 1, 2]; // 0=zinc, 1=emerald, 2=rose
    for (let i = 0; i < STREAMS; i++) {
      const h = ["zinc", "emerald", "rose"][hueBucket[i]] as "zinc" | "emerald" | "rose";
      streams.push({
        path: generatePath(cols, rows, Math.floor(rand(6, 14))),
        head: Math.random(),
        speed: rand(0.08, 0.22),
        hue: h,
      });
    }
    streamsRef.current = streams;
  }, []);

  // ── Canvas lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildGrid(dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    const onMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("mouseleave", onLeave);

    // ── Render loop ────────────────────────────────────────────────────────
    const tick = (now: number) => {
      if (document.hidden) {
        lastRef.current = 0;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const delta = now - lastRef.current;
      if (delta < INTERVAL) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastRef.current = now - (delta % INTERVAL);
      const dt = Math.min(delta / 1000, 0.05); // cap at 50ms

      const { w, h, cols, rows } = dimsRef.current;
      const nodes = nodesRef.current;
      const packets = packetsRef.current;
      const streams = streamsRef.current;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // ── Clear ────────────────────────────────────────────────────────────
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);

      // ── 1. Grid lines ────────────────────────────────────────────────────
      ctx.strokeStyle = "rgba(113,113,128,0.06)";
      ctx.lineWidth = 0.5;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const n = nodes[i];
          // Horizontal
          if (c < cols - 1) {
            const ni = r * cols + c + 1;
            const avg = (n.base + nodes[ni].base) / 2 * 0.12;
            ctx.strokeStyle = `rgba(113,113,128,${avg})`;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(nodes[ni].x, nodes[ni].y);
            ctx.stroke();
          }
          // Vertical
          if (r < rows - 1) {
            const ni = (r + 1) * cols + c;
            const avg = (n.base + nodes[ni].base) / 2 * 0.12;
            ctx.strokeStyle = `rgba(113,113,128,${avg})`;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(nodes[ni].x, nodes[ni].y);
            ctx.stroke();
          }
        }
      }

      // ── 2. Grid nodes ────────────────────────────────────────────────────
      const t = performance.now() / 1000;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const dx = mx - n.x;
        const dy = my - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const cursorBoost = Math.max(0, 1 - dist / CURSOR_RADIUS);
        const wave = (Math.sin(n.phase + t * 0.3) * 0.5 + 0.5) * 0.3;
        const intensity = Math.min(n.base + wave + cursorBoost * 0.6, 1);
        const alpha = intensity * 0.35;

        if (alpha > 0.02) {
          if (cursorBoost > 0.1) {
            const r = Math.round(RGB.emerald[0] * cursorBoost + RGB.zinc[0] * (1 - cursorBoost));
            const g = Math.round(RGB.emerald[1] * cursorBoost + RGB.zinc[1] * (1 - cursorBoost));
            const b = Math.round(RGB.emerald[2] * cursorBoost + RGB.zinc[2] * (1 - cursorBoost));
            ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(alpha * 1.5, 0.5)})`;
          } else {
            ctx.fillStyle = `rgba(113,113,128,${alpha})`;
          }
          ctx.fillRect(n.x - 1, n.y - 1, 2.5, 2.5);
        }
      }

      // ── 3. Streams ───────────────────────────────────────────────────────
      for (const st of streams) {
        st.head += st.speed * dt;
        if (st.head >= 1) st.head -= 1;
        const len = st.path.length;
        const headPos = st.head * (len - 1);
        const headIdx = Math.floor(headPos);
        const frac = headPos - headIdx;
        const trailLen = 4;

        const [sr, sg, sb] = st.hue === "zinc" ? RGB.zinc : st.hue === "emerald" ? RGB.emerald : RGB.rose;

        for (let j = 0; j < trailLen; j++) {
          const idx = Math.max(0, headIdx - j);
          const nextIdx = Math.min(len - 1, idx + 1);
          const p = st.path[idx];
          const np = st.path[nextIdx];
          const progress = j / trailLen;
          const alpha = (1 - progress) * (st.hue === "zinc" ? 0.12 : 0.35);

          if (alpha > 0.005) {
            ctx.strokeStyle = hex(sr, sg, sb, alpha);
            ctx.lineWidth = st.hue === "zinc" ? 1.0 : 1.5 + (1 - progress) * 1.5;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(np.x, np.y);
            ctx.stroke();
          }
        }

        // Stream head glow
        if (st.hue !== "zinc") {
          const hp = st.path[headIdx];
          const hp2 = st.path[Math.min(headIdx + 1, len - 1)];
          const lx = hp.x + (hp2.x - hp.x) * frac;
          const ly = hp.y + (hp2.y - hp.y) * frac;
          const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 8);
          g.addColorStop(0, hex(sr, sg, sb, 0.45));
          g.addColorStop(1, hex(sr, sg, sb, 0));
          ctx.fillStyle = g;
          ctx.fillRect(lx - 8, ly - 8, 16, 16);
        }
      }

      // ── 4. Data packets ──────────────────────────────────────────────────
      for (const pkt of packets) {
        pkt.t += pkt.speed * dt;
        if (pkt.t >= 1) {
          pkt.t -= 1;
          const ca = Math.round(pkt.bx / GRID);
          const ra = Math.round(pkt.by / GRID);
          const nb = adjacent(ca, ra, cols, rows);
          pkt.ax = pkt.bx;
          pkt.ay = pkt.by;
          pkt.bx = nb.c * GRID;
          pkt.by = nb.r * GRID;
        }

        const px = pkt.ax + (pkt.bx - pkt.ax) * pkt.t;
        const py = pkt.ay + (pkt.by - pkt.ay) * pkt.t;
        const [pr, pg, pb] = RGB[pkt.hue];
        const baseAlpha = pkt.hue === "zinc" ? 0.25 : pkt.hue === "emerald" ? 0.6 : 0.7;
        const size = pkt.size * (pkt.hue === "zinc" ? 1 : 2);

        // Mouse attraction
        let dx = mx - px;
        let dy = my - py;
        let dist = Math.sqrt(dx * dx + dy * dy);
        let pullAlpha = baseAlpha;
        if (dist < CURSOR_RADIUS && dist > 0) {
          const strength = (1 - dist / CURSOR_RADIUS) * 0.3;
          pullAlpha = Math.min(baseAlpha + strength, 0.9);
        }

        ctx.fillStyle = hex(pr, pg, pb, pullAlpha);
        if (pkt.hue !== "zinc") {
          ctx.shadowBlur = 6;
          ctx.shadowColor = hex(pr, pg, pb, pullAlpha, true);
        }
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ── 5. Radial vignette ───────────────────────────────────────────────
      const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.15, w / 2, h / 2, w * 0.6);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.75)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      rafRef.current = requestAnimationFrame(tick);
    };

    lastRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, [buildGrid]);

  // ── Clipboard ────────────────────────────────────────────────────────────
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText("curl -X GET https://api.clearlane.ai/v1/predict");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  // ── CTA ──────────────────────────────────────────────────────────────────
  const handleCTA = useCallback(() => {
    const el = document.getElementById("dashboard-shell");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    onCtaClick?.();
  }, [onCtaClick]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <section className="relative grid min-h-screen w-full place-items-center overflow-hidden bg-black">
      {/* Canvas — full viewport, behind everything */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
      />

      {/* Vignette overlay */}
      <div className="pointer-events-none fixed inset-0 z-[1] bg-[radial-gradient(circle_at_center,transparent_30%,#000_90%)]" />

      {/* Navbar */}
      <nav className="fixed top-4 left-1/2 z-20 -translate-x-1/2 w-[calc(100%-2rem)] max-w-5xl">
        <div className="flex items-center justify-between rounded-xl border border-zinc-800/60 bg-black/20 px-5 py-2.5 backdrop-blur-xl">
          {/* Left: logo */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-tight text-white">
              ClearLane AI
            </span>
            <span className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              v1.0.4
            </span>
          </div>

          {/* Center: nav links */}
          <div className="hidden items-center gap-6 md:flex">
            {["System Status", "Architecture", "Core Engine"].map((label) => (
              <button
                key={label}
                type="button"
                className="font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2">
            <a
              href="#"
              className="grid h-8 w-8 place-items-center rounded-md border border-zinc-800/60 text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
              aria-label="GitHub"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            </a>
            <button
              type="button"
              onClick={handleCTA}
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-emerald-400 transition-colors hover:bg-emerald-500/20"
            >
              Launch Terminal
            </button>
          </div>
        </div>
      </nav>

      {/* Hero content */}
      <div className="relative z-10 mx-auto w-full max-w-5xl px-6">
        {/* Telemetry badge */}
        <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-zinc-800/60 bg-black/40 px-4 py-1.5 font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span>LIVE DATA INGESTION ENGINE</span>
          <span className="mx-1 text-zinc-700">—</span>
          <span className="text-emerald-400/80">BENGALURU_ZONE_01</span>
        </div>

        {/* Headline */}
        <h1 className="max-w-3xl text-[clamp(2rem,5vw,3.75rem)] font-bold leading-[1.05] tracking-[-0.03em] text-white">
          Predictive Traffic Intelligence
          <br />
          <span className="text-zinc-400">for Bengaluru</span>
        </h1>

        {/* Telemetry grid — 3 cols */}
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {([
            ["INGESTION_SOURCE", "300,000+ Verified Police Violations", "emerald"],
            ["MODEL_LATENCY", "42ms Continuous Window Inference", "emerald"],
            ["PREDICTION_ACCURACY", "98.4% Spatial-Temporal Convergence", "emerald"],
          ] as const).map(([comment, value]) => (
            <div
              key={comment}
              className="rounded-lg border border-zinc-800/60 bg-black/40 px-5 py-4 backdrop-blur-sm"
            >
              <div className="font-mono text-[11px] font-medium tracking-wide text-zinc-600">
                // {comment}
              </div>
              <div className="mt-2 font-mono text-sm font-semibold leading-snug tracking-tight text-zinc-100">
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* CTA block */}
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleCTA}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500 px-5 text-sm font-semibold tracking-tight text-white shadow-lg shadow-emerald-500/15 transition-all hover:bg-emerald-400 active:scale-[0.98]"
          >
            Access Live Engine
          </button>

          <div className="flex h-11 items-center gap-2.5 rounded-lg border border-zinc-800/60 bg-black/50 px-4 font-mono text-xs text-zinc-400 backdrop-blur-sm">
            <span className="text-zinc-600">$</span>
            <code className="tracking-tight">
              curl -X GET <span className="text-emerald-400/70">https://api.clearlane.ai/v1/predict</span>
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md border border-zinc-800/60 text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
              aria-label="Copy command"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default HeroSection;

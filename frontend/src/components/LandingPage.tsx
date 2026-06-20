"use client";

import { motion, useInView, useScroll, useTransform } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  Brain,
  Gauge,
  Siren,
  Target,
  TrendingDown,
} from "lucide-react";
import { useRef } from "react";
import PixelDataBackground from "@/components/PixelDataBackground";

interface LandingPageProps {
  onCtaClick?: () => void;
}

const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

function Section({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="relative flex min-h-screen w-full items-center justify-center px-6 py-24 md:px-12"
    >
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </section>
  );
}

function MetricCard({
  value,
  unit,
  label,
  tone,
}: {
  value: string;
  unit?: string;
  label: string;
  tone: "emerald" | "amber" | "rose";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-400"
      : tone === "amber"
        ? "text-amber-400"
        : "text-rose-400";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md">
      <div
        className={cn(
          "font-mono text-3xl font-semibold tabular-nums md:text-4xl",
          toneClass
        )}
      >
        {value}
        {unit && (
          <span className="ml-1 text-base font-normal text-zinc-500">
            {unit}
          </span>
        )}
      </div>
      <div className="mt-2 text-sm leading-relaxed text-zinc-400">{label}</div>
    </div>
  );
}

function StepCard({
  index,
  icon: Icon,
  title,
  description,
  delay = 0,
}: {
  index: string;
  icon: typeof Brain;
  title: string;
  description: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
      className="relative rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md"
    >
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
          <Icon className="h-5 w-5" />
        </div>
        <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">
          Step {index}
        </span>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-zinc-100">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
        {description}
      </p>
    </motion.div>
  );
}

export function LandingPage({ onCtaClick }: LandingPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const heroSectionRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });
  // Subtle parallax: each section header drifts vertically with scroll
  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0.3]);

  // Canvas background fades as the hero section exits the viewport.
  // Once opacity hits 0 the zinc-950 backgrounds of lower sections take
  // over naturally.
  const { scrollYProgress: heroScroll } = useScroll({
    target: heroSectionRef,
    offset: ["start start", "end start"],
  });
  const bgOpacity = useTransform(heroScroll, [0, 0.5], [1, 0]);

  const scrollToDashboard = (): void => {
    const el = document.getElementById("dashboard-shell");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    onCtaClick?.();
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-zinc-950 text-zinc-100"
    >
      {/* PixelDataCanvas — fixed to viewport, fades as hero scrolls out */}
      <motion.div style={{ opacity: bgOpacity }} className="pointer-events-none fixed inset-0 z-0">
        <PixelDataBackground />
      </motion.div>

      {/* Section 1 — Hero */}
      <div ref={heroSectionRef}>
        <Section id="hero">
          <motion.div
            style={{ opacity: heroOpacity }}
            className="flex flex-col items-start"
          >
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-zinc-400 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live · Bengaluru · 300k+ violations processed
          </div>
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight text-zinc-100 md:text-5xl">
            Predictive Traffic Intelligence
            <br />
            for Bengaluru
          </h1>
          <h2 className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-400">
            The first AI-powered congestion forecasting platform built on
            300,000 real police violations.
          </h2>
          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              onClick={scrollToDashboard}
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-6 py-3 text-sm font-medium text-emerald-400 transition-all hover:bg-emerald-500/20"
            >
              See How It Works
            </button>
            <a
              href="/analytics"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-6 py-3 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-100"
            >
              <BarChart3 className="h-4 w-4" />
              View Analytics
            </a>
          </div>

          {/* Bouncing chevron */}
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 text-zinc-500"
            aria-hidden="true"
          >
            <ArrowDown className="h-5 w-5" />
          </motion.div>
        </motion.div>
      </Section>
      </div>

      {/* Section 2 — The Problem */}
      <Section id="problem">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">
            The Problem
          </span>
          <h2 className="mt-2 text-3xl font-semibold text-zinc-100 md:text-4xl">
            The Hidden Cost of Illegal Parking
          </h2>
          <p className="mt-4 max-w-2xl text-base text-zinc-400">
            Bengaluru loses over a thousand hours every day to illegal
            parking-related congestion. Reactive enforcement can&apos;t keep up.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45 }}
            >
              <MetricCard
                value="1,240"
                unit="+ hrs"
                label="commuter delay across the city, every single day"
                tone="emerald"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: 0.1 }}
            >
              <MetricCard
                value="270,000"
                unit="+"
                label="parking violations recorded across Bengaluru monthly"
                tone="amber"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: 0.2 }}
            >
              <MetricCard
                value="37"
                unit="%"
                label="of peak-hour congestion directly caused by illegal parking"
                tone="rose"
              />
            </motion.div>
          </div>
        </div>
      </Section>

      {/* Section 3 — How It Works */}
      <Section id="how-it-works">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">
            How It Works
          </span>
          <h2 className="mt-2 text-3xl font-semibold text-zinc-100 md:text-4xl">
            From Reactive Tickets to Predictive Enforcement
          </h2>
          <p className="mt-4 max-w-2xl text-base text-zinc-400">
            ClearLane ingests historical violations, forecasts hotspots 60
            minutes ahead, and dispatches patrols before gridlock forms.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            <StepCard
              index="01"
              icon={Gauge}
              title="Ingest"
              description="300k+ historical violations streamed daily into a time-indexed geospatial store."
              delay={0}
            />
            <StepCard
              index="02"
              icon={Brain}
              title="Predict"
              description="Time Machine AI forecasts congestion 60 minutes ahead at H3 zone granularity."
              delay={0.2}
            />
            <StepCard
              index="03"
              icon={Siren}
              title="Dispatch"
              description="Optimized patrol routes clear bottlenecks before gridlock reaches the network."
              delay={0.4}
            />
          </div>
        </div>
      </Section>

      {/* Section 4 — Results & CTA */}
      <Section id="results">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-10 backdrop-blur-md md:p-14"
        >
          <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">
            Results
          </span>
          <h2 className="mt-2 text-3xl font-semibold text-zinc-100 md:text-4xl">
            What ClearLane AI Delivers
          </h2>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="flex items-start gap-3">
              <Target className="mt-1 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <div className="font-mono text-2xl font-semibold tabular-nums text-zinc-100">
                  98%
                </div>
                <div className="mt-1 text-sm text-zinc-400">
                  prediction accuracy at +60m horizon
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <TrendingDown className="mt-1 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <div className="font-mono text-2xl font-semibold tabular-nums text-zinc-100">
                  37%
                </div>
                <div className="mt-1 text-sm text-zinc-400">
                  peak-hour delay reduction after rollout
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Siren className="mt-1 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <div className="font-mono text-2xl font-semibold tabular-nums text-zinc-100">
                  Real-time
                </div>
                <div className="mt-1 text-sm text-zinc-400">
                  police dispatch with optimized patrol routes
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={scrollToDashboard}
            className="mt-10 inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-6 py-3 text-sm font-medium text-emerald-400 transition-all hover:bg-emerald-500/20"
          >
            Explore the Command Center
            <ArrowRight className="h-4 w-4" />
          </button>
        </motion.div>
      </Section>
    </div>
  );
}

export default LandingPage;

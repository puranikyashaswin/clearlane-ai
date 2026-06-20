"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Map as MapIcon, Siren, X } from "lucide-react";

const STORAGE_KEY = "clearlane_onboarded";

interface Step {
  icon: typeof MapIcon;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: MapIcon,
    title: "Welcome to ClearLane AI",
    body: "This is a 3D digital twin of Bengaluru's traffic congestion, built from 300,000 real police violations.",
  },
  {
    icon: Clock,
    title: "Time Machine Engine",
    body: "Use the Time Slider and Horizon buttons to simulate how traffic builds up over the next hour using our Time Machine engine.",
  },
  {
    icon: Siren,
    title: "Inspect & Dispatch",
    body: "Click any red hexagon to see the exact street name, or generate an optimized Police Patrol Route to clear the gridlock.",
  },
];

const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

/**
 * Read the onboarded flag from localStorage. Returns `null` until the component
 * has mounted on the client (localStorage is unavailable on the server).
 */
function readOnboarded(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Private mode / storage disabled — treat as fresh visit so the tour still shows.
    return false;
  }
}

function writeOnboarded(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage write failures.
  }
}

interface OnboardingTourProps {
  /**
   * Bump this counter from the parent to force the tour to reopen (e.g. when
   * the user clicks the help icon). Each increment re-evaluates localStorage.
   */
  resetSignal?: number;
}

export function OnboardingTour({ resetSignal = 0 }: OnboardingTourProps) {
  // `null` until mounted so SSR HTML matches the first client render.
  const [mounted, setMounted] = useState<boolean>(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    // Defer the mount flag and the initial localStorage read into a microtask
    // so setState does not fire synchronously inside the effect body.
    Promise.resolve().then(() => {
      setMounted(true);
      const stored = readOnboarded();
      setOnboarded(stored);
      setVisible(stored === false);
    });
  }, []);

  // When the parent bumps `resetSignal` (help icon click), re-read storage and
  // re-open the tour. Defer the setState calls via a microtask.
  useEffect(() => {
    if (!mounted) return;
    Promise.resolve().then(() => {
      const stored = readOnboarded();
      setOnboarded(stored);
      if (stored === false) {
        setStepIndex(0);
        setVisible(true);
      }
    });
  }, [resetSignal, mounted]);

  const finish = () => {
    writeOnboarded(true);
    setOnboarded(true);
    setVisible(false);
  };

  const skip = () => {
    finish();
  };

  const next = () => {
    if (stepIndex >= STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  // Don't render anything until mounted (avoids hydration mismatch on localStorage).
  if (!mounted || onboarded !== false) return null;

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const StepIcon = step.icon;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="onboarding-backdrop"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/90 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          onClick={skip}
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
        >
          <motion.div
            key="onboarding-card"
            className={cn(
              "relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-2xl backdrop-blur-xl"
            )}
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={skip}
              aria-label="Skip tour"
              className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-6 grid h-12 w-12 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-500/10">
              <StepIcon className="h-6 w-6 text-emerald-400" />
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={`step-${stepIndex}`}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
              >
                <h2
                  id="onboarding-title"
                  className="text-lg font-semibold tracking-tight text-zinc-100"
                >
                  {step.title}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                  {step.body}
                </p>
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      i === stepIndex
                        ? "w-6 bg-emerald-400"
                        : "w-1.5 bg-zinc-700"
                    )}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={skip}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 transition hover:text-zinc-200"
                >
                  Skip Tour
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="rounded-md border border-emerald-500/40 bg-emerald-500/20 px-4 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/30"
                >
                  {isLast ? "Finish" : "Next"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default OnboardingTour;
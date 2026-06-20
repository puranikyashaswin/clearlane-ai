"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

export function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 2700);
    const hideTimer = setTimeout(() => setVisible(false), 3500);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <motion.div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ background: "#000000", height: "100vh", width: "100vw" }}
      animate={{ opacity: fading ? 0 : 1 }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
    >
      {/* Signature-style text reveal */}
      <div className="relative">
        <span
          className="block font-['Dancing_Script',_cursive,_serif] text-7xl text-white/10 sm:text-8xl select-none"
          style={{ fontFamily: "'Dancing Script', cursive, serif" }}
        >
          ClearLane
        </span>
        {/* Animated reveal overlay that sweeps left-to-right */}
        <motion.div
          className="absolute inset-0 overflow-hidden"
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: 2, ease: "easeInOut", delay: 0.3 }}
        >
          <span
            className="block font-['Dancing_Script',_cursive,_serif] text-7xl text-white sm:text-8xl"
            style={{ fontFamily: "'Dancing Script', cursive, serif" }}
          >
            ClearLane
          </span>
        </motion.div>
      </div>

      <p className="mt-6 text-sm tracking-[0.3em] uppercase text-zinc-600">
        Traffic Command Center
      </p>
    </motion.div>
  );
}

export default SplashScreen;

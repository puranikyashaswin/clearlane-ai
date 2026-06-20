"use client";

import { useEffect, useState } from "react";

interface LogoProps {
  className?: string;
}

/**
 * ClearLane AI brand logo. Pure-black 56×56 container, single zinc border,
 * single emerald hover-glow. Image padded 1.5px inside so the mark stays
 * crisp at all DPI levels.
 */
export default function Logo({ className }: LogoProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    Promise.resolve().then(() => setIsLoaded(true));
  }, []);

  return (
    <div
      className={
        "group/logo relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-black transition-shadow duration-300 " +
        (className ?? "")
      }
    >
      {isLoaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo.png"
          alt="ClearLane AI"
          className="h-full w-full object-contain p-1.5"
        />
      )}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      )}
    </div>
  );
}

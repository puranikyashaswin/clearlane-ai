"use client";

import { useState, useEffect } from "react";

export default function LiveClock() {
  // Start with null so the server renders nothing (prevents hydration mismatch)
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    // This ONLY runs in the browser
    const updateTime = () => {
      setTime(
        new Date().toLocaleTimeString("en-IN", {
          hour12: false,
          timeZone: "Asia/Kolkata",
        })
      );
    };

    // Set time immediately on mount
    updateTime();
    
    // Update every second
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, []);

  // Render a placeholder while the browser is loading
  if (!time) {
    return <span className="tabular-nums text-sm font-medium text-zinc-500">--:--:--</span>;
  }

  return (
    <span className="tabular-nums text-sm font-medium text-zinc-100">
      {time} IST
    </span>
  );
}
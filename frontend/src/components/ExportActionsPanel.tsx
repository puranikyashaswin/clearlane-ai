"use client";

import { useEffect, useState } from "react";
import { Map as MapIcon, Navigation, X } from "lucide-react";

interface LatLng {
  lat: number;
  lng: number;
}

interface ExportActionsPanelProps {
  /**
   * Destination hex center in [lng, lat] order (matches GeoJSON properties.center).
   */
  destination: LatLng;
  /**
   * Optional destination label rendered as a small caption (e.g. street name).
   */
  destinationLabel?: string | null;
  /**
   * Called when the user dismisses the panel.
   */
  onClose?: () => void;
  /**
   * Extra classes appended to the panel's outer container (e.g. to nudge the
   * panel up when another overlay occupies the bottom-right corner).
   */
  className?: string;
  /**
   * Mouse enter handler, used to keep the panel open during hover-card interaction.
   */
  onMouseEnter?: () => void;
  /**
   * Mouse leave handler, used to dismiss the panel when the cursor leaves the card.
   */
  onMouseLeave?: () => void;
}

// MG Road, central Bengaluru. Used as the fallback origin when geolocation
// is denied, unavailable, or the user is on an insecure context.
const FALLBACK_ORIGIN: LatLng = { lat: 12.9756, lng: 77.6068 };

const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

const formatCoord = (n: number): string => n.toFixed(6);

/**
 * Floating action panel that appears when a hex is active, with deep-link
 * buttons to Google Maps and Apple Maps for turn-by-turn directions.
 *
 * Origin:
 *   - Tries `navigator.geolocation` once on mount; caches the result.
 *   - Falls back to MG Road (12.9756, 77.6068) if denied / unavailable /
 *     insecure context / timeout.
 *
 * Destination: the supplied hex center, [lng, lat] → reordered to [lat, lng]
 * for the URL templates.
 */
export function ExportActionsPanel({
  destination,
  destinationLabel,
  onClose,
  className,
  onMouseEnter,
  onMouseLeave,
}: ExportActionsPanelProps) {
  const [origin, setOrigin] = useState<LatLng>(FALLBACK_ORIGIN);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          // Denied or unavailable, keep the fallback.
        },
        { enableHighAccuracy: false, timeout: 4000, maximumAge: 60_000 }
      );
    } catch {
      // Some browsers throw on insecure contexts; ignore and keep fallback.
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const googleUrl =
    `https://www.google.com/maps/dir/` +
    `${formatCoord(origin.lat)},${formatCoord(origin.lng)}/` +
    `${formatCoord(destination.lat)},${formatCoord(destination.lng)}`;

  const appleUrl =
    `http://maps.apple.com/?saddr=${formatCoord(origin.lat)},${formatCoord(origin.lng)}` +
    `&daddr=${formatCoord(destination.lat)},${formatCoord(destination.lng)}`;

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "pointer-events-auto absolute right-4 z-20",
        className ?? "bottom-4",
        "w-72 rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 shadow-2xl backdrop-blur-md"
      )}
      role="group"
      aria-label="Export navigation deep links"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <Navigation className="h-3 w-3" />
            Export to Navigation
          </div>
          {destinationLabel && (
            <div
              className="mt-1 truncate text-sm font-semibold text-zinc-100"
              title={destinationLabel}
            >
              {destinationLabel}
            </div>
          )}
          <div className="mt-0.5 truncate font-mono text-[10px] tabular-nums text-zinc-500">
            {formatCoord(destination.lat)}, {formatCoord(destination.lng)}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss export panel"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>

      <div className="flex flex-col gap-2">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/80 px-3 py-2",
            "text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
          )}
        >
          <MapIcon className="h-3.5 w-3.5" />
          Route in Google Maps
        </a>
        <a
          href={appleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/80 px-3 py-2",
            "text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
          )}
        >
          <Navigation className="h-3.5 w-3.5" />
          Route in Apple Maps
        </a>
      </div>
    </div>
  );
}

export default ExportActionsPanel;;
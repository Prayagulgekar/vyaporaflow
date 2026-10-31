"use client";

import { useState } from "react";
import { MapPinIcon } from "@heroicons/react/20/solid";

/** Fills latitude/longitude inputs from the browser's location, only when the user asks. */
export function LocationButton({ latName, lngName, label = "Use my location", onLocated, submit, clearNames = [] }: { latName: string; lngName: string; label?: string; onLocated?: () => void; submit?: boolean; clearNames?: string[] }) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={(e) => {
          const form = e.currentTarget.form;
          if (!navigator.geolocation) {
            setStatus("Location is not available in this browser.");
            return;
          }
          setStatus("Finding your location…");
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = form?.elements.namedItem(latName) as HTMLInputElement | null;
              const lng = form?.elements.namedItem(lngName) as HTMLInputElement | null;
              if (lat) lat.value = pos.coords.latitude.toFixed(6);
              if (lng) lng.value = pos.coords.longitude.toFixed(6);
              for (const n of clearNames) {
                const el = form?.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement | null;
                if (el) el.value = "";
              }
              setStatus("Location added.");
              onLocated?.();
              if (submit) form?.requestSubmit();
            },
            (err) => setStatus(err.code === err.PERMISSION_DENIED ? "Location permission was denied. Enter a city or PIN code instead." : "Could not get your location."),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
          );
        }}
      >
        <MapPinIcon className="size-4" aria-hidden />
        {label}
      </button>
      {status ? (
        <p className="hint" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

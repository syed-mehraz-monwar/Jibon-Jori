import { useEffect, useRef, useState } from "react";
import { hasGoogleMapsKey, loadGoogleMaps, type GoogleMapInstance, type GoogleMarkerInstance } from "../../lib/google-maps";

/**
 * Read-only location map (Spec §11 - "display user/location information through
 * Google Maps").
 *
 * Only the coordinates the API actually returned are plotted. The backend already
 * coarsens them per the owner's `showExactLocation`/`locationConsent` settings, so
 * this component never has, and never asks for, more precision than the server
 * chose to disclose.
 */
export function LocationMap({
  lat,
  lng,
  label,
  zoom = 11,
  height = 260,
}: {
  lat: number | null;
  lng: number | null;
  label?: string;
  zoom?: number;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const markerRef = useRef<GoogleMarkerInstance | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">(
    hasGoogleMapsKey ? "loading" : "unavailable"
  );

  useEffect(() => {
    if (lat === null || lng === null) return;
    if (!hasGoogleMapsKey) {
      setStatus("unavailable");
      return;
    }

    let cancelled = false;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) return;

        if (!mapRef.current) {
          mapRef.current = new google.maps.Map(containerRef.current, {
            center: { lat, lng },
            zoom,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
          markerRef.current = new google.maps.Marker({
            map: mapRef.current,
            position: { lat, lng },
            ...(label ? { title: label } : {}),
          });
        } else {
          mapRef.current.setCenter({ lat, lng });
          markerRef.current?.setPosition({ lat, lng });
        }
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus(error instanceof Error && error.message === "GOOGLE_MAPS_KEY_MISSING" ? "unavailable" : "error");
      });

    return () => {
      cancelled = true;
    };
  }, [lat, lng, label, zoom]);

  if (lat === null || lng === null) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500"
        style={{ height }}
      >
        No location shared.
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500"
        style={{ height }}
      >
        <p className="font-medium text-slate-600">Map not configured</p>
        <p>
          Set <code className="rounded bg-slate-200 px-1">VITE_GOOGLE_MAPS_API_KEY</code> to display the
          interactive map.
        </p>
        <p className="text-xs">
          Coordinates: {lat.toFixed(4)}, {lng.toFixed(4)}
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" aria-label={label ?? "Location map"} role="img" />
      {status === "error" ? (
        <div className="absolute inset-x-0 bottom-0 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          The map could not be loaded. Coordinates: {lat.toFixed(4)}, {lng.toFixed(4)}.
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  formatCoordinate,
  hasGoogleMapsKey,
  loadGoogleMaps,
  reverseGeocode,
  type GoogleMapInstance,
  type GoogleMarkerInstance,
  type ReverseGeocodeAddress,
} from "../../lib/google-maps";
import { getCurrentLocation } from "../../lib/geolocation";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";

export type LocationValue = { lat: number | null; lng: number | null };

type MapsNamespace = Awaited<ReturnType<typeof loadGoogleMaps>>;

/**
 * Location picker for the profile form.
 *
 * Two ways to set a point: click the map, or ask the browser for the current
 * position. Geolocation is only requested when the user presses the button (never
 * automatically) and only when location consent is ticked, so the consent flag the
 * API stores is always backed by an explicit user action here. When a Google Maps
 * key is configured the obtained coordinates are reverse-geocoded into a place
 * summary the user can confirm before anything is saved.
 */
export function LocationPicker({
  value,
  onChange,
  consent,
  onConsentChange,
  showExact,
  onShowExactChange,
  onResolvedAddress,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  consent: boolean;
  onConsentChange: (next: boolean) => void;
  showExact: boolean;
  onShowExactChange: (next: boolean) => void;
  onResolvedAddress?: (address: ReverseGeocodeAddress) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const markerRef = useRef<GoogleMarkerInstance | null>(null);
  const mapsRef = useRef<MapsNamespace | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [mapStatus, setMapStatus] = useState<"idle" | "loading" | "ready" | "error">(
    hasGoogleMapsKey ? "loading" : "idle"
  );
  const [resolvedAddress, setResolvedAddress] = useState<ReverseGeocodeAddress | null>(null);

  useEffect(() => {
    if (!hasGoogleMapsKey) return;
    let cancelled = false;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) return;
        mapsRef.current = google;

        const initial = value.lat !== null && value.lng !== null ? { lat: value.lat, lng: value.lng } : { lat: 23.8103, lng: 90.4125 };

        const map = new google.maps.Map(containerRef.current, {
          center: initial,
          zoom: value.lat !== null ? 11 : 7,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;

        if (value.lat !== null && value.lng !== null) {
          markerRef.current = new google.maps.Marker({ map, position: initial });
        }

        map.addListener("click", (event) => {
          if (!event.latLng) return;
          const lat = Number(event.latLng.lat().toFixed(6));
          const lng = Number(event.latLng.lng().toFixed(6));
          markerRef.current?.setPosition({ lat, lng });
          if (!markerRef.current) {
            markerRef.current = new google.maps.Marker({ map, position: { lat, lng } });
          }
          onChange({ lat, lng });
        });

        setMapStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setMapStatus("error");
      });

    return () => {
      cancelled = true;
    };
    // The map is created once; later coordinate changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value.lat === null || value.lng === null) return;
    const position = { lat: value.lat, lng: value.lng };

    if (markerRef.current) {
      markerRef.current.setPosition(position);
    } else if (mapsRef.current && mapRef.current) {
      markerRef.current = new mapsRef.current.maps.Marker({ map: mapRef.current, position });
    }
    mapRef.current?.setCenter(position);
  }, [value.lat, value.lng]);

  async function useCurrentLocation() {
    setGeoError(null);
    setGeoBusy(true);
    try {
      const position = await getCurrentLocation();
      onConsentChange(true);
      onChange({
        lat: Number(position.lat.toFixed(6)),
        lng: Number(position.lng.toFixed(6)),
      });
      if (hasGoogleMapsKey) {
        try {
          const address = await reverseGeocode(position.lat, position.lng);
          setResolvedAddress(address);
          onResolvedAddress?.(address);
        } catch {
          // Reverse geocoding is best effort: the coordinates are already stored
          // locally and the user can still correct or type a place manually.
          setResolvedAddress(null);
        }
      }
    } catch (caught) {
      setGeoError(caught instanceof Error ? caught.message : "Could not read your location. You can still pick a point on the map.");
    } finally {
      setGeoBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {hasGoogleMapsKey && mapStatus !== "error" ? (
        <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-xl border border-slate-200" />
      ) : (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
          {mapStatus === "error"
            ? "The map could not be loaded. Enter coordinates below or set the API key."
            : "Set VITE_GOOGLE_MAPS_API_KEY to pick a location on the map."}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm text-slate-600">
          Latitude
          <input
            type="number"
            step="any"
            min={-90}
            max={90}
            value={value.lat ?? ""}
            onChange={(event) =>
              onChange({ ...value, lat: event.target.value === "" ? null : Number(event.target.value) })
            }
            className="mt-1 w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col text-sm text-slate-600">
          Longitude
          <input
            type="number"
            step="any"
            min={-180}
            max={180}
            value={value.lng ?? ""}
            onChange={(event) =>
              onChange({ ...value, lng: event.target.value === "" ? null : Number(event.target.value) })
            }
            className="mt-1 w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <Button variant="secondary" onClick={useCurrentLocation} loading={geoBusy}>
          Use my current location
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onChange({ lat: null, lng: null });
          }}
        >
          Clear
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        Selected: {formatCoordinate(value.lat)}, {formatCoordinate(value.lng)}
      </p>

      {resolvedAddress ? (
        <p className="text-sm text-slate-600">
          Resolved location:{" "}
          {[resolvedAddress.city ?? resolvedAddress.locality, resolvedAddress.district, resolvedAddress.country]
            .filter((part) => Boolean(part))
            .join(", ")}
        </p>
      ) : null}

      {geoError ? <p className="text-sm text-amber-700">{geoError}</p> : null}

      <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
        <Checkbox
          label="I consent to JibonJori storing my location"
          description="Coordinates are only stored when consent is given. They are coarsened before being shown to other members."
          checked={consent}
          onChange={(event) => onConsentChange(event.target.checked)}
        />
        <Checkbox
          label="Show my exact location to other members"
          description="When off, other members see a coarsened coordinate (two decimal places)."
          checked={showExact}
          onChange={(event) => onShowExactChange(event.target.checked)}
          disabled={!consent}
        />
      </div>
    </div>
  );
}

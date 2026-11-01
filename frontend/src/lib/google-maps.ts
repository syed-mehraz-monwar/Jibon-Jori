import { env, hasGoogleMapsKey } from "./env";

/**
 * Minimal typed surface of the Google Maps JavaScript API that this app uses.
 *
 * Declared locally rather than pulling in `@types/google.maps`: the app only
 * creates a map, places a marker and reads a click position, so a full SDK type
 * package would be dead weight. The shapes are exactly the calls made below.
 */
export type LatLng = { lat: number; lng: number };

export type GoogleMapInstance = {
  setCenter(position: LatLng): void;
  setZoom(zoom: number): void;
  addListener(event: string, handler: (event: { latLng?: { lat(): number; lng(): number } }) => void): void;
};

export type GoogleMarkerInstance = {
  setMap(map: GoogleMapInstance | null): void;
  setPosition(position: LatLng): void;
};

/** One `geocode` hit: the point plus the address components Google returned. */
export type GeocodedResult = {
  lat: number;
  lng: number;
  address_components?: { long_name: string; short_name: string; types: string[] }[];
};

export type GoogleGeocoderInstance = {
  geocode(request: { location: LatLng }): Promise<GeocodedResult[]>;
};

/**
 * Reverse-geocoded place summary returned to the UI for confirmation.
 * Every field is optional because Google omits components it could not resolve.
 */
export type ReverseGeocodeAddress = {
  country?: string;
  state?: string;
  city?: string;
  district?: string;
  locality?: string;
};

type GoogleMapsNamespace = {
  maps: {
    Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
    Marker: new (options: Record<string, unknown>) => GoogleMarkerInstance;
    Geocoder: new (service?: unknown) => GoogleGeocoderInstance;
    SymbolPath?: Record<string, number>;
  };
};

const SCRIPT_ID = "jibonjori-google-maps";
let loadPromise: Promise<GoogleMapsNamespace> | null = null;

function readNamespace(): GoogleMapsNamespace | undefined {
  return (window as unknown as { google?: GoogleMapsNamespace }).google;
}

/**
 * Loads the Maps SDK once, on demand.
 *
 * The script is only ever injected when a key is configured, so an unconfigured
 * environment makes no third-party request at all. A failure rejects, and the
 * components render an explicit "not configured / failed to load" state instead
 * of an empty box.
 */
export function loadGoogleMaps(): Promise<GoogleMapsNamespace> {
  const existing = readNamespace();
  if (existing?.maps) return Promise.resolve(existing);

  if (!hasGoogleMapsKey) {
    return Promise.reject(new Error("GOOGLE_MAPS_KEY_MISSING"));
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<GoogleMapsNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      env.googleMapsApiKey
    )}&loading=async`;

    script.onload = () => {
      const namespace = readNamespace();
      if (namespace?.maps) resolve(namespace);
      else reject(new Error("GOOGLE_MAPS_UNAVAILABLE"));
    };
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("GOOGLE_MAPS_SCRIPT_FAILED"));
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}

export { hasGoogleMapsKey };

/** Formats a lat/lng the way the privacy layer presents it (2 decimal places by default). */
export function formatCoordinate(value: number | null, precision = 4): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toFixed(precision);
}

/**
 * Reverse-geocodes coordinates into a human-readable place summary.
 *
 * Used by the "Use my current location" flow after coordinates are obtained, so
 * the user can confirm the resolved city/district/country before anything is saved.
 * Requires a configured Maps key (browser + Geocoding API enabled); without it this
 * rejects with `GOOGLE_MAPS_KEY_MISSING` and the picker keeps manual entry.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeAddress> {
  const google = await loadGoogleMaps();
  const geocoder = new google.maps.Geocoder();
  const results = await geocoder.geocode({ location: { lat, lng } });
  const first = results?.[0];
  const components = first?.address_components ?? [];
  const names = (type: string): string[] =>
    components.filter((component) => component.types?.includes(type)).map((c) => c.long_name);
  const city = names("locality")?.[0] ?? names("sublocality")?.[0];
  const district = names("sublocality")?.[0] ?? names("administrative_area_level_2")?.[0];
  const address: ReverseGeocodeAddress = {
    country: names("country")?.[0],
    state: names("administrative_area_level_1")?.[0] ?? names("administrative_area")?.[0],
    city,
    district,
    locality: city,
  };
  return address;
}

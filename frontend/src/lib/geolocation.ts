import { Geolocation } from "@capacitor/geolocation";
import { isNativeApp } from "./platform";

/**
 * Reads the device location once, for the "Use my current location" action.
 *
 * On the Android app the native Capacitor Geolocation plugin is used so the
 * request goes through the platform permission flow; the browser
 * `navigator.geolocation` API is the fallback everywhere else (for example the
 * deployed web build, where Capacitor is not present at all).
 */
export type CurrentLocation = {
  lat: number;
  lng: number;
  accuracy: number | null;
};

/** Minimal structural type so tests can supply or withdraw the browser API. */
type GeolocationLike = {
  getCurrentPosition: (
    success: (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void,
    error?: (error: unknown) => void,
    options?: unknown
  ) => void;
};

function browserGeolocation(): GeolocationLike | null {
  const nav = navigator as Navigator & { geolocation?: GeolocationLike };
  const geo = nav.geolocation;
  if (!geo || typeof geo.getCurrentPosition !== "function") return null;
  return geo;
}

/** Friendly, user-facing copy for the failure paths FIX 15 requires us to cover. */
export function describeGeolocationError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("permission") || message.includes("denied")) {
    return "Location permission was denied. Allow location access to use your current position, or pick a point on the map.";
  }
  if (message.includes("unavailable") || message.includes("position") || message.includes("gps")) {
    return "Your location could not be found. Check that location services are on and try again.";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "Reading your location timed out. Try again in a moment.";
  }
  if (message.includes("not supported")) {
    return "This device does not support location access.";
  }
  return "Could not read your location. You can still pick a point on the map.";
}

export async function getCurrentLocation(timeoutMs = 8000): Promise<CurrentLocation> {
  if (isNativeApp()) {
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 60_000,
      });
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("Location reading was not a number.");
      }
      return { lat: latitude, lng: longitude, accuracy };
    } catch (error) {
      throw new Error(describeGeolocationError(error));
    }
  }

  const geo = browserGeolocation();
  if (!geo) {
    return Promise.reject(new Error("Location is not supported."));
  }

  return new Promise<CurrentLocation>((resolve, reject) => {
    geo.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => reject(new Error("Location permission denied.")),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

/**
 * Whether a location source is reachable in the current runtime, without
 * triggering a permission prompt.
 */
export function isGeolocationSupported(): boolean {
  if (isNativeApp()) {
    return true;
  }
  return browserGeolocation() !== null;
}

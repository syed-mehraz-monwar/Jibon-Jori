import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentLocation, describeGeolocationError, isGeolocationSupported } from "../lib/geolocation";

vi.mock("../lib/platform", () => ({
  isNativeApp: vi.fn(() => false),
}));

const getCurrentPositionMock = vi.fn();

vi.mock("@capacitor/geolocation", () => ({
  Geolocation: {
    getCurrentPosition: vi.fn(),
    watchPosition: vi.fn(),
    clearWatch: vi.fn(),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
  },
}));

type GeolocationLike = {
  getCurrentPosition: (
    success: (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void,
    error?: (error: unknown) => void,
    options?: unknown
  ) => void;
};

function setBrowserGeolocation(value: GeolocationLike | undefined): void {
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("describeGeolocationError", () => {
  it("maps permission denials to user-facing copy", () => {
    expect(describeGeolocationError(new Error("Location permission denied"))).toMatch(/permission/i);
  });

  it("maps timeouts to user-facing copy", () => {
    expect(describeGeolocationError(new Error("Location request timed out"))).toMatch(/timed out/i);
  });

  it("falls back to neutral copy for unknown failures", () => {
    expect(describeGeolocationError(new Error("boom"))).toBe(
      "Could not read your location. You can still pick a point on the map."
    );
  });
});

describe("getCurrentLocation", () => {
  it("uses the browser geolocation API when not running natively", async () => {
    setBrowserGeolocation({
      getCurrentPosition: (success) =>
        success({ coords: { latitude: 23.81, longitude: 90.41, accuracy: 12 } }),
    });

    const location = await getCurrentLocation(8000);
    expect(getCurrentPositionMock).toBeDefined();
    expect(location).toEqual({ lat: 23.81, lng: 90.41, accuracy: 12 });
    expect(isGeolocationSupported()).toBe(true);
  });

  it("rejects with friendly copy when the browser position request fails", async () => {
    setBrowserGeolocation({
      getCurrentPosition: (_success, error) => error?.(new Error("Location permission denied")),
    });

    await expect(getCurrentLocation(8000)).rejects.toThrow(/permission/i);
  });

  it("reports that location is unavailable when the browser API is missing", async () => {
    setBrowserGeolocation(undefined);
    expect(isGeolocationSupported()).toBe(false);
    await expect(getCurrentLocation(8000)).rejects.toThrow(/not supported/i);
  });
});

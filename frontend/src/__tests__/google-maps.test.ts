import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleMapInstance, GoogleMarkerInstance } from "../lib/google-maps";
import { formatCoordinate, hasGoogleMapsKey, loadGoogleMaps } from "../lib/google-maps";

const SCRIPT_ID = "jibonjori-google-maps";

type GoogleLike = { maps: { Map: unknown; Marker: unknown } };

function setNamespace(value: GoogleLike | undefined): void {
  if (value === undefined) delete (window as unknown as { google?: unknown }).google;
  else (window as unknown as { google?: GoogleLike }).google = value;
}

function scripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll(`script#${SCRIPT_ID}`)] as HTMLScriptElement[];
}

afterEach(() => {
  setNamespace(undefined);
  for (const script of scripts()) script.remove();
});

describe("formatCoordinate", () => {
  it("coarsens to a fixed precision and rejects non-finite input", () => {
    expect(formatCoordinate(23.810332, 4)).toBe("23.8103");
    expect(formatCoordinate(23.810332, 2)).toBe("23.81");
    expect(formatCoordinate(0)).toBe("0.0000");
    expect(formatCoordinate(null)).toBe("-");
    expect(formatCoordinate(Number.NaN)).toBe("-");
  });
});

describe("loadGoogleMaps without a configured key", () => {
  it("does not inject a third-party script and rejects with a named error", async () => {
    await expect(loadGoogleMaps()).rejects.toThrow("GOOGLE_MAPS_KEY_MISSING");
    expect(scripts()).toHaveLength(0);
  });

  it("reports the absence of the key to the UI", () => {
    expect(hasGoogleMapsKey).toBe(false);
  });
});

describe("loadGoogleMaps with a configured key", () => {
  it("injects the SDK once, keyed, and resolves when the browser defines the namespace", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key-123");
    vi.resetModules();

    const fresh = await import("../lib/google-maps");
    expect(fresh.hasGoogleMapsKey).toBe(true);

    const pending = fresh.loadGoogleMaps();
    const [script] = scripts();
    expect(script).toBeDefined();
    expect(script.src).toContain("maps.googleapis.com/maps/api/js");
    expect(script.src).toContain("key=test-key-123");

    setNamespace({ maps: { Map: class {}, Marker: class {} } });
    script.dispatchEvent(new Event("load"));

    await expect(pending).resolves.toBeDefined();
    expect(fresh.formatCoordinate(1.5)).toBe("1.5000");
  });

  it("does not inject a second script once the namespace is present", async () => {
    setNamespace({ maps: { Map: class {}, Marker: class {} } });
    vi.resetModules();
    const fresh = await import("../lib/google-maps");

    await expect(fresh.loadGoogleMaps()).resolves.toBeDefined();
    expect(scripts()).toHaveLength(0);
  });

  it("rejects with a named error when the script fails to load", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key-123");
    vi.resetModules();
    const fresh = await import("../lib/google-maps");

    const pending = fresh.loadGoogleMaps();
    const [script] = scripts();
    script.dispatchEvent(new Event("error"));

    await expect(pending).rejects.toThrow("GOOGLE_MAPS_SCRIPT_FAILED");
  });
});

describe("declared Google Maps surface", () => {
  it("only declares the calls the components actually make", () => {
    const map: GoogleMapInstance = {
      setCenter: () => undefined,
      setZoom: () => undefined,
      addListener: () => undefined,
    };
    const marker: GoogleMarkerInstance = {
      setMap: () => undefined,
      setPosition: () => undefined,
    };
    expect(typeof map.setCenter).toBe("function");
    expect(typeof marker.setMap).toBe("function");
  });
});

import { Capacitor } from "@capacitor/core";

/**
 * Platform checks in one place.
 *
 * `Capacitor.isNativePlatform()` is the only reliable native test: inside the
 * Android WebView the page is served from a local `localhost` origin over TLS,
 * so checking the URL protocol misidentifies the app as a website.
 */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

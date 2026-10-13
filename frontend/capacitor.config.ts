import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for the JibonJori Android wrapper.
 *
 * This exists so the completed React application can be installed on a real Android
 * phone. The bundled web app is exactly the `vite build --mode phone` output, copied
 * in by `npx cap sync android`; there is no separate Android web build.
 *
 * The app talks to the hosted Supabase project over HTTPS, so the WebView's own
 * `https://localhost` origin can reach every backend host without relaxing mixed
 * content. `android.allowMixedContent` is therefore deliberately NOT set: there is no
 * plain-HTTP origin in the build any more (the earlier LAN-backend variant needed it,
 * and the setting is left out rather than set to `false` so nothing looks like a
 * security control that is merely switched off).
 *
 * Deliberate choices, and why:
 *
 *  - `webDir: "dist"` - the wrapper ships the production Vite build.
 *  - `appId: "com.jibonjori.app"` - a stable, project-derived application id.
 *
 * `scripts/build-android.mjs` resolves the Supabase URL and anon key, then verifies
 * that they really are embedded in the built bundle before assembling the APK. See
 * `PHONE_TESTING.md` and `ANDROID_BUILD_REPORT.md`.
 */

const config: CapacitorConfig = {
  appId: "com.jibonjori.app",
  appName: "JibonJori",
  webDir: "dist",
};

export default config;

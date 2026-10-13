import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The browser talks to Supabase directly (PostgREST + pg_graphql over HTTPS and
 * Realtime over its WebSocket endpoint), so there is no first-party backend origin to
 * proxy in development. `VITE_SUPABASE_URL` is read by the client at runtime from the
 * environment, not by this config.
 */
export default defineConfig({
  plugins: [react()],
  css: {
    preprocessorOptions: {
      // Opt into the modern Sass compiler API; the legacy API is deprecated and
      // prints a warning during every build.
      scss: { api: "modern-compiler" },
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});

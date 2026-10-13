import { mergeConfig, defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

/**
 * Test configuration.
 *
 * The application config is reused so the tests resolve modules the same way the
 * production build does (React plugin, Sass, the `import.meta.env` contract).
 * Only the test runner is layered on top.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./src/__tests__/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      restoreMocks: true,
      clearMocks: true,
      css: false,
      // The app decides whether Supabase is configured from these; a dummy pair lets
      // `isSupabaseConfigured()` be true so the api modules run against the fake.
      env: {
        VITE_SUPABASE_URL: "http://127.0.0.1:54321",
        VITE_SUPABASE_ANON_KEY: "test-anon-key",
      },
    },
  })
);

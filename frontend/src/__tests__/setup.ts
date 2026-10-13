import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

/**
 * The Supabase client is replaced for every test.
 *
 * `src/lib/supabase.ts` builds its client with `createClient`, so mocking that
 * factory here swaps in the in-memory `FakeSupabase` for every api module, with no
 * per-test wiring. Tests drive it through `fakeSupabase.state` (tables, RPCs and
 * Edge Function responses) and `seedAuth`.
 */
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => fakeSupabase,
}));

// jsdom does not implement matchMedia. The animation helpers and GSAP's
// ScrollTrigger both read it, and `prefersReducedMotion()` must not throw.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  fakeSupabase.reset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

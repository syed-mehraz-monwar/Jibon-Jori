import { getSupabase, isSupabaseConfigured, toApiError } from "../lib/supabase";
import type { HealthReport } from "../lib/types";

/**
 * `/api/health` — used by the app shell to show backend reachability (§2).
 *
 * There is no backend to probe: readiness is "the Supabase client is configured and
 * answers a trivial request". The result keeps the `HealthReport` shape the shell
 * reads, and a failure is reported as `status: "unavailable"` rather than invented.
 */
export const healthApi = {
  ready: async (_signal?: AbortSignal): Promise<HealthReport> => {
    if (!isSupabaseConfigured()) {
      return {
        status: "unavailable",
        checks: { supabase: { status: "unavailable", detail: "VITE_SUPABASE_URL/KEY are not set" } },
      };
    }

    try {
      const { error } = await getSupabase()
        .from("education_levels")
        .select("id", { count: "exact", head: true })
        .limit(1);
      if (error) throw toApiError(error);

      const session = await getSupabase().auth.getSession();
      return {
        status: "ok",
        checks: {
          supabase: { status: "connected" },
          session: { status: session.data.session ? "authenticated" : "anonymous" },
        },
      };
    } catch (error) {
      return {
        status: "unavailable",
        checks: {
          supabase: {
            status: "error",
            detail: error instanceof Error ? error.message : "unknown error",
          },
        },
      };
    }
  },
};

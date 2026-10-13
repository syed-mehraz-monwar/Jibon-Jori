import { getSupabase, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import { mapCompatibilityResult, type CompatibilityRow } from "../lib/mappers";
import type { CompatibilityResult } from "../lib/types";

/**
 * `/api/compatibility` — deterministic scoring, not ML (§12).
 *
 * The score comes from the `compatibility_for` SQL function, which is the single
 * authoritative scorer: it runs the six weighted factors, refuses a pair the caller
 * may not see, and caches the canonical result. The client never recomputes it.
 */
export const compatibilityApi = {
  get: async (profileId: string, _signal?: AbortSignal): Promise<CompatibilityResult> => {
    const { data, error } = await getSupabase()
      .rpc("compatibility_for", { p_other: profileId })
      .maybeSingle();
    if (error) throw toApiError(error, "The compatibility score could not be computed.");
    if (!data) throw new ApiError(404, "NOT_FOUND", "That profile does not exist.");
    return mapCompatibilityResult(profileId, data as CompatibilityRow);
  },
};

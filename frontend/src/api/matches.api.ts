import { callRpc } from "../lib/supabase";
import { COMPAT_WEIGHTS, paginationFor } from "../lib/mappers";
import type { RecommendationItem, RecommendationsResult } from "../lib/types";

type RecommendationRow = {
  id: string;
  username?: string | null;
  display_name: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  completeness: number | null;
  photo_visibility: string | null;
  overall_score: number | null;
  scored: boolean | null;
  total_count: number | string | null;
};

/**
 * `/api/matches` — ranked by the deterministic engine (`recommendations` RPC).
 *
 * Judgement call: the RPC returns the pair's `overall_score` and whether it was
 * cached (`scored`), but not the per-factor breakdown or the availability flags that
 * the old REST endpoint returned. `RecommendationsPage` only renders `score.overall`
 * and `model`, so the factor breakdown is reported as an empty/unavailable
 * projection rather than invented. The detail view (`compatibilityApi.get`) still
 * returns the full, authoritative breakdown for any single pair.
 */
export const matchesApi = {
  recommendations: async (
    params: { page?: number; limit?: number } = {},
    _signal?: AbortSignal
  ): Promise<RecommendationsResult> => {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    const rows = await callRpc<RecommendationRow[]>("recommendations", {
      p_limit: limit,
      p_offset: (page - 1) * limit,
    });

    const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;

    const items: RecommendationItem[] = rows.map((row) => {
      const overall = Math.max(0, Math.min(100, row.overall_score ?? 0)) / 100;
      return {
        profileId: row.id,
        eligibility: { eligible: true, reasons: [] },
        model: {
          version: "deterministic-v1",
          inputsHash: "",
          fromCache: row.scored === true,
          computedAt: null,
        },
        score: {
          overall,
          factors: {
            interests: 0,
            education: 0,
            profession: 0,
            educationProfession: 0,
            location: 0,
            lifestyle: 0,
            partnerPreference: 0,
          },
          availability: {
            interests: false,
            education: false,
            profession: false,
            educationProfession: false,
            location: false,
            lifestyle: false,
            partnerPreference: false,
          },
        },
      };
    });

    return {
      weights: COMPAT_WEIGHTS,
      items,
      pagination: paginationFor(page, limit, total),
      // The RPC pages over the whole candidate set, so the response is never a
      // silently capped pool the way the old endpoint's bounded window could be.
      candidatePoolTruncated: false,
    };
  },
};

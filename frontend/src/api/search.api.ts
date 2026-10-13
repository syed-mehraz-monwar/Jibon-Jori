import { callRpc } from "../lib/supabase";
import { mapSearchProfileRow, type SearchProfileRow } from "../lib/mappers";
import type { Gender, MaritalStatus, Pagination, SearchProfile } from "../lib/types";

export type SearchFilters = {
  page?: number;
  limit?: number;
  ageMin?: number;
  ageMax?: number;
  gender?: Gender | "";
  maritalStatus?: MaritalStatus | "";
  city?: string;
  educationId?: string;
  professionId?: string;
  interestIds?: string[];
  /**
   * Proximity filter (B-40). The three values are all-or-nothing: the RPC ignores
   * a partial set, so a centre without a radius does nothing.
   */
  nearLat?: number;
  nearLng?: number;
  radiusKm?: number;
};

export type SearchResult = { profiles: SearchProfile[]; pagination: Pagination };

/** Converts camelCase filters into the `search_profiles` RPC's parameter names. */
export function searchParams(filters: SearchFilters): Record<string, string | number | undefined> {
  return {
    page: filters.page,
    limit: filters.limit,
    ageMin: filters.ageMin,
    ageMax: filters.ageMax,
    gender: filters.gender || undefined,
    maritalStatus: filters.maritalStatus || undefined,
    city: filters.city?.trim() || undefined,
    educationId: filters.educationId || undefined,
    professionId: filters.professionId || undefined,
    interestIds: filters.interestIds?.length ? filters.interestIds.join(",") : undefined,
    nearLat: filters.nearLat,
    nearLng: filters.nearLng,
    radiusKm: filters.radiusKm,
  };
}

/**
 * The GraphQL-shaped projection of the same filters, retained as a pure function
 * for callers/tests. It no longer drives a GraphQL transport.
 */
export function searchGraphqlInput(filters: SearchFilters): Record<string, unknown> {
  return {
    page: filters.page,
    limit: filters.limit,
    ageMin: filters.ageMin,
    ageMax: filters.ageMax,
    gender: filters.gender || undefined,
    maritalStatus: filters.maritalStatus || undefined,
    city: filters.city?.trim() || undefined,
    educationId: filters.educationId || undefined,
    professionId: filters.professionId || undefined,
    interestIds: filters.interestIds?.length ? filters.interestIds : undefined,
    nearLat: filters.nearLat,
    nearLng: filters.nearLng,
    radiusKm: filters.radiusKm,
  };
}

/** `/api/search` — backed by the `search_profiles` RPC (RLS-scoped). */
export const searchApi = {
  profiles: async (filters: SearchFilters, signal?: AbortSignal): Promise<SearchResult> => {
    void signal;
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;

    const rows = await callRpc<SearchProfileRow[]>("search_profiles", {
      p_gender: filters.gender || null,
      p_city: filters.city?.trim() || null,
      p_age_min: filters.ageMin ?? null,
      p_age_max: filters.ageMax ?? null,
      p_education_id: filters.educationId || null,
      p_profession_id: filters.professionId || null,
      p_marital_status: filters.maritalStatus || null,
      p_interest_ids: filters.interestIds?.length ? filters.interestIds : null,
      p_near_lat: filters.nearLat ?? null,
      p_near_lng: filters.nearLng ?? null,
      p_radius_km: filters.radiusKm ?? null,
      p_limit: limit,
      p_offset: (page - 1) * limit,
    });

    const total = rows.length > 0 ? Number((rows[0] as { total_count?: number }).total_count ?? 0) : 0;
    return {
      profiles: rows.map(mapSearchProfileRow),
      pagination: {
        page,
        limit,
        total,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      },
    };
  },
};

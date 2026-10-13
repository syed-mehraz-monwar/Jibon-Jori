import { getSupabase, toApiError } from "../lib/supabase";
import { mapCuratedVideo, paginationFor, rangeFor, type CuratedVideoRow } from "../lib/mappers";
import type { CuratedVideo, Pagination } from "../lib/types";

const SELECT = "id, youtube_id, title, description, category, created_at";

/**
 * `/api/curated-videos` (spec 14, "Embedded Audio/Video").
 *
 * Reading the catalogue requires authentication; curating it is administrator-only and
 * is not exposed through the UI (there is no admin screen for it), so only the read
 * endpoint is wrapped here.
 */
export const curatedApi = {
  list: async (
    params: { page?: number; limit?: number; category?: string } = {},
    _signal?: AbortSignal
  ): Promise<{ videos: CuratedVideo[]; pagination: Pagination }> => {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [from, to] = rangeFor(page, limit);

    let query = getSupabase()
      .from("curated_videos")
      .select(SELECT, { count: "exact" })
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (params.category) query = query.eq("category", params.category);

    const { data, error, count } = await query;
    if (error) throw toApiError(error);
    return {
      videos: ((data ?? []) as CuratedVideoRow[]).map(mapCuratedVideo),
      pagination: paginationFor(page, limit, count ?? 0),
    };
  },
};

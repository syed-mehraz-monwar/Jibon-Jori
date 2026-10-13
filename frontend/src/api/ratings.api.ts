import { callRpc, getSupabase, requireUserId, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import { mapRating, paginationFor, rangeFor, type RatingRow } from "../lib/mappers";
import type { Pagination, RatingSummary } from "../lib/types";

export type Rating = {
  raterProfileId: string;
  ratedProfileId: string;
  score: number;
  createdAt: string;
};

export type RatingListResult = { ratings: Rating[]; pagination: Pagination };

const SELECT = "rater_profile_id, rated_profile_id, score, created_at";

type RatingSummaryRow = {
  average: number | string | null;
  rating_count: number | null;
  distribution: Record<string, number> | null;
};

/** `/api/ratings` — score is an integer 1..5 (§9). */
export const ratingsApi = {
  listMine: async (
    params: { page?: number; limit?: number; score?: number } = {},
    _signal?: AbortSignal
  ): Promise<RatingListResult> => {
    const userId = await requireUserId();
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [from, to] = rangeFor(page, limit);

    let query = getSupabase()
      .from("ratings")
      .select(SELECT, { count: "exact" })
      .eq("rater_profile_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (params.score !== undefined) query = query.eq("score", params.score);

    const { data, error, count } = await query;
    if (error) throw toApiError(error);
    return {
      ratings: ((data ?? []) as RatingRow[]).map(mapRating),
      pagination: paginationFor(page, limit, count ?? 0),
    };
  },

  set: async (targetProfileId: string, score: number): Promise<{ rating: Rating }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("ratings")
      .upsert(
        { rater_profile_id: userId, rated_profile_id: targetProfileId, score },
        { onConflict: "rater_profile_id,rated_profile_id" }
      )
      .select(SELECT)
      .single();
    if (error) throw toApiError(error);
    return { rating: mapRating(data as RatingRow) };
  },

  remove: async (targetProfileId: string): Promise<{ rating: Rating }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("ratings")
      .delete()
      .eq("rater_profile_id", userId)
      .eq("rated_profile_id", targetProfileId)
      .select(SELECT)
      .maybeSingle();
    if (error) throw toApiError(error);
    if (!data) {
      throw new ApiError(404, "NOT_FOUND", "You have not rated this profile.");
    }
    return { rating: mapRating(data as RatingRow) };
  },

  /** Aggregates are computed server-side (`rating_summary`), never in the client. */
  summary: async (profileId: string, _signal?: AbortSignal): Promise<{ summary: RatingSummary }> => {
    const row = await callRpc<RatingSummaryRow>("rating_summary", { p_profile: profileId });
    const average = row?.average === null || row?.average === undefined ? null : Number(row.average);
    return {
      summary: {
        targetProfileId: profileId,
        count: row?.rating_count ?? 0,
        average: Number.isFinite(average as number) ? (average as number) : null,
        distribution: row?.distribution ?? {},
      },
    };
  },
};

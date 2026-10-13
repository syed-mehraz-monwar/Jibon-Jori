import { getSupabase, requireUserId, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import { mapComment, paginationFor, rangeFor, type CommentRow } from "../lib/mappers";
import type { Comment, Pagination } from "../lib/types";

export type CommentListResult = { comments: Comment[]; pagination: Pagination };

const SELECT = "id, author_profile_id, target_profile_id, body, created_at";

/** `/api/comments` — §10. */
export const commentsApi = {
  list: async (
    profileId: string,
    params: { page?: number; limit?: number } = {},
    _signal?: AbortSignal
  ): Promise<CommentListResult> => {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [from, to] = rangeFor(page, limit);

    const { data, error, count } = await getSupabase()
      .from("comments")
      .select(SELECT, { count: "exact" })
      .eq("target_profile_id", profileId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw toApiError(error);
    return {
      comments: ((data ?? []) as CommentRow[]).map(mapComment),
      pagination: paginationFor(page, limit, count ?? 0),
    };
  },

  create: async (targetProfileId: string, body: string): Promise<{ comment: Comment }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("comments")
      .insert({ author_profile_id: userId, target_profile_id: targetProfileId, body })
      .select(SELECT)
      .single();
    if (error) throw toApiError(error);
    return { comment: mapComment(data as CommentRow) };
  },

  /**
   * RLS only permits deleting your own comment, so a non-owner delete returns no
   * row and is reported as `403 FORBIDDEN`; an unknown id is a `404` (the
   * documented exception to the 404-for-both convention).
   */
  remove: async (commentId: string): Promise<{ comment: Comment }> => {
    const userId = await requireUserId();

    // Read first so a missing comment (404) is distinguishable from one the caller
    // does not own (403); RLS would collapse both into "deleted nothing".
    const existing = await getSupabase().from("comments").select(SELECT).eq("id", commentId).maybeSingle();
    if (existing.error) throw toApiError(existing.error);
    if (!existing.data) {
      throw new ApiError(404, "NOT_FOUND", "That comment does not exist.");
    }
    if ((existing.data as CommentRow).author_profile_id !== userId) {
      throw new ApiError(403, "FORBIDDEN", "You can only delete your own comments.");
    }

    const { error } = await getSupabase().from("comments").delete().eq("id", commentId);
    if (error) throw toApiError(error);
    return { comment: mapComment(existing.data as CommentRow) };
  },
};

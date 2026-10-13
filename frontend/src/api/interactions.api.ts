import { getSupabase, requireUserId, toApiError } from "../lib/supabase";
import { mapInteraction, paginationFor, rangeFor, type InteractionRow } from "../lib/mappers";
import type { Interaction, InteractionValue, Pagination } from "../lib/types";

export type InteractionListResult = { interactions: Interaction[]; pagination: Pagination };

const SELECT = "actor_profile_id, target_profile_id, value, created_at";

/** `/api/interactions` — `value` is −1 dislike, 1 like, 2 favourite (§8). */
export const interactionsApi = {
  listMine: async (
    params: { page?: number; limit?: number; value?: InteractionValue } = {},
    _signal?: AbortSignal
  ): Promise<InteractionListResult> => {
    const userId = await requireUserId();
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [from, to] = rangeFor(page, limit);

    let query = getSupabase()
      .from("interactions")
      .select(SELECT, { count: "exact" })
      .eq("actor_profile_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (params.value !== undefined) query = query.eq("value", params.value);

    const { data, error, count } = await query;
    if (error) throw toApiError(error);
    return {
      interactions: ((data ?? []) as InteractionRow[]).map(mapInteraction),
      pagination: paginationFor(page, limit, count ?? 0),
    };
  },

  /** Upsert: one stance per (actor, target) pair, enforced by the primary key. */
  set: async (targetProfileId: string, value: InteractionValue): Promise<{ interaction: Interaction }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("interactions")
      .upsert(
        { actor_profile_id: userId, target_profile_id: targetProfileId, value },
        { onConflict: "actor_profile_id,target_profile_id" }
      )
      .select(SELECT)
      .single();
    if (error) throw toApiError(error);
    return { interaction: mapInteraction(data as InteractionRow) };
  },

  remove: async (targetProfileId: string): Promise<null> => {
    const userId = await requireUserId();
    const { error } = await getSupabase()
      .from("interactions")
      .delete()
      .eq("actor_profile_id", userId)
      .eq("target_profile_id", targetProfileId);
    if (error) throw toApiError(error);
    return null;
  },
};

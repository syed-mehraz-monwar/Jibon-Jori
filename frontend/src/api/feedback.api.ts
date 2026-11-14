import { getSupabase, requireUserId, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import type { Feedback } from "../lib/types";

const SELECT =
  "id, rater_profile_id, score, feedback, created_at, updated_at";

const MAX_FEEDBACK_LENGTH = 2000;
const MIN_SCORE = 1;
const MAX_SCORE = 5;

type FeedbackRow = {
  id: string;
  rater_profile_id: string;
  score: number;
  feedback: string | null;
  created_at: string;
  updated_at: string;
};

function mapFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    raterProfileId: row.rater_profile_id,
    score: row.score,
    feedback: row.feedback,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * `/api/feedback` - the teacher evaluation feature: an app-experience star
 * rating (1..5) with optional bounded free text.
 *
 * Deliberately separate from the match-level `ratings` table: `ratings` scores
 * a specific (rater, rated) pair, `feedback` rates the JibonJori experience.
 *
 * Row shape matches the single-column unique constraint `feedback_rater_idx`
 * (unique on `rater_profile_id`), so an upsert keyed on that column replaces the
 * member's previous rating while keeping exactly one active rating per member.
 */
export const feedbackApi = {
  /** Reads the caller's own feedback (owner-only RLS). */
  getMine: async (): Promise<Feedback | null> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("feedback")
      .select(SELECT)
      .eq("rater_profile_id", userId)
      .maybeSingle();
    if (error) throw toApiError(error);
    const row = (data ?? null) as FeedbackRow | null;
    return row ? mapFeedback(row) : null;
  },

  /** Creates or updates the caller's own rating. Returns the persisted row. */
  submit: async (input: { score: number; feedback?: string | null }): Promise<Feedback> => {
    const userId = await requireUserId();

    // The score must be a genuine integer in 1..5: fractional or out-of-range
    // values are rejected here rather than silently coerced or truncated, and the
    // database CHECK constraint enforces the same bound authoritatively.
    if (!Number.isInteger(input.score) || input.score < MIN_SCORE || input.score > MAX_SCORE) {
      throw new ApiError(400, "VALIDATION_ERROR", "The rating must be an integer between 1 and 5.");
    }

    const trimmedFeedback = (input.feedback ?? "").trim();
    if (trimmedFeedback.length > MAX_FEEDBACK_LENGTH) {
      throw new ApiError(400, "VALIDATION_ERROR", `Feedback must be at most ${MAX_FEEDBACK_LENGTH} characters.`);
    }

    const { data, error } = await getSupabase()
      .from("feedback")
      .upsert(
        {
          rater_profile_id: userId,
          score: input.score,
          feedback: trimmedFeedback.length > 0 ? trimmedFeedback : null,
        },
        { onConflict: "rater_profile_id" }
      )
      .select(SELECT)
      .single();

    if (error) throw toApiError(error);
    const row = data as FeedbackRow;
    return mapFeedback(row);
  },

  /** Deletes the caller's own feedback. */
  remove: async (): Promise<void> => {
    const userId = await requireUserId();
    const { error } = await getSupabase()
      .from("feedback")
      .delete()
      .eq("rater_profile_id", userId);
    if (error) throw toApiError(error);
  },
};

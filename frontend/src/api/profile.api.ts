import { getSupabase, requireUserId, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import { PROFILE_SELECT, mapProfileRow, type ProfileRow } from "../lib/mappers";
import type { Profile, ProfileInput } from "../lib/types";

async function fetchMine(userId: string): Promise<Profile> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw toApiError(error);
  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Your profile has not been created yet.");
  }
  return mapProfileRow(data as unknown as ProfileRow);
}

/** camelCase `ProfileInput` -> the snake_case columns PostgREST expects. */
function toProfilePatch(input: ProfileInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) patch[key] = value;
  };

  set("display_name", input.displayName);
  if (input.dob !== undefined) set("dob", input.dob.slice(0, 10));
  set("gender", input.gender);
  set("height_cm", input.heightCm);
  set("marital_status", input.maritalStatus);
  set("religion", input.religion);
  set("caste_community", input.casteCommunity);
  set("education_id", input.educationId);
  set("education_detail", input.educationDetail);
  set("profession_id", input.professionId);
  set("profession_detail", input.professionDetail);
  set("income_band", input.incomeBand);
  set("city", input.city);
  set("district", input.district);
  set("country", input.country);
  set("lat", input.lat);
  set("lng", input.lng);
  set("location_consent", input.locationConsent);
  set("show_exact_location", input.showExactLocation);
  set("about", input.about);
  set("lifestyle", input.lifestyle);
  set("is_public", input.isPublic);
  set("photo_visibility", input.photoVisibility);
  return patch;
}

/** `/api/profile` — the profile is a 1:1 row with `profiles.id = auth.uid()`. */
export const profileApi = {
  getMine: async (signal?: AbortSignal): Promise<{ profile: Profile }> => {
    void signal;
    const userId = await requireUserId();
    return { profile: await fetchMine(userId) };
  },

  upsertMine: async (input: ProfileInput): Promise<{ profile: Profile }> => {
    const userId = await requireUserId();
    const patch = toProfilePatch(input);

    if (Object.keys(patch).length > 0) {
      const { error } = await getSupabase().from("profiles").update(patch).eq("id", userId);
      if (error) throw toApiError(error);
    }

    // Interests are a full replacement set, so the M2M rows are deleted then
    // re-inserted. The first failure is surfaced; the second is not attempted.
    if (input.interestIds !== undefined) {
      const del = await getSupabase().from("profile_interests").delete().eq("profile_id", userId);
      if (del.error) throw toApiError(del.error);

      const unique = [...new Set(input.interestIds)];
      if (unique.length > 0) {
        const insert = await getSupabase()
          .from("profile_interests")
          .insert(unique.map((interestId) => ({ profile_id: userId, interest_id: interestId })));
        if (insert.error) throw toApiError(insert.error);
      }
    }

    return { profile: await fetchMine(userId) };
  },
};

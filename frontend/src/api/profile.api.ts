import { getSupabase, requireUserId, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import {
  PROFILE_DETAILS_SELECT,
  PROFILE_SELECT,
  mapProfileDetails,
  mapProfileRow,
  type ProfileDetailsRow,
  type ProfileRow,
} from "../lib/mappers";
import { socialUrlError } from "../lib/validation";
import type { Profile, ProfileDetailsInput, ProfileInput } from "../lib/types";

/**
 * Reads the optional `profile_details` row.
 *
 * It is fetched separately from the profile row on purpose: if a deployment has
 * not applied migration 0016 yet, PostgREST answers `PGRST205` for a missing
 * table, and the profile itself must still load. A missing row (the common case
 * for an existing member who has never filled the extras in) maps to `null`.
 */
async function fetchDetails(userId: string): Promise<ProfileDetailsRow | null> {
  const { data, error } = await getSupabase()
    .from("profile_details")
    .select(PROFILE_DETAILS_SELECT)
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) return null;
  return (data as ProfileDetailsRow | null) ?? null;
}

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
  const profile = mapProfileRow(data as unknown as ProfileRow);
  const details = await fetchDetails(userId);
  return { ...profile, details: details ? mapProfileDetails(details) : null };
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

/**
 * `ProfileDetailsInput` -> `profile_details` columns.
 *
 * `undefined` means "leave alone" and `null` means "clear", which is how the
 * form can distinguish "the member never touched this" from "the member chose
 * Prefer not to say / removed the link".
 */
function toDetailsPatch(input: ProfileDetailsInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) patch[key] = value;
  };

  set("religious_practice", input.religiousPractice);
  set("blood_group", input.bloodGroup);
  set("biodata", input.biodata);
  set("religious_practice_visibility", input.religiousPracticeVisibility);
  set("blood_group_visibility", input.bloodGroupVisibility);
  set("biodata_visibility", input.biodataVisibility);
  set("social_links_visibility", input.socialLinksVisibility);

  if (input.socialLinks !== undefined) {
    const links: Record<string, string> = {};
    for (const [platform, value] of Object.entries(input.socialLinks)) {
      if (!value) continue;
      const problem = socialUrlError(value);
      if (problem) throw new ApiError(400, "VALIDATION_ERROR", `${platform}: ${problem}`);
      links[platform] = value.trim();
    }
    patch.social_links = links;
  }

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

    if (input.details !== undefined) {
      const detailsPatch = toDetailsPatch(input.details);
      if (Object.keys(detailsPatch).length > 0) {
        const { error } = await getSupabase()
          .from("profile_details")
          .upsert({ profile_id: userId, ...detailsPatch }, { onConflict: "profile_id" });
        if (error) {
          if (error.code === "PGRST205" || error.code === "42P01") {
            throw new ApiError(
              503,
              "DETAILS_UNAVAILABLE",
              "Optional profile details are not available on this deployment yet. Your other changes were saved."
            );
          }
          throw toApiError(error);
        }
      }
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

  /**
   * The visibility-masked extras of another member.
   *
   * Reads `public_profile_details()` rather than the table: the table is
   * owner-only under RLS, and the function applies each field's own visibility
   * before anything leaves the database.
   */
  publicDetails: async (profileId: string, signal?: AbortSignal): Promise<ProfileDetailsPublic | null> => {
    void signal;
    const { data, error } = await getSupabase().rpc("public_profile_details", { p_profile: profileId });
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as
      | { religious_practice?: string | null; blood_group?: string | null; biodata?: string | null; social_links?: Record<string, string> | null }
      | null
      | undefined;
    if (!row) return null;
    if (!row.religious_practice && !row.blood_group && !row.biodata && !row.social_links) {
      return null;
    }
    return {
      religiousPractice: row.religious_practice ?? null,
      bloodGroup: row.blood_group ?? null,
      biodata: row.biodata ?? null,
      socialLinks: row.social_links ?? {},
    };
  },
};

export type ProfileDetailsPublic = {
  religiousPractice: string | null;
  bloodGroup: string | null;
  biodata: string | null;
  socialLinks: Record<string, string>;
};

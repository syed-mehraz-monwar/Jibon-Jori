import { getSupabase, requireUserId, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import { mapPartnerPreferences, type PartnerPreferencesRow } from "../lib/mappers";
import type { Gender, PartnerPreferences, PreferenceRule } from "../lib/types";

export type PartnerPreferencesInput = {
  ageMin?: number;
  ageMax?: number;
  genders?: Gender[];
  educationIds?: string[];
  professionIds?: string[];
  locations?: string[];
  mustHave?: PreferenceRule;
  dealbreakers?: PreferenceRule;
};

const PREFERENCE_SELECT =
  "profile_id, age_min, age_max, genders, education_ids, profession_ids, locations, must_have, dealbreakers, created_at, updated_at";

/** `/api/partner-preferences` — private matchmaking inputs, one row per profile. */
export const partnerPreferencesApi = {
  getMine: async (_signal?: AbortSignal): Promise<{ preferences: PartnerPreferences }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("partner_preferences")
      .select(PREFERENCE_SELECT)
      .eq("profile_id", userId)
      .maybeSingle();
    if (error) throw toApiError(error);
    if (!data) {
      throw new ApiError(404, "NOT_FOUND", "You have not set partner preferences yet.");
    }
    return { preferences: mapPartnerPreferences(data as unknown as PartnerPreferencesRow) };
  },

  upsertMine: async (input: PartnerPreferencesInput): Promise<{ preferences: PartnerPreferences }> => {
    const userId = await requireUserId();
    const row: Record<string, unknown> = { profile_id: userId };
    if (input.ageMin !== undefined) row.age_min = input.ageMin;
    if (input.ageMax !== undefined) row.age_max = input.ageMax;
    if (input.genders !== undefined) row.genders = input.genders;
    if (input.educationIds !== undefined) row.education_ids = input.educationIds;
    if (input.professionIds !== undefined) row.profession_ids = input.professionIds;
    if (input.locations !== undefined) row.locations = input.locations;
    if (input.mustHave !== undefined) row.must_have = input.mustHave;
    if (input.dealbreakers !== undefined) row.dealbreakers = input.dealbreakers;

    const { data, error } = await getSupabase()
      .from("partner_preferences")
      .upsert(row, { onConflict: "profile_id" })
      .select(PREFERENCE_SELECT)
      .single();
    if (error) throw toApiError(error);
    return { preferences: mapPartnerPreferences(data as unknown as PartnerPreferencesRow) };
  },
};

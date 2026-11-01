import type {
  AppNotification,
  ChatConversation,
  ChatMessage,
  Comment,
  CompatibilityAvailability,
  CompatibilityFactors,
  CompatibilityResult,
  CuratedVideo,
  Gender,
  Interaction,
  InteractionValue,
  MaritalStatus,
  MediaItem,
  ModelInfo,
  NotificationType,
  Pagination,
  PartnerPreferences,
  PhotoVisibility,
  PreferenceRule,
  Profile,
  ProfileDetails,
  Reference,
  UserStatus,
} from "./types";

/**
 * Row -> DTO mappers.
 *
 * The database speaks snake_case and returns enums/arrays as Postgres values; the
 * UI speaks the camelCase contract in `lib/types.ts`. Putting the shared shapes
 * here keeps every api module a thin query + map.
 */

/** The deterministic scorer's fixed weights (`compat_weights()` in the schema). */
export const COMPAT_WEIGHTS: Record<string, number> = {
  interests: 0.25,
  educationProfession: 0.2,
  location: 0.15,
  lifestyle: 0.15,
  partnerPreference: 0.25,
};

/** The inclusive PostgREST `range(from, to)` bounds for a 1-based page. */
export function rangeFor(page: number, limit: number): [number, number] {
  const safeLimit = limit > 0 ? limit : 20;
  const safePage = page > 0 ? page : 1;
  return [(safePage - 1) * safeLimit, safePage * safeLimit - 1];
}

export function paginationFor(page: number, limit: number, total: number): Pagination {
  const safeLimit = limit > 0 ? limit : 20;
  return {
    page: page > 0 ? page : 1,
    limit: safeLimit,
    total,
    totalPages: safeLimit > 0 ? Math.ceil(total / safeLimit) : 0,
  };
}

export type ReferenceRow = { id: string; slug: string; label: string; tier?: number | null };

export function mapReference(row: ReferenceRow): Reference {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    ...(row.tier !== null && row.tier !== undefined ? { tier: row.tier } : {}),
  };
}

type EmbeddedReference = { id: string; slug: string; label: string; tier?: number | null } | null;

export type ProfileRow = {
  id: string;
  username?: string | null;
  display_name?: string | null;
  dob?: string | null;
  gender?: Gender | null;
  height_cm?: number | null;
  marital_status?: MaritalStatus | null;
  religion?: string | null;
  caste_community?: string | null;
  education_id?: string | null;
  education_detail?: string | null;
  profession_id?: string | null;
  profession_detail?: string | null;
  income_band?: string | null;
  city?: string | null;
  district?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  location_consent?: boolean | null;
  show_exact_location?: boolean | null;
  about?: string | null;
  lifestyle?: Record<string, unknown> | null;
  is_public?: boolean | null;
  photo_visibility?: PhotoVisibility | null;
  completeness?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  education_levels?: EmbeddedReference;
  professions?: EmbeddedReference;
  profile_interests?: { interests: EmbeddedReference }[] | null;
};

/** The select string every profile read uses, so the mapper always has its joins. */
export const PROFILE_SELECT =
  "id, username, display_name, dob, gender, height_cm, marital_status, religion, caste_community, " +
  "education_id, education_detail, profession_id, profession_detail, income_band, city, district, " +
  "country, lat, lng, location_consent, show_exact_location, about, lifestyle, is_public, " +
  "photo_visibility, completeness, created_at, updated_at, " +
  "education_levels(id, slug, label, tier), professions(id, slug, label, tier), " +
  "profile_interests(interests(id, slug, label))";

export function mapProfileRow(row: ProfileRow): Profile {
  const interests = (row.profile_interests ?? [])
    .map((entry) => entry.interests)
    .filter((value): value is NonNullable<EmbeddedReference> => value !== null && value !== undefined)
    .map((value) => mapReference(value));

  return {
    id: row.id,
    userId: row.id,
    displayName: row.display_name ?? "",
    dob: row.dob ?? "",
    gender: row.gender ?? "other",
    heightCm: row.height_cm ?? null,
    maritalStatus: row.marital_status ?? "never_married",
    religion: row.religion ?? null,
    casteCommunity: row.caste_community ?? null,
    education: row.education_levels ? mapReference(row.education_levels) : null,
    educationDetail: row.education_detail ?? null,
    profession: row.professions ? mapReference(row.professions) : null,
    professionDetail: row.profession_detail ?? null,
    incomeBand: row.income_band ?? null,
    city: row.city ?? "",
    district: row.district ?? null,
    country: row.country ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    locationConsent: row.location_consent === true,
    showExactLocation: row.show_exact_location === true,
    about: row.about ?? null,
    lifestyle: row.lifestyle ?? {},
    interests,
    isPublic: row.is_public === true,
    photoVisibility: row.photo_visibility ?? "public",
    // Filled in by `profileApi.getMine`, which reads the optional row
    // separately so a deployment without migration 0016 degrades to "no extras"
    // instead of failing the whole profile read.
    details: null,
    completeness: row.completeness ?? 0,
    createdAt: row.created_at ?? new Date(0).toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date(0).toISOString(),
  };
}

/**
 * `profile_details` row -> DTO. Missing values are simply absent, so "not
 * provided" and "prefer not to say" stay distinguishable.
 */
export function mapProfileDetails(row: ProfileDetailsRow): ProfileDetails {
  return {
    religiousPractice: (row.religious_practice ?? null) as ProfileDetails["religiousPractice"],
    bloodGroup: (row.blood_group ?? null) as ProfileDetails["bloodGroup"],
    biodata: row.biodata ?? null,
    socialLinks: (row.social_links ?? {}) as ProfileDetails["socialLinks"],
    religiousPracticeVisibility: row.religious_practice_visibility ?? "members",
    bloodGroupVisibility: row.blood_group_visibility ?? "private",
    biodataVisibility: row.biodata_visibility ?? "members",
    socialLinksVisibility: row.social_links_visibility ?? "members",
  };
}

/** The `profile_details` columns `profileApi` reads and writes (migration 0016). */
export type ProfileDetailsRow = {
  profile_id?: string;
  religious_practice?: string | null;
  blood_group?: string | null;
  biodata?: string | null;
  social_links?: Record<string, string> | null;
  religious_practice_visibility?: PhotoVisibility | null;
  blood_group_visibility?: PhotoVisibility | null;
  biodata_visibility?: PhotoVisibility | null;
  social_links_visibility?: PhotoVisibility | null;
};

export const PROFILE_DETAILS_SELECT =
  "profile_id, religious_practice, blood_group, biodata, social_links, " +
  "religious_practice_visibility, blood_group_visibility, biodata_visibility, social_links_visibility";

export type PartnerPreferencesRow = {  profile_id: string;
  age_min: number | null;
  age_max: number | null;
  genders: string[] | null;
  education_ids: string[] | null;
  profession_ids: string[] | null;
  locations: string[] | null;
  must_have: PreferenceRule | null;
  dealbreakers: PreferenceRule | null;
  created_at: string;
  updated_at: string;
};

function ruleOrNull(value: PreferenceRule | null | undefined): PreferenceRule | null {
  if (!value || typeof value !== "object") return null;
  return Object.keys(value).length === 0 ? null : value;
}

export function mapPartnerPreferences(row: PartnerPreferencesRow): PartnerPreferences {
  return {
    id: row.profile_id,
    profileId: row.profile_id,
    ageMin: row.age_min ?? null,
    ageMax: row.age_max ?? null,
    genders: (row.genders ?? []) as Gender[],
    educationIds: row.education_ids ?? [],
    professionIds: row.profession_ids ?? [],
    locations: row.locations ?? [],
    mustHave: ruleOrNull(row.must_have),
    dealbreakers: ruleOrNull(row.dealbreakers),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type InteractionRow = {
  actor_profile_id: string;
  target_profile_id: string;
  value: InteractionValue;
  created_at: string;
};

export function mapInteraction(row: InteractionRow): Interaction {
  return {
    actorProfileId: row.actor_profile_id,
    targetProfileId: row.target_profile_id,
    value: row.value,
    createdAt: row.created_at,
  };
}

export type RatingRow = {
  rater_profile_id: string;
  rated_profile_id: string;
  score: number;
  created_at: string;
};

export type Rating = {
  raterProfileId: string;
  ratedProfileId: string;
  score: number;
  createdAt: string;
};

export function mapRating(row: RatingRow): Rating {
  return {
    raterProfileId: row.rater_profile_id,
    ratedProfileId: row.rated_profile_id,
    score: row.score,
    createdAt: row.created_at,
  };
}

export type CommentRow = {
  id: string;
  author_profile_id: string;
  target_profile_id: string;
  body: string;
  created_at: string;
};

export function mapComment(row: CommentRow): Comment {
  return {
    id: row.id,
    authorProfileId: row.author_profile_id,
    targetProfileId: row.target_profile_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

export type NotificationRow = {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

export function mapNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload ?? {},
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export type MediaRow = {
  id: string;
  profile_id: string;
  storage_path: string;
  kind: "photo" | "document";
  mime: string;
  bytes: number;
  is_primary: boolean;
  created_at: string;
};

export function mapMedia(row: MediaRow): MediaItem {
  return {
    id: row.id,
    firebasePath: row.storage_path,
    kind: row.kind,
    mime: row.mime,
    bytes: row.bytes,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

export type ChatConversationRow = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export function mapChatConversation(row: ChatConversationRow): ChatConversation {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

export type ChatMessageRow = {
  id: string;
  role: ChatMessage["role"];
  content: string;
  model?: string | null;
  created_at: string;
};

export function mapChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    model: row.model ?? null,
    createdAt: row.created_at,
  };
}

export type CuratedVideoRow = {
  id: string;
  youtube_id: string;
  title: string;
  description: string | null;
  category: string;
  created_at: string;
};

export function mapCuratedVideo(row: CuratedVideoRow): CuratedVideo {
  return {
    id: row.id,
    youtubeId: row.youtube_id,
    title: row.title,
    description: row.description,
    category: row.category,
    createdAt: row.created_at,
  };
}

export type SearchProfileRow = {
  id: string;
  username?: string | null;
  display_name: string | null;
  age: number | null;
  gender: Gender | null;
  city: string | null;
  district: string | null;
  country: string | null;
  education_id: string | null;
  profession_id: string | null;
  marital_status: MaritalStatus | null;
  about: string | null;
  photo_visibility: PhotoVisibility | null;
  completeness: number | null;
  created_at: string;
};

/**
 * The list-level search RPC does not return the embedded education/profession
 * labels or a member's interests and primary photo, so those are reported empty
 * rather than fabricated. `ProfileCard` renders the null/empty cases gracefully.
 */
export function mapSearchProfileRow(row: SearchProfileRow) {
  return {
    id: row.id,
    displayName: row.display_name ?? "",
    gender: row.gender ?? "other",
    age: row.age ?? 0,
    maritalStatus: row.marital_status ?? "never_married",
    city: row.city,
    district: row.district,
    country: row.country,
    education: null,
    profession: null,
    incomeBand: null,
    about: row.about,
    interests: [],
    primaryPhoto: null,
    completeness: row.completeness ?? 0,
    createdAt: row.created_at,
  };
}

export type CompatibilityRow = {
  eligible?: boolean | null;
  eligibility_reasons?: string[] | null;
  interests_score?: number | null;
  education_score?: number | null;
  profession_score?: number | null;
  education_profession_score?: number | null;
  location_score?: number | null;
  lifestyle_score?: number | null;
  preference_score?: number | null;
  interests_available?: boolean | null;
  education_available?: boolean | null;
  profession_available?: boolean | null;
  education_profession_available?: boolean | null;
  location_available?: boolean | null;
  lifestyle_available?: boolean | null;
  preference_available?: boolean | null;
  overall_score?: number | null;
  model_version?: string | null;
  inputs_hash?: string | null;
  from_cache?: boolean | null;
  computed_at?: string | null;
};

function fraction(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value / 100 : 0;
}

export function compatibilityFactors(row: CompatibilityRow): CompatibilityFactors {
  return {
    interests: fraction(row.interests_score),
    education: fraction(row.education_score),
    profession: fraction(row.profession_score),
    educationProfession: fraction(row.education_profession_score),
    location: fraction(row.location_score),
    lifestyle: fraction(row.lifestyle_score),
    partnerPreference: fraction(row.preference_score),
  };
}

export function compatibilityAvailability(row: CompatibilityRow): CompatibilityAvailability {
  return {
    interests: row.interests_available === true,
    education: row.education_available === true,
    profession: row.profession_available === true,
    educationProfession: row.education_profession_available === true,
    location: row.location_available === true,
    lifestyle: row.lifestyle_available === true,
    partnerPreference: row.preference_available === true,
  };
}

export function mapCompatibilityModel(row: CompatibilityRow): ModelInfo {
  return {
    version: row.model_version ?? "deterministic-v1",
    inputsHash: row.inputs_hash ?? "",
    fromCache: row.from_cache === true,
    computedAt: row.computed_at ?? null,
  };
}

export function mapCompatibilityResult(targetProfileId: string, row: CompatibilityRow): CompatibilityResult {
  const eligible = row.eligible === true;
  return {
    targetProfileId,
    eligibility: { eligible, reasons: row.eligibility_reasons ?? [] },
    weights: COMPAT_WEIGHTS,
    model: mapCompatibilityModel(row),
    score: eligible
      ? {
          overall: fraction(row.overall_score),
          factors: compatibilityFactors(row),
          availability: compatibilityAvailability(row),
        }
      : null,
  };
}

/** Reproduces the old `UserStatus` from the auth + profile signals. */
export function deriveUserStatus(input: {
  isSuspended: boolean | null | undefined;
  deletedAt: string | null | undefined;
  emailConfirmedAt: string | null;
  phoneConfirmedAt: string | null;
}): UserStatus {
  if (input.deletedAt) return "deleted";
  if (input.isSuspended) return "suspended";
  if (!input.emailConfirmedAt && !input.phoneConfirmedAt) return "pending";
  return "active";
}

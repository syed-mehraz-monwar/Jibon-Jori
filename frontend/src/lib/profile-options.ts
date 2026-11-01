import type {
  BloodGroup,
  Gender,
  PhotoVisibility,
  ReligiousPractice,
  SocialPlatform,
} from "./types";

/**
 * Option sets for the optional profile fields.
 *
 * These are fixed vocabulary rather than database reference tables: they are
 * closed lists that the database constrains (`profiles.religion` is free text,
 * but `profile_details` enums are CHECKed), they never change per deployment,
 * and they are rendered inside one form. Keeping them next to the validators
 * means the label and the stored slug cannot drift apart.
 */

/**
 * Product-approved gender choices.
 *
 * "Other" remains a valid *stored* value (`GENDER_LABELS` still renders it for
 * older rows), but it is no longer offered when creating or filtering a profile,
 * as requested in FIX 06. Keeping it out of the option list means historical
 * records are preserved without being rewritten.
 */
export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

/**
 * Religion suggestions. The field stays free text so that a member whose
 * religion is not listed can still answer honestly; these are suggestions, not
 * an assertion that the list is exhaustive. "Prefer not to say" is a value, not
 * an absence, so it is stored explicitly instead of being guessed.
 */
export const RELIGION_OPTIONS = [
  "Islam",
  "Hinduism",
  "Christianity",
  "Buddhism",
  "Judaism",
  "Sikhism",
  "Jainism",
  "Other",
  "Prefer not to say",
] as const;

/** Neutral, religion-agnostic wording: nothing here ranks one practice level. */
export const RELIGIOUS_PRACTICE_OPTIONS: { value: ReligiousPractice; label: string }[] = [
  { value: "not_practicing", label: "Not practicing" },
  { value: "slightly_practicing", label: "Slightly practicing" },
  { value: "moderately_practicing", label: "Moderately practicing" },
  { value: "practicing", label: "Practicing" },
  { value: "very_practicing", label: "Very practicing" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export const BLOOD_GROUP_OPTIONS: { value: BloodGroup; label: string }[] = [
  { value: "a_positive", label: "A+" },
  { value: "a_negative", label: "A-" },
  { value: "b_positive", label: "B+" },
  { value: "b_negative", label: "B-" },
  { value: "ab_positive", label: "AB+" },
  { value: "ab_negative", label: "AB-" },
  { value: "o_positive", label: "O+" },
  { value: "o_negative", label: "O-" },
  { value: "unknown", label: "Unknown" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export const SOCIAL_PLATFORMS: {
  value: SocialPlatform;
  label: string;
  placeholder: string;
}[] = [
  { value: "facebook", label: "Facebook", placeholder: "facebook.com/your.name" },
  { value: "instagram", label: "Instagram", placeholder: "instagram.com/your.name" },
  { value: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/your-name" },
  { value: "x", label: "X (Twitter)", placeholder: "x.com/your_name" },
  { value: "youtube", label: "YouTube", placeholder: "youtube.com/@yourchannel" },
  { value: "website", label: "Personal website", placeholder: "example.com" },
];

export const VISIBILITY_OPTIONS: { value: PhotoVisibility; label: string }[] = [
  { value: "public", label: "Anyone" },
  { value: "members", label: "Signed-in members" },
  { value: "private", label: "Only me" },
];

export function labelFor<T extends string>(
  options: { value: T; label: string }[],
  value: string | null | undefined
): string | null {
  if (!value) return null;
  return options.find((option) => option.value === value)?.label ?? null;
}

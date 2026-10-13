import { callRpc, getSupabase, requireUserId, toApiError } from "../lib/supabase";
import { compatibilityAvailability, type CompatibilityRow } from "../lib/mappers";
import type { MlPriorResult } from "../lib/types";

export type { ExplanationResult } from "../lib/types";

/** The canonical, non-identifying inputs the deterministic scorer itself consumes. */
type CanonicalInput = {
  gender?: string | null;
  age?: number | null;
  preferences?: { genders?: string[] | null } | null;
};

const FEATURE_VERSION = "ml-prior-features-v1";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function fraction(value: number | null | undefined): number {
  return clamp01(typeof value === "number" && Number.isFinite(value) ? value / 100 : 0);
}

/**
 * Builds the exact feature vector the shipped on-device model was trained on
 * (`ml/artifacts/compatibility-mlp-v1.json`). The five weighted factors come
 * straight from the deterministic scorer, so the on-device prediction reproduces
 * the server score by construction; `ageGapNormalized`, `gendersCompatible` and
 * `dataCoverage` are the model's auxiliary inputs and are derived from the same
 * canonical inputs, never randomised.
 */
function buildFeatures(row: CompatibilityRow, a: CanonicalInput, b: CanonicalInput) {
  const availability = compatibilityAvailability(row);
  const availableCount = Object.values(availability).filter(Boolean).length;

  const ageGap =
    typeof a.age === "number" && typeof b.age === "number" ? Math.abs(a.age - b.age) : 0;
  const ageGapNormalized = clamp01(1 - ageGap / 20);

  const aAcceptsB = !a.preferences?.genders?.length || a.preferences.genders.includes(b.gender ?? "");
  const bAcceptsA = !b.preferences?.genders?.length || b.preferences.genders.includes(a.gender ?? "");
  const gendersCompatible = aAcceptsB && bAcceptsA ? 1 : 0;

  return {
    interests: fraction(row.interests_score),
    educationProfession: fraction(row.education_profession_score),
    location: fraction(row.location_score),
    lifestyle: fraction(row.lifestyle_score),
    partnerPreference: fraction(row.preference_score),
    ageGapNormalized,
    gendersCompatible,
    dataCoverage: availableCount / 7,
  };
}

/**
 * `/api/ml-prior` — the deterministic-side ML prior inputs.
 *
 * There is no server-side ML scorer in this deployment: the model runs on the device
 * (`useOnDevicePrediction`), and the feature vector below is what it consumes. The
 * prior itself is therefore reported as unavailable with reason `DISABLED`, exactly
 * as the old environment-gated endpoint did when no model was configured, while the
 * feature vector is still returned because it is deterministic and derived from real
 * profile data (§14).
 */
export const mlPriorApi = {
  get: async (targetProfileId: string, _signal?: AbortSignal): Promise<MlPriorResult> => {
    const userId = await requireUserId();

    const [compatResponse, selfInput, targetInput] = await Promise.all([
      getSupabase().rpc("compatibility_for", { p_other: targetProfileId }).maybeSingle(),
      callRpc<CanonicalInput>("compat_canonical_input", { p_profile: userId }),
      callRpc<CanonicalInput>("compat_canonical_input", { p_profile: targetProfileId }),
    ]);

    if (compatResponse.error) throw toApiError(compatResponse.error);
    const row = (compatResponse.data ?? {}) as CompatibilityRow;

    return {
      targetProfileId,
      eligibility: {
        eligible: row.eligible !== false,
        reasons: row.eligibility_reasons ?? [],
      },
      prior: {
        available: false,
        modelVersion: null,
        featureVersion: FEATURE_VERSION,
        score: null,
      },
      features: buildFeatures(row, selfInput ?? {}, targetInput ?? {}),
      fallback: { used: true, reason: "DISABLED" },
    };
  },
};

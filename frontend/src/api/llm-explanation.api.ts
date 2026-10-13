import { invokeFunction } from "../lib/supabase";
import {
  compatibilityAvailability,
  compatibilityFactors,
  mapCompatibilityModel,
  type CompatibilityRow,
} from "../lib/mappers";
import type { ExplanationResult } from "../lib/types";

type AiExplanationResponse = {
  targetProfileId: string;
  compatibility: CompatibilityRow;
  explanation: string;
  model: string | null;
  fallback: boolean;
};

/**
 * `/api/llm-explanation` — served by the `ai-explanation` Edge Function.
 *
 * The score is never produced here: the function calls the deterministic
 * `compatibility_for` scorer and hands the LLM only aggregate component scores, so
 * the explanation is a phrasing of real numbers rather than a source of them. When
 * no provider key is configured the function returns a deterministic template built
 * from the same numbers, which is surfaced as `fallback.reason === "NO_PROVIDER"`.
 * The API key stays server-side; the browser never sees it.
 */
export const llmExplanationApi = {
  get: async (targetProfileId: string, _signal?: AbortSignal): Promise<ExplanationResult> => {
    const response = await invokeFunction<AiExplanationResponse>("ai-explanation", { targetProfileId });
    const row = response.compatibility ?? {};

    const overall = typeof row.overall_score === "number" ? row.overall_score : null;
    const hasText = typeof response.explanation === "string" && response.explanation.length > 0;

    return {
      targetProfileId,
      eligibility: {
        eligible: row.eligible !== false,
        reasons: row.eligibility_reasons ?? [],
      },
      compatibility: {
        overall,
        factors: compatibilityFactors(row),
        availability: compatibilityAvailability(row),
      },
      model: mapCompatibilityModel(row),
      mlPrior: {
        available: false,
        modelVersion: null,
        featureVersion: "ml-prior-features-v1",
        score: null,
      },
      explanation: {
        available: hasText,
        text: hasText ? response.explanation : null,
        providerVersion: response.model,
        promptVersion: "ai-explanation-v1",
        generatedAt: hasText ? new Date().toISOString() : null,
      },
      fallback: {
        used: response.fallback === true,
        reason: response.fallback === true ? "NO_PROVIDER" : "",
      },
    };
  },
};

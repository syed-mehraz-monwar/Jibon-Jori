import { getSupabase, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import { validateArtifact, type MlpArtifact } from "../lib/mlp";

/**
 * The compatibility model artifact (A-12), read from the `ml_artifacts` table.
 *
 * The trained JSON is published to `ml_artifacts` by the operator pipeline
 * (`ml/publish.mjs`) and is read here over PostgREST — clients have SELECT only, and
 * no write policy exists. The artifact is fetched once per session, cached in memory
 * and validated structurally before use, so a truncated or mismatched payload
 * degrades to "model unavailable" rather than producing a wrong number.
 */
const MODEL_NAME = "compatibility-mlp-v1";

let cached: Promise<MlpArtifact> | null = null;

async function loadArtifact(): Promise<MlpArtifact> {
  const { data, error } = await getSupabase()
    .from("ml_artifacts")
    .select("artifact")
    .eq("name", MODEL_NAME)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw toApiError(error);
  if (!data?.artifact) {
    throw new ApiError(404, "MODEL_UNAVAILABLE", "No active compatibility model artifact is published.");
  }

  const artifact = data.artifact as MlpArtifact;
  const problem = validateArtifact(artifact);
  if (problem) throw new ApiError(500, "INVALID_MODEL_ARTIFACT", `Invalid model artifact: ${problem}`);
  return artifact;
}

export const mlPriorModelApi = {
  get: (_signal?: AbortSignal): Promise<MlpArtifact> => {
    if (!cached) {
      cached = loadArtifact().catch((error: unknown) => {
        // A failed load must not be cached forever: the next call retries.
        cached = null;
        throw error;
      });
    }
    return cached;
  },
  /** Test helper: drop the memoised artifact so a suite can re-exercise the load path. */
  reset: (): void => {
    cached = null;
  },
};

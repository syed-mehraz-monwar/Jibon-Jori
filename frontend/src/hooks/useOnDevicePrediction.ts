import { useEffect, useMemo, useState } from "react";
import { mlPriorModelApi } from "../api/ml-prior-model.api";
import { runMlp, toFeatureArray, type MlpArtifact } from "../lib/mlp";

export type OnDevicePredictionState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; score: number; modelVersion: string; featureVersion: string };

/**
 * Real-time on-device compatibility prediction (A-12).
 *
 * The feature vector comes from the API (it is derived from real profile data), the
 * weights come from the artifact, and the forward pass runs here - on the device, with
 * no additional request. When the artifact cannot be loaded or the arithmetic fails the
 * result is an explicit `unavailable` state with a reason, never a fabricated number.
 */
export function useOnDevicePrediction(
  features: Record<string, unknown> | null | undefined
): OnDevicePredictionState {
  const [artifact, setArtifact] = useState<MlpArtifact | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReason(null);
    mlPriorModelApi
      .get()
      .then((loaded) => {
        if (active) setArtifact(loaded);
      })
      .catch(() => {
        if (active) {
          setArtifact(null);
          setReason("MODEL_UNAVAILABLE");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return useMemo<OnDevicePredictionState>(() => {
    if (!features) return { status: "loading" };
    if (reason) return { status: "unavailable", reason };
    if (!artifact) return { status: "loading" };

    try {
      const score = runMlp(artifact, toFeatureArray(features));
      return {
        status: "ready",
        score: Math.round(score * 10000) / 100,
        modelVersion: artifact.version,
        featureVersion: artifact.featureVersion,
      };
    } catch {
      return { status: "unavailable", reason: "INVALID_MODEL_OUTPUT" };
    }
  }, [artifact, features, reason]);
}

/**
 * A-12 — the on-device prediction path as the UI uses it.
 *
 * Two things are covered here: the artifact loader's caching/failure semantics (so a
 * broken load degrades to "unavailable" instead of a wrong number, and a transient
 * failure is retried rather than cached forever), and the hook's four states.
 *
 * The artifact now comes from the `ml_artifacts` table over PostgREST (read-only), so
 * the fake Supabase client serves it instead of a fetch mock.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mlPriorModelApi } from "../api/ml-prior-model.api";
import { fakeSupabase } from "./fake-supabase";
import type { MlpArtifact } from "../lib/mlp";

const ARTIFACT: MlpArtifact = {
  name: "compatibility-prior",
  version: "compatibility-mlp-v1",
  featureVersion: "ml-prior-features-v1",
  inputOrder: [
    "interests",
    "educationProfession",
    "location",
    "lifestyle",
    "partnerPreference",
    "ageGapNormalized",
    "gendersCompatible",
    "dataCoverage",
  ],
  outputRange: [0, 1],
  provenance: { kind: "supervised-distillation", teacher: "deterministic-v1", description: "test" },
  training: {
    framework: "tensorflow.js 4.22.0",
    samples: 1,
    epochs: 1,
    batchSize: 1,
    learningRate: 0.01,
    finalLossMse: 0,
    maxAbsErrorOnEval: 0,
    r2OnEval: 1,
    seed: 1,
  },
  // A deliberately trivial one-layer network: sum of the five factor features.
  layers: [
    {
      units: 1,
      activation: "linear",
      kernel: [[1], [1], [1], [1], [1], [0], [0], [0]],
      bias: [0],
    },
  ],
  goldenVectors: [{ input: [1, 1, 1, 1, 1, 0, 0, 1], expected: 1 }],
};

function seedArtifact(artifact: MlpArtifact = ARTIFACT): void {
  fakeSupabase.state.tables.ml_artifacts = [
    {
      id: "a1",
      name: "compatibility-mlp-v1",
      version: artifact.version,
      feature_version: artifact.featureVersion,
      is_active: true,
      artifact,
    },
  ];
}

describe("mlPriorModelApi", () => {
  beforeEach(() => {
    mlPriorModelApi.reset();
  });

  afterEach(() => {
    mlPriorModelApi.reset();
  });

  it("loads the active artifact once and reuses it", async () => {
    seedArtifact();

    const first = await mlPriorModelApi.get();
    const second = await mlPriorModelApi.get();

    expect(first.version).toBe("compatibility-mlp-v1");
    expect(second).toBe(first);
  });

  it("reports MODEL_UNAVAILABLE when nothing is published and retries after publishing", async () => {
    await expect(mlPriorModelApi.get()).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });

    // A failed load must not be cached forever: the next call retries.
    seedArtifact();
    await expect(mlPriorModelApi.get()).resolves.toMatchObject({ version: "compatibility-mlp-v1" });
  });

  it("rejects a malformed artifact instead of using it", async () => {
    seedArtifact({ ...ARTIFACT, inputOrder: ["nope"] });
    await expect(mlPriorModelApi.get()).rejects.toMatchObject({ code: "INVALID_MODEL_ARTIFACT" });
  });
});

describe("useOnDevicePrediction", () => {
  beforeEach(() => {
    mlPriorModelApi.reset();
    seedArtifact();
  });

  afterEach(() => {
    mlPriorModelApi.reset();
  });

  it("computes the score on the device from the feature vector", async () => {
    const { useOnDevicePrediction } = await import("../hooks/useOnDevicePrediction");
    const features = {
      interests: 1,
      educationProfession: 1,
      location: 1,
      lifestyle: 1,
      partnerPreference: 1,
      ageGapNormalized: 0,
      gendersCompatible: 1,
      dataCoverage: 1,
    };

    const { result } = renderHook(() => useOnDevicePrediction(features));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("unreachable");
    expect(result.current.score).toBeCloseTo(100, 6);
    expect(result.current.modelVersion).toBe("compatibility-mlp-v1");
  });

  it("stays loading until the feature vector arrives", async () => {
    const { useOnDevicePrediction } = await import("../hooks/useOnDevicePrediction");
    const { result } = renderHook(() => useOnDevicePrediction(null));
    expect(result.current.status).toBe("loading");
  });

  it("reports an explicit reason when the artifact cannot be loaded", async () => {
    fakeSupabase.state.tables.ml_artifacts = [];
    const { useOnDevicePrediction } = await import("../hooks/useOnDevicePrediction");

    const { result } = renderHook(() => useOnDevicePrediction({ interests: 0.5 }));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));

    if (result.current.status !== "unavailable") throw new Error("unreachable");
    expect(result.current.reason).toBe("MODEL_UNAVAILABLE");
  });
});

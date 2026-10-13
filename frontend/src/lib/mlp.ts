/**
 * On-device inference runtime for the compatibility MLP artifact (A-12).
 *
 * The arithmetic lives only here; there is no second runtime to keep in step, because
 * the backend that used to mirror it was removed in the Supabase migration. The
 * artifact's `goldenVectors` are produced by TensorFlow.js during training
 * (`ml/train.mjs`) and asserted against this runtime in the frontend suite, so a
 * divergence between training and inference fails the tests.
 *
 * Nothing here fetches or tunes anything: the weights arrive as the active
 * `ml_artifacts` row from Supabase and the forward pass is a handful of
 * multiply-adds, so the prediction is computed on the device with no further round
 * trip.
 */

export const MLP_FEATURE_ORDER = [
  "interests",
  "educationProfession",
  "location",
  "lifestyle",
  "partnerPreference",
  "ageGapNormalized",
  "gendersCompatible",
  "dataCoverage",
] as const;

export type MlpDenseLayer = {
  units: number;
  activation: "relu" | "linear";
  /** `[in][out]`, matching TensorFlow.js' dense kernel layout. */
  kernel: number[][];
  bias: number[];
};

export type MlpGoldenVector = { input: number[]; expected: number };

export type MlpArtifact = {
  name: string;
  version: string;
  featureVersion: string;
  inputOrder: string[];
  outputRange: [number, number];
  provenance: { kind: string; teacher: string; description: string };
  training: {
    framework: string;
    samples: number;
    epochs: number;
    batchSize: number;
    learningRate: number;
    finalLossMse: number;
    maxAbsErrorOnEval: number;
    r2OnEval: number;
    seed: number;
  };
  layers: MlpDenseLayer[];
  goldenVectors: MlpGoldenVector[];
};

export type OnDevicePrediction =
  | { status: "ready"; score: number; modelVersion: string; featureVersion: string }
  | { status: "unavailable"; reason: string };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Structural validation, run before the artifact is accepted from the network. */
export function validateArtifact(artifact: MlpArtifact): string | null {
  if (!artifact || typeof artifact !== "object") return "artifact is not an object";
  if (!Array.isArray(artifact.layers) || artifact.layers.length === 0) return "artifact has no layers";
  if (!Array.isArray(artifact.inputOrder) || artifact.inputOrder.length !== MLP_FEATURE_ORDER.length) {
    return "artifact input order has the wrong width";
  }
  for (let i = 0; i < MLP_FEATURE_ORDER.length; i += 1) {
    if (artifact.inputOrder[i] !== MLP_FEATURE_ORDER[i]) return `input order mismatch at ${i}`;
  }

  let incoming: number = MLP_FEATURE_ORDER.length;
  for (const [index, layer] of artifact.layers.entries()) {
    if (!Array.isArray(layer.kernel) || layer.kernel.length !== incoming) {
      return `layer ${index} has the wrong input width`;
    }
    if (!Array.isArray(layer.bias) || layer.bias.length !== layer.units) {
      return `layer ${index} has the wrong bias length`;
    }
    for (const row of layer.kernel) {
      if (!Array.isArray(row) || row.length !== layer.units) {
        return `layer ${index} has a malformed kernel row`;
      }
      for (const weight of row) {
        if (!Number.isFinite(weight)) return `layer ${index} has a non-finite weight`;
      }
    }
    incoming = layer.units;
  }

  const last = artifact.layers[artifact.layers.length - 1];
  if (last.units !== 1) return "the output layer is not a single unit";
  return null;
}

/** Flatten the backend's feature object into the artifact's canonical input order. */
export function toFeatureArray(features: Record<string, unknown>): number[] {
  return MLP_FEATURE_ORDER.map((name) => clamp01(Number(features[name] ?? 0)));
}

export function runMlp(artifact: MlpArtifact, input: readonly number[]): number {
  if (input.length !== artifact.inputOrder.length) {
    throw new Error(`expected ${artifact.inputOrder.length} features, received ${input.length}`);
  }

  let activations: number[] = MLP_FEATURE_ORDER.map((_, i) => clamp01(input[i]));

  for (const layer of artifact.layers) {
    const next = new Array<number>(layer.units).fill(0);
    for (let j = 0; j < layer.units; j += 1) {
      let sum = layer.bias[j];
      for (let i = 0; i < activations.length; i += 1) {
        sum += activations[i] * layer.kernel[i][j];
      }
      next[j] = layer.activation === "relu" ? Math.max(0, sum) : sum;
    }
    activations = next;
  }

  const [min, max] = artifact.outputRange;
  const raw = activations[0];
  if (!Number.isFinite(raw)) throw new Error("the artifact produced a non-finite output");
  return Math.min(max, Math.max(min, raw));
}

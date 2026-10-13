/**
 * A-12 — the browser-side inference runtime, checked against the *shipped* artifact.
 *
 * The artifact is trained by `ml/train.mjs` and written to
 * `ml/artifacts/compatibility-mlp-v1.json`; it is published to the `ml_artifacts`
 * table and fetched by the client. This suite parses that checked-in artifact and
 * asserts that the frontend runtime reproduces the TensorFlow.js golden vectors
 * recorded at training time, which is what pins the on-device forward pass to the
 * one reference implementation.
 *
 * It also asserts the artifact's provenance text, so a future regeneration which
 * silently changed the claim would fail here.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MLP_FEATURE_ORDER,
  runMlp,
  toFeatureArray,
  validateArtifact,
  type MlpArtifact,
} from "../lib/mlp";

const frontendRoot = resolve(process.cwd());
const ARTIFACT_PATH = join(
  frontendRoot,
  "..",
  "ml",
  "artifacts",
  "compatibility-mlp-v1.json"
);

const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as MlpArtifact;

describe("the shipped model artifact", () => {
  it("parses out of the generated module and validates", () => {
    expect(artifact.version).toBe("compatibility-mlp-v1");
    expect(artifact.featureVersion).toBe("ml-prior-features-v1");
    expect(validateArtifact(artifact)).toBeNull();
  });

  it("uses the runtime's canonical feature order", () => {
    expect(artifact.inputOrder).toEqual([...MLP_FEATURE_ORDER]);
  });

  it("declares distillation from the deterministic scorer, not outcome data", () => {
    expect(artifact.provenance.kind).toBe("supervised-distillation");
    expect(artifact.provenance.teacher).toBe("deterministic-v1");
    expect(artifact.provenance.description.toLowerCase()).toContain("no behavioural outcome data");
    expect(artifact.training.framework).toMatch(/^tensorflow\.js /);
    expect(artifact.training.maxAbsErrorOnEval).toBeLessThanOrEqual(0.02);
  });

  it("is reproduced by the frontend runtime to TensorFlow.js golden-vector precision", () => {
    expect(artifact.goldenVectors.length).toBeGreaterThanOrEqual(16);
    let worst = 0;
    for (const vector of artifact.goldenVectors) {
      worst = Math.max(worst, Math.abs(runMlp(artifact, vector.input) - vector.expected));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("clamps an out-of-range input rather than extrapolating", () => {
    const zeros = runMlp(artifact, MLP_FEATURE_ORDER.map(() => 0));
    const clamped = runMlp(artifact, MLP_FEATURE_ORDER.map(() => -100));
    expect(clamped).toBeCloseTo(zeros, 10);

    const ones = runMlp(artifact, MLP_FEATURE_ORDER.map(() => 1));
    const high = runMlp(artifact, MLP_FEATURE_ORDER.map(() => 100));
    expect(high).toBeCloseTo(ones, 10);
  });
});

describe("validateArtifact", () => {
  it("rejects a truncated artifact", () => {
    expect(validateArtifact({ ...artifact, layers: [] })).toBe("artifact has no layers");
  });

  it("rejects a reordered feature contract", () => {
    const reordered = { ...artifact, inputOrder: [...artifact.inputOrder].reverse() };
    expect(validateArtifact(reordered)).toMatch(/input order mismatch/);
  });

  it("rejects a non-finite weight", () => {
    const corrupt = JSON.parse(JSON.stringify(artifact)) as MlpArtifact;
    corrupt.layers[0].kernel[0][0] = Number.NaN;
    expect(validateArtifact(corrupt)).toMatch(/non-finite weight/);
  });

  it("rejects an output layer that is not a single unit", () => {
    const widened = JSON.parse(JSON.stringify(artifact)) as MlpArtifact;
    widened.layers[widened.layers.length - 1].units = 2;
    expect(validateArtifact(widened)).toMatch(/wrong bias length|kernel row/);
  });
});

describe("toFeatureArray", () => {
  it("flattens in the canonical order and coerces junk to zero", () => {
    expect(
      toFeatureArray({
        interests: 2,
        educationProfession: -1,
        location: 0.5,
        lifestyle: undefined,
        partnerPreference: 0.25,
        ageGapNormalized: 0.75,
        gendersCompatible: 1,
        dataCoverage: Number.NaN,
      })
    ).toEqual([1, 0, 0.5, 0, 0.25, 0.75, 1, 0]);
  });

  it("throws on the wrong input width instead of guessing", () => {
    expect(() => runMlp(artifact, [0, 1])).toThrow(/expected 8 features/);
  });
});

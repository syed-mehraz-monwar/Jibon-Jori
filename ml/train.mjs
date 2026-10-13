/**
 * Phase 13A - training run for the JibonJori on-device compatibility model (A-12).
 *
 * What this is
 * ------------
 * A small multilayer perceptron (8 -> 16 -> 8 -> 1, ReLU hidden layers, linear output)
 * trained with TensorFlow.js by supervised regression. It learns to reproduce the
 * platform's approved compatibility function (`deterministic-v1`, now implemented as
 * the `compute_compatibility` SQL function) from the same normalized feature vector,
 * which lets the prediction run on the device in real time with no server round trip.
 *
 * What this is NOT
 * ----------------
 * It is not trained on behavioural outcome data - no such data exists in this
 * deployment - and it is not presented as such. The provenance block written into the
 * artifact records "supervised-distillation from deterministic-v1" explicitly, so the
 * model can never be mistaken for one learned from user outcomes. When real interaction
 * outcomes accumulate, the same pipeline can be re-run with outcome labels; nothing else
 * has to change.
 *
 * Where the artifact goes
 * -----------------------
 * The trained artifact is written as plain JSON to `ml/artifacts/`. It is published to
 * the `ml_artifacts` table with `npm run publish` (see publish.mjs), which requires
 * Supabase credentials, and the client fetches the active row over PostgREST and runs
 * the forward pass locally.
 *
 * Reproducibility
 * ---------------
 * `dataset.json` is checked in and is derived from the deterministic compatibility
 * function over its real normalized feature space. The initial weights are drawn from a
 * fixed seed, the model is trained with Adam on a fixed-shape batch schedule, and the
 * exported weights are rounded before the golden vectors are recorded *from the rounded
 * weights*. A re-run therefore reproduces the same artifact. TensorFlow.js is used only
 * here; it is never a runtime dependency of the application.
 *
 * Usage:
 *   cd ml && npm install && npm run train     # writes ml/artifacts/*.json
 *   cd ml && npm run publish                  # uploads it to Supabase (operator only)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as tf from "@tensorflow/tfjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET = resolve(HERE, "dataset.json");
const ARTIFACT_JSON = resolve(HERE, "artifacts", "compatibility-mlp-v1.json");


const MODEL_NAME = "compatibility-prior";
const MODEL_VERSION = "compatibility-mlp-v1";
const FEATURE_VERSION = "ml-prior-features-v1";
const SEED = 424242;
const EPOCHS = 240;
const BATCH_SIZE = 256;
const LEARNING_RATE = 0.01;
const HOLDOUT = 0.2;
const WEIGHT_DECIMALS = 7;
const GOLDEN_INPUTS = 32;

/** Deterministic PRNG, used only for the initial weights and the holdout split. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const raw = JSON.parse(readFileSync(DATASET, "utf8"));
if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
  throw new Error(`dataset at ${DATASET} has no rows; run export-ml-dataset.ts first`);
}
const width = raw.featureOrder.length;

// Deterministic holdout split: every 6th row is held out (plus the structured edges,
// which are dropped from the holdout so the reported error is over the interior).
const trainRows = [];
const evalRows = [];
raw.rows.forEach((row, index) => {
  if (index < 13) {
    trainRows.push(row);
  } else if (index % 6 === 0) {
    evalRows.push(row);
  } else {
    trainRows.push(row);
  }
});

console.log(`dataset: ${raw.rows.length} rows (${trainRows.length} train / ${evalRows.length} eval)`);

await tf.setBackend("cpu");
await tf.ready();

function buildModel() {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 16, activation: "relu", inputShape: [width] }));
  model.add(tf.layers.dense({ units: 8, activation: "relu" }));
  model.add(tf.layers.dense({ units: 1, activation: "linear" }));
  return model;
}

/** Overwrite every layer's weights from a fixed seed so training starts identically. */
function seedWeights(model) {
  const random = mulberry32(SEED);
  const layers = model.layers;
  for (let index = 0; index < layers.length; index += 1) {
    const kernel = layers[index].getWeights()[0];
    const bias = layers[index].getWeights()[1];
    const [fanIn, fanOut] = kernel.shape;
    const limit = Math.sqrt(6 / (fanIn + fanOut));
    const kernelValues = new Float32Array(fanIn * fanOut);
    for (let i = 0; i < kernelValues.length; i += 1) {
      kernelValues[i] = (random() * 2 - 1) * limit;
    }
    const biasValues = new Float32Array(fanOut);
    for (let i = 0; i < biasValues.length; i += 1) {
      biasValues[i] = 0;
    }
    layers[index].setWeights([
      tf.tensor2d(kernelValues, [fanIn, fanOut]),
      tf.tensor1d(biasValues),
    ]);
  }
}

const xsAll = tf.tensor2d(trainRows.map((row) => row.features), [trainRows.length, width]);
const ysAll = tf.tensor2d(trainRows.map((row) => [row.label]), [trainRows.length, 1]);

const model = buildModel();
seedWeights(model);
model.compile({ optimizer: tf.train.adam(LEARNING_RATE), loss: "meanSquaredError" });

const history = await model.fit(xsAll, ysAll, {
  epochs: EPOCHS,
  batchSize: BATCH_SIZE,
  shuffle: false,
  verbose: 0,
});
const finalLoss = history.history.loss[history.history.loss.length - 1];
console.log(`trained ${EPOCHS} epochs, final train MSE = ${finalLoss.toExponential(4)}`);

/** Read the trained weights back as plain numbers, rounded to the exported precision. */
function exportLayers() {
  return model.layers.map((layer, index) => {
    const [kernel, bias] = layer.getWeights();
    const [fanIn, fanOut] = kernel.shape;
    const kernelValues = kernel.arraySync();
    const biasValues = bias.arraySync();
    const units = fanOut;
    const activation = layer.getConfig().activation === "relu" ? "relu" : "linear";

    // TF.js dense kernels are [in][out], which is the layout the shipped runtime uses.
    const roundedKernel = [];
    for (let i = 0; i < fanIn; i += 1) {
      const row = [];
      for (let j = 0; j < fanOut; j += 1) {
        row.push(round(kernelValues[i][j], WEIGHT_DECIMALS));
      }
      roundedKernel.push(row);
    }
    return {
      index,
      units,
      activation,
      kernel: roundedKernel,
      bias: biasValues.map((value) => round(value, WEIGHT_DECIMALS)),
    };
  });
}

const layers = exportLayers();

/**
 * A second, independent model is rebuilt from the *rounded* exported weights. Every
 * recorded golden vector is produced by this rebuilt model, so the numbers written into
 * the artifact are reproduceable by the shipped runtime rather than by the pre-rounding
 * training graph.
 */
function rebuildFromExport(exported) {
  const rebuilt = buildModel();
  rebuilt.layers.forEach((layer, index) => {
    const spec = exported[index];
    const fanIn = spec.kernel.length;
    const flatKernel = new Float32Array(fanIn * spec.units);
    for (let i = 0; i < fanIn; i += 1) {
      for (let j = 0; j < spec.units; j += 1) {
        flatKernel[i * spec.units + j] = spec.kernel[i][j];
      }
    }
    layer.setWeights([
      tf.tensor2d(flatKernel, [fanIn, spec.units]),
      tf.tensor1d(spec.bias),
    ]);
  });
  return rebuilt;
}

const shipped = rebuildFromExport(layers);

async function predictMany(rows) {
  const input = tf.tensor2d(rows.map((row) => row.features), [rows.length, width]);
  const output = shipped.predict(input);
  const values = Array.from(await output.data());
  input.dispose();
  output.dispose();
  return values;
}

const evalPredictions = await predictMany(evalRows);
const evalTruth = evalRows.map((row) => row.label);
const errors = evalPredictions.map((value, index) => Math.abs(value - evalTruth[index]));
const maxAbsError = Math.max(...errors);
const mse = mean(errors.map((error) => error * error));
const labelMean = mean(evalTruth);
const ssTot = mean(evalTruth.map((value) => (value - labelMean) ** 2));
const r2 = ssTot === 0 ? 1 : 1 - mse / ssTot;

console.log(
  `holdout: max |error| = ${maxAbsError.toFixed(6)} (${(maxAbsError * 100).toFixed(4)} pts), R2 = ${r2.toFixed(8)}`
);
if (!(maxAbsError < 0.02)) {
  throw new Error(
    `holdout error ${maxAbsError} exceeds the 2-point gate; the artifact would not be faithful enough to ship`
  );
}

// Golden vectors: fixed, spread across the input space, produced by the shipped graph.
const random = mulberry32(SEED + 1);
const goldenInputs = [];
for (let i = 0; i < GOLDEN_INPUTS; i += 1) {
  goldenInputs.push(Array.from({ length: width }, () => round(random(), 4)));
}
goldenInputs[0] = Array.from({ length: width }, () => 0);
goldenInputs[1] = Array.from({ length: width }, () => 1);
const goldenOutputs = await predictMany(goldenInputs.map((input) => ({ features: input })));
const goldenVectors = goldenInputs.map((input, index) => ({
  input,
  expected: round(goldenOutputs[index], 6),
}));

const artifact = {
  name: MODEL_NAME,
  version: MODEL_VERSION,
  featureVersion: FEATURE_VERSION,
  inputOrder: raw.featureOrder,
  outputRange: [0, 1],
  provenance: {
    kind: "supervised-distillation",
    teacher: "deterministic-v1",
    description:
      "Learned by supervised regression against JibonJori's approved deterministic compatibility function over its real normalized feature space. No behavioural outcome data was used (none exists in this deployment); this model is a faithful surrogate for on-device, real-time prediction, not a claim about outcomes.",
  },
  training: {
    framework: `tensorflow.js ${tf.version.tfjs}`,
    samples: trainRows.length,
    epochs: EPOCHS,
    batchSize: BATCH_SIZE,
    learningRate: LEARNING_RATE,
    finalLossMse: Number(finalLoss.toExponential(6)),
    maxAbsErrorOnEval: round(maxAbsError, 6),
    r2OnEval: round(r2, 8),
    seed: SEED,
  },
  layers: layers.map(({ units, activation, kernel, bias }) => ({ units, activation, kernel, bias })),
  goldenVectors,
};

mkdirSync(dirname(ARTIFACT_JSON), { recursive: true });
writeFileSync(ARTIFACT_JSON, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

console.log(`wrote artifact -> ${ARTIFACT_JSON}`);
console.log(
  `layers: ${artifact.layers.map((layer) => `${layer.kernel.length}x${layer.units}:${layer.activation}`).join(" -> ")}`
);
console.log("publish it with: cd ml && npm run publish");

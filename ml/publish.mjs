/**
 * Publishes the trained on-device model artifact to Supabase.
 *
 * The `ml_artifacts` table is read-only for clients by policy: an artifact is an
 * operator action, not something an application user can influence. Publishing
 * therefore uses the service-role key and must never be done from the client.
 *
 * It is safe to re-run: the previous active row for the same model name is
 * deactivated first, so the partial unique index
 * (`ml_artifacts_one_active_per_name_idx`) can never see two live candidates.
 *
 * Usage:
 *   cd ml && npm run train          # writes artifacts/compatibility-mlp-v1.json
 *   cd ml && npm run publish        # uploads it
 *
 * Required environment (never logged, never written to the repo):
 *   SUPABASE_URL                 e.g. https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    the service-role key (server-side secret)
 *
 * Optional:
 *   ML_ARTIFACT_FILE             defaults to artifacts/compatibility-mlp-v1.json
 *   ML_ARTIFACT_MODEL_NAME       defaults to artifact.name
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, process.env.ML_ARTIFACT_FILE ?? "artifacts/compatibility-mlp-v1.json");

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
      "The service-role key is a server-side secret: set it in your shell or CI secret store,\n" +
      "never in a file that is committed to the repository.",
  );
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(FILE, "utf8"));
const modelName = process.env.ML_ARTIFACT_MODEL_NAME ?? artifact.name;

if (typeof artifact.name !== "string" || typeof artifact.version !== "string") {
  console.error(`artifact at ${FILE} is missing a name or version`);
  process.exit(1);
}
if (!Array.isArray(artifact.layers) || artifact.layers.length === 0) {
  console.error(`artifact at ${FILE} has no layers; refusing to publish`);
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function request(method, path, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: method === "POST" ? { ...headers, Prefer: "return=representation" } : headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    // The response body can only contain PostgREST diagnostic text, never the key.
    throw new Error(`${method} ${path} -> ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

console.log(`publishing ${artifact.name}@${artifact.version} to ${SUPABASE_URL}`);

const deactivated = await request(
  "PATCH",
  `ml_artifacts?name=eq.${encodeURIComponent(modelName)}&is_active=is.true`,
  { is_active: false },
);
console.log(`deactivated ${Array.isArray(deactivated) ? deactivated.length : 0} previously active row(s)`);

const inserted = await request("POST", "ml_artifacts", [
  {
    name: modelName,
    version: artifact.version,
    feature_version: artifact.featureVersion,
    artifact,
    is_active: true,
  },
]);

const row = Array.isArray(inserted) ? inserted[0] : inserted;
console.log(`published: id=${row.id} name=${row.name} version=${row.version} active=${row.is_active}`);

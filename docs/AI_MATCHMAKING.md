# AI and Matchmaking

JibonJori keeps three clearly separated layers, and the repository rules require the
distinction to stay explicit (`AGENTS.md` "AI and Machine Learning"):

1. **Deterministic compatibility engine** — SQL, migration 0012. Produces every
   number the app displays.
2. **On-device ML model** — a small MLP distilled from the deterministic engine,
   trained offline and executed in the client.
3. **LLM seam** — an Edge Function pair that phrases results or answers questions.
   It has no authority over any score.

Status vocabulary: VERIFIED, PARTIAL, ENVIRONMENT-GATED, BLOCKED, NOT VERIFIED,
NOT APPLICABLE.

> Evidence note: the deterministic-engine values are pinned by the SQL suite as
> recorded in `docs/SUPABASE_MIGRATION_FINAL_REPORT.md` and
> `docs/SUPABASE_MIGRATION_INVENTORY.md`. The ML metrics are recorded in the same
> report and inside the artifact. The LLM functions were never executed. This
> document ran no gate.

---

## 1. Deterministic engine (migration 0012)

The engine is a faithful port of the archived implementation
(`20260927000012_compatibility_parity.sql:4-43`). It is entirely in SQL; the client
never recomputes a score (`frontend/src/api/compatibility.api.ts:6-12`).

### 1.1 Weights

`compat_weights()` returns the single shared definition
(`0012:48-60`), mirrored in the client at
`frontend/src/lib/mappers.ts:34-41`:

| Factor key | Weight |
| --- | --- |
| `interests` | 0.25 |
| `educationProfession` | 0.20 |
| `location` | 0.15 |
| `lifestyle` | 0.15 |
| `partnerPreference` | 0.25 |

### 1.2 Factor formulas (`compute_compatibility`, `0012:337-511`)

| Factor | Formula | Unavailable case |
| --- | --- | --- |
| `interests` | Jaccard overlap: `round(100 * shared / union)` over the union of interest ids | union = 0 → score 0, `interests_available = false` (`:391-405`) |
| `education` (raw) | tier proximity `greatest(0, 100 - 20 * abs(tierA - tierB))` | either tier null → 0, false (`:407-415`) |
| `profession` (raw) | same tier-proximity formula | either tier null → 0, false (`:417-424`) |
| `educationProfession` | mean of whichever raw tier factors are available | neither available → 0, false (`:426-435`) |
| `location` | **maximum** of the available signals: equal city 100; equal district 70; coordinates `greatest(0, 100 - round(haversine_km))` | no signal → 0, false (`:437-451`) |
| `lifestyle` | `round(100 * matching_keys / shared_keys)`, where a key matches when the canonical values of both profiles' `lifestyle` jsonb are equal | no shared keys → 0, false (`:453-468`) |
| `partnerPreference` | mean of the available per-side scores from `preference_side_score` | neither side available → 0, false (`:470-481`) |

`preference_side_score(seeker, candidate)` (`0012:266-329`) counts each clause the
seeker actually stated (`age_min`, `age_max`, `genders`, `education_ids`,
`profession_ids`, `locations`), marks each clause satisfied or not, and returns
`round(100 * satisfied / total)`. `available` is false when the seeker has no
preference row or stated no clauses.

Location uses `haversine_km(lat1, lng1, lat2, lng2)` (`0007:20-37`).

### 1.3 Overall score

`0012:483-490`, clamped to 0..100 at `:507`:

```
overall = round(
    0.25 * (interests_available        ? interests_score        : 0)
  + 0.20 * (education_profession_avail ? education_profession_score : 0)
  + 0.15 * (location_available         ? location_score         : 0)
  + 0.15 * (lifestyle_available        ? lifestyle_score        : 0)
  + 0.25 * (preference_available       ? preference_score       : 0)
)
```

This is the documented divergence from the first SQL port, which substituted a
neutral 50 for a missing factor; the contract marks the factor unavailable and
contributes **zero** (`0012:22-24`).

### 1.4 Eligibility

`compute_eligibility(a, b)` (`0012:204-259`) is symmetric and returns de-duplicated
reason codes; the implementation collects them and collapses duplicates with
`array_agg(distinct r order by r)` (`:252-255`). Possible reasons:

| Reason | Trigger |
| --- | --- |
| `UNDERAGE` | either profile's age is null or < 18 (`:228-230`) |
| `GENDER_NOT_PREFERRED` | either seeker's gender list is non-empty and excludes the other (`:232-239`) |
| `AGE_NOT_IN_RANGE` | either seeker's age bounds exclude the other (`:241-250`) |

An ineligible pair returns no score and writes no cache row, but still reports the
inputs hash, matching the contract's build order (`0012:578-590`).

### 1.5 Model version and inputs hash

- `compat_model_version()` is the constant `deterministic-v1` (`0012:62-66`).
- `compat_inputs_hash(a, b)` (`0012:175-198`) builds a canonical input per profile
  with `profileId` excluded, interests and preference arrays sorted, framed as
  `{"a":<canonical>,"b":<canonical>}` with the pair ordered by profile id text, and
  hashes it with SHA-256. It is deterministic and invariant to the order the pair is
  passed in. It is deliberately **not** byte-identical to the removed JS output
  (jsonb key order differs), which the migration explains is acceptable because a
  fresh database has no legacy hashes (`0012:164-174`).

### 1.6 Cache write rules (`compatibility_for`, `0012:519-641`)

| Rule | Detail |
| --- | --- |
| Canonical pair | `lo = least(me, p_other)`, `hi = greatest(...)`; the table CHECK enforces `a < b` (`:572-573`) |
| Order of checks | unauthenticated → `UNAUTHENTICATED`; `p_other` null/self → `INVALID_TARGET`; not visible → `PROFILE_NOT_VISIBLE` (`:562-570`) |
| Eligibility first | ineligible → return no score, no cache row (`:580-590`) |
| Cache hit | `from_cache = true` when an existing row has the same `inputs_hash` **and** `model_version`, and `computed_at` is reused (`:598-604`) |
| Cache miss | upsert into `compatibility_scores` with `model_version` and `inputs_hash` (`:605-628`) |
| What is stored | only the five raw factor columns (`interests`, `education`, `profession`, `location`, `preference`) plus `overall`, `model_version`, `inputs_hash`, `computed_at` — **not** `lifestyle` or the combined `educationProfession` score, which are response-only outputs (`0012:38-42`) |
| Who may write | only this definer function; `compatibility_scores` has no client write policy (`0004:326-330`) |

`compatibility_for` returns 22 columns including `eligible`, `eligibility_reasons`,
every factor score and its availability flag, `overall_score`, `model_version`,
`inputs_hash`, `from_cache` and `computed_at` (`0012:520-544`).

### 1.7 Two pinned example values

Both are asserted by value in the SQL suite, and both were computed by the engine
itself.

**Example A — alice ↔ bob, overall 38** (`supabase/tests/rls_assertions.sql:344-357`).

- interests: 2 shared of union 4 → 50.
- education / profession: neither profile lists a tier → combined factor
  unavailable → contributes 0.
- location: no shared city/district and no coordinates → contributes 0.
- lifestyle: no shared keys → contributes 0.
- partnerPreference: both sides fully satisfied → 100.
- `overall = round(0.25*50 + 0.20*0 + 0.15*0 + 0.15*0 + 0.25*100) = round(12.5 + 25)
  = 38`.

**Example B — controlled formula pair, overall 67** (`rls_assertions.sql:645-684`).

- interests: identical single-interest sets → 100.
- education: tier gap 2 → `max(0, 100 - 20*2) = 60`. Profession unavailable, so the
  combined `educationProfession` is the mean of the available tiers = 60.
- location: matching city → 100.
- lifestyle: one shared key with equal value → 100.
- partnerPreference: no preferences stated → unavailable → 0.
- `overall = round(0.25*100 + 0.20*60 + 0.15*100 + 0.15*100 + 0.25*0) =
  round(25 + 12 + 15 + 15) = 67`.

---

## 2. On-device ML model

The model runs in the client; there is no server-side ML scorer. The feature vector
is real (derived from the deterministic scorer), the weights are a published
artifact, and the forward pass happens on the device.

### 2.1 Artifact shape

`frontend/src/lib/mlp.ts:36-56` defines the artifact contract; the table CHECKs in
`0009` guarantee `layers` is a non-empty array and `inputOrder` is an array
(`20260927000009_ml_artifacts.sql:32-38`).

`ml/artifacts/compatibility-mlp-v1.json` (as read from the file):

| Field | Value |
| --- | --- |
| `name` | `compatibility-prior` |
| `version` | `compatibility-mlp-v1` |
| `featureVersion` | `ml-prior-features-v1` |
| `inputOrder` | `interests`, `educationProfession`, `location`, `lifestyle`, `partnerPreference`, `ageGapNormalized`, `gendersCompatible`, `dataCoverage` |
| `outputRange` | `[0, 1]` |
| `provenance.kind` / `teacher` | `supervised-distillation` / `deterministic-v1` |
| `layers` | `8×16:relu → 16×8:relu → 8×1:linear` (dense kernels are `[in][out]`) |
| `goldenVectors` | 32 vectors |
| `training` | framework `tensorflow.js 4.22.0`, samples 16680, epochs 240, batchSize 256, learningRate 0.01, seed 424242, finalLossMse 2.119132e-07, **maxAbsErrorOnEval 0.007528**, r2OnEval 0.9999794 |

The provenance block records "supervised-distillation", not outcome learning: the
model is trained to reproduce the platform's approved deterministic function, and no
behavioural outcome data exists in this deployment (`ml/train.mjs:1-20`, `:262-267`).

### 2.2 Feature order and runtime

`MLP_FEATURE_ORDER` (`mlp.ts:15-24`) is the same eight features as the artifact's
`inputOrder`. `validateArtifact` checks the shape structurally before use
(`mlp.ts:70-102`); `toFeatureArray` clamps each value to 0..1 (`:105-107`); `runMlp`
runs the dense forward pass and clamps the output to `outputRange` (`:109-132`).

The feature vector is built in `frontend/src/api/ml-prior.api.ts:35-57` from the
deterministic row plus three auxiliary inputs (`ageGapNormalized`,
`gendersCompatible`, `dataCoverage`); `useOnDevicePrediction` loads the artifact and
runs the pass, returning an explicit `unavailable` reason on failure
(`frontend/src/hooks/useOnDevicePrediction.ts:18-59`). `mlPriorApi.get` reports the
classic endpoint as `available: false, reason: "DISABLED"` because the prediction
is on-device (`ml-prior.api.ts:59-97`).

The artifact is fetched over PostgREST from `ml_artifacts` (`ml-prior-model.api.ts`),
which is read-only for clients (`0009:48-55`).

### 2.3 Toolchain

| Step | Command | File |
| --- | --- | --- |
| Train | `cd ml && npm install && npm run train` | `ml/train.mjs` |
| Publish | `cd ml && npm run publish` | `ml/publish.mjs` |

Training is deterministic: a fixed seed (`SEED = 424242`), a deterministic PRNG for
initial weights and the holdout split, `shuffle: false`, and weights rounded before
golden vectors are recorded **from the rounded weights** (`ml/train.mjs:28-40`,
`:117-139`, `:242-254`). The training run fails if holdout max |error| ≥ 0.02
(`ml/train.mjs:236-240`).

Publishing requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and refuses to run
without them; it deactivates the previous active row before inserting, so the
partial unique index never sees two live candidates (`ml/publish.mjs:1-10`,
`:35-42`, `:79-94`).

### 2.4 Status

| Item | Status |
| --- | --- |
| Artifact shape + 32 golden vectors | VERIFIED — recorded in `docs/SUPABASE_MIGRATION_FINAL_REPORT.md:86-94` |
| Holdout accuracy max abs error 0.007528 (gate 0.02), R² 0.9999794 | VERIFIED — recorded in the same report and in the artifact's `training` block |
| Byte-identical artifact across two training runs (sha256 `C49B8A69…6075`) | VERIFIED — recorded in `docs/SUPABASE_MIGRATION_FINAL_REPORT.md:88-92` |
| Client runtime (`runMlp`, `validateArtifact`, golden-vector unit test) | Unit-covered (`frontend/src/__tests__/on-device-model.test.ts`, `on-device-prediction.test.tsx`) |
| Publishing an artifact to a live `ml_artifacts` row | **NOT VERIFIED** — needs service-role credentials |

---

## 3. LLM seam

The LLM only **phrases** or **answers**. It never produces a score
(`supabase/functions/_shared/llm.ts:7-15`).

### 3.1 Provider client (`_shared/llm.ts`)

| Setting | Default | Env var |
| --- | --- | --- |
| base URL | `https://api.openai.com/v1` | `LLM_BASE_URL` |
| model | `gpt-4o-mini` | `LLM_MODEL` |
| timeout | 20 000 ms | `LLM_TIMEOUT_MS` |
| API key | none | `LLM_API_KEY` |

`isLlmConfigured()` is true only when `LLM_API_KEY` is set (`:31-33`).
`chatCompletion` sends an OpenAI-compatible `/chat/completions` request. A provider
error body is logged, never returned, because it can contain request identifiers and
prompt echoes (`:47-107`).

### 3.2 `ai-explanation`

- Auth: `requireUser`; body `{ targetProfileId }` (`index.ts:67-79`).
- The score comes from `compatibility_for`, not the model (`:81-105`).
- The prompt is given only aggregate component scores and coarse, non-identifying
  region facts read through RLS (`:107-140`).
- If no key is configured, it returns `templateExplanation(...)`, a deterministic
  sentence built from the same numbers, and `fallback = true` (`:41-65`, `:119`,
  `:152-158`).
- Client mapping: `llm-explanation.api.ts:61-64` surfaces `fallback.reason ===
  "NO_PROVIDER"`.

### 3.3 `ai-chat`

- Auth: `requireUser`; body `{ conversationId, content }` (`index.ts:41-58`).
- The user turn is written with the caller's client (RLS: `role = 'user'` inside the
  caller's own conversation); the assistant turn is written with the **service role**,
  so a member cannot forge model replies into their history (`:8-16`, `:86-137`).
- History is limited to the last 20 messages; content is capped at 4000 characters
  (`:23-24`).
- No key or a failed call returns the named `FALLBACK_REPLY` and `fallback = true`
  (`:37-39`, `:96-121`).
- Client mapping: `chat.api.ts:108-124` surfaces `fallback.reason ===
  "LLM_UNAVAILABLE"`.

### 3.4 Status

| Item | Status |
| --- | --- |
| Provider seam, key handling, sanitised errors | Written; `LLM_API_KEY` remains server-side |
| Fallback design (named, never fabricated) | Written and unit-covered where possible |
| `ai-chat` / `ai-explanation` runtime | **NOT VERIFIED** — never executed; needs a hosted project and an LLM key (ENVIRONMENT-GATED) |

The secret template is `supabase/functions/.env.example:18-24`. Setting the secret
is a deployment step (`docs/DEPLOYMENT.md`).

---

## 4. Status summary

| Layer | Status |
| --- | --- |
| Deterministic engine (weights, formulas, eligibility, cache) | VERIFIED (SQL); two pairs pinned by value (38 and 67) |
| On-device MLP (artifact, runtime, golden vectors, training determinism) | VERIFIED; live publish NOT VERIFIED |
| LLM seam (`ai-chat`, `ai-explanation`) | Written; runtime NOT VERIFIED; ENVIRONMENT-GATED on `LLM_API_KEY` |

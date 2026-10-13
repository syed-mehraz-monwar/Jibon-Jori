# API

JibonJori exposes three API surfaces, all backed by the same PostgreSQL schema and
the same row level security policies:

1. **REST (PostgREST)** — derived automatically from the `public` schema.
2. **GraphQL (`pg_graphql`)** — enabled by migration 0014, served at `/graphql/v1`.
3. **RPCs and Edge Functions** — Postgres functions called over PostgREST, plus five
   Deno Edge Functions for operations that must not run in the client.

Status vocabulary: VERIFIED (exercised at the SQL level and recorded in
`docs/SUPABASE_MIGRATION_FINAL_REPORT.md` / `docs/COURSE_REQUIREMENT_MAPPING.md`),
PARTIAL, ENVIRONMENT-GATED, BLOCKED, NOT VERIFIED, NOT APPLICABLE.

> Evidence note: "VERIFIED (SQL)" below means the policy/function is covered by the
> SQL test suite as recorded in the existing migration documents. No Edge Function,
> live REST call, or live GraphQL call was executed in the environment in which this
> document was written.

---

## 1. REST (PostgREST)

The client's only first-party API is Supabase. The one client is built in
`frontend/src/lib/supabase.ts:23-42`; every read/write goes through it or through
`callRpc` (`:144-147`). There is no `/api/*` proxy anywhere
(`frontend/nginx.conf:1-13`, `frontend/vite.config.ts:4-9`).

### 1.1 Tables the client reads or writes

| Table | Client operation | Module | Policy that constrains it |
| --- | --- | --- | --- |
| `profiles` | select (own + discovery), update (own) | `profile.api.ts`, `auth.api.ts`, `health.api.ts` | `profiles_select_own`, `profiles_select_discoverable`, `profiles_update_own` (`0004:122-141`, `0011:172-180`) |
| `profile_interests` | select (own), delete + insert (full replacement) | `profile.api.ts:69-82` | `profile_interests_select/insert/delete` (`0004:200-210`) |
| `partner_preferences` | select, upsert | `partner-preferences.api.ts` | `partner_preferences_select/insert/update` (`0004:157-172`) |
| `media` | select, insert, update, delete | `media.api.ts` | `media_select/insert/update/delete` (`0004:218-237`) |
| `interactions` | select (own), upsert, delete | `interactions.api.ts` | `interactions_select/insert/update/delete` (`0004:244-263`) |
| `ratings` | select (own), upsert, delete | `ratings.api.ts` | `ratings_select/insert/update/delete` (`0004:270-289`) |
| `comments` | select (by target), insert, delete | `comments.api.ts` | `comments_select/insert/update/delete` (`0004:296-319`) |
| `notifications` | select (own), update (mark read) | `notifications.api.ts` | `notifications_select/update` (`0004:337-348`) |
| `chat_conversations` | select, insert, update | `chat.api.ts` | `chat_conversations_*` (`0004:358-373`) |
| `chat_messages` | select (own conversation) | `chat.api.ts` | `chat_messages_select` (`0004:377-385`) — assistant turns are written by the service role only |
| `curated_videos` | select (published) | `curated.api.ts` | `curated_videos_read_published/read_member` (`0004:415-421`) |
| `education_levels`, `professions`, `interests` | select (reference dropdowns) | `reference.api.ts:13-23` | public read policies (`0004:177-193`) |
| `ml_artifacts` | select (active artifact) | `ml-prior-model.api.ts:18-35` | `ml_artifacts_select_member` (`0009:53-55`) |
| `audit_logs` | (no client read in the UI) | — | admin-only select (`0004:402-404`) |

Tables the client never writes: `compatibility_scores` (no write policy),
`notifications` (no insert policy), `ml_artifacts` (no write policy),
`audit_logs` (no client write). Rows in these are produced by `security definer`
functions/triggers or by the service role.

### 1.2 Storage REST

| Operation | Module | Policy |
| --- | --- | --- |
| `.storage.from(bucket).upload(path, file)` | `media.api.ts:125-128` | bucket insert policy, own folder (`0005:60-66`) |
| `.storage.from(bucket).createSignedUrl(path, ttl)` | `media.api.ts:187-189` | bucket select policy (`0005:68-77`) |
| `.storage.from(bucket).remove([path])` | `media.api.ts:145`, `:249` | bucket delete policy, own folder (`0005:91-97`) |

The client always constructs the path as `${userId}/...`
(`media.api.ts:83-88`, `:123`), matching both the bucket policies and the `media`
CHECK constraint.

---

## 2. GraphQL (`pg_graphql`)

### 2.1 Server side

Migration `0014` enables `pg_graphql`, guarded by
`pg_available_extensions` (`20260927000014_graphql.sql:23-33`). The endpoint is
`/graphql/v1` on the same project, and it enforces the same RLS policies as
PostgREST because it runs as the same authenticated role
(`0014:4-14`). `supabase/config.toml:7-15` exposes the `public` and
`graphql_public` schemas.

### 2.2 Client side

`frontend/src/lib/graphql.ts`:

- `GRAPHQL_PATH = "/graphql/v1"` (`:20`).
- `graphqlRequest` POSTs `{ query, variables }` with the caller's access token (or
  the anon key when signed out) (`:30-87`).
- The one query in use is `REFERENCE_DATA_QUERY` (`:90-99`), which fetches
  `educationLevelsCollection` and `professionsCollection` ordered by `tier` in one
  document.

`frontend/src/api/reference.api.ts:38-48` wraps that call and returns `null` on any
failure; `:62-68` then falls back to two PostgREST reads
(`referenceTable("education_levels", "tier")` and `referenceTable("professions",
"tier")`). Interests are always read over PostgREST. So GraphQL is an optimization,
never the only path.

### 2.3 Status

| Item | Status |
| --- | --- |
| Transport (`graphqlRequest`, error mapping, fallback) | Unit-tested (`frontend/src/__tests__/graphql.test.ts`) |
| Live `/graphql/v1` endpoint | **NOT VERIFIED** — `pg_graphql` is a Supabase built-in and is absent from the local PostgreSQL; no hosted project was available |

---

## 3. RPCs

All RPCs are Postgres functions invoked through PostgREST (`callRpc`,
`frontend/src/lib/supabase.ts:144-147`).

### 3.1 RPCs the client actually calls

| RPC | Called from | Auth | Parameters | Returns | SQL status |
| --- | --- | --- | --- | --- | --- |
| `username_available` | `auth.api.ts:212` | anon or authenticated | `p_username text` | `boolean` | VERIFIED (SQL) — anon reachable, reserved/taken/invalid cases asserted (`rls_assertions.sql:61-98`) |
| `search_profiles` | `search.api.ts:75-89` | authenticated, active member | 13 params (see `docs/DATABASE.md` §6.3) | table incl. `total_count` | VERIFIED (SQL) — visibility and pending gate asserted (`rls_assertions.sql:397-402`, `:470-495`) |
| `recommendations` | `matches.api.ts:38-41` | authenticated, active member | `p_limit`, `p_offset` | table incl. `overall_score`, `scored`, `total_count` | VERIFIED (SQL) |
| `compatibility_for` | `compatibility.api.ts:16`, `ml-prior.api.ts:74`, `ai-explanation/index.ts:84` | authenticated | `p_other uuid` | 22-column table | VERIFIED (SQL) — weights, zero-contribution, version, eligibility, cache rules asserted (`rls_assertions.sql:328-378`) |
| `compat_canonical_input` | `ml-prior.api.ts:75-76` | authenticated | `p_profile uuid` | jsonb canonical input | VERIFIED (SQL) — used to build the on-device feature vector |
| `rating_summary` | `ratings.api.ts:82` | authenticated | `p_profile uuid` | `average, rating_count, distribution` | VERIFIED (SQL) — 1-decimal average, zero-filled distribution, visibility gate (`0013:33-75`) |

Not called by the client despite existing in SQL: `interaction_summary`, the six
`report_*` functions (invoked by the `reports` Edge Function, not the browser), and
all internal helpers (`compute_compatibility`, `compute_eligibility`,
`preference_side_score`, `compat_inputs_hash`, `compat_weights`, identity helpers).

### 3.2 Client `rpc()` call sites, enumerated

| File:line | RPC |
| --- | --- |
| `frontend/src/api/auth.api.ts:212` | `username_available` |
| `frontend/src/api/search.api.ts:75` | `search_profiles` |
| `frontend/src/api/matches.api.ts:38` | `recommendations` |
| `frontend/src/api/compatibility.api.ts:16` | `compatibility_for` |
| `frontend/src/api/ml-prior.api.ts:74` | `compatibility_for` |
| `frontend/src/api/ml-prior.api.ts:75-76` | `compat_canonical_input` (twice) |
| `frontend/src/api/ratings.api.ts:82` | `rating_summary` |

---

## 4. Edge Functions

All live in `supabase/functions/`. Shared helpers: `_shared/http.ts` (CORS
allowlist, JSON envelope, sanitised errors), `_shared/supabase.ts` (caller client vs
service client, `requireUser`, `requireAdmin`), `_shared/llm.ts` (provider seam).

CORS: allowed origins come from the `CORS_ALLOWED_ORIGINS` secret; the Capacitor
application origins `https://localhost`, `http://localhost`, `capacitor://localhost`
are always allowed (`_shared/http.ts:10-32`). Unhandled errors are logged and
returned as a generic `500 INTERNAL` (`_shared/http.ts:66-83`).

### 4.1 `ai-chat`

| Item | Value |
| --- | --- |
| Method | `POST` only (`index.ts:43-45`) |
| Auth | `requireUser` — any signed-in user (`:47`) |
| Request body | `{ conversationId: uuid, content: string(1..4000) }` (`:50-58`) |
| Behaviour | reads the caller's conversation + last 20 messages through the caller client (RLS-scoped), writes the user turn with the caller client, calls the LLM if configured, writes the assistant turn with the service role, bumps the conversation (`:62-147`) |
| Response | `{ userMessage, assistantMessage, reply, fallback, model }` (`:149-155`) |
| Fallback | when `LLM_API_KEY` is unset or the call fails, `reply` is a named fallback string and `fallback = true`; the model name is `null` (`:37-39`, `:96-121`) |
| Status | **NOT VERIFIED** — never executed (needs a project + LLM key). Transcript RLS is VERIFIED (SQL). |

### 4.2 `ai-explanation`

| Item | Value |
| --- | --- |
| Method | `POST` only (`index.ts:69-71`) |
| Auth | `requireUser` (`:73`) |
| Request body | `{ targetProfileId: uuid }` (`:74-79`) |
| Behaviour | calls `compatibility_for` through the caller client, so an invisible profile cannot be probed; then optionally asks the LLM to phrase the numbers (`:83-150`) |
| Response | `{ targetProfileId, compatibility, explanation, model, fallback }` (`:152-158`) |
| Fallback | deterministic `templateExplanation` built from the same component scores (`:41-65`, `:119`) |
| Status | **NOT VERIFIED** — never executed |

### 4.3 `account-delete`

| Item | Value |
| --- | --- |
| Method | `POST` only (`index.ts:22-24`) |
| Auth | `requireUser` (`:27`) |
| Request body | none |
| Behaviour | writes an `account.close` audit row first, then **soft-closes** the account in one transaction: `profiles.deleted_at = now()` (idempotent — left untouched if already set) and `delete from auth.sessions where user_id = <caller>`. No row is removed; `is_active_member()` and `account_state() = 'deleted'` stop matching immediately, and a pre-closure token dies with its session (archived spec B-72) |
| Response | `{ closed: true }` |
| Status | **NOT VERIFIED** — never executed |

### 4.4 `sessions`

| Item | Value |
| --- | --- |
| Methods | `GET` (list) and `POST` (revoke) (`index.ts:61-63`) |
| Auth | `requireUser` (`:65`) |
| Request (POST) | `{ revokeOthers: true }` or `{ sessionId: uuid }` (`:103-131`) |
| Behaviour | reads/updates `auth.sessions` directly over `SUPABASE_DB_URL` (that schema is not exposed via PostgREST); every statement filters `user_id = <caller>` and the caller's current session is never revoked (`:8-21`, `:106`, `:122-124`) |
| Response | `{ sessions: [{ id, createdAt, updatedAt, userAgent, ip, isCurrent }] }` or `{ revoked: number }` |
| Requires | `SUPABASE_DB_URL`; if absent, `503 DATABASE_NOT_CONFIGURED` (`:53-57`) |
| Status | **NOT VERIFIED** — never executed |

### 4.5 `reports`

| Item | Value |
| --- | --- |
| Method | `GET` only (`index.ts:163-165`) |
| Auth | `requireAdmin` — 403 for a non-admin (`:167`, `_shared/supabase.ts:69-84`) |
| Query | `?kind=<kind>&targetProfileId=<uuid>&format=json|csv` (`:169-172`) |
| Kinds | `users`, `matchmaking`, `compatibility`, `ratings`, `ratings-summary`, `admin` (`:41-144`) |
| Requires target | `compatibility`, `ratings-summary` (`needsTarget`) (`:85-131`); the others reject noise |
| Behaviour | calls the matching `report_*` SQL function with the caller client; each SQL function re-checks `is_admin()` itself (`:196-209`) |
| Response (json) | `{ dataset: { kind, label, description, columns, rowLimit, rows } }` (`:224-233`) |
| Response (csv) | `text/csv` with an RFC-4180 quoting helper (`:146-159`, `:214-222`) |
| Status | **NOT VERIFIED** — never executed. The six `report_*` SQL shapes and the admin gate are VERIFIED (SQL) (`rls_assertions.sql:516-533`). |

---

## 5. Client error contract

`ApiError` (`frontend/src/lib/http.ts:12-38`) is the shape the UI branches on.
`toApiError` (`frontend/src/lib/supabase.ts:74-135`) maps the several error shapes
supabase-js can raise onto it: PostgREST codes (`23505` → 409 DUPLICATE, `23514` /
`23503` → 400 VALIDATION_ERROR, `PGRST116` → 404), Edge Function JSON envelopes, and
message-keyword matching (`FORBIDDEN`, `PROFILE_NOT_VISIBLE`, `PROFILE_NOT_FOUND`,
`UNAUTHENTICATED`, `INVALID_*`).

---

## 6. Status summary

| Surface | Status |
| --- | --- |
| REST (PostgREST over tables) | Written; RLS behind it VERIFIED (SQL). Live calls from the browser NOT VERIFIED. |
| GraphQL (`pg_graphql`) | Transport unit-tested; live endpoint NOT VERIFIED (PARTIAL) |
| RPCs | SQL-level VERIFIED for the six the client calls; the Edge Function callers NOT VERIFIED |
| Edge Functions (all five) | Written; **NOT VERIFIED** (never executed) |

# Architecture

JibonJori is a **pure Supabase BaaS deployment**. There is no first-party server:
the React client talks directly to a hosted Supabase project, and PostgreSQL row
level security (RLS) is the single authorization boundary. This document describes
the layers as they exist in this repository. It is a description, not a claim that
any hosted-service behaviour was executed here.

Status vocabulary used in this document: VERIFIED, PARTIAL, ENVIRONMENT-GATED,
BLOCKED, NOT VERIFIED, NOT APPLICABLE.

---

## 1. Layered design

```
+--------------------------------------------------------------------------------+
| CLIENT  (browser and Android WebView)                                          |
|   React 18 + TypeScript + Vite, Tailwind + Sass, GSAP, react-router-dom         |
|   @supabase/supabase-js (Auth, PostgREST, Storage, Realtime)                    |
|   fetch() for the GET Edge Functions (reports, sessions)                        |
|   Capacitor Android wrapper (frontend/capacitor.config.ts)                      |
+----------------------+----------------------+----------------------+------------+
                       | HTTPS                | HTTPS                | WSS
                       | (REST/GraphQL/Auth/  | (Storage signed      | (Realtime
                       |  Storage)            |  URLs)               |  postgres_changes)
                       v                      v                      v
+--------------------------------------------------------------------------------+
| SUPABASE PROJECT                                                               |
|   Auth          | PostgREST      | pg_graphql   | Storage   | Realtime          |
|   Edge Functions (Deno)                                                         |
|     ai-chat, ai-explanation, account-delete, sessions, reports                  |
+--------------------------------------+-----------------------------------------+
                                       | SQL executed as the request's
                                       | `anon` / `authenticated` role
                                       v
+--------------------------------------------------------------------------------+
| POSTGRESQL (public schema)                                                     |
|   RLS policies  = the single authorization boundary                            |
|   CHECK constraints, FKs, triggers                                              |
|   `security definer` helper + RPC functions                                     |
+--------------------------------------------------------------------------------+
```

Sources: `README.md:13-29`, `frontend/src/lib/supabase.ts:23-42`,
`frontend/nginx.conf:1-13`, `supabase/config.toml:7-23`,
`supabase/functions/_shared/supabase.ts:1-18`.

---

## 2. What each layer owns

| Layer | Owns | Where |
| --- | --- | --- |
| Client | UI, client-side UX validation, the one Supabase client, RLS-scoped reads/writes, on-device ML forward pass | `frontend/src/` |
| Supabase Auth | Identity, credentials, email OTP, email confirmation, JWT sessions + refresh | `supabase/config.toml:156-235`, `frontend/src/api/auth.api.ts` |
| PostgREST | REST API derived from `public` tables/views/RPCs | `supabase/config.toml:7-18`, `frontend/src/api/*.ts` |
| pg_graphql | GraphQL API at `/graphql/v1` over `public` | `supabase/migrations/20260927000014_graphql.sql` |
| Storage | Bytes for photos and documents (private buckets) | `supabase/migrations/20260927000005_storage.sql` |
| Realtime | `postgres_changes` broadcasts on 5 tables | `supabase/migrations/20260927000006_realtime.sql` |
| Edge Functions | Only the operations that cannot run in the client (LLM keys, auth-user delete, `auth.sessions` enumeration, admin datasets) | `supabase/functions/` |
| PostgreSQL | All rules that matter: RLS, CHECKs, FKs, triggers, RPC/queries | `supabase/migrations/` |

---

## 3. Data flow — one representative read

Reading the discovery list (`SearchPage` → `searchApi.profiles`):

1. `frontend/src/api/search.api.ts:75-89` calls RPC `search_profiles` with the
   filter object.
2. `callRpc` (`frontend/src/lib/supabase.ts:144-147`) issues a PostgREST POST to
   `/rest/v1/rpc/search_profiles` with the caller's JWT (the client owns the
   session; `frontend/src/lib/supabase.ts:32-39`).
3. `search_profiles` is **`security invoker`** (`20260927000007_rpc.sql:353-388`),
   so it runs as `authenticated`. Its `where` clause never mentions RLS; RLS on
   `public.profiles` filters the rows instead (`20260927000004_rls_policies.sql:120-132`,
   redefined for the discoverable predicate at
   `20260927000011_pending_account_gating.sql:172-180`).
4. The window count `count(*) over ()` gives `total_count` in the same round trip
   (`20260927000007_rpc.sql:395`), which `search.api.ts:91-100` turns into the
   `Pagination` object.
5. The rows are mapped snake_case → camelCase in
   `frontend/src/lib/mappers.ts:361-380`.

Because the function is invoker, a bug in it cannot return a row the caller could
not have read with a plain `select`.

---

## 4. Data flow — one representative write

Posting a comment (`CommentThread` → `commentsApi.create`):

1. `frontend/src/api/comments.api.ts:34-43` inserts into `public.comments` via the
   Supabase client. `author_profile_id` comes from `requireUserId()`
   (`frontend/src/lib/supabase.ts:50-61`), never from a client-supplied id.
2. PostgREST applies the `comments_insert` policy
   (`20260927000004_rls_policies.sql:304-310`): the caller must be the author, must
   be an active member, and must be able to view the target profile.
3. The CHECK constraint on `comments.body` enforces 1..1000 characters at the database
   (`20260927000010_spec_parity_constraints.sql:206-207`).
4. The `comments_notify` trigger (`20260927000002_activity.sql:307-309`) fans out a
   `comment` notification using a `security definer` function, because the client
   has no write policy on `notifications`
   (`20260927000004_rls_policies.sql:332-348`).
5. `notifications` is a Realtime publication member
   (`20260927000006_realtime.sql:27-33`), so the recipient's client may receive an
   INSERT event over Realtime (delivery itself is NOT VERIFIED here; see
   `REALTIME.md`).

Every write follows the same pattern: the client sends the row, RLS/constraints
decide whether the database accepts it, and anything the client may not author is
produced by a definer trigger or function.

---

## 5. Why there is no first-party server

- Identity, sessions, token refresh and email verification are provided by Supabase
  Auth, so the previous bespoke `users` / `otp_verifications` / `sessions` tables are
  gone (`20260927000001_foundation.sql:6-9`).
- REST and GraphQL are derived from the schema (PostgREST and `pg_graphql`), so
  there is no controller layer to maintain or duplicate
  (`20260927000014_graphql.sql:4-14`).
- The rules that a server would enforce are instead migration constraints, triggers
  and RLS: "Anything that matters is enforced in the database by CHECK constraints,
  foreign keys, triggers and row level security" (`README.md:126-130`).
- The five Edge Functions exist only for operations that genuinely cannot be done
  from a client: LLM keys (`_shared/llm.ts:1-15`), deleting an `auth.users` row
  (`account-delete/index.ts:1-16`), reading `auth.sessions` (excluded from
  PostgREST) (`sessions/index.ts:8-13`), and admin report datasets
  (`reports/index.ts:1-25`).

---

## 6. `security definer` vs `security invoker`

The rule is written at the top of the RPC migration
(`20260927000007_rpc.sql:4-11`):

- **`security invoker` (the default)** is used for anything that **returns user
  rows**, so RLS remains the single boundary. In this repository that is
  `search_profiles` (`:386`) and `recommendations` (`:454`).
- **`security definer`** is used for anything that returns only an aggregate/count,
  or that must write a table which has no client write policy. Definer functions
  return scalars or counts, never private rows, and re-check the caller themselves.
  Examples: `username_available` (`:52-68`), `compute_compatibility` (`:152`),
  `compatibility_for` (`:274`), `rating_summary` (`:488`),
  `interaction_summary` (`:516`), and the six `report_*` functions.

The definer transitions were kept safe by two extra measures:

- Every definer function is executable by `PUBLIC` by default, so `0004` revokes
  `execute` from `public` and grants it back only to the intended entry points
  (`20260927000004_rls_policies.sql:435-446`,
  `20260927000007_rpc.sql:645-672`).
- Identity helpers (`is_admin`, `is_active_member`, `can_view_profile`,
  `can_view_photos`) are themselves `security definer` and return scalars only, so
  they can be called from policy expressions without re-entering RLS on `profiles`
  and cannot act as a data-exfiltration oracle
  (`20260927000004_rls_policies.sql:17-108`).

`account_state`, `is_active_profile` and `has_verified_contact` follow the same
pattern (`20260927000011_pending_account_gating.sql:33-122`).

---

## 7. The two-store rule

Bytes and metadata live in different stores:

- **Bytes** live in Supabase Storage, in two **private** buckets:
  `profile-photos` (5 MiB; `image/jpeg`, `image/png`, `image/webp`) and
  `profile-documents` (10 MiB; `application/pdf`, `image/jpeg`, `image/png`)
  (`20260927000005_storage.sql:23-32`). Every read goes through a signed URL;
  nothing is world-readable (`:4-11`).
- **Metadata** lives in `public.media`, one row per object, holding
  `storage_path`, `kind`, `mime`, `bytes` and `is_primary`
  (`20260927000002_activity.sql:9-25`).

The two stores are tied together by an ownership rule expressed on both sides: the
object path must begin with the owner's user id
(`storage.foldername(name))[1] = auth.uid()::text`,
`20260927000005_storage.sql:60-66`), and the metadata row carries the identical
rule as a CHECK constraint
(`storage_path like profile_id::text || '/%'`,
`20260927000002_activity.sql:24`). A forged path therefore fails at both layers.

Ownership of the bytes is validated further by client code before upload
(`frontend/src/api/media.api.ts:33-38`, `:121-129`).

---

## 8. Client transport surface

| Transport | Used for | Source |
| --- | --- | --- |
| `supabase.from(...)` | PostgREST reads/writes on user tables | `frontend/src/api/*.ts` |
| `supabase.rpc(...)` | Postgres RPCs | `frontend/src/lib/supabase.ts:144-147` |
| `fetch(.../functions/v1/...)` (GET) | `reports`, `sessions` list | `frontend/src/lib/supabase.ts:158-190` |
| `supabase.functions.invoke` (POST) | `ai-chat`, `ai-explanation`, `account-delete`, `sessions` revoke | `frontend/src/lib/supabase.ts:192-198` |
| `fetch(.../graphql/v1)` | `pg_graphql` reference-data read | `frontend/src/lib/graphql.ts:30-87` |
| Realtime channel | live notifications/likes/comments/ratings | `frontend/src/lib/realtime.ts` |

---

## 9. Status

| Layer | Status | Basis |
| --- | --- | --- |
| Schema, constraints, RLS, scoring, reports (on a real PostgreSQL) | VERIFIED | recorded in `docs/SUPABASE_MIGRATION_FINAL_REPORT.md:52-72`; not re-run for this document |
| Client data layer (compile/lint/build/tests) | VERIFIED | recorded in `docs/SUPABASE_MIGRATION_FINAL_REPORT.md:74-84` |
| Auth services (signup, confirmation, refresh) | NOT VERIFIED | no hosted project in this environment (`docs/SUPABASE_MIGRATION_FINAL_REPORT.md:145-159`) |
| Storage upload / signed URL | NOT VERIFIED | same |
| Realtime delivery | NOT VERIFIED | same |
| Edge Function execution | NOT VERIFIED | never executed |
| `pg_graphql` live endpoint | NOT VERIFIED | extension is a Supabase built-in, absent from local PostgreSQL |
| Repository's own gates | NOT APPLICABLE to this document | this is documentation only; no gate was run |

---

## 10. Related documents

- `docs/DATABASE.md` — tables, constraints, functions, policies
- `docs/API.md` — REST / GraphQL / RPC / Edge Function contracts
- `docs/AUTHENTICATION.md` — identity and the pending-account gate
- `docs/AI_MATCHMAKING.md` — deterministic engine, on-device MLP, LLM seam
- `docs/REALTIME.md` — Realtime publication and client adapter
- `docs/DEPLOYMENT.md` — setup, containers, Android

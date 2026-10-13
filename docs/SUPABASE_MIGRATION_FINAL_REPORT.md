# Supabase Migration — Final Report

**Date:** 2026-09-27
**Scope:** the destructive migration of JibonJori from `Node.js + Express + Prisma +
Socket.IO` to a pure **Supabase BaaS** deployment.
**Rule followed:** the archived implementation is the *source specification*; the
runtime target is Supabase. Nothing in this report is a claim about work that was
not executed.

---

## 1. What changed

| Old | New |
| --- | --- |
| Express REST API at `/api/*` | PostgREST, derived from the schema |
| GraphQL at `/api/graphql` | `pg_graphql` at `/graphql/v1` (migration 0014) |
| Prisma + local PostgreSQL | 14 SQL migrations in `supabase/migrations` |
| `users`, `otp_verifications`, `sessions` tables | Supabase Auth owns identity; `profiles.id = auth.users.id` |
| JWT + opaque refresh tokens, bespoke token store | Supabase Auth sessions (`@supabase/supabase-js`) |
| Socket.IO + rooms | Supabase Realtime (`postgres_changes`) on 5 tables |
| Firebase Storage | Supabase Storage (`profile-photos`, `profile-documents`) |
| Zod validation in the service layer | CHECK constraints, triggers and RLS — the database is the boundary |
| Express service layer | `security definer` SQL functions + Edge Functions |
| Backend `docker-compose` + Render | Single client build talking to a hosted Supabase project |

The old `backend/` (197 files) and `render.yaml` were deleted. A verified archive
exists outside the working tree at
`D:\Zeem\app\jibon_jori_migration_evidence\jibonjori_pre_supabase_backup.zip`
(460 entries, sha256 `EDE09842…06912`); the ledger records it (Entry 1).

---

## 2. Architecture

- **Client** (`frontend/`): React 18 + TypeScript, Vite, Tailwind + Sass, GSAP,
  `@supabase/supabase-js`, Capacitor. It talks only to
  `https://<project>.supabase.co`.
- **Database**: PostgreSQL with row level security as the *single* authorization
  boundary. The client holds only the public anon key.
- **Server-side logic**: 5 Edge Functions (`ai-chat`, `ai-explanation`,
  `account-delete`, `sessions`, `reports`) for the operations that must not run in
  the client (LLM keys, auth-user deletion, session enumeration, admin report
  datasets).
- **No PC dependency**: there is no LAN backend, no local database at runtime, and
  no first-party HTTP origin.

---

## 3. Gates executed, with measured results

### 3.1 Database — real PostgreSQL 18.6

The Docker daemon could not be used (see §5), so the migrations were applied to a
real PostgreSQL 18.6 server inside the machine's Ubuntu WSL distribution — which is
the same engine line Supabase runs, with genuine RLS, `auth.uid()`, CHECK
constraints and PL/pgSQL. A Docker-free runner was added for this:
`supabase/tests/run-rls-tests.sh` (the Docker runner `run-rls-tests.mjs` is kept).

| Gate | Result |
| --- | --- |
| 14 / 14 migrations apply with `ON_ERROR_STOP` | **pass** |
| RLS + constraints + scoring + reports assertions | **124 / 124 claims hold** |

The suite is adversarial: it `SET ROLE`s to `anon`/`authenticated` and asserts what a
caller *cannot* read or write. It is mutation-tested (three deliberate policy defects
were injected and all three were detected), so a green run is meaningful.

Coverage grew from 74 to 124 claims. New assertions include: reserved usernames
(case- and separator-insensitive), the pending-account gate in both directions, the
field/cardinality/lifestyle/preference-shape constraints, the full deterministic
scoring contract, and all six report shapes with their admin gate.

### 3.2 Frontend

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Unit + integration | `npm test` | **142 passed** (18 files) |
| Deployment config | `npm run test:deploy` | 16 / 16 |

The full stack was run twice from a clean state with identical results.

### 3.3 Security sweep (read-only, against the verified test database)

| Check | Result |
| --- | --- |
| Public tables with `relrowsecurity = true` | **17 / 17** |
| `audit_logs` client write policies | **none** — select-admin only, so the table is append-only despite its grant |
| Ambiguous function overloads in `public` | **none** — every `rpc()` name resolves uniquely |
| `anon` table privileges | `SELECT` on the 4 reference tables only |
| `anon` function privileges | `EXECUTE` on `username_available` only |
| Credential literals (JWT / OpenAI / Google / private key) in 304 files | **none** |
| Tracked `.env` files | **none** (`.env.phone.local` is ignored by `.gitignore:6`) |

### 3.4 ML pipeline

| Gate | Result |
| --- | --- |
| Training determinism | two runs produced a byte-identical artifact (sha256 `C49B8A69…6075`) |
| Shape | 8×16:relu → 16×8:relu → 8×1:linear |
| Holdout accuracy | max |error| 0.007528 (gate 0.02); R² 0.9999794 |
| Publisher | `ml/publish.mjs` refuses to run without service-role credentials |

---

## 4. Correctness work done during the migration

These were not cosmetic; each was found by comparing the new code against the
archived implementation and then verified.

1. **Scoring contract** — the first SQL port used the wrong weights
   (0.25/0.25/0.20/0.15/0.15, no lifestyle) and substituted a neutral 50 for missing
   factors. Corrected to interests .25, educationProfession .20, location .15,
   lifestyle .15, partnerPreference .25, with unavailable factors contributing
   **zero**, tier proximity `max(0, 100 − 20·gap)`, and location as the maximum of
   city 100 / district 70 / `max(0, 100 − round(haversineKm))`. Two pairs are pinned
   by value in the suite.
2. **Reports** — only 4 of the 6 documented kinds existed, and two were the wrong
   shape. All six now exist with the documented columns; `matchmaking` and `ratings`
   are the requesting admin's own rows.
3. **Pending-account gating** — `is_active_member()` now also requires a verified
   email or phone, and a new `is_active_profile()` gates the candidate side, so an
   unverified account can neither act nor be discovered.
4. **Reserved usernames** — the archived normalisation (lower-case, strip non
   `[a-z0-9]`) and the full 74-handle list are enforced by a CHECK, and signup fails
   loudly rather than silently renaming.
5. **Field, cardinality and shape constraints** — adult-only, lat/lng pairing, field
   lengths, interest/education/profession/gender caps, and the strict `lifestyle`
   and preference-rule shapes.
6. **`rating_summary`** — average rounded to one decimal and `null` (not 0) when
   empty, plus a visibility gate.
7. **Harness bug** — the `auth.users` stand-in lacked `phone_confirmed_at`, which the
   pending gate reads; corrected to mirror Supabase.
8. **`account-delete` was a hard delete** — it removed the auth user and leaned on the
   profile cascade. The archived implementation (spec B-72) closes the account instead,
   because the row is referenced by other members' interactions, ratings and comments,
   and the new schema is already built for that state (`profiles.deleted_at`,
   `account_state() = 'deleted'`). The hard delete made the designed `'deleted'` state
   unreachable and would have destroyed other members' data. Now soft-closes:
   `{ closed: true }`, `deleted_at` stamped, sessions revoked, in one transaction and
   idempotently.
9. **`sessions` could log the caller out** — the JWT payload was decoded with `atob` on
   unpadded base64url, which throws; the `catch` returned `null`, and with `null` the
   "keep the current session" guard was dropped, so `revokeOthers` revoked the caller's
   own session. Padding is restored and the endpoint now refuses (409) rather than
   guessing.
10. **Email confirmation was disabled** — `supabase/config.toml` committed
    `enable_confirmations = false`, quietly removing the first of the two pending-account
    gates. Set to `true`.

Full reasoning is in `docs/SUPABASE_MIGRATION_LEDGER.md` (Entries 8–11).

---

## 5. What is blocked, and exactly why

### 5.1 Docker (Phase 0) — BLOCKED

Docker Desktop's data disk is on `C:`, which filled to 0 bytes, so the containerd
store became read-only and the daemon hung (`docker info`/`version`/`run` all time
out). Authorised regenerable cleanup freed ~3.98 GB, but the relocation itself needs
the Docker Desktop UI (no settings/disk-move subcommand exists, and the daemon is
unresponsive). This blocks `supabase start` / `supabase db reset` and therefore the
`Docker` image build gate.

**Mitigation:** the entire SQL/RLS layer is verified on a real PostgreSQL without
Docker (§3.1), so the blocker now covers only the local Supabase stack and the image
build.

### 5.2 No Supabase project credentials — BLOCKED

No project URL, anon key or service-role key were available. Everything that needs
the hosted services is therefore **not verified**:

- Auth (signup, email confirmation, session refresh) — **NOT VERIFIED**
- Storage upload/signed-URL — **NOT VERIFIED**
- Realtime delivery — **NOT VERIFIED**
- Edge Function execution (`ai-chat`, `ai-explanation`, `account-delete`, `sessions`,
  `reports`) — **NOT VERIFIED**
- `pg_graphql` live endpoint — **NOT VERIFIED** (the extension is a Supabase built-in
  and is absent from local PostgreSQL; the transport is unit-tested and has a
  PostgREST fallback)
- Android APK + the "PC off" acceptance test — **BLOCKED** (needs a project, a release
  keystore, and LLM/Maps keys)

### 5.3 Missing external keys — ENVIRONMENT-GATED

`LLM_API_KEY` (live AI), a Google Maps browser key, and an Android release keystore.
Without them the app degrades to explicit, named states rather than fake output.

---

## 6. Status summary

| Area | Status |
| --- | --- |
| Schema, constraints, RLS, scoring, reports (real PostgreSQL 18.6) | **VERIFIED** (124/124) |
| Frontend data layer on Supabase | **VERIFIED** for compile/lint/build/tests (142) |
| ML artifact + on-device inference | **VERIFIED** |
| Deployment config assertions | **VERIFIED** (16/16) |
| Auth, Storage, Realtime, Edge Functions, `pg_graphql`, APK | **NOT VERIFIED / BLOCKED** (no project, no Docker) |
| Course requirements | see `docs/COURSE_REQUIREMENT_MAPPING.md` |

---

## 7. To finish on a real project

1. Create the Supabase project; `supabase link` and `supabase db push`.
2. Set the Edge Function secrets (`LLM_API_KEY`, `CORS_ALLOWED_ORIGINS`,
   `SUPABASE_SERVICE_ROLE_KEY`) and deploy `supabase/functions`.
3. Put `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `frontend/.env.local` and
   run `npm run verify`.
4. Enable email confirmation in Auth; verify the pending gate end to end.
5. Run the realtime, storage and Edge Function checks that §5.2 lists as unverified.
6. Build the release APK with `npm run build:android:release` and run the "PC off"
   acceptance test on a phone over mobile data.

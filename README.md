# JibonJori

An AI-assisted matrimony platform: members create a matrimonial profile, discover
compatible partners, communicate, and receive matchmaking recommendations with an
explanation of the score.

The application is a **pure Supabase BaaS deployment**. The React client (web and
Android) talks directly to a Supabase project — Supabase Auth for identity,
PostgreSQL with row level security as the single authorization boundary, Storage for
files, Realtime for live updates, and Edge Functions for the few operations that
must not run in the client. There is no first-party server to deploy.

## Architecture

| Layer | Technology |
| --- | --- |
| Client | React 18 + TypeScript 5 + Vite 5, Tailwind CSS **and** Sass, GSAP, `@supabase/supabase-js`, react-router-dom, Capacitor (Android) |
| Identity | Supabase Auth: email + password, email confirmation (OTP), JWT sessions with automatic refresh, sign-out |
| Database | PostgreSQL (Supabase) — **14 committed migrations** in `supabase/migrations`, extensions `citext`, `pg_trgm`, `pg_graphql` |
| Authorization | Row level security policies + `security definer` helpers; the client holds only the public anon key |
| REST API | PostgREST, derived from the schema |
| GraphQL API | `pg_graphql` at `/graphql/v1`; enforces the same RLS policies |
| Realtime | Supabase Realtime (`postgres_changes`) on `comments`, `interactions`, `ratings`, `notifications`, `chat_messages` |
| Files | Supabase Storage buckets `profile-photos`, `profile-documents`, with per-owner folder policies |
| Server-side logic | Edge Functions (Deno): `ai-chat`, `ai-explanation`, `account-delete`, `sessions`, `reports` |
| AI | A deterministic 7-factor compatibility engine **in SQL** (real profile data, hashed inputs, cached per pair), a trained TensorFlow.js MLP that runs **on the device**, and an LLM explanation/chat seam that fails closed to a named fallback |

There is no Node/Express server, no Prisma, no Socket.IO, no local PostgreSQL
dependency, and no PC on the network. The client reaches only `https://<project>.supabase.co`.

## Repository layout

```
supabase/    migrations/, RLS test harness, Edge Functions, config
frontend/    React SPA, its tests, nginx config and Dockerfile, Android build
ml/          Offline TensorFlow.js training toolchain + the published artifact
docs/        Migration inventory, ledger, and the final migration report
AGENTS.md    Engineering rules for this repository
JibonJori_OpenCode_Spec.md   The course specification this project satisfies
```

## Running it

### Database (Supabase)

Apply the migrations and seed with the Supabase CLI against your project:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

The migrations create the schema, policies, functions, storage buckets,
realtime publication and reference data. Reference data lives in
`20260927000008_seed_reference_data.sql`, so no separate seed step is needed.

### Client

```bash
cd frontend
npm install
cp .env.example .env.local     # then set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Only `VITE_`-prefixed variables reach the browser bundle, and they are public by
design: the anon key is designed to ship in a client and is constrained by row
level security. **The `service_role` key is never used in the client and never
placed in any `VITE_` variable.** With no Maps key the map components render an
explicit "not configured" state rather than a broken or fake map.

### Android

```bash
cd frontend
npm run build:android -- --supabase-url https://<project-ref>.supabase.co --anon-key <anon-key>
```

The build refuses to produce a release APK unless the Supabase URL is `https://`.

## Verifying it

Every gate below has been executed and the numbers are the measured results; the
database gates were run on a real PostgreSQL 18.6 server, because Supabase is
PostgreSQL.

| What | Command | Result |
| --- | --- | --- |
| Migrations apply cleanly to real PostgreSQL | `supabase/tests/run-rls-tests.sh` | 14 / 14 applied, `ON_ERROR_STOP` |
| RLS + constraints + scoring + reports assertions | same command | **124 / 124** claims hold |
| Frontend typecheck | `npm run typecheck` (in `frontend/`) | exit 0 |
| Frontend lint | `npm run lint` | exit 0 |
| Frontend build | `npm run build` | exit 0 |
| Frontend unit/integration tests | `npm test` | **142 passed** (18 files) |
| Deployment-config gate | `npm run test:deploy` | 16 / 16 |
| Android release-origin gate | `npm run test:release-gate` | **21 / 21** |
| Built-APK contents scan | `npm run test:apk` | CLEAN (or SKIP when no APK exists) |
| Course requirement matrix | `node scripts/check-course-matrix.mjs --self-test` | TOTAL=45, PROBLEMS=0 |
| Security sweep (classified) | `node scripts/security-sweep.mjs --self-test` | 0 blocking, 4 / 4 self-tests |
| Auth email template / OTP chain | `node scripts/check-auth-config.mjs --self-test` | PROBLEMS=0, 8 / 8 self-tests |
| Edge Function typecheck, lint, tests | `node scripts/check-edge-functions.mjs --mutation` | check + lint PASS, **19 / 19**, mutation detected |

The RLS suite is adversarial: it switches to the `anon`/`authenticated` roles and
asserts that a caller cannot read or write what they must not. It is
mutation-tested (deliberate policy defects are detected), so a green run means
something.

The Edge Function gate runs **Deno** — the runtime those functions actually deploy
to — over the five functions and their shared modules: `deno check`, `deno lint`,
and 19 behavioural tests of the shared HTTP and token-decoding layers. It is
mutation-tested too: with `--mutation` it reintroduces the base64url defect that
once signed members out and requires the suite to fail. If Deno cannot be resolved
the gate reports SKIP rather than a pass it did not earn.

**What is not verified here:** anything requiring the hosted Supabase services —
Auth, Storage, Realtime delivery, Edge Function execution, `pg_graphql`, and the
on-device APK talking to a real project — because no Supabase project credentials are
available in this environment.

The Android *toolchain* is verified: `npm run build:android` produces a real APK. The
release-origin gate is verified across 21 cases. The local Supabase stack via Docker is
not available (the Docker daemon is not running and its data disk is still on `C:`), but
that only affects local convenience — the SQL/RLS layer is verified on host PostgreSQL.

To activate the cloud side, follow [`docs/SUPABASE_CLOUD_SETUP.md`](docs/SUPABASE_CLOUD_SETUP.md),
then use the guarded wrapper:

```
node supabase/scripts/cloud.mjs doctor
node supabase/scripts/cloud.mjs link     --project-ref <ref>
node supabase/scripts/cloud.mjs push     --project-ref <ref> --confirm
node supabase/scripts/cloud.mjs functions --project-ref <ref> --confirm
node supabase/scripts/cloud.mjs verify
```

See `docs/FINAL_PHONE_READINESS_REPORT.md` for the exact status of every area.

### Re-check (2026-09-27)

The activation boundary was re-checked. It has not moved: no Supabase project credential exists
in this environment (all six orchestration environment variables unset, no `.env` anywhere,
`supabase/.temp/project-ref` absent, `cloud.mjs doctor` reports `login : NOT LOGGED IN`). The CLI
itself is reachable at `2.118.0`, so the only missing input is the project.

All local gates above were re-run and are unchanged (typecheck 0, lint 0, build 0, 142/142,
16/16, 21/21, RLS 124/124, APK scan SKIP with no APK). The frozen state was swept clean: no
legacy port listening, no `node`/`postgres`/Docker process, no reintroduced backend tree, the
evidence archive byte-identical, no secret file tracked, HEAD still `7bffe33`. Cloud Database,
Auth, RLS-through-the-API, Storage, Realtime, Edge Functions and `pg_graphql` therefore remain
`NOT VERIFIED`, and `PHONE-INDEPENDENT BACKEND` remains **NOT VERIFIED** — the decisive physical
PC-off phone test has not been performed, because there is nothing yet for the phone to reach.

## Documentation map

| Document | Contents |
| --- | --- |
| [`docs/SUPABASE_MIGRATION_FINAL_REPORT.md`](docs/SUPABASE_MIGRATION_FINAL_REPORT.md) | The migration: what changed, every gate with its measured result, and what remains blocked |
| [`docs/SUPABASE_MIGRATION_INVENTORY.md`](docs/SUPABASE_MIGRATION_INVENTORY.md) | The old→new mapping and the gap-closure table |
| [`docs/SUPABASE_MIGRATION_LEDGER.md`](docs/SUPABASE_MIGRATION_LEDGER.md) | Append-only audit trail of the destructive migration |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering, data flow, and where each responsibility lives |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Tables, enums, constraints, indexes, functions, policies |
| [`docs/API.md`](docs/API.md) | REST (PostgREST), GraphQL, RPCs and Edge Function contracts |
| [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md) | Signup, verification, sessions, sign-out, pending-account gating |
| [`docs/AI_MATCHMAKING.md`](docs/AI_MATCHMAKING.md) | The deterministic engine, the on-device MLP, and the LLM seam |
| [`docs/REALTIME.md`](docs/REALTIME.md) | Which tables broadcast, what the client subscribes to |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Supabase setup, client build, containers, Android |
| [`docs/SUPABASE_CLOUD_SETUP.md`](docs/SUPABASE_CLOUD_SETUP.md) | Exact values to copy from the Supabase Dashboard, what to configure, what must never enter the APK |
| [`docs/FINAL_PHONE_READINESS_REPORT.md`](docs/FINAL_PHONE_READINESS_REPORT.md) | Public-phone readiness: every area classified, the exact blockers, and the remaining activation steps |
| [`docs/FINAL_SUPABASE_PHONE_VERIFICATION_REPORT.md`](docs/FINAL_SUPABASE_PHONE_VERIFICATION_REPORT.md) | Cloud activation attempt: what was verified, what is blocked, and the shortest path to the acceptance criterion |
| [`frontend/PHONE_TESTING.md`](frontend/PHONE_TESTING.md) | Building, installing and acceptance-testing the APK on a physical phone |
| [`frontend/ANDROID_BUILD_REPORT.md`](frontend/ANDROID_BUILD_REPORT.md) | The Android build pipeline, the release gate, and signing status |
| [`docs/COURSE_REQUIREMENT_MAPPING.md`](docs/COURSE_REQUIREMENT_MAPPING.md) | Requirement-by-requirement mapping with evidence and status |
| [`docs/FINAL_SUPABASE_MIGRATION_COMPLETION_REPORT.md`](docs/FINAL_SUPABASE_MIGRATION_COMPLETION_REPORT.md) | The completion report: final architecture, every executed result with its number, and the exact remaining boundary |
| [`JibonJori_OpenCode_Spec.md`](JibonJori_OpenCode_Spec.md) | The course specification |

## Conventions

- **Never trust client input.** The client holds no privileged key, and every rule
  that matters is enforced in the database by CHECK constraints, foreign keys,
  triggers and row level security, so a forged PostgREST request fails the same way
  a forged UI request does.
- **One authorization boundary.** Privileged tables (`notifications`,
  `compatibility_scores`, `ml_artifacts`) have no client write policy; rows are
  written only by `security definer` functions or triggers.
- **No fabricated AI output.** The compatibility score comes from real profile
  data; the ML score comes from a trained artifact whose provenance is recorded in
  the artifact itself (distilled from the platform's own scorer, never from
  behavioural outcome data); the LLM seam returns an explicit, named fallback when
  absent.
- **Secrets live in the environment.** `.env` is never committed. Only the public
  anon key and project URL appear in the client.

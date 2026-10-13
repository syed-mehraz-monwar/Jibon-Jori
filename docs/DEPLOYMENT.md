# Deployment

JibonJori deploys as a static React client talking directly to a hosted Supabase
project. There is no first-party server container and no API upstream. This document
collects the setup and build steps that are recorded in the repository.

Status vocabulary: VERIFIED, PARTIAL, ENVIRONMENT-GATED, BLOCKED, NOT VERIFIED,
NOT APPLICABLE.

> **Honesty note.** No hosted Supabase project and no service-role credentials were
> available in the environment where this document was written, so every step that
> touches a live Supabase project is **NOT VERIFIED**. The container image build is
> **BLOCKED** by the local Docker daemon (its data disk filled and the daemon hung),
> as recorded in `docs/SUPABASE_MIGRATION_FINAL_REPORT.md:130-143`. This document
> ran no deploy step.

---

## 1. Supabase project setup

### 1.1 Apply the migrations

The migrations create the schema, policies, functions, Storage buckets, Realtime
publication and reference data. Reference data is applied by migration
`20260927000008_seed_reference_data.sql`, so there is no separate seed step
(`supabase/config.toml:65-72`, `README.md:44-55`).

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Source: `README.md:48-51`. Status: **NOT VERIFIED** (no project).

### 1.2 Storage buckets

Migration 0005 creates `profile-photos` (5 MiB; `image/jpeg`, `image/png`,
`image/webp`) and `profile-documents` (10 MiB; `application/pdf`, `image/jpeg`,
`image/png`) as **private** buckets. If the migration role lacks privilege on
`storage.buckets`, the migration downgrades to a notice and the buckets must be
created manually in the dashboard with the sizes and MIME lists above
(`supabase/migrations/20260927000005_storage.sql:21-39`).

### 1.3 Edge Function secrets and deploy

The template is `supabase/functions/.env.example`. Set the secrets for the project:

```bash
npx supabase secrets set --env-file supabase/.env
```

Source: `supabase/functions/.env.example:3-9`.

| Secret | Used by | Notes |
| --- | --- | --- |
| `LLM_API_KEY` | `ai-chat`, `ai-explanation` | leave unset to degrade to the deterministic fallback |
| `LLM_BASE_URL` | same | default `https://api.openai.com/v1` |
| `LLM_MODEL` | same | default `gpt-4o-mini` |
| `LLM_TIMEOUT_MS` | same | default `20000` |
| `CORS_ALLOWED_ORIGINS` | all functions | comma-separated exact origins; Capacitor origins are always allowed |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_DB_URL` are injected by the platform and are not set by hand for a
deployed project (`.env.example:12-16`). `SUPABASE_DB_URL` is required by the
`sessions` function (`supabase/functions/sessions/index.ts:53-57`). Never commit the
filled-in `.env` (`.env.example:1-10`).

The repository's recorded deployment steps say to set these secrets and "deploy
`supabase/functions`" (`docs/SUPABASE_MIGRATION_FINAL_REPORT.md:183-185`); the exact
`supabase functions deploy` invocation is not recorded in the repository. Status:
**NOT VERIFIED**.

### 1.4 Enable email confirmation and ship the OTP template

The pending-account gate is two layers (`docs/AUTHENTICATION.md`). The Auth config
layer is the Supabase Auth `enable_confirmations` setting (`0011:11-16`); the committed
config declares it **enabled** (`supabase/config.toml:233`, in `[auth.email]`). Because
the app confirms signup by a **typed 6-digit code**, the confirmation template must also
carry `{{ .Token }}`; the repository ships one at `supabase/templates/confirmation.html`
and wires it through `[auth.email.template.confirmation]`. Both are applied to the hosted
project with `supabase config push` (or by hand in the dashboard). Until then only the
database gate (migration 0011) is in force and the default email carries no code.
Status: **ENVIRONMENT-GATED**.

---

## 2. Client build

### 2.1 Environment variables

Only `VITE_`-prefixed variables reach the bundle, and they are public by design
(`frontend/src/lib/env.ts:1-8`). Copy and fill the template:

```bash
cd frontend
npm install
cp .env.example .env.local
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | project URL; client appends REST paths itself |
| `VITE_SUPABASE_ANON_KEY` | yes | public anon key, constrained by RLS |
| `VITE_GOOGLE_MAPS_API_KEY` | no | maps components render a "not configured" state without it |
| `VITE_YOUTUBE_VIDEO_IDS` | no | comma-separated ids for the learn/watch page |

Source: `frontend/.env.example:11-27`. **The `service_role` key must never be placed
in any `VITE_` variable** (`.env.example:15-18`). With no Supabase values,
`getSupabase()` throws an explicit `503 SUPABASE_NOT_CONFIGURED` rather than a stack
trace (`frontend/src/lib/supabase.ts:23-30`).

### 2.2 Commands

| Command | What it does | Source |
| --- | --- | --- |
| `npm run dev` | Vite dev server on port 5173 | `frontend/package.json:7`, `vite.config.ts:19-21` |
| `npm run build` | `npm run typecheck && vite build` (a type error fails the build) | `package.json:8` |
| `npm run verify` | `typecheck && lint && build && test && test:deploy` | `package.json:16` |

`vite.config.ts` defines no proxy because there is no first-party origin to proxy
(`vite.config.ts:4-9`).

### 2.3 CI

`.github/workflows/ci.yml` wires the same frontend commands plus a database job that
starts the official local stack. The file states plainly that it has **never been
executed by GitHub Actions** in this environment (`ci.yml:1-7`). Status: PARTIAL —
authored, unexecuted.

---

## 3. Containers

### 3.1 `frontend/Dockerfile`

Multi-stage build: `node:22-bookworm-slim` builds the SPA, `nginx:1.27-alpine`
serves the static output (`Dockerfile:21`, `:50`).

The two Supabase values are passed as **build args**, because Vite inlines `VITE_*`
values at build time and they cannot be injected at container start
(`Dockerfile:6-19`):

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://<ref>.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=<anon-key> \
  -t jibonjori-web .
```

Build args accepted: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_GOOGLE_MAPS_API_KEY`, `VITE_YOUTUBE_VIDEO_IDS` (`Dockerfile:25-28`).

**Fails closed:** after the build, the Dockerfile checks that the built bundle
actually contains `VITE_SUPABASE_URL` and exits non-zero otherwise, so it will not
ship a bundle that cannot reach any backend (`Dockerfile:46-48`). The image has a
healthcheck that fetches `/` (`Dockerfile:59-60`).

**The `service_role` key must never be passed here** (`Dockerfile:18-19`).

### 3.2 `frontend/nginx.conf`

A pure static SPA host:

- No `/api/` or `/socket.io/` upstream; it serves the built SPA and nothing else
  (`nginx.conf:1-13`).
- Security headers are repeated verbatim in every location that adds one, because
  nginx `add_header` is not inherited once a location declares its own; the
  deployment-config test enforces that rule (`nginx.conf:9-13`).
- CSP `connect-src` allows `https://*.supabase.co` and `wss://*.supabase.co` (plus
  `*.supabase.in`), and `img-src` allows the same hosts because profile photos are
  Storage signed URLs (`nginx.conf:30-44`).
- `/assets/` is immutable with content-hashed filenames; `/index.html` is
  `no-cache`; everything else falls back to the shell for client-side routes
  (`nginx.conf:61-89`).

### 3.3 Status

| Gate | Status |
| --- | --- |
| Deployment-config assertions (`npm run test:deploy`) | 16/16 recorded in `docs/SUPABASE_MIGRATION_FINAL_REPORT.md:82` |
| Docker image build | **BLOCKED** — local Docker daemon unusable; recorded in `docs/SUPABASE_MIGRATION_FINAL_REPORT.md:130-143` |

---

## 4. Android

### 4.1 Build

```bash
cd frontend
npm run build:android            # debug APK
npm run build:android:release    # release APK (gated)
```

Flags (`frontend/scripts/build-android.mjs:171-185`):
`--supabase-url <url>`, `--anon-key <key>`, `--print-config`, `--release`.

The URL and key are resolved from CLI flags, then environment, then
`.env.phone` / `.env.phone.local` / `.env` (`build-android.mjs:230-256`). Both values
are public; the script rejects a `service_role` key outright for debug **and**
release builds (`build-android.mjs:286-300`).

The build runs typecheck and lint, `vite build --mode phone`, verifies the built
bundle actually contains the Supabase host and the anon key signature, runs
`cap sync android`, then assembles the APK with the Gradle wrapper
(`build-android.mjs:548-696`). It checks the Android/JDK toolchain first and fails
with the exact missing prerequisite rather than pretending an APK was produced
(`build-android.mjs:377-456`).

### 4.2 Release gate

For `--release`, `VITE_SUPABASE_URL` must be `https://` on a publicly routable host.
Cleartext, loopback (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`), the emulator alias
`10.0.2.2`, and the private ranges `10/8`, `172.16/12`, `192.168/16`, `169.254/16`
are all rejected, and the anon key must be a JWT whose `role` claim is `anon`. The
gate fails closed: with no public `https://` URL, no release APK is produced at all
(`build-android.mjs:302-374`).

### 4.3 Capacitor

`frontend/capacitor.config.ts` sets `appId: "com.jibonjori.app"`,
`appName: "JibonJori"`, `webDir: "dist"`. The bundled web app is exactly the
`vite build --mode phone` output, copied in by `cap sync android`. The app talks to
Supabase over HTTPS, so `android.allowMixedContent` is deliberately **not set** —
there is no plain-HTTP origin to relax for (`capacitor.config.ts:1-31`). The build
script verifies the synced config has the expected `appId` and that mixed content is
not enabled (`build-android.mjs:614-639`).

### 4.4 Status

| Item | Status |
| --- | --- |
| Android release APK + "PC off" acceptance test | **BLOCKED** — needs a project, a release keystore, LLM/Maps keys (`docs/SUPABASE_MIGRATION_FINAL_REPORT.md:155-159`) |

---

## 5. Environment-gated and blocked items

| Item | Status | Why |
| --- | --- | --- |
| Hosted project, Auth, Storage, Realtime, Edge Functions, `pg_graphql` | NOT VERIFIED | no project URL / anon key / service-role key in this environment (`docs/SUPABASE_MIGRATION_FINAL_REPORT.md:145-159`) |
| Docker image build | BLOCKED | Docker data disk read-only, daemon hung (`docs/SUPABASE_MIGRATION_FINAL_REPORT.md:130-143`) |
| `LLM_API_KEY` (live AI) | ENVIRONMENT-GATED | without it the functions return their named fallback |
| Google Maps browser key | ENVIRONMENT-GATED | without it the map components render a "not configured" state |
| Android release keystore | ENVIRONMENT-GATED | needed for a signed release APK |

No credential is fabricated in this document, and none is recorded in the
repository.

---

## 6. Status summary

| Area | Status |
| --- | --- |
| Migration commands, secrets template, env contract | Written and documented; live execution NOT VERIFIED |
| Client `npm run dev` / `build` / `verify` | Defined in `package.json`; recorded results are in the existing migration docs (not re-run here) |
| Container config (Dockerfile + nginx.conf) | Authored; deployment-config assertions recorded 16/16; image build BLOCKED |
| Android build script + release gate | Authored; APK BLOCKED (needs project/keystore/keys) |
| CI workflow | Authored, never executed by GitHub Actions |

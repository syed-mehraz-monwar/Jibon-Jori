# Final Phone Readiness Report

**Date:** 2026-09-27
**Scope:** the infrastructure / public-phone-deployment phase. The application-side migration
review was already complete; this phase covers the local work that removes every dependency on
the developer's PC, and the exact remainder before the app can be used from anywhere.

**Location note.** You asked for this at `backend/FINAL_PHONE_READINESS_REPORT.md`. The
`backend/` directory was deleted by the authorised destructive migration, and recreating it
would suggest the Node/Express runtime still exists. This report therefore lives in `docs/`.
No file named `backend/*` was created.

---

## 1. Current architecture

```
Android app (Capacitor WebView, React bundle)
    |  HTTPS
    v
Supabase Cloud
    +-- Auth              (email confirmation, sessions, refresh)
    +-- PostgreSQL + RLS  (17 tables, 14 migrations)  <- the only authorization boundary
    +-- Storage           (2 private buckets)
    +-- Realtime          (5 published tables)
    +-- Edge Functions    (5 functions: ai-chat, ai-explanation, account-delete, sessions, reports)
```

There is no first-party server. The client talks to PostgREST, `pg_graphql`, Auth, Storage and
Realtime directly, and to Edge Functions for the few operations that must not run in a client.
SQL functions (`security definer`) act as the trusted layer where a client cannot be trusted.

**Present in the tree:** `frontend/` (React + Capacitor Android), `supabase/` (14 migrations,
5 Edge Functions, tests, scripts), `ml/` (training + publish tooling), `docs/`.

**Absent by design:** `backend/`, `render.yaml`, Prisma, Express, Socket.IO, local PostgreSQL,
Brevo, Docker-at-runtime.

---

## 2. Target architecture

Exactly §1. The acceptance condition is that every arrow is public internet, and no arrow
touches the developer's PC, a LAN address, a local database, or a locally-running service.

Verified as *absent* from the client's shipped code and configuration:

| Eliminated | Evidence |
| --- | --- |
| Node/Express server | `backend/` deleted; no `express` reference anywhere |
| Prisma | no `PrismaClient`; the only `prisma` mentions are prose explaining its removal |
| Socket.IO | `lib/socket.ts` and `socket.io-client` removed; realtime is `postgres_changes` |
| Local PostgreSQL | the client has no Postgres URI; the client cannot hold a DB password |
| Docker at runtime | no runtime container; Docker is only for the optional *local* stack |
| LAN IP / localhost origin | no `http://192.168.*` or `http://localhost:<port>` in source; the committed debug network config holds **no** LAN address |
| Brevo | no Brevo/SMTP SDK in the client; Supabase Auth sends its own mail |
| `VITE_API_BASE_URL` / `VITE_SOCKET_URL` | removed, and the deployment gate asserts they cannot reappear |

---

## 3. Destructive migration status

Complete, and intentionally destructive. The old runtime was deleted, not preserved:

| Removed | Preserved as evidence |
| --- | --- |
| `backend/` (197 files) | `D:\Zeem\app\jibon_jori_migration_evidence\jibonjori_pre_supabase_backup.zip` (460 entries, 3,641,558 B, sha256 `EDE09842...206912`) |
| `render.yaml` | inside the same archive |
| `lib/socket.ts`, `lib/storage.ts`, `socket.io-client` | archived copies |

Status: **VERIFIED** (the deletion happened and the archive exists and is intact).

---

## 4. Local verification

Executed on this machine, in this phase.

| Gate | Command | Result | Status |
| --- | --- | --- | --- |
| Typecheck | `npm run typecheck` | exit 0 | VERIFIED |
| Lint | `npm run lint` | exit 0 | VERIFIED |
| Build | `npm run build` | exit 0, 24 chunks | VERIFIED |
| Unit + integration | `npm test` | **142 / 142** (18 files) | VERIFIED |
| Deployment config | `npm run test:deploy` | **16 / 16** | VERIFIED |
| Release gate | `npm run test:release-gate` | **21 / 21** | VERIFIED |
| RLS + constraints + scoring + reports | `supabase/tests/run-rls-tests.sh` | **124 / 124** on PostgreSQL 18.6 | VERIFIED |
| Android build pipeline | `npm run build:android` | real APK produced (see §11) | VERIFIED |

All gates were re-run after every source change in this phase.

---

## 5. Supabase verification

**NOT VERIFIED.** No hosted Supabase project exists in this environment, so nothing has been
applied, deployed or exercised against Supabase Cloud. The activation procedure is fully
prepared and scripted but unexecuted. See §14 and §15.

---

## 6. RLS verification

| Aspect | Result | Status |
| --- | --- | --- |
| Adversarial RLS suite against a real PostgreSQL 18.6 engine | 124 / 124 claims hold; `SET ROLE` to `anon`/`authenticated`; mutation-tested (3 injected defects all detected) | VERIFIED |
| All 17 public tables have `relrowsecurity = true` | measured in the live test database | VERIFIED |
| `audit_logs` has no client INSERT/UPDATE/DELETE policy | 0 write policies | VERIFIED |
| `anon` privileges | `SELECT` on exactly the 4 reference tables; `EXECUTE` on `username_available` only | VERIFIED |
| No ambiguous function overloads in `public` | none | VERIFIED |
| The same policies in the cloud | never executed there | NOT VERIFIED |

The suite is deliberately **not** runnable against a real project: `bootstrap.sql` creates a
synthetic `auth.users` stand-in and `fixtures.sql` inserts fake identities. Pointing it at cloud
would collide with the platform's own `auth` schema. Cloud adversarial testing requires a
throwaway project or a preview branch. `supabase/scripts/verify-cloud.sql` is the read-only
cloud substitute and was itself validated by running it against the local migrated database
(11 PASS, 1 honest FAIL for the absent `supabase_migrations` schema, then the deliberate
hard-fail).

---

## 7. Auth verification

**NOT VERIFIED.** Supabase Auth (signup, email confirmation, OTP, refresh, sign-out) has not
been exercised, because no project exists.

What *is* verified locally is the database half of the pending-account gate: `has_verified_contact()`,
`is_active_member()`, `is_active_profile()` and `account_state()` are covered by the RLS suite in
both directions, including a dedicated unverified identity. `supabase/config.toml` now sets
`enable_confirmations = true` so the Auth half matches.

---

## 8. Storage verification

**NOT VERIFIED** (no upload, download or signed URL has been issued).

Verified locally by SQL: both buckets (`profile-photos` 5 MiB / `profile-documents` 10 MiB) are
declared **private** with MIME allow-lists, and 8 `storage.objects` policies exist. Confirmed
again by the read-only cloud check, which asserts the buckets are present, private and limited.

---

## 9. Realtime verification

**NOT VERIFIED** (no live delivery observed).

Verified locally by SQL: the `supabase_realtime` publication exists and contains exactly
`comments`, `interactions`, `ratings`, `notifications`, `chat_messages`; `profiles` is not
published; `interactions` has `replica identity full`. The client adapter maps those table
changes back onto the original Socket.IO event surface. Known limitation, unchanged: only
INSERT is subscribed for `interactions`, so an unlike (DELETE) pushes nothing.

---

## 10. Edge Function verification

**NOT VERIFIED.** None of the five functions has ever been executed - they require a deployed
project with a real JWT. Deno is not installed locally, so they were not even type-checked in
this environment.

Three genuine defects were found by static review in this phase and fixed:

1. `account-delete` was a **hard delete** of the auth user. The archived specification (B-72)
   requires a soft *closure*, and the schema is built for it (`profiles.deleted_at`,
   `account_state() = 'deleted'`). Fixed to stamp `deleted_at` and revoke all sessions in one
   transaction, idempotently, returning `{ closed: true }`.
2. `sessions` decoded the JWT with `atob` on unpadded base64url, which throws; the `catch`
   returned `null`, which dropped the "keep the current session" guard - so `revokeOthers` would
   have signed the caller out. Padding restored; the endpoint now refuses (409) rather than
   guessing.
3. `supabase/config.toml` shipped `enable_confirmations = false`, silently removing the first of
   the two pending-account gates. Set to `true`.

---

## 11. Android verification

| Aspect | Result | Status |
| --- | --- | --- |
| Toolchain present | JDK 17 (`C:\Eclipse Adoptium\jdk-17.0.19.10-hotspot`), `ANDROID_HOME=D:\Zeem\Andrd\sdk`, Gradle wrapper 8.2.1, Capacitor 6, `adb` | VERIFIED |
| Full pipeline | `npm run build:android` completed: typecheck, lint, `vite build --mode phone`, `cap sync`, `assembleDebug` | VERIFIED |
| APK produced | `app-debug.apk`, 4,698,728 bytes (4.48 MiB), package `com.jibonjori.app`, 4 expected zip entries confirmed | VERIFIED |
| Build fails closed with no Supabase URL | exits 1 with a clear message, no APK | VERIFIED |
| Release gate rejects non-public origins | 21 / 21 cases (loopback, LAN, CGNAT, link-local, IPv6-mapped, single-label, reserved suffixes, cleartext, service/secret keys) | VERIFIED |
| Signed release APK | no keystore supplied; none fabricated | ENVIRONMENT-GATED |
| The APK talks to a real Supabase project over the internet | needs credentials | NOT VERIFIED |

The APK built above used **synthetic** placeholder values and was deleted immediately, so it can
not be mistaken for a usable artifact. What it proves is that the toolchain and the whole
packaging path work end to end; only the two public values change for a real build.

---

## 12. Security verification

Sweep over source, fresh build output, Android project, configuration, documentation and ML
artifacts (308 files):

| Check | Result |
| --- | --- |
| service-role / `service_role` | only identifiers, prose and negative assertions - no value |
| Database password / Postgres URI | none in client or config; one throwaway local-stack default in the CI file (`postgres:postgres@127.0.0.1:54322`), documented as ephemeral |
| JWT secret | none; `JWT_SECRET` appears only inside a *forbidden-pattern* assertion |
| SMTP password / Brevo | none |
| LLM key (`sk-...`) | none |
| Google Maps key (`AIza...`) | none |
| Private key material | none |
| Old LAN API URL (`http://192.168.*`) | none anywhere |
| `localhost` API origin | none in source. The only occurrence in a bundle is `gotrue-js`'s internal default (`http://localhost:9999`), which is unreachable because `getSupabase()` throws unless a URL is configured |
| Fresh bundle credential scan | 24 chunks: no key, no host baked in when unconfigured |
| Secrets/templates gitignore | `supabase/.env`, `frontend/.env.phone.local`, `keystore.properties`, `*.jks`, `*.keystore` ignored; the four `*.example` templates trackable |
| Tracked `.env` files | none |

No secret value is reproduced in this report.

**Defect fixed:** the *committed* debug `network_security_config.xml` still carried a stale LAN
address (`192.168.0.104`) from the old PC-backend setup. The generated block is now empty, so no
LAN address is stored in the repository at all.

---

## 13. External dependencies

| Dependency | Needed for | Status |
| --- | --- | --- |
| Supabase Cloud project | everything | **BLOCKED** - no project/credentials |
| Docker | only the *optional* local Supabase stack | BLOCKED - see §14.1 (not on the critical path) |
| LLM provider key | `ai-chat`, `ai-explanation` phrasing | **ENVIRONMENT-GATED** - absent → deterministic fallback, never a fabricated answer |
| Google Maps browser key | the location map/picker | **ENVIRONMENT-GATED** - absent → explicit "not configured" state, never a fake map |
| Android release keystore | a distributable signed APK | **ENVIRONMENT-GATED** - absent → unsigned release only |
| Custom SMTP sender | real email delivery | ENVIRONMENT-GATED - Supabase's default sender is rate-limited |

---

## 14. Exact blockers

### 14.1 Docker - BLOCKED (not on the critical path)

Determined this phase, once, without repeated restarts:

| Probe | Result |
| --- | --- |
| `docker context show` | `desktop-linux` (exit 0) |
| `docker version` | client 29.8.0 OK; **server unreachable** (exit 1) |
| `docker info` | `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine ... The system cannot find the file specified` |
| Docker Desktop processes | **none running** |
| WSL distros | `Ubuntu` Stopped, `docker-desktop` Stopped |
| Data root | `C:\Users\MINHAZ\AppData\Local\Docker\wsl\disk\docker_data.vhdx` (still on `C:`; `D:\Docker\data` absent) |
| `C:` free space | 3.38 GB |

The state is **not running**, not merely hung. Docker is required only for the *local* Supabase
stack (`supabase start` / `db reset`), which is a convenience for local testing. The SQL/RLS
layer is verified without it on host PostgreSQL 18.6, so this blocker does **not** block the
public-phone goal and no time was spent restarting it.

### 14.2 Supabase Cloud credentials - BLOCKED

The single real blocker for the acceptance test. No project URL, publishable key, service-role
key or project reference exists in this environment. Consequences, all **NOT VERIFIED**: Auth,
Storage, Realtime delivery, Edge Function execution, `pg_graphql`, cloud migrations, and the
PC-off phone test.

### 14.3 Missing keys - ENVIRONMENT-GATED

LLM key, Google Maps browser key, release keystore. Each degrades to a documented, honest state
and blocks no part of the core app.

---

## 15. Exact manual Supabase setup

Full detail in `docs/SUPABASE_CLOUD_SETUP.md`. The short form:

**Values to copy (Dashboard → Settings → API / General):**

| # | Value | Where |
| --- | --- | --- |
| 1 | Project URL (`https://<ref>.supabase.co`) | Settings → API → Project URL |
| 2 | anon / publishable key | Settings → API → Project API keys → `anon` `public` (or *publishable key*) |
| 3 | service-role key (server-side only) | Settings → API → Project API keys → `service_role` `secret` (or *secret key*) |
| 4 | project reference | Settings → General → Reference ID (or read it from the URL) |
| 5 | database password | Settings → Database |

**Configuration to change:**

1. Auth → Confirm email: **enabled**.
2. Auth → URL Configuration: **Site URL** = real app origin; **Redirect URLs** = real web origin
   **and** `https://localhost` (the Android WebView origin). Replace the `127.0.0.1:3000` local
   defaults.
3. Auth → SMTP: configure a verified sender before real users register.
4. Realtime: enabled (the publication is created by migration 0006).
5. Storage: created by migration 0005 - verify, do not recreate by hand.
6. Edge Function secrets: `CORS_ALLOWED_ORIGINS` (recommended), `LLM_API_KEY` (optional).

**Commands:**

```
node supabase/scripts/cloud.mjs doctor
node supabase/scripts/cloud.mjs link --project-ref <ref>
node supabase/scripts/cloud.mjs push --project-ref <ref> --dry-run
node supabase/scripts/cloud.mjs push --project-ref <ref> --confirm
node supabase/scripts/cloud.mjs status --project-ref <ref>
node supabase/scripts/cloud.mjs functions --project-ref <ref> --confirm
node supabase/scripts/cloud.mjs secrets --env-file supabase/.env --confirm
node supabase/scripts/cloud.mjs verify
```

---

## 16. Exact manual signing setup

Distinguish three artifacts:

| Artifact | Command | Signing | Installable? |
| --- | --- | --- | --- |
| Debug APK | `npm run build:android` | Android debug key | Yes, for testing only |
| Unsigned release APK | `npm run build:android:release` with no keystore | none | **No** - Android refuses it |
| Signed release APK | `npm run build:android:release` with a keystore | your release key | Yes, distributable |

To create the keystore (once, and keep it safe - losing it means you can never update an
installed app):

```
keytool -genkeypair -v ^
  -keystore D:/keys/jibonjori-release.jks ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -alias jibonjori
```

Then copy `frontend/android/keystore.properties.example` to
`frontend/android/keystore.properties` (git-ignored) and fill in `storeFile`, `storePassword`,
`keyAlias`, `keyPassword`. `android/app/build.gradle` reads it: present → signed
`app-release.apk`; absent → `app-release-unsigned.apk` and a warning. No script creates or
stores a keystore, and `*.jks` / `*.keystore` / `keystore.properties` are git-ignored.

Environment note: `JAVA_HOME` on this machine points at a non-existent directory
(`C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot`); the real JDK is
`C:\Eclipse Adoptium\jdk-17.0.19.10-hotspot`. `scripts/build-android.mjs` detects and corrects
this for its own build. A manual `gradlew` invocation does not, so set `JAVA_HOME` correctly
first.

---

## 17. Exact phone installation procedure

1. Install the Android platform tools and confirm the device:
   `adb devices`
2. Build with your project's two public values:
   `npm run build:android -- --supabase-url https://<ref>.supabase.co --anon-key <anon-key>`
   (or put them in `frontend/.env.phone.local`; see `.env.phone.example`).
3. Install:
   `adb install -r "frontend\android\app\build\outputs\apk\debug\app-debug.apk"`
4. Alternative without a cable: copy the APK to the phone and enable *Install unknown apps* for
   the file manager.
5. Reinstall over an older build: `adb install -r` (or uninstall first if the signature differs).

Full procedure: `frontend/PHONE_TESTING.md`.

---

## 18. Acceptance test

The criterion: the APK installs on a physical phone and performs the full flow over ordinary
internet, with the PC **off**.

| # | Step | Status |
| --- | --- | --- |
| 1 | Create an account | NOT VERIFIED |
| 2 | Receive / complete verification | NOT VERIFIED |
| 3 | Log in | NOT VERIFIED |
| 4 | Remain authenticated (app restart) | NOT VERIFIED |
| 5 | Refresh the session | NOT VERIFIED |
| 6 | View profile | NOT VERIFIED |
| 7 | Edit profile | NOT VERIFIED |
| 8 | Search | NOT VERIFIED |
| 9 | Interact with another account | NOT VERIFIED |
| 10 | Receive realtime updates | NOT VERIFIED |
| 11 | Upload / view permitted media | NOT VERIFIED |
| 12 | Log out | NOT VERIFIED |
| 13 | Log back in | NOT VERIFIED |

None of these is claimed, because no project exists to run them against. Steps 9 and 10 need a
**second** account. Everything needed to perform the test is in place; only §14.2 stands in the
way.

---

## 19. Production / public-readiness classification

| Area | Classification |
| --- | --- |
| Database schema, constraints, RLS, scoring, reports (SQL) | **VERIFIED** (local PostgreSQL 18.6, 124/124) |
| Frontend application against an in-memory Supabase double | **VERIFIED** (142/142) |
| Android build pipeline and toolchain | **VERIFIED** (real APK produced) |
| Release-origin gate | **VERIFIED** (21/21) |
| Secrets hygiene / gitignore / no credential in the tree | **VERIFIED** |
| Migration scripts + read-only cloud verification script | **VERIFIED** (syntax and guard behaviour executed) |
| Supabase Auth | **NOT VERIFIED** |
| Supabase Storage | **NOT VERIFIED** |
| Supabase Realtime delivery | **NOT VERIFIED** |
| Edge Functions (all 5) | **NOT VERIFIED** |
| `pg_graphql` live endpoint | **NOT VERIFIED** |
| Client against a real Supabase project | **NOT VERIFIED** |
| Cloud migrations applied | **NOT VERIFIED** |
| Signed distributable release APK | **ENVIRONMENT-GATED** |
| LLM features | **ENVIRONMENT-GATED** |
| Google Maps features | **ENVIRONMENT-GATED** |
| Local Supabase stack via Docker | **BLOCKED** (not on the critical path) |
| Public phone acceptance test | **BLOCKED** (sole cause: no cloud project) |
| Crystal Reports / on-device TensorFlow Lite / etc. | **NOT APPLICABLE** to this phase |

**Overall: not yet usable from anywhere.** Not because anything is known broken, but because the
cloud project has never existed. Every locally-verifiable claim is verified; every cloud claim is
honestly marked unverified.

---

## 20. What remains before the app can be used anywhere

One blocker, then activation:

1. **Create the Supabase project** (or open the one you have) and copy the five values in §15.
2. **Configure the dashboard**: confirm email, Site URL, Redirect URLs (including
   `https://localhost`), SMTP.
3. **Apply the migrations**: `push --confirm`, then `status`, then `verify`.
4. **Deploy the Edge Functions** and set `CORS_ALLOWED_ORIGINS`.
5. **Build the APK** with the real Project URL and anon key, install it, and run the §18
   acceptance test with the PC off.
6. Optional, independent: keystore (§16), LLM key, Maps key.

Steps 1–2 need a human with dashboard access. Steps 3–5 are scripted and ready.

---

## Changes made in this phase

| # | Change | Why |
| --- | --- | --- |
| 1 | Cleared the stale LAN address from the committed debug network config | A PC-era `192.168.0.104` was still committed |
| 2 | Hardened the release gate: trailing-dot FQDN, single-label hosts, reserved suffixes, CGNAT, link-local, IPv6 loopback/unique-local, IPv4-mapped IPv6 forms | Real bypasses existed - the harness found `::ffff:7f00:1` passing |
| 3 | Made the gate accept `sb_publishable_...` and refuse `sb_secret_...` | Newer Supabase key formats would have falsely blocked a valid release, or wrongly allowed a secret |
| 4 | Added `npm run test:release-gate` (21 cases) | A gate is only worth having if it is exercised |
| 5 | Added a release signing config + `keystore.properties.example` | A signed release was previously not possible without editing Gradle |
| 6 | Ignored `*.jks`, `*.keystore`, `keystore.properties` | Signing material must never be committable |
| 7 | Corrected stale backend-era comments in `.gitignore`, `types.ts`, `mlp.ts` | They referred to deleted files |
| 8 | Wrote `docs/SUPABASE_CLOUD_SETUP.md`, `frontend/PHONE_TESTING.md`, `frontend/ANDROID_BUILD_REPORT.md` | Referenced but missing |
| 9 | Added `supabase/scripts/cloud.mjs` and `verify-cloud.sql` | Deterministic, guarded cloud activation |
| 10 | Fixed two bugs in `verify-cloud.sql` and two in `cloud.mjs` found by running them | `on commit drop` killed the temp table; a no-FROM target list bypassed its guard; `npx` was not `.cmd`-resolved on Windows; the placeholder regex was over-broad |
| 11 | Set `enable_confirmations = true`; reworked `account-delete`; fixed `sessions` | Three real correctness/security defects |

No commit, push, fetch, reset or remote change was performed. Nothing was fabricated; no
credential, keystore, or cloud value was invented.

---

# 2026-09-27 — second attempt: boundary re-checked, frozen state swept

Re-checked the credential boundary by existence only. Still absent: all six environment
variables, every `.env` file, and `supabase/.temp/project-ref` (project not linked).
`cloud.mjs doctor` reports the CLI healthy (`2.118.0`) and `login : NOT LOGGED IN`, so the
Supabase CLI is now reachable and nothing but a project is missing. No cloud phase ran.

Frozen state swept and clean: no listener on any legacy port; no `node`/`postgres`/Docker
process; Docker still not running and not required; `backend/`, `render.yaml`, `server/`,
`api/`, `prisma/` and all Docker files absent, so the destructive migration is intact; 14
migrations and all 6 Edge Function directories present; the evidence archive byte-identical
(3,641,558 B, sha256 `EDE09842…206912`); no secret file tracked; HEAD still `7bffe33`.
An unrelated pre-existing MySQL80 service is running on 3306/33060; JibonJori does not use
MySQL, so it is not a dependency and was left alone.

Local gates re-run, all green: typecheck 0, lint 0, build 0, 142/142 tests, 16/16 deploy,
21/21 release-gate, RLS 124/124, APK scan SKIP (no APK exists, correct with no cloud config).

Status unchanged and un-promoted: **`PHONE-INDEPENDENT BACKEND: NOT VERIFIED`**, for the single
reason that no Supabase project exists to point at. What to provide is listed in
`docs/SUPABASE_CLOUD_SETUP.md` 8 and in the verification report's phase-15 section: the project
reference, Project URL, anon key, service-role key, database password, and the two Auth
dashboard settings.

---

# Errata (2026-09-27, appended - no earlier text rewritten)

One present-tense claim earlier in this document has since become false and is corrected here
rather than edited in place, because the audit convention is append-only.

- §10 said: *"Deno is not installed locally, so they were not even type-checked in this
  environment."* **That is no longer true.** Deno `2.9.6` has been provisioned into a temp cache
  outside the repository, and a reproducible gate (`scripts/check-edge-functions.mjs`) now runs
  `deno check`, `deno lint` and `deno test` over the five functions and their shared modules:
  **typecheck PASS, lint PASS, 19/19 tests, mutation detected**, reproduced twice. The gate is
  wired into CI via `denoland/setup-deno@v2`.

- **§10's status is nevertheless unchanged: NOT VERIFIED.** Typechecking, linting and unit
  tests of shared helpers are not execution. No function has been deployed or invoked against a
  Supabase project, and the handler bodies that touch `postgres`, Auth and Storage have never
  run. The corrected sentence should read "they are now typechecked, linted and unit-tested, but
  have still never been executed."

Also corrected during the same work: the earlier description of the `sessions` defect as an
*unpadded* `atob` throwing was measured to be imprecise. In Deno, `atob` **accepts** unpadded
input and **throws on the base64url alphabet** (`-`, `_`). The alphabet conversion is the
load-bearing half of that fix; the padding restoration is defensive. The fix itself was already
correct.

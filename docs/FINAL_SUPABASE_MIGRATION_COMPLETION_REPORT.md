# Final Supabase Migration — Completion Report

**Date:** 2026-09-27
**Repository HEAD:** `7bffe33` (unchanged; nothing committed, pushed, fetched or reset)
**Migration evidence archive:** `D:\Zeem\app\jibon_jori_migration_evidence\jibonjori_pre_supabase_backup.zip`
— 3,641,558 B, sha256 `EDE098428A56F3072735D4747BAB2D48D2D672E91ACF35ABC3ED4EC519206912` (verified this phase)

> **Read this first.** Every claim below is either an executed result with its measured
> number, or an explicit `BLOCKED` / `NOT VERIFIED` / `ENVIRONMENT-GATED` statement.
> The single decisive acceptance test — a physical Android phone talking to Supabase
> with the PC powered off — **has not been performed**, because no Supabase project
> credentials exist in this environment. Nothing here promotes that test's status.

---

## 1. Executive summary

The destructive migration from a Node/Express + Prisma + Socket.IO backend to a
pure-Supabase BaaS architecture is **complete in the repository and fully verified
everywhere it can be verified without a cloud project**. The runtime architecture is now
`Android/React → Supabase (Auth, PostgreSQL+RLS, Storage, Realtime, Edge Functions, GraphQL)`.
No first-party server exists; `backend/` and `render.yaml` are deleted and are confirmed
absent.

All locally executable gates pass, twice, with identical results. Two new mechanical
checkers were added this phase — a course-matrix reconciliation and a classified
security sweep — and both are self-testing, so a green run means the detectors actually
fire.

**The one thing that is not done is the thing that requires the cloud:** the project
activation (Phases 1–14 of the master prompt) and the phone test (Phases 15–16) are
blocked because the five Supabase values and the two Auth dashboard settings have not
been provided. The phase stopped exactly at that boundary. No user, JWT, email, storage
object, realtime event, Edge Function result, GraphQL response or signing key was
fabricated.

## 2. Final architecture

```
Android / React client  (holds only the public anon key)
        │  HTTPS
        ▼
Supabase project
        ├── Auth            email + password, confirmation, JWT sessions, refresh
        ├── PostgreSQL      schema from 14 migrations; the single authorization boundary (RLS)
        ├── REST / PostgREST    derived from the schema
        ├── GraphQL / pg_graphql  /graphql/v1, same RLS policies (migration 0014)
        ├── Storage         buckets `profile-photos`, `profile-documents` (private)
        ├── Realtime        postgres_changes on 5 published tables
        └── Edge Functions  ai-chat, ai-explanation, account-delete, sessions, reports
        │
        ▼
External providers, only where explicitly configured:
        LLM (optional) · Google Maps (optional) · Crystal Reports datasets (no runtime)
```

Absent by design: localhost, LAN origins, local PostgreSQL, Node/Express, Prisma runtime,
Socket.IO, Docker Desktop at runtime, Render, Brevo. The client reaches only
`https://<project>.supabase.co`.

## 3. Destructive migration details

| Item | State |
| --- | --- |
| Removed | `backend/` (197 files), `render.yaml`, `server/`, `api/`, `prisma/`, all Dockerfiles/compose files |
| Preserved as specification evidence | the archive above (byte-identical this phase) |
| Migrations | 14, `20260927000001_foundation.sql` … `20260927000014_graphql.sql` |
| Edge Functions | `_shared` + `ai-chat`, `ai-explanation`, `account-delete`, `sessions`, `reports` |
| Divergences recorded (archive code outranks archive prose) | score is 0–100 (not 0–1); `comments.body` max 1000 (not 2000); `inputsHash` order-invariant but not byte-identical to the old JS |

## 4. Supabase project verification

**BLOCKED.** No project exists in this environment. Checked this phase by existence only:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, `DATABASE_URL`,
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` — all unset. No
`.env` file exists anywhere in the tree. `supabase/.temp/project-ref` does not exist, so
nothing is linked. `node supabase/scripts/cloud.mjs doctor` reports the CLI healthy
(`2.118.0`) with `login : NOT LOGGED IN`.

No `link`, `push`, `migration status`, `functions deploy` or `secrets set` was executed.

## 5. Database verification

**Verified on a real PostgreSQL 18.6 server (host), not on Supabase.** All 14 migrations
apply cleanly with `ON_ERROR_STOP`; the RLS suite executes against the real database.
17/17 public tables have `relrowsecurity = true`; reference data is seeded
(`education_levels = 8`, `professions = 16`, `interests = 24`).

Cloud schema, migration history and `supabase migration status` remain **NOT VERIFIED**.

## 6. RLS verification

**124 / 124 claims hold, run twice this phase with identical results (`124 | 0`,
`RLS TESTS PASSED`).** The suite is adversarial — it switches to the `anon` and
`authenticated` roles and asserts that a caller cannot read or write what they must not —
and it is mutation-tested: three deliberately injected policy defects were all detected,
so a green run is meaningful.

Covered: cross-user read/write denial, forged ratings/comments, foreign notifications,
foreign media and sessions, `audit_logs` unwritable by clients, admin-only operations,
`anon` limited to the four reference tables plus `EXECUTE` on `username_available`,
suspended/closed/pending denial, and no ambiguous `public` function overloads.

**Cloud RLS through the real API (PostgREST/Storage/Realtime with real JWTs) is NOT
VERIFIED** — that is exactly what `supabase/scripts/verify-cloud-runtime.mjs` is written
to prove, and it has never run because it refuses to run without credentials (fail-closed,
exit 2, no claim printed).

## 7. Auth verification

**NOT VERIFIED against a real project.** `supabase/config.toml` sets
`enable_confirmations = true`, restoring the first of the two pending-account gates; the
second is the database gate in migration 0011, covered by the RLS suite. Registration,
confirmation email, login, session persistence, refresh, logout, password reset and
soft-close are all implemented and unit-covered, but the Auth service itself has never
been exercised. Brevo is not reintroduced: Supabase Auth is the provider.

## 8. Storage verification

**NOT VERIFIED against a real project.** Migration 0005 defines two private buckets —
`profile-photos` (5 MiB; `image/jpeg`, `image/png`, `image/webp`) and
`profile-documents` (10 MiB; `application/pdf`, `image/jpeg`, `image/png`) — plus 8
`storage.objects` policies. The RLS suite asserts folder isolation, the byte ceiling and
document privacy. No object has ever been uploaded to a superseded Storage service, and
none will be claimed as such.

## 9. Realtime verification

**NOT VERIFIED against a real project.** Migration 0006 publishes exactly `comments`,
`interactions`, `ratings`, `notifications`, `chat_messages` on `supabase_realtime`, with
`interactions` using `replica identity full`. `profiles` is deliberately **not**
published. The publication and replica identity are asserted by the RLS suite; live
delivery between two real authenticated clients has not been observed.

## 10. Edge Function verification

**NOT VERIFIED — never deployed, never executed against a project.** Deno was absent
locally at the start of this phase; it has since been provisioned and the functions
are now **typechecked, linted and behaviourally tested** in the runtime they deploy to
(§21). That is static and unit evidence, not execution evidence, so the function status
itself does not change.

Static review during the migration found and fixed three real defects, each of which
would have misbehaved in production:

- `account-delete` — was a **hard delete** of the auth user; now **soft-closes** per
  archived spec B-72 (`{ closed: true }`, `deleted_at` stamped, sessions deleted, one
  `postgres` transaction, idempotent), with the audit action renamed `account.delete` →
  `account.close` and audit failure aborting the transaction.
- `sessions` — the current-session claim was decoded by passing a base64url payload
  straight to `atob`. Measured in Deno, `atob` **throws on `-` and `_`** (it does *not*
  throw on missing padding), so a caller with a valid token was treated as having no
  current session, the "keep the calling session" guard was dropped, and `revokeOthers`
  signed the member out. The payload decode now lives in `_shared/jwt.ts`, converts the
  alphabet and restores padding, and `revokeOthers` **fails closed** with
  `409 CURRENT_SESSION_UNKNOWN`.
- `supabase/config.toml` — `enable_confirmations` was `false`; now `true`.

Each function still needs an executed behavioural assertion before it may be called
VERIFIED. Deployment and invocation are the remaining step.

## 11. GraphQL verification

**NOT VERIFIED.** Migration 0014 enables `pg_graphql` under a guarded `create extension`,
and `frontend/src/lib/graphql.ts` provides the transport with a PostgREST fallback. The
extension is a Supabase built-in that is **not available on the local PostgreSQL**, so
the live endpoint has never been queried. It remains part of the client contract, so it
is neither removed nor claimed.

## 12. Frontend migration

Complete. Every `src/api/*` export signature and each context/hook value shape was
preserved, so no page needed editing; the data layer now runs on `@supabase/supabase-js`.
`getSupabase()` **fails closed** with a `503 SUPABASE_NOT_CONFIGURED` unless both public
values are set. `VITE_API_BASE_URL`, `VITE_SOCKET_URL` and `VITE_DEV_BACKEND_URL` are
removed and asserted absent. Gates: typecheck 0, lint 0, build 0, **142/142** tests,
deploy **16/16**, release-origin gate **21/21**, all reproduced twice this phase.

## 13. Android build

The pipeline is verified end to end: `frontend/scripts/build-android.mjs` resolves the
config, refuses a service_role/secret key, applies the release-origin gate, auto-corrects
the machine's broken `JAVA_HOME`, rewrites the debug cleartext allowlist to
`localhost`/`127.0.0.1`/`10.0.2.2` only, builds with Vite, syncs Capacitor, assembles,
verifies the APK and reports signing status. It **fails closed** with no Supabase URL.
Debug APKs were built twice (4,698,728 B and 4,501,130 B) with **synthetic** placeholder
values and then deleted; the release build reads `keystore.properties` when present and
otherwise emits an unsigned `app-release-unsigned.apk` with a warning — no keystore was
fabricated. **No cloud-configured APK exists**, so this phase's `test:apk` correctly
reports `SKIP`.

## 14. APK security scan

The scanner (`frontend/test-support/scan-apk.mjs`) decompresses the built APK's zip and
searches its text/asset entries. The last real APK scan was **CLEAN** across 235
decompressed entries: no `service_role`, `sb_secret_`, `sk-`, `AIza`, Postgres URI,
`JWT_SECRET`/`OTP_HASH_SECRET`, SMTP/Brevo, private-key material, RFC1918 literal,
emulator alias, Socket.IO, Prisma, Express, old `/api/*` path or old `VITE_` variable.
One embedded `.supabase.co` origin, as intended. The sole finding was investigated rather
than suppressed: `http://localhost:9999` is `@supabase/auth-js`'s own
`exports.GOTRUE_URL` constant (`node_modules/@supabase/auth-js/dist/main/lib/constants.js:18`),
unreachable because `getSupabase()` throws unless configured; the scanner now judges
loopback occurrence-by-occurrence. No APK exists right now, so the scan is `SKIP`.

## 15. Physical phone test

**BLOCKED — not performed.** There is no cloud-configured APK to install, because there
is no project to configure it against.

## 16. PC-off test (`JIBONJORI_PC_OFF_ACCEPTANCE`)

**BLOCKED — not performed.** It cannot begin before §15. The status of
`PHONE-INDEPENDENT BACKEND` is therefore **NOT VERIFIED**.

## 17. Mobile-data test

**BLOCKED** — dependent on §15.

## 18. Independent-Wi-Fi test

**BLOCKED** — dependent on §15.

## 19. Security audit

A classified sweep replaced the blanket grep the master prompt warns against. Every
occurrence is printed with its line and judged; secrets are never tolerated, origin/storage
literals are tolerated only in test fixtures, debug source sets and prose; identifiers are
reported but never blocking. The allowlist pins an **exact count per file**, so a new LAN
or secret literal cannot hide behind an old exemption, and the scanner's four self-test
cases (real secret key, LAN origin in shipped code, hardcoded service-role assignment,
Postgres URI with password) all fire.

Result this phase, twice: **runtime 113 occurrences — 76 allowlisted, 37 identifier
mentions, 0 blocking; prose 5 occurrences — 5 allowlisted, 0 blocking. PASSED.**

Frozen-state sweep also confirmed: no listener on any legacy port
(3000, 3001, 4000, 5000, 5173, 5174, 5432, 54321, 54322, 8080, 8888, 9999); no
`node`/`postgres`/`redis-server`/Docker process; Docker daemon down and not required; no
`.env`, `*.jks`, `*.keystore` or `keystore.properties` tracked; HEAD unchanged. One
honest note: an unrelated pre-existing **MySQL80** Windows service listens on
3306/33060 — JibonJori references MySQL nowhere and uses PostgreSQL/Supabase, so it is
not a dependency and was left alone.

## 20. Course matrix reconciliation

The master prompt refers to a **187-row** matrix. **No such matrix, and no 187-row
requirement list, exists in this repository or in the preserved archive** (the only `187`
anywhere is a source line range in `VALIDATION_REVIEW.md`). Rather than invent rows to
reach a total, the authoritative list was taken from `JibonJori_OpenCode_Spec.md`: the
**21** numbered features under *Important and Interesting Features* plus the **24**
bullets under *Course Requirement Coverage*.

`scripts/check-course-matrix.mjs` reconciles the spec against
`docs/COURSE_REQUIREMENT_MAPPING.md` mechanically. Its first run found **4 real
divergences**, all fixed: feature §3 and §11 were renamed to the spec's wording, and one
coverage row was retitled to match the spec bullet exactly. Final:

```
course matrix: TOTAL=45 PROBLEMS=0
  spec features 21 · spec coverage 24 · mapping feature rows 21 · mapping coverage rows 24
```

The checker is self-testing: dropping a coverage row, renaming a feature away from the
spec, and introducing a non-vocabulary status are all detected. Statuses use only the
project vocabulary (`VERIFIED`, `PARTIAL`, `ENVIRONMENT-GATED`, `BLOCKED`,
`NOT VERIFIED`, `NOT APPLICABLE`).

## 21. Test results

Run twice from a cleaned `dist/`, identical both times:

| Gate | Command | Result (run 1 / run 2) |
| --- | --- | --- |
| Course matrix | `node scripts/check-course-matrix.mjs --self-test` | TOTAL=45 PROBLEMS=0 / same |
| Security sweep | `node scripts/security-sweep.mjs --self-test` | 0 blocking, 4/4 self-tests / same |
| Typecheck | `npm run typecheck` | exit 0 / exit 0 |
| Lint | `npm run lint` | exit 0 / exit 0 |
| Build | `npm run build` | exit 0 / exit 0 |
| Unit + integration | `npm test` | 142 passed (142) / 142 passed (142) |
| Deployment config | `npm run test:deploy` | 16/16 / 16/16 |
| Release-origin gate | `npm run test:release-gate` | 21/21 / 21/21 |
| APK scan | `npm run test:apk` | SKIP (no APK) / SKIP |
| RLS suite (host PG 18.6) | `supabase/tests/run-rls-tests.sh` | 124 \| 0 PASSED / 124 \| 0 PASSED |
| Edge Functions (Deno) | `node scripts/check-edge-functions.mjs --mutation` | check PASS, lint PASS, 19/19, mutation detected (both) |

No flake was observed and nothing was hidden.

### Edge Function gate detail

Deno `2.9.6` over the 11 TypeScript files in `supabase/functions` (5 functions +
`_shared` + `tests`): `deno check` PASS, `deno lint` PASS, `deno test` **19 passed / 0
failed** (`http_test.ts` 10, `jwt_test.ts` 9).

The tests are not decorative. `--mutation` reintroduces a defect into a scratch copy and
requires the suite to fail; three defects were verified as detected, each by the test
written for it:

| Injected defect | Detected by |
| --- | --- |
| remove the base64url → standard alphabet conversion | `jwt: decodes a payload whose base64url uses the url-safe alphabet` (and the multi-byte test) |
| accept any `session_id` type instead of requiring a string | `jwt: returns null instead of throwing for every malformed input` |
| make `bearerToken` return the scheme word `Bearer` as a token | `jwt: bearerToken extracts the token from an Authorization header` |
| leak the internal error message from the 500 handler | `http: handler converts an unexpected error into a 500 that leaks nothing` |

Two defects in the new code were found by these tests rather than by inspection:
`bearerToken` returned `"Bearer"` for a scheme-only header (the Fetch API trims header
values, so the scheme check missed it), and the jwt test file originally claimed the
*padding* was the load-bearing part of the fix. Probing the runtime showed the opposite —
Deno's `atob` accepts unpadded input and rejects the url-safe alphabet — so the claim was
corrected and a `runtime behaviour` test now records the measured facts.

## 22. Remaining environment-gated items

| Item | State | Consequence |
| --- | --- | --- |
| Supabase project credentials (5 values) | absent | blocks everything cloud |
| Supabase Auth dashboard (Confirm email, Site URL, Redirect URLs) | not configured | blocks signup/login verification |
| `LLM_API_KEY` | absent | deterministic fallback, never a fabricated answer |
| Google Maps browser key | absent | explicit "not configured" map state |
| Android release keystore | absent | unsigned release APK only |
| Verified SMTP sender | absent | Supabase default sender is rate-limited |
| Docker daemon | not running | local Supabase stack unavailable; off the critical path |
| Crystal Reports runtime | does not exist | dataset binding authored; no `.rpt` fabricated |

## 23. Remaining product decisions

- Whether the release APK should ship with a real keystore (needs a keystore; none exists).
- Whether to configure a custom SMTP sender, or accept Supabase's rate-limited default.
- Whether `pg_graphql` stays in the client contract. It is currently kept; if the course
  deliverable does not need it, the cleanest end state is removal rather than an
  unverified dependency.
- Whether the debug cleartext allowlist should keep the emulator alias `10.0.2.2` (it is
  debug-only and cannot affect release).

## 24. Known limitations

- Everything in §4–§11 is unverified against a real project; the local PostgreSQL proves
  SQL/RLS logic, not the Supabase service surfaces.
- The Edge Functions are typechecked, linted and unit-tested, but their shared modules only:
  the handler bodies that touch `postgres`, Auth and Storage have never run, and `index.ts`
  files cannot be imported by a test because they call `Deno.serve` at module scope.
- Deno is provisioned on demand into a cache directory outside the repository; if that is
  impossible the edge gate reports SKIP rather than failing.
- The 45-row total is the honest count of the spec's requirements. It is not 187.
- Realtime, Storage and GraphQL remain unexercised end to end.
- `supabase/config.toml` carries CLI-local defaults (`site_url = http://127.0.0.1:3000`,
  `additional_redirect_urls = ["https://127.0.0.1:3000"]`); they do not affect the cloud
  client and are documented as local-only.
- The security sweep excludes its own source (it necessarily contains the literals it
  searches for); its `--self-test` proves the detectors still fire.

## 25. Exact deployment instructions

```powershell
# 1. Provide 5 Dashboard values (Settings -> API: URL, anon, service_role;
#    Settings -> General: Reference ID; Settings -> Database: password) and, in
#    Authentication, enable Confirm email and set Site URL + Redirect URLs
#    (including https://localhost for the Android WebView).

# 2. Link and apply migrations (destructive by design; the project is the target).
node supabase/scripts/cloud.mjs link      --project-ref <REF>
node supabase/scripts/cloud.mjs push      --project-ref <REF> --dry-run
node supabase/scripts/cloud.mjs push      --project-ref <REF> --confirm
node supabase/scripts/cloud.mjs status    --project-ref <REF>

# 3. Edge Functions.
node supabase/scripts/cloud.mjs functions --project-ref <REF> --confirm

# 4. Read-only cloud assertions (12 claims).
node supabase/scripts/cloud.mjs verify

# 5. Real-API adversarial harness (writes throwaway data; use a throwaway project
#    or preview branch). Export the three values for this command only.
$env:SUPABASE_URL='https://<REF>.supabase.co'
$env:SUPABASE_ANON_KEY='<anon key>'
$env:SUPABASE_SERVICE_ROLE_KEY='<service_role key>'
node supabase/scripts/cloud.mjs runtime
```

## 26. Exact phone installation instructions

```powershell
cd frontend
npm run build:android -- --supabase-url https://<REF>.supabase.co --anon-key <anon key>
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Then, before testing: power the PC **completely off**, put the phone on mobile data or an
unrelated Wi-Fi network, confirm it cannot reach `192.168.x.x`, and run the 20-step
acceptance list in `frontend/PHONE_TESTING.md`. Only then may
`PHONE-INDEPENDENT BACKEND` become `VERIFIED`.

## 27. Rollback limitations

The migration is destructive and there is no automatic rollback path. `backend/` and
`render.yaml` are deleted; the only recovery route is restoring from the immutable
archive `jibonjori_pre_supabase_backup.zip` (sha256 above) and re-adding the deleted tree
from it. The migrations are forward-only: `cloud.mjs` deliberately exposes **no** remote
reset or drop command. Rolling a cloud database back therefore requires manual action in
the Supabase Dashboard, which this tooling does not and will not perform.

## 28. Final readiness classification

Grounds for each: cloud surfaces are unverified and the decisive PC-off phone test has not
run, so no "ready" claim is available.

| Classification | Result | Because |
| --- | --- | --- |
| COURSE-READY | **NO** | 45/45 rows mapped and the local gates pass, but the cloud-backed requirements (Auth, Storage, Realtime, Edge Functions, GraphQL) and the phone test are unverified |
| PHONE-TESTABLE-ANYWHERE | **NO** | no cloud-configured APK; the physical PC-off test has not been performed |
| PC-INDEPENDENT | **NO** | the architecture has no PC dependency and the APK is verified clean, but that is not the criterion; the phone-with-PC-off demonstration is missing |
| RELEASE-READY | **NO** | no cloud configuration and no signing keystore; only an unsigned release artifact can be produced |
| PRODUCTION-READY | **NO** | Auth/Storage/Realtime/Edge Functions/GraphQL unverified, no SMTP sender, no operational hardening |

**In one line:** the repository-side migration is finished and honest, the boundary is a
Supabase project, and the largest remaining task is not code — it is supplying the five
values and two Auth settings so the phone test can actually be run.

---

## Addendum — Edge Function gate (2026-09-27, appended)

The phase above noted that the Edge Functions had only ever been read by eye, because Deno
was absent. Deno `2.9.6` has since been provisioned (into a temp cache, outside the
repository) and a reproducible gate added: `scripts/check-edge-functions.mjs` runs
`deno check`, `deno lint` and `deno test`, with `--mutation` proving the tests bite.

Results, reproduced twice: **check PASS · lint PASS · 19/19 tests · mutation detected.**
The gate is wired into CI as a `denoland/setup-deno@v2` step.

What changed, precisely:

- `_shared/jwt.ts` was extracted so the payload decode is testable. The `sessions` function
  previously held it privately inside a module that calls `Deno.serve` at import time, which
  made it unreachable from a test. Behaviour is unchanged; `sessions/index.ts` now imports
  `sessionIdFromRequest`.
- Two defects in the new code were found by the new tests: `bearerToken` returned `"Bearer"`
  for a scheme-only header, and a test comment misattributed the fix's load-bearing part to
  padding. Both corrected. The measured runtime facts (Deno's `atob` tolerates missing
  padding but rejects `-`/`_`) are now asserted by a test rather than assumed.
- The security sweep gained three allowlist entries for the new test fixtures, at pinned
  exact counts. `runtime 119 occurrences / 82 allowlisted / 37 identifier / 0 blocking`;
  `prose 6 / 6 / 0 / 0`.

**No status above is promoted by this addendum.** The Edge Functions remain
`NOT VERIFIED`: typechecking, linting and unit-testing shared helpers is not deployment, and
not one function has been invoked against a Supabase project. The cloud blocker is unchanged.

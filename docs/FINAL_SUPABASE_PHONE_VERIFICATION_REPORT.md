# Final Supabase Phone Verification Report

**Date:** 2026-09-27
**Phase:** cloud activation and verification of the `PHONE → INTERNET → SUPABASE CLOUD` architecture.
**Headline:** the client is cloud-only and its APK is verified clean, but **no Supabase Cloud
project was available**, so every cloud claim below is `BLOCKED` or `NOT VERIFIED`. The
acceptance criterion has **not** been met.

Status vocabulary: `VERIFIED`, `PARTIAL`, `ENVIRONMENT-GATED`, `BLOCKED`, `NOT VERIFIED`,
`NOT APPLICABLE`. A status is only `VERIFIED` where a command was actually executed and its
output observed in this session.

---

## 0. What this phase changed, and why

The instruction was to activate and verify the real cloud backend. That could not start: no
credential exists. Rather than idle, this phase did everything that does not require a project,
and it found four real defects in the tooling that would have blocked the activation anyway.

| # | Finding | Fix | Verified how |
| --- | --- | --- | --- |
| 1 | `cloud.mjs` could not invoke the Supabase CLI at all on Windows: the `cmd.exe` wrapper produced `'"npx.cmd"' is not recognized` | Resolve the CLI as `node <npm>/bin/npx-cli.js`, removing `cmd.exe` entirely | `doctor` now reports CLI `2.118.0`; `projects list` fails gracefully with "Access token not provided" |
| 2 | The `cmd.exe` wrapper also broke any repository path containing a space (probed both quoting forms: both fail) | Same fix; a space in the path no longer matters | Probed empirically against `space dir\probe.cmd` (exit 1) vs the `npx-cli.js` route (exit 0) |
| 3 | `verify-cloud.sql` destroyed its own results table: `create temporary table ... on commit drop` drops at the end of the statement under psql's autocommit | Removed `on commit drop` (session-scoped temporary table) | Ran the file against the local migrated database: 12 claims reported instead of an error |
| 4 | `verify-cloud.sql` raised instead of reporting when `supabase_migrations` is absent (a guard in `WHERE` cannot protect a `FROM`-less target list) | Moved the check into a `DO` block with dynamic SQL | Re-ran: the claim reports `FAIL` with a reason, then the deliberate hard-fail is the only error |

Also added this phase:

| Artifact | Purpose |
| --- | --- |
| `supabase/scripts/verify-cloud-runtime.mjs` | Adversarial cloud harness: real Auth, real JWTs, real PostgREST/Storage/Realtime. **Never executed.** |
| `supabase/scripts/cloud.mjs runtime` | Runs that harness |
| `frontend/test-support/scan-apk.mjs` + `npm run test:apk` | Scans a built APK's decompressed contents for forbidden values |

---

## 1. Cloud project verification — `BLOCKED`

`node supabase/scripts/cloud.mjs doctor`:

```
=== cloud doctor ===
node          : v24.18.0
platform      : win32
supabase cli  : npx --yes supabase@2.118.0
  version     : 2.118.0
  login       : NOT LOGGED IN (or no network)
                Run: npx supabase login
```

Credential presence was checked by existence only; no value was read or printed.

| Expected | State |
| --- | --- |
| `SUPABASE_URL` | unset |
| `SUPABASE_ANON_KEY` | unset |
| `SUPABASE_SERVICE_ROLE_KEY` | unset |
| `SUPABASE_DB_URL` | unset |
| `SUPABASE_ACCESS_TOKEN` | unset |
| `supabase/.env` | absent |
| `supabase/.temp/project-ref` | absent - the project is not linked |

**No project reference was supplied, so there is nothing to verify against.** Per the operating
rules, the phase stopped before any destructive operation: no `link`, no `push`, no `functions
deploy`, no `secrets set` ran against any project. Nothing was fabricated to fill the gap.

Because there is no project, sections 2–9 below cannot be executed. Each is stated as it is.

---

## 2. Migration result — `NOT VERIFIED` in cloud, `VERIFIED` locally

| Aspect | Status |
| --- | --- |
| The 14 migrations applied to a hosted project | **NOT VERIFIED** - `push` never ran |
| Cloud migration history (`supabase_migrations`) | **NOT VERIFIED** |
| The same 14 migrations applied to a real PostgreSQL 18.6 engine | **VERIFIED** - all apply with `ON_ERROR_STOP` |

The migration kit is ready: `cloud.mjs push --confirm` is guarded, `--dry-run` prints
`npx-cli.js --yes supabase@2.118.0 db push --project-ref <ref> --dry-run` and executes nothing,
and there is no remote reset or drop path in the script at all.

---

## 3. Schema result — `NOT VERIFIED` in cloud, `VERIFIED` locally

Verified locally against PostgreSQL 18.6 (the same engine line Supabase runs):

| Check | Result |
| --- | --- |
| 17/17 public tables present | VERIFIED |
| 17/17 have `relrowsecurity = true` | VERIFIED |
| Enum types, CHECK constraints, indexes, triggers | VERIFIED (exercised by the 124-claim suite) |
| `anon` table privileges: `SELECT` on the 4 reference tables only | VERIFIED |
| `anon` function privileges: `username_available` only | VERIFIED |
| No ambiguous function overloads in `public` | VERIFIED |
| Reference data seeded (8 education levels, 16 professions, 24 interests) | VERIFIED |

`supabase/scripts/verify-cloud.sql` asserts all of the above plus buckets, publication and the
six `report_*` functions, and was validated by execution against the local database (11 `PASS`,
1 honest `FAIL` for the absent migration-history schema, followed by its deliberate hard-fail).

---

## 4. RLS result — `VERIFIED` locally, `NOT VERIFIED` in cloud

| Aspect | Status |
| --- | --- |
| SQL-layer adversarial suite (role switching, 124 claims) | **VERIFIED** - 124/124 on PostgreSQL 18.6, mutation-tested |
| RLS enabled on every table | **VERIFIED** |
| `audit_logs` accepts no client write | **VERIFIED** |
| The same properties through the real REST/Storage/Realtime surface | **NOT VERIFIED** |

A distinction matters here, and this phase acted on it. The existing suite proves the policies
*in SQL*, by assuming roles inside one database. It does **not** prove that a real user's token,
through PostgREST, is denied. So `verify-cloud-runtime.mjs` was written to test the second thing
with the real API: two genuinely confirmed users, real JWTs, and adversarial claims - A cannot
modify/delete B's profile, cannot escalate its own `role`, cannot set its own `deleted_at`,
cannot read B's media/notifications/conversations/chat, cannot forge a rating or comment
attributed to B, cannot read `audit_logs`; `anon` reads reference data but no profiles; a
suspended member, a closed member and a pending member all lose access; a non-admin cannot call
an admin report or write `ml_artifacts`.

That harness has **never been executed**, so it proves nothing yet. Its safety properties were
verified: with no credentials it exits 2 having reported **no claim at all**, and it refuses to
run if `SUPABASE_ANON_KEY` holds a service_role/secret key (because then the client-side claims
would be meaningless).

---

## 5. Auth result — `NOT VERIFIED`

Not executed. No project, so registration, confirmation, login, refresh, logout and password
reset were not exercised. The harness covers: login before confirmation rejected, login after
confirmation succeeds, token identity matches, refresh issues a new session, wrong password
rejected, session revocation via the `sessions` function, sign-out, a forged token refused by
PostgREST, and `username_available` for `anon`.

The one Auth-adjacent property that **is** verified locally is the database half of the pending
gate: `account_state()` returns `pending` for an unverified identity, and the suite covers the
gate in both directions. `supabase/config.toml` sets `enable_confirmations = true` to match.

The old custom OTP/Brevo flow was **not** used as a workaround, and was not reintroduced.

**External dependency if this fails next:** email delivery needs a verified SMTP sender on a
real domain. Supabase's default sender is rate-limited and unsuitable for real users. That is a
configuration task, not a code change.

---

## 6. Storage result — `NOT VERIFIED`

Not executed. Buckets and policies are verified **by SQL** (both buckets private,
`profile-photos` 5 MiB / `profile-documents` 10 MiB, with MIME allow-lists; 8 `storage.objects`
policies), and `verify-cloud.sql` re-asserts them read-only. No upload, download, signed URL or
deletion has occurred against Supabase.

The harness covers: owner upload, invalid MIME rejected, signed URL works, expired signed URL
fails (created with a 1-second TTL and fetched after 2.5 s), B cannot download/sign/delete A's
object, and the owner can delete its own. Never executed.

---

## 7. Realtime result — `NOT VERIFIED`

Not executed, and per the instruction it is **not** claimed from the mocked tests. The client
adapter is unit-tested against an in-memory double, which is not evidence of live delivery.

Verified **by SQL** only: the `supabase_realtime` publication exists and contains exactly
`comments`, `interactions`, `ratings`, `notifications`, `chat_messages`; `profiles` is
deliberately not published; `interactions` has `replica identity full`.

The harness covers: a subscriber receives an authorised change (B subscribed to `comments`,
A inserts, B receives within 15 s), and no event arrives for the unpublished `profiles` table.
Never executed.

Socket.IO is absent from the client: no `socket.io-client` dependency, no `lib/socket.ts`, and
the APK scan found no Socket.IO endpoint.

---

## 8. Edge Function result — `NOT VERIFIED`

None of the five functions has been deployed or executed. Deno is not installed locally, so
they were not type-checked either. Three real defects were found by static review in the
previous phase and are fixed in the source (`account-delete` soft-close, `sessions` JWT padding
and fail-closed revocation, `enable_confirmations`), but a fix that has never run is not a
verified fix.

The harness covers, per function, the required cases: valid request, unauthenticated,
unauthorized, malformed, ownership violation, admin-only, and suspend/close where applicable -
including specifically that `sessions` lists only the caller's own sessions and refuses to
revoke the calling session, and that `account-delete` refuses an unauthenticated caller.
Never executed.

---

## 9. GraphQL result — `NOT VERIFIED`

`pg_graphql` is not available on the local PostgreSQL, so the extension could not be installed
or queried locally; the live `/graphql/v1` endpoint has never been exercised. The transport
(`frontend/src/lib/graphql.ts`) is unit-tested against the in-memory double with a PostgREST
fallback, which is not evidence that the endpoint works. Migration `0014` guards the
`create extension` so it is a no-op where the extension is absent.

---

## 10. Client result — `VERIFIED`

The production client is cloud-only, and this is verified by gates rather than asserted.

| Requirement | Result |
| --- | --- |
| Only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in production config | VERIFIED - `.env.example` declares exactly 4 variables (2 required, 2 optional features); `test:deploy` asserts no unsupported variable |
| No service-role key, DB password, JWT secret, SMTP/LLM secret in the client | VERIFIED - `test:deploy` asserts no credential literal; the build refuses a service_role/secret key |
| No `localhost`, `127.0.0.1`, `10.0.2.2`, `192.168.x.x`, RFC1918, Socket.IO, Prisma, Express or old API path | VERIFIED - APK scan (§12) plus `test:deploy` |
| Release build rejects a private/local origin | VERIFIED - `test:release-gate` 21/21 |
| Canonical gates | VERIFIED - typecheck 0, lint 0, build 0, test 142/142, deploy 16/16, release gate 21/21 |

The migration to cloud-only was completed in the earlier phases; this phase re-verified it and
found no regression. One genuine defect was fixed earlier and remains covered: the committed
debug network config no longer holds any LAN address (its only cleartext entries are the
Capacitor loopback and the emulator alias, in the debug source set only; a release build denies
cleartext outright).

---

## 11. APK result — `VERIFIED` (artifact), `ENVIRONMENT-GATED` (signed release)

A real debug APK was built and scanned. It used **synthetic** placeholder values and was
deleted immediately, so it cannot be mistaken for a usable artifact; the synthetic
`.env.phone.local` it generated was also removed, which leaves the build correctly failing
closed until real values are supplied.

| Item | Result |
| --- | --- |
| Toolchain present (JDK 17, `ANDROID_HOME`, Gradle 8.2.1, Capacitor 6, `adb`) | VERIFIED |
| Full pipeline (`typecheck` → `lint` → `vite build --mode phone` → `cap sync` → `assembleDebug`) | VERIFIED |
| APK produced | 4,501,130 bytes (4.29 MiB), package `com.jibonjori.app`, 516 zip entries |
| APK contents scanned (235 text/asset entries decompressed and searched) | **CLEAN** |
| Build fails closed with no Supabase URL | VERIFIED |

The scan searched the **decompressed contents of the APK** (not the source) for a service_role
literal, `sb_secret_`, `sk-`, `AIza`, a Postgres URI, `JWT_SECRET`/`OTP_HASH_SECRET`, SMTP/Brevo,
private-key material, RFC1918 and emulator origins, Socket.IO, Prisma, Express, old `/api/*`
paths and old `VITE_` variables. All clean. It also asserts exactly one `.supabase.co` origin is
embedded.

One finding was investigated rather than waved through: `http://localhost:9999` is present. It
is a constant inside `@supabase/auth-js` (`dist/main/lib/constants.js: exports.GOTRUE_URL =
'http://localhost:9999'`), not this app's configuration. Our source contains no loopback
reference. It is unreachable because `lib/supabase.ts` refuses to construct a client unless both
values are set, and the build script refuses to build without them, so the client always gets an
explicit URL and never falls back to that default. The scanner now judges the loopback pattern
occurrence by occurrence (exactly one, and only the library constant) instead of flagging it
blindly, so the check stays useful for future builds.

The 13 origins found in the bundle are library documentation links (apache, cordova, react,
gsap, stackoverflow, capacitorjs, github, youtube), `maps.googleapis.com`, `i.ytimg.com`, and the
configured Supabase origin.

**Signed release: `ENVIRONMENT-GATED`.** No keystore exists and none was fabricated. The signing
config reads `android/keystore.properties` when present and otherwise produces an unsigned
release APK that Android refuses to install; `*.jks`, `*.keystore` and `keystore.properties` are
git-ignored. This debug APK is **not** the final distributable.

---

## 12. Security result — `VERIFIED` (for what could be scanned)

| Surface | Result |
| --- | --- |
| Decompressed APK contents | CLEAN (§11) |
| Fresh production bundle (24 chunks) | no key, no host when unconfigured, no credential |
| Source tree (308 files) | no credential literal; `service_role`/`JWT_SECRET` appear only as identifiers, prose, or negative test assertions |
| Configuration | no secret in `Dockerfile`, `nginx.conf` or `.env.example` |
| Documentation | no secret value in any doc in this repository |
| Generated files | stale build output removed; no synthetic marker remains |
| Gitignore | `.env`, `.env.*`, `*.jks`, `*.keystore`, `keystore.properties` ignored; the four `*.example` templates trackable |
| Tracked `.env` files | none |

No secret value appears in this report.

---

## 13. Physical-phone result — `BLOCKED`

Not performed. It cannot be: there is no cloud project for the phone to reach, and no APK with
real configuration exists.

## 14. PC-off result — `BLOCKED`

Not performed, for the same reason.

**Therefore:**

```
PHONE-INDEPENDENT BACKEND: NOT VERIFIED
```

This is stated plainly rather than inferred. What *is* true is that no code path in the shipped
client reaches the PC: there is no Node/Express server, no Prisma, no Socket.IO, no local
PostgreSQL, no LAN or loopback origin, and the APK scan confirms it. The client is architecturally
independent of the PC. But architectural independence is not the acceptance criterion - the
criterion is a working app with the PC powered off, and that has not been demonstrated.

---

## 15. Remaining external dependencies

| Dependency | Blocks | Status |
| --- | --- | --- |
| **Supabase Cloud project + the 5 values** | everything cloud: Auth, Storage, Realtime, Edge Functions, GraphQL, migrations, the phone test | **BLOCKED** - the single real blocker |
| Verified SMTP sender | real email confirmation at scale | ENVIRONMENT-GATED |
| Android release keystore | a distributable signed release | ENVIRONMENT-GATED |
| `LLM_API_KEY` | AI phrasing only; degrades to a deterministic template | ENVIRONMENT-GATED |
| Google Maps browser key | the map only; degrades to a "not configured" state | ENVIRONMENT-GATED |
| Docker | the *optional* local stack only | BLOCKED, and not on the critical path |

---

## 16. The exact shortest path to the acceptance criterion

Nothing here needs a code change. It needs five values and about twenty minutes.

**Step 1 - copy five values from the Supabase Dashboard** (create a project if none exists):

| # | Value | Where |
| --- | --- | --- |
| 1 | Project URL | Settings → API → *Project URL* |
| 2 | anon / publishable key | Settings → API → *Project API keys* → `anon` `public` |
| 3 | service-role key | Settings → API → *Project API keys* → `service_role` `secret` |
| 4 | project reference | Settings → General → *Reference ID* |
| 5 | database password | Settings → Database |

**Step 2 - configure Authentication** (this is the step most likely to be missed):
enable **Confirm email**; set **Site URL** to the real app origin; add the real origin **and**
`https://localhost` to **Redirect URLs**.

**Step 3 - apply and verify:**

```
node supabase/scripts/cloud.mjs link      --project-ref <REF>
node supabase/scripts/cloud.mjs push      --project-ref <REF> --dry-run
node supabase/scripts/cloud.mjs push      --project-ref <REF> --confirm
node supabase/scripts/cloud.mjs status    --project-ref <REF>
node supabase/scripts/cloud.mjs functions --project-ref <REF> --confirm
node supabase/scripts/cloud.mjs verify
```

**Step 4 - prove access control through the real API** (writes throwaway data; use a throwaway
project or a preview branch):

```
$env:SUPABASE_URL='https://<REF>.supabase.co'
$env:SUPABASE_ANON_KEY='<anon key>'
$env:SUPABASE_SERVICE_ROLE_KEY='<service_role key>'
node supabase/scripts/cloud.mjs runtime
```

**Step 5 - build and install with the real values:**

```
cd frontend
npm run build:android -- --supabase-url https://<REF>.supabase.co --anon-key <anon key>
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

**Step 6 - the acceptance test:** power the PC off, put the phone on mobile data, and run every
flow in §13. Only then may this line be changed:

```
PHONE-INDEPENDENT BACKEND: NOT VERIFIED   ->   VERIFIED
```

---

## 17. Disclosure

Running the APK build overwrote `frontend/.env.phone.local`, because the build script
regenerates that file on every run.

The file it replaced was 238 bytes. Its contents were **not** read at any point - the operating
rules forbid reading dotenv files - so this report cannot and does not state what it held. All
that is known is that it was a machine-local, git-ignored file whose values predated this phase,
and that the client no longer reads any backend-era variable, so any LAN-era value in it was
already inert.

The file has been deleted outright rather than left holding this phase's placeholder values, so
the build now fails closed with "no Supabase project was configured" until real values are
supplied. `.env.phone.example` is the committed template. If that file held anything you still
want, it will have to be re-entered; the build cannot have used it.

No commit, push, fetch, reset or remote change was performed. HEAD is unchanged. The migration
evidence archive was not touched. No credential, token, keystore or cloud result was fabricated.

---

# Phase 15 re-attempt — credential boundary held, frozen state swept

**Date:** 2026-09-27 (second attempt, appended; nothing above was rewritten)

This section records a fresh attempt to run the full cloud activation path. It reached the same
boundary as §1, so the cloud sections above remain `BLOCKED` / `NOT VERIFIED` and nothing here
promotes them. What it adds is the frozen-state evidence and a re-run of every local gate.

## A. Credential boundary — re-checked by existence only

| Expected value | State |
| --- | --- |
| `SUPABASE_URL` | unset |
| `SUPABASE_ANON_KEY` | unset |
| `SUPABASE_SERVICE_ROLE_KEY` | unset |
| `SUPABASE_DB_URL` | unset |
| `SUPABASE_ACCESS_TOKEN` | unset |
| `SUPABASE_PROJECT_REF` / `JJ_PROJECT_REF` | unset |
| `supabase/.env`, `supabase/.env.local` | absent |
| `frontend/.env`, `.env.phone`, `.env.phone.local`, `.env.local` | absent |
| root `.env` | absent |
| `supabase/.temp/project-ref` | absent - not linked |

`node supabase/scripts/cloud.mjs doctor`:

```
supabase cli  : npx --yes supabase@2.118.0
  version     : 2.118.0
  login       : NOT LOGGED IN (or no network)
```

The CLI is healthy; the project is not authenticated and does not exist in this environment.
No secret value was read or printed.

**Phases 2-14 therefore did not execute**: no `link`, no `push`, no `functions deploy`, no
`secrets set`, no `verify`, no `runtime`, no APK built against a cloud project, no phone test.

## B. Frozen-state sweep (executed)

| Check | Result |
| --- | --- |
| Listener on any legacy port (3000, 3001, 4000, 5000, 5173, 5174, 5432, 54321, 54322, 8080, 8888, 9999) | none |
| `node` / `postgres` / `pg_ctl` / `redis-server` / Docker process | none running |
| Docker daemon | not running - and not required |
| `backend/`, `render.yaml`, `server/`, `api/`, `prisma/` | absent |
| any `Dockerfile` / `docker-compose.yml` | absent |
| 14 migrations | present |
| Edge Functions (`_shared` + 5) | present |
| Migration evidence archive | intact - 3,641,558 B, sha256 `EDE09842…206912` |
| `.env` / `*.jks` / `*.keystore` / `keystore.properties` tracked | none (3 tracked files total) |
| HEAD | unchanged at `7bffe33` |

One honest note: an unrelated **MySQL80** Windows service is listening on 3306/33060. JibonJori
references MySQL nowhere and uses PostgreSQL/Supabase, so it is not a project dependency. It was
not stopped, because it is not ours.

## C. Local gates re-run (all green)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | 142 / 142 |
| `npm run test:deploy` | 16 / 16 |
| `npm run test:release-gate` | 21 / 21 |
| `npm run test:apk` | SKIP - no APK exists, which is correct with no cloud configuration |
| RLS suite (host PostgreSQL 18.6) | 124 / 124 |

## D. Security re-scan

The fresh 24-chunk bundle is clean of `service_role`, `sb_secret_`, `sk-`, `AIza`, Postgres URIs,
`JWT_SECRET`, private-key material, RFC1918 origins and the removed `VITE_` variables. Three
source lines were flagged and each was inspected and found benign: a placeholder URI shape in a
`cloud.mjs` help message, the synthetic `sb_secret_SYNTHETIC_N0tACredential` fixture that exists
to prove the release gate rejects secret keys, and the well-known throwaway local-stack default
in the CI workflow.

## E. Status after this attempt

No status above changes. `PHONE-INDEPENDENT BACKEND: NOT VERIFIED`, for one reason only: there is
no Supabase project. The application-side readiness is unchanged and complete.

**What must be provided** (the exact shortest list - see §16 for where each value lives):

1. Supabase **project reference**
2. Supabase **Project URL**
3. Supabase **anon / publishable key**
4. Supabase **service-role key** (server-side only)
5. Supabase **database password**
6. Dashboard: **Confirm email** enabled; **Site URL** and **Redirect URLs** set (including
   `https://localhost` for the Android WebView)
7. Optional, independent: an `LLM_API_KEY`, a Google Maps browser key, and an Android release
   keystore. None blocks the acceptance test; each degrades to a documented state.

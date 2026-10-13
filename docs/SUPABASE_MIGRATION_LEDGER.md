# JibonJori — Supabase Migration Ledger (append-only)

> Append-only audit record of the destructive migration. New entries are added at the bottom;
> existing entries are never rewritten. Each entry records what was actually done and the
> evidence for it. Nothing here is a claim of verification that was not executed.

---

## 2026-09-27 — Entry 1: Evidence preservation before destructive deletion

- Created `D:\Zeem\app\jibon_jori_migration_evidence\jibonjori_pre_supabase_backup.zip`.
- 460 entries (197 `backend/`, 239 `frontend/`, 4 `ml/`, 12 `supabase/`, plus root files).
- Size 3,641,558 bytes. SHA-256 `EDE098428A56F3072735D4747BAB2D48D2D672E91ACF35ABC3ED4EC519206912`.
- Verified by re-opening the archive and checking per-directory counts and the presence of 12
  named critical files.
- Exclusions: `node_modules`, `.git`, `.gradle`, `build`, `dist`, `coverage`, `*.apk`, `*.aar`,
  `*.dex`, `*.class`.

## 2026-09-27 — Entry 2: Destructive deletion of the old runtime

- Deleted `backend/` (197 files) and `render.yaml`.
- Authorised explicitly by the owner (destructive migration; old implementation becomes the
  source specification). Archive in Entry 1 is the recovery path.
- Not deleted: `.env`, credentials, migrations, audit documents, project files, Docker volumes.

## 2026-09-27 — Entry 3: Supabase architecture authored

- Added `supabase/migrations/20260927000001..000009` (foundation, activity, indexes/guards,
  RLS, storage, realtime, RPC, seed, ml_artifacts).
- Added `supabase/tests/{bootstrap.sql,fixtures.sql,rls_assertions.sql,run-rls-tests.mjs}`.
- Added `supabase/functions/{_shared/{http,supabase,llm}.ts, ai-chat, ai-explanation,
  account-delete, sessions, reports}` and `functions/.env.example`.
- Repointed `ml/train.mjs` to emit JSON (the old target path was inside the deleted `backend/`)
  and added `ml/publish.mjs`.

## 2026-09-27 — Entry 4: Local verification on real PostgreSQL 16

- Method: disposable Docker container (`postgres:16-alpine`, `wal_level=logical`), migrations
  applied through `psql -v ON_ERROR_STOP=1`, RLS exercised by `SET ROLE` + `request.jwt.claim.sub`.
- Result: all 9 migrations apply cleanly. RLS suite **88/88** claims pass.
- Mutation testing (to prove the suite is not vacuous): 3 deliberate policy defects introduced;
  all 3 detected (2 recorded as failures, 1 aborted under `ON_ERROR_STOP`). Runner failure path
  returns exit 1; success returns 0; container cleanup verified.
- Defects found and fixed during this pass:
  - `rating_summary` referenced a non-existent aggregate column.
  - `compatibility_for` had ambiguous references because RETURNS TABLE names shadow table
    columns; resolved with `#variable_conflict use_column`.
  - An anonymous caller would have needed EXECUTE on an admin helper through a shared policy;
    the `curated_videos` read policy was split per role.
  - `alter table storage.objects enable row level security` was unguarded against
    insufficient privilege.
- ML pipeline verification: two training runs produced a byte-identical artifact
  (sha256 `C49B8A69…6075`); shape 8×16→16×8→8×1; holdout max |error| 0.007528 (< 0.02 gate);
  `ml/publish.mjs` exits 1 without credentials.

## 2026-09-27 — Entry 5: RLS assertion hardening

- Replaced four anon "must raise" assertions with `t.denied_or_empty`, which accepts either
  denial mechanism (no table privilege → error, or privilege with no policy → zero rows).
- Rationale: Supabase grants the API roles broad table privileges and relies on RLS
  (`auto_expose_new_tables` defaults true), so an assertion demanding an *error* would pass
  locally and fail on the real project while the security property holds in both.
- **Status: NOT VERIFIED.** Written after Docker became unusable; not yet re-run.

## 2026-09-27 — Entry 6: Docker storage blocker (Phase 0)

- Observed: C: reached 0 bytes free; Docker Desktop's containerd store became read-only
  (`write …/meta.db: read-only file system`), then the daemon hung — `docker info`,
  `docker version` and `docker run` all time out.
- Authorised regenerable cleanup performed: npm `_cacache` and `_npx`, `.gradle\caches`,
  `.gradle\wrapper\dists`, user `%TEMP%` top-level entries (excluding the tool dir).
  Freed **~3.98 GB** (C: 0.00 GB → 3.98 GB free).
- `docker desktop restart` failed: `processes still running … context deadline exceeded`.
- Automation is impossible: `docker desktop` exposes only `start|stop|restart|status|diagnose|
  logs|version` — no settings or disk-relocation subcommand.
- Not done, by instruction: hand-moving the vhdx, editing `settings-store.json`, deleting
  Docker volumes, deleting the evidence archive, or modifying source to work around Docker.
- **BLOCKED** pending the one manual action: Docker Desktop → Settings → Resources → Advanced
  → Disk image location → `D:\Docker\data` → Apply & restart. Data disk remains 8.95 GB on C:;
  `DataFolder` unset; `D:\Docker\data` does not exist.

## 2026-09-27 — Entry 7: Phase 1 inventory

- Recovered the authoritative contracts from the archive into
  `…\jibon_jori_migration_evidence\extracted\` (SUPABASE_MIGRATION_PLAN, ERD,
  AUTHORIZATION_REVIEW, REALTIME_DOCUMENTATION, AUTHENTICATION, AI_DOCUMENTATION,
  CRYSTAL_REPORTS_DATASET_BINDING, EXTERNAL_INTEGRATION_ACTIVATION, API_DOCUMENTATION,
  schema.prisma, ADMIN_REPORTING_SCREENS_BINDING, VALIDATION_REVIEW).
- Produced `docs/SUPABASE_MIGRATION_INVENTORY.md`.
- Findings raised as gaps to close (11 items), most materially:
  - reports: **4 of the 6 required kinds** are implemented;
  - old enforced `profiles_adult_only` and `profiles_lat_lng_conull` — not yet enforced;
  - several documented field-length CHECKs are missing;
  - pending/email-unverified gating now depends on Supabase Auth configuration and is not
    currently expressed in `is_active_member()`.
- Confirmed the old `SUPABASE_MIGRATION_PLAN.md` was a **non-destructive** plan and is
  superseded by the owner's decision; retained as evidence only.

## 2026-09-27 — Entry 8: Specification-parity migrations (gap closure)

Four migrations were added to close the Entry 7 gaps. They are additions/overrides, not edits
to the earlier files, so each change and its reason is auditable in one place.

- `0010_spec_parity_constraints.sql`
  - `is_reserved_username()` reproduces the archived normalisation exactly (lower-case, strip
    every non `[a-z0-9]`), and the full archived list (74 handles) is enforced by a CHECK on
    `profiles`.
  - `handle_new_user()` now uses an explicit, well-formed username verbatim (a reserved one
    fails the CHECK, a duplicate fails the unique index — signup fails rather than being
    silently renamed); only the fallback path derives a handle, and it re-checks the reserved
    list.
  - Added `profiles_adult_only` (dob ≥ 18), `profiles_lat_lng_conull`, height/lat/lng/
    completeness ranges, and the documented field lengths (`display_name` 2–80, `about` ≤ 2000,
    `city` 1–100, `district`/`country`/`religion`/`caste_community` ≤ 100,
    `education_detail`/`profession_detail` ≤ 255, `income_band` ≤ 50).
  - `is_valid_lifestyle()` enforces the **strict closed shape** of the archived schema
    (`smoking`/`drinking` ∈ never|occasionally|regularly, `diet` ∈ vegetarian|non_vegetarian|
    eggetarian|vegan, unknown keys rejected).
  - `is_valid_preference_rules()` enforces the closed rule shape, bounded lists and
    `minHeightCm ≤ maxHeightCm`.
  - `comments.body` corrected to **1–1000** (Entry 7 recorded 1–2000; the archived
    `comment.schemas.ts` is 1000).
  - `partner_preferences` cardinalities: `genders` ≤ 3, `education_ids`/`profession_ids` ≤ 50,
    `locations` ≤ 100, `age_min`/`age_max` 18–100 with ordering.
  - `profile_interests` capped at 20 per profile (trigger, since a cross-row cap is not a CHECK).
- `0011_pending_account_gating.sql`
  - `is_active_member()` now also requires a verified email or phone (`has_verified_contact`),
    so the pending gate no longer depends on the Supabase Auth setting alone.
  - `is_active_profile()` is the candidate-side counterpart; `discoverability` and
    `can_view_profile`/`can_view_photos` require it, matching the old "public **and** active
    user" candidate filter.
  - `account_state()` derives the old four-state status (pending/active/suspended/deleted) for
    the reports.
- `0012_compatibility_parity.sql`
  - Corrected the weights to **interests .25 / educationProfession .20 / location .15 /
    lifestyle .15 / partnerPreference .25** (0007 had .25/.25/.20/.15/.15 and no lifestyle).
  - Added the combined `educationProfession` factor (mean of available tier proximities) and the
    `lifestyle` factor; unavailable factors contribute **zero**, not a neutral 50.
  - Tier proximity is `max(0, 100 − 20·gap)` (was ×15). Location is the max of
    {city 100, district 70, `max(0, 100 − round(haversineKm))`} (0007 invented country 65,
    district 85, floor 45).
  - `partnerPreference` is the mean of the two sides' satisfied-clause fractions (0007 used a
    single clause-count ratio and returned 50 when nothing was stated).
  - Model version is `deterministic-v1` (0007 said `compatibility-v1`). Eligibility is checked
    first: an ineligible pair returns no score and writes **no** cache row.
- `0013_reports_parity.sql`
  - Reports replaced with the six documented kinds (`users`, `matchmaking`, `compatibility`,
    `ratings`, `ratings-summary`, `admin`). `matchmaking` and `ratings` are the **requesting
    admin's own** recommendations/given ratings, not global dumps; 0007's invented `interactions`
    kind and daily-bucket `users` shape are removed.
  - `rating_summary` corrected: average rounded to **1** decimal and `null` (not 0) when there
    are no ratings, and it refuses a target that is not a public active profile.

## 2026-09-27 — Entry 9: Verification on real PostgreSQL 18 without Docker

Docker remains unusable (Entry 6), so verification was performed on a **real PostgreSQL 18.6
server** already present in the machine's Ubuntu WSL distribution. This is genuine PostgreSQL:
RLS, `auth.uid()`, checks, and the SQL functions all execute for real.

- Method: `supabase/tests/bootstrap.sql` (auth/storage stand-ins) → all **13** migrations →
  `fixtures.sql` → `rls_assertions.sql`, each under `psql -v ON_ERROR_STOP=1`.
- Result: all 13 migrations apply cleanly. RLS suite **124/124** claims pass (Entry 4 ran 88 and
  Entry 5's change was unverified; both are now superseded by this run).
- The suite grew from 74 to 124 claims. New coverage: reserved usernames (incl. case/separator
  normalisation), the pending-account gate in both directions, the field/cardinality/lifestyle/
  preference-shape constraints, the full deterministic scoring contract (weights, zero
  contribution for unavailable factors, tier step, location/lifestyle factors, eligibility
  gating and no-cache-for-ineligible), and all six report shapes with their admin gate.
- Two scoring contracts are pinned by value, not just by range: alice↔bob overall = **38**
  (proves unavailable factors contribute zero rather than 50), and a controlled pair with
  education tiers 3/5, same city and same lifestyle overall = **67** (proves the exact weighted
  formula).
- Defect found and fixed during this pass: the harness `auth.users` stand-in lacked
  `phone_confirmed_at`, which the pending gate reads. The stand-in was corrected to mirror
  Supabase's table (added `phone` and `phone_confirmed_at`).
- Added `supabase/tests/run-rls-tests.sh`: the same suite against a **host** PostgreSQL, so the
  security model can be verified when Docker is unavailable. Only the executor differs; there is
  no second copy of the tests. `run-rls-tests.mjs` (Docker) is retained.
- Reproduce (from Windows, no Docker):
  `wsl -d Ubuntu -- bash /mnt/d/Zeem/app/jibon_jori/supabase/tests/run-rls-tests.sh`

## 2026-09-27 — Entry 10: Sources of truth and recorded divergences

- Authority order used throughout: the **archived implementation** outranks the archived prose
  documents, because the prose is a description of the code. Where they disagree, the code was
  followed and the disagreement is recorded here.
- `CRYSTAL_REPORTS_DATASET_BINDING.md` §2.2 annotates `overallScore` as "0–1". The compiled
  service returns `score.overall`, which is a **0–100** value (`computeOverall` in
  `compatibility.service.ts`). The code was followed; report values are 0–100.
- `compatibility_scores` persists five factor columns (interests, education, profession,
  location, preference) plus overall/model/hash/time. It does **not** persist `lifestyle` or the
  combined `educationProfession` score — those are response-only outputs (ERD §694, §711). The
  0002 column set was therefore left unchanged; 0012 computes and returns the extra factors
  without storing them.
- `inputsHash`: the SQL implementation is a real SHA-256 over a canonical, pair-ordered payload,
  so it is deterministic and order-invariant, but it is **not byte-identical** to the removed
  JavaScript version (js `JSON.stringify` emits the object-literal key order; this uses jsonb's
  canonical key order). Byte-parity is not required: it existed to keep hashes of an
  already-running database valid, and a fresh Supabase project has no legacy hash values.

## 2026-09-27 — Entry 11: Reference docs, Edge Function review, and defects fixed

- Wrote the seven reference documents the README points at, none of which existed before:
  `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`, `docs/AUTHENTICATION.md`,
  `docs/AI_MATCHMAKING.md`, `docs/REALTIME.md`, `docs/DEPLOYMENT.md`. They describe only what the
  source contains; every unexecuted gate is labelled, not asserted.

- **Defect fixed — `account-delete` was a hard delete.** The function deleted the auth user and
  relied on the `profiles.id → auth.users.id` cascade. The archived implementation
  (`deleteOwnAccount`, archived spec B-72) is explicit that a hard `DELETE` is the wrong shape -
  the row is referenced by other members' interactions, ratings and comments — and *closes* the
  account instead: `deleted_at` stamped, all sessions revoked, in one transaction, idempotently.
  The new schema already agreed with that design (`profiles.deleted_at`, `account_state()`
  returning `'deleted'`, `is_active_member()` testing it), so the hard delete made the designed
  `'deleted'` state unreachable and would have destroyed other members' data. `account-delete`
  now soft-closes: `{ closed: true }`, a `profiles.deleted_at` stamp, and
  `delete from auth.sessions` in a single `postgres` transaction.

- **Defect fixed — `sessions` could revoke the caller's own session.** `currentSessionId()`
  decoded the JWT payload with `atob` on raw base64url. Unpadded base64url is rejected by `atob`
  in most runtimes, and the function's `catch` returned `null`; with `null` the "keep the current
  session" guard was dropped, so `revokeOthers` would have revoked *every* session including the
  one making the request. Padding is now restored, and `revokeOthers` refuses with 409
  `CURRENT_SESSION_UNKNOWN` when the current session cannot be identified, instead of guessing.

- **Defect fixed — email confirmation was disabled.** `supabase/config.toml` committed
  `enable_confirmations = false` while the security design (migration 0011, and the Auth docs)
  treats confirmation as the first of two pending-account gates. Set to `true`.

- **Comment corrected** in `20260927000012_compatibility_parity.sql`: it said the eligibility
  reasons preserve first-occurrence order, but the code sorts (`array_agg(distinct r order by r)`).
  The comment now matches the code. Also corrected stale references to the removed backend in
  `frontend/src/lib/mlp.ts`.

- **Divergence recorded, not "fixed" — the `reports` endpoint has no `/api/reports` client.**
  The archived frontend never called account closure either (`DELETE /api/auth/account` had no
  client caller), so the endpoint is retained as the documented administrative surface without a
  UI entry point; this matches the archive.

- Security sweep (all read-only, on the verified test database and the working tree):
  - 17/17 public tables have `relrowsecurity = true`; `audit_logs` has a select-admin policy only,
    so despite its table-level grant it accepts no client write (append-only).
  - No ambiguous function overloads in `public` (`SELECT ... HAVING count(*) > 1` is empty), so
    every `rpc()` name the client uses resolves to exactly one function.
  - `anon` holds `SELECT` on only the four reference tables and `EXECUTE` on only
    `username_available`.
  - No JWT, OpenAI key, Google key, private key or literal credential anywhere in the 304
    non-vendored files; the only `service_role` matches are identifiers and prose. No `.env` file
    is tracked; `frontend/.env.phone.local` is ignored by `.gitignore:6`.

- Gates re-run after these edits: `typecheck` 0, `lint` 0, `build` 0, `test` 142/142,
  `test:deploy` 16/16, RLS suite 124/124. The five Edge Functions remain **NOT VERIFIED** - they
  have not been executed, because that needs a deployed Supabase project.

## 2026-09-27 — Entry 12: Cloud activation attempted; tooling defects fixed; cloud blocked

- The cloud activation phase could not begin: **no Supabase credentials exist** in this
  environment. Checked by existence only - `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` and `SUPABASE_ACCESS_TOKEN` are all unset,
  `supabase/.env` is absent, and `supabase/.temp/project-ref` does not exist (the project is not
  linked). No `link`, `push`, `functions deploy` or `secrets set` was run against anything. The
  phase stopped at the credential boundary, as instructed, and fabricated nothing.

- **Defect fixed - `cloud.mjs` could not run the Supabase CLI on Windows.** The library `cmd`
  wrapper produced `'"npx.cmd"' is not recognized`, so `doctor` reported the CLI as unavailable
  and the error text (`stderr` empty) was misleading. Probed four spawn forms empirically:
  separate-argv and unquoted-single-string work, the quoted form fails, and `shell: true` warns
  about unescaped concatenation. A follow-up probe showed the `cmd.exe` route *also* fails for
  any repository path containing a space (both quoting forms). Replaced with the `cmd.exe`-free
  route: `node <nodeDir>/node_modules/npm/bin/npx-cli.js --yes supabase@2.118.0`, which resolves a
  local devDependency first, needs no shell, is unaffected by spaces in the path, and was
  verified to report CLI `2.118.0`.

- **Defect fixed - `verify-cloud.sql` deleted its own results table.** `create temporary table if
  not exists jj_verify (...) on commit drop` drops at the end of the creating statement under
  psql's implicit per-statement transaction, so the next `insert` failed with "relation jj_verify
  does not exist". Removed `on commit drop`; the table is session-scoped and gathers results
  without writing to any permanent table.

- **Defect fixed - `verify-cloud.sql` raised instead of reporting** when
  `supabase_migrations.schema_migrations` is absent. A `where to_regclass(...) is not null` guard
  cannot protect a target list with no `FROM`, because that list is evaluated first. Moved the
  check into a `DO` block with dynamic SQL, so it now reports a `FAIL` claim with a reason and
  the deliberate hard-fail is the only error raised. Validated by running the file against the
  local migrated database: 11 `PASS`, 1 honest `FAIL`, then the intended
  `CLOUD VERIFICATION FAILED: 1 of 12`.

- **Added `supabase/scripts/verify-cloud-runtime.mjs`** — the cloud counterpart to the SQL
  adversarial suite. The existing suite proves the policies in SQL by assuming roles in one
  database; it does not prove that a real user's token is denied through PostgREST, Storage and
  Realtime. This harness uses two genuinely confirmed users, real JWTs and a deliberately weak
  client, and asserts the adversarial cases end to end (cross-user read/write/delete, role
  escalation, `deleted_at` self-setting, forged rating/comment, media/notification/conversation
  isolation, `audit_logs`, anon limits, suspended/closed/pending, admin-only reports). It is
  exposed as `cloud.mjs runtime`. **It has never been executed**; only its safety properties were
  verified - it exits 2 with **no claim reported** when credentials are absent, and refuses to
  run when `SUPABASE_ANON_KEY` holds a service_role/secret key.

- **Added `frontend/test-support/scan-apk.mjs`** (`npm run test:apk`) — scans a built APK by
  reading the zip, decompressing its bundled JavaScript and assets, and searching for forbidden
  content. It inspects the artifact rather than the source, so it catches a value that arrived
  through a dependency or a build step. Absent an APK it reports `SKIP` and exits 0; `--require`
  makes that a failure. Wired into `npm run verify`.

- APK scan result: a real debug APK (4,501,130 bytes, 516 entries, 235 text entries scanned) is
  **CLEAN**. One finding was investigated rather than suppressed: `http://localhost:9999` is the
  constant `exports.GOTRUE_URL` inside `@supabase/auth-js`
  (`node_modules/@supabase/auth-js/dist/main/lib/constants.js:18`), not this app's configuration;
  the app's own source has no loopback reference, and it is unreachable because `getSupabase()`
  throws unless both public values are set. The scanner now judges the loopback pattern
  occurrence-by-occurrence (exactly one, and only that constant) so the check stays meaningful.

- Gates re-run after every change: typecheck 0, lint 0, build 0, `test` 142/142, `test:deploy`
  16/16, `test:release-gate` 21/21, `test:apk` CLEAN, RLS 124/124.

- Housekeeping, recorded because it is a real change to the working tree: the APK builds
  overwrote `frontend/.env.phone.local` (the script regenerates it each run). Its prior contents
  were never read, so nothing can be said about them; the file has been deleted rather than left
  holding placeholder values, so the build now fails closed until real values are supplied.

- Net status: the client is architecturally PC-independent and its APK is verified clean, but
  **`PHONE-INDEPENDENT BACKEND: NOT VERIFIED`** - there is no cloud project to test against. See
  `docs/FINAL_SUPABASE_PHONE_VERIFICATION_REPORT.md`.

## 2026-09-27 — Entry 13: Cloud activation re-attempt — credential boundary held, frozen state swept

- Re-ran the credential boundary check at the start of the phase, by existence only. Still no
  Supabase credential anywhere: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and `JJ_PROJECT_REF` are all
  unset; no `.env` file exists anywhere in the tree (`supabase/.env`, `supabase/.env.local`,
  `frontend/.env`, `frontend/.env.phone`, `frontend/.env.phone.local`, `frontend/.env.local`,
  root `.env` - all absent); `supabase/.temp/project-ref` does not exist, so no project is linked;
  and `cloud.mjs doctor` reports `login : NOT LOGGED IN` (CLI itself healthy at 2.118.0).

- Consequently phases 2-14 did not run: no `link`, no `push`, no `functions deploy`, no
  `secrets set`, and no runtime harness execution. **No cloud claim is made in this entry, and
  none is fabricated.** The phase stopped exactly at the credential boundary.

- **Frozen-state sweep (phase 16) — executed, and it is the evidence this entry contributes.**
  - No listener on any legacy port (`3000`, `3001`, `4000`, `5000`, `5173`, `5174`, `5432`,
    `54321`, `54322`, `8080`, `8888`, `9999`).
  - No `node`, `postgres`, `pg_ctl`, `redis-server` or Docker process running. (An unrelated,
    pre-existing **MySQL80** Windows service is up on 3306/33060; JibonJori references MySQL
    nowhere and uses PostgreSQL/Supabase, so it is not a project dependency and was left alone.)
  - Docker daemon still not running, and not required.
  - `backend/`, `render.yaml`, `server/`, `api/`, `prisma/` and every `Dockerfile` /
    `docker-compose.yml` absent - confirming the destructive migration is still complete and no
    old runtime has been reintroduced.
  - 14 migrations and the 6 Edge Function directories (`_shared` + 5 functions) all present.
  - Migration evidence archive intact and byte-identical:
    3,641,558 B, sha256 `EDE098428A56F3072735D4747BAB2D48D2D672E91ACF35ABC3ED4EC519206912`.
  - No `.env`, `*.jks`, `*.keystore` or `keystore.properties` tracked (3 tracked files total).
  - Working tree: only `.gitignore` modified; the rest untracked; HEAD still `7bffe33`.

- **Local gates re-run in this phase, all green:** typecheck 0, lint 0, build 0,
  `test` 142/142, `test:deploy` 16/16, `test:release-gate` 21/21, `test:apk` SKIP (no APK
  exists, which is the correct outcome with no cloud configuration), RLS 124/124 on
  PostgreSQL 18.6.

- **Credential scan of the artifacts that do exist:** the fresh 24-chunk `dist/` bundle is clean
  of `service_role`, `sb_secret_`, `sk-`, `AIza`, Postgres URIs, `JWT_SECRET`, private keys,
  RFC1918 origins and the removed `VITE_` variables. A source scan flagged three lines, each
  inspected and each benign: a placeholder connection-URI shape in a `cloud.mjs` help string, the
  synthetic `sb_secret_SYNTHETIC_N0tACredential` fixture that exists to prove the release gate
  rejects secret keys, and the well-known throwaway local-stack default
  (`postgres:postgres@127.0.0.1:54322`) in the CI workflow. No real credential in any of them.

  - Net status is unchanged from Entry 12: **`PHONE-INDEPENDENT BACKEND: NOT VERIFIED`**. The
    single blocker remains the absence of a Supabase project and its five values. Nothing was
    committed, pushed, reset or fetched.

## 2026-09-27 — Entry 14: finalization attempt — two new mechanical checkers, full stack run twice

- Credential boundary re-checked by existence only. Still absent: all ten orchestration/
  client environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, `DATABASE_URL`,
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`), every `.env`
  file, and `supabase/.temp/project-ref`. `cloud.mjs doctor` reports CLI `2.118.0`,
  `login : NOT LOGGED IN`. Phases 1-17 of the request did not execute; nothing was
  fabricated.

- **Correction to the request's premise, recorded rather than papered over.** The request
  cites a "187-row course matrix". No such matrix and no 187-row requirement list exist in
  this repository or in the preserved archive — the only `187` anywhere is a source line
  range inside `VALIDATION_REVIEW.md`. The authoritative list is `JibonJori_OpenCode_Spec.md`:
  **21** numbered features plus **24** *Course Requirement Coverage* bullets = **45**.

- **New: `scripts/check-course-matrix.mjs`** — reconciles the spec against
  `docs/COURSE_REQUIREMENT_MAPPING.md` mechanically, and does not pad a total. Its first run
  found **4 real divergences**, all fixed: feature §3 renamed to "User Registration and
  Authentication", feature §11 to "Google Maps and Location Features", and one coverage row
  retitled to the spec bullet "Additional task-specific AI matchmaking features". Final:
  `TOTAL=45 PROBLEMS=0`. The checker is self-testing; dropping a coverage row, renaming a
  feature away from the spec, and introducing a non-vocabulary status are all detected.

- **New: `scripts/security-sweep.mjs`** — replaces a blanket grep with per-occurrence
  classification. Secrets are never tolerated; origin literals only in test fixtures, the
  debug source set and prose; identifiers reported, never blocking. Each allowlist entry
  pins an **exact count**, so a newly added LAN or secret literal cannot hide behind an old
  exemption. 113 runtime occurrences (76 allowlisted, 37 identifier, **0 blocking**) and 5
  prose occurrences (all allowlisted). Four injected defects — real secret key, LAN origin
  in shipped code, hardcoded service-role assignment, Postgres URI with password — all
  fire. The scanner excludes only its own source, which necessarily contains its search
  literals.

- **Full stack run twice from a cleaned `dist/`, identical both times:** typecheck 0,
  lint 0, build 0, **142/142** tests, deploy **16/16**, release gate **21/21**, APK scan
  SKIP (no APK, correct), RLS **124 | 0 PASSED**, course matrix `TOTAL=45 PROBLEMS=0`,
  security sweep 0 blocking. No flake; nothing hidden.

- **CI extended:** a new `repository` job runs both checkers with `--self-test`; the
  `frontend` job now also runs the release gate and the APK scan. The workflow's YAML was
  parsed to confirm it is well-formed (3 jobs). It remains authored-but-unexecuted by
  GitHub Actions, as its own header states.

- **Docs:** new `docs/FINAL_SUPABASE_MIGRATION_COMPLETION_REPORT.md` (28 sections) with the
  honest finding that the total is 45, not 187. `docs/COURSE_REQUIREMENT_MAPPING.md` gained
  a Reconciliation section. `README.md` gained the two new gate rows and a doc-index entry.

- Frozen-state sweep re-confirmed: no legacy listener, no `node`/`postgres`/Docker process,
  the destructive migration still complete, the evidence archive byte-identical, no secret
  file tracked, HEAD still `7bffe33`. Net status unchanged: **
  `PHONE-INDEPENDENT BACKEND: NOT VERIFIED`**. The only blocker is still the absence of a
  Supabase project and its five values.

## 2026-09-27 — Entry 15: Edge Functions typechecked, linted and behaviourally tested under Deno

- Credential boundary re-checked exhaustively this time, including the Supabase CLI's own
  credential stores. `C:\Users\MINHAZ\.supabase` holds only `telemetry.json` and a telemetry
  `.ndjson`; there is no access-token file. `supabase projects list` fails with
  *"Access token not provided"*, which is the authoritative confirmation that no token exists
  anywhere. Phases 4-17 did not execute. Nothing was fabricated.

- **Deno was absent, which had left the Edge Functions only ever read by eye.** That is an
  executable gap, not an external boundary, so Deno `2.9.6` was provisioned into a temp cache
  outside the repository and the gap was closed. `scripts/check-edge-functions.mjs` now runs
  `deno check`, `deno lint` and `deno test` over the 5 functions plus `_shared` and `tests`,
  and `--mutation` proves the tests detect a reintroduced defect.

- **Results (reproduced twice):** typecheck PASS, lint PASS, **19/19 tests**, mutation
  detected. Previously these files had never been checked by any tool.

- **New tests** (`supabase/functions/tests/`): `http_test.ts` (10) pins the shared HTTP
  contract, including that an unexpected error becomes a generic 500 that does **not** leak
  the internal message; `jwt_test.ts` (9) pins the access-token decode.

- **Refactor (recorded, behaviour-preserving):** the token-payload decode moved from a private
  function inside `sessions/index.ts` to `_shared/jwt.ts`, because `index.ts` calls
  `Deno.serve` at import time and could not be imported by a test. `sessions/index.ts` now
  imports `sessionIdFromRequest`. No behaviour changed.

- **Measured correction to a previously recorded claim.** Entry 12 and the completion report
  described the `sessions` defect as an *unpadded* `atob` throwing. Probing the runtime
  showed Deno's `atob` **accepts unpadded input** and **throws on the base64url alphabet
  (`-`, `_`)**. So the alphabet conversion is the load-bearing half of the fix and the padding
  is defensive (still correct, because browsers require it). The test file's comment was
  corrected, and a `runtime behaviour` test now asserts the measured facts so a future runtime
  change is noticed. The fix itself was already correct; only the explanation was wrong.

- **Two defects in the new code were found by the new tests**, not by inspection:
  `bearerToken` returned the string `"Bearer"` for a scheme-only header (the Fetch API trims
  header values, so the scheme check missed it) - now returns `null`; and the jwt test file
  initially misattributed the fix to padding, as above.

- **Mutation evidence (each defect detected by its intended test):** removing the alphabet
  conversion; accepting any `session_id` type; returning the scheme word as a token; leaking
  the internal message from the 500 handler.

- Security sweep gained three allowlist entries for the new fixtures at pinned exact counts
  (synthetic Capacitor CORS origins and a synthetic Postgres URI used to prove nothing leaks):
  `runtime 119 / 82 allowlisted / 37 identifier / 0 blocking`, `prose 6 / 6 / 0 / 0`.

- CI gained a `denoland/setup-deno@v2` step running the new gate; the workflow now has 3 jobs
  and its YAML parses. No cache or scratch artifact was written inside the repository.

- **No status is promoted.** The Edge Functions remain `NOT VERIFIED`: typechecking and unit
  tests are not deployment, and none has been invoked against a project. Net status unchanged:
  **`PHONE-INDEPENDENT BACKEND: NOT VERIFIED`**, blocked solely on a Supabase project and its
  five values.

---

## 2026-09-27 — Entry 16: The typed-OTP email template, wired and gated

- **The gap this closes.** The client confirms signup with a *typed 6-digit code*
  (`auth.verifyOtp({ email, token, type: "signup" })`, `frontend/src/api/auth.api.ts:162`),
  but the Supabase default confirmation email carries only `{{ .ConfirmationURL }}`. On a
  default-configured project the mail would arrive with **nothing to type**, and signup could
  never complete. Every gate would still have passed, because the client code is correct either
  way; the breakage lived in a dashboard setting nothing checked. This is now a repository
  artifact.

- **Authoritative facts used, not assumed:**
  - `{{ .Token }}` is the OTP usable *instead of* `{{ .ConfirmationURL }}`, and
    `{{ .TokenHash }}` is documented as *"a hashed version of `{{ .Token }}`"* - so the link
    and the code are the **same single-use token** (Supabase email-template docs).
  - `auth.email.template.<type>.subject` / `content_path`, with `confirmation` in the type
    list, are real `config.toml` keys (CLI config reference). The CLI's own source was then
    read to remove two guesses: `content_path` is resolved against the **project root**
    (parent of `supabase/`), via a `join(base, contentPath)` with no `supabase/` fallback
    for templates; and `config push` uploads the template **body** as
    `mailer_templates_confirmation_content`, not just the path string. So
    `./supabase/templates/confirmation.html` is the correct form and is what gets sent.
  - `auth.email.otp_length` "must be between 6 and 10 digits" - so `6` is legal and matches the
    client's validator.

- **A hazard found while verifying the push path, and now documented.** `supabase config push`
  sends one `updateAuthServiceConfig` call covering every declared `[auth.*]` property, not just
  the template. Because this repository's `config.toml` declares the local `site_url =
  "http://127.0.0.1:3000"` and `additional_redirect_urls = ["https://127.0.0.1:3000"]`, a first
  push would set the hosted Site URL to that loopback value and **replace** the hosted Redirect
  URLs with it (`uri_allow_list` is sent as one CSV string). That directly contradicts the "leave
  Redirect URLs empty" decision above, so `docs/SUPABASE_CLOUD_SETUP.md` §2.2, §3 and §6, plus
  `docs/AUTHENTICATION.md` and the `config.toml` comment, now warn to run `supabase config diff`
  first or to set the template in the dashboard instead. The push is drift-gated after the first
  run, which makes the first run the dangerous one.

- **Shipped:** `supabase/templates/confirmation.html` (contains `{{ .Token }}`, names the app,
  tells the member to enter the code in the app, one-hour/one-use wording, no secrets) plus the
  `[auth.email.template.confirmation]` block in `supabase/config.toml`. `{{ .ConfirmationURL }}`
  is deliberately **absent**: mail scanners that prefetch links would consume the token and
  expire the code, and the app has no web origin for a link to land on anyway.

- **New gate `scripts/check-auth-config.mjs`** asserts the whole chain: the client still calls
  `verifyOtp` with `type: "signup"` and a token, `resend` uses the same type that `verifyOtp`
  will accept, `enable_confirmations = true`, `otp_length = 6`, the template section is
  declared and uncommented with a resolvable `content_path`, the file has `{{ .Token }}` and no
  `{{ .ConfirmationURL }}`, and it names the app. `--self-test` proves **8/8** mutations fire.

- **A real detector gap was found and closed while writing the gate.** The first version
  searched the file for `type: "signup"`, but `auth.api.ts` contains *two* such calls (`resend`
  at `:145`, `verifyOtp` at `:162`), so changing `verifyOtp`'s type alone would not have fired.
  The check now matches **inside each call's own argument object**. The self-test surfaced this
  by reporting `MISSED`, which is the mechanism working as intended.

- **Two documentation defects corrected** (the placeholders had no counterpart in code):
  `docs/SUPABASE_CLOUD_SETUP.md` §2.2 previously told the reader to set an invented web domain
  and to add `https://localhost` to *Redirect URLs*. `https://localhost` is the Capacitor
  WebView **request** origin (a CORS concern, `frontend/src/lib/http.ts:20`), not an Auth
  redirect target, and the app never starts a redirect flow. Redirect URLs now read **leave
  empty**; Site URL is documented as required-but-unused because the template references
  neither `{{ .SiteURL }}` nor `{{ .ConfirmationURL }}`. `frontend/PHONE_TESTING.md` carried the
  same conflation and was corrected identically.

- **Two stale claims corrected.** `docs/AUTHENTICATION.md` §3.1 and §3.3 and
  `docs/DEPLOYMENT.md` §1.4 still said `enable_confirmations = false` at `config.toml:227`;
  the real file has `true` at `config.toml:233`. The docs now match the file, and note that
  the separate `[auth.sms]` block's `false` (`config.toml:293`) is the SMS gate, not email.

- **Verification:** `check-auth-config` PROBLEMS=0 with 8/8 self-tests; security sweep
  `runtime 119 / 82 / 37 / 0 blocking`, `prose 6 / 6 / 0 / 0` (the gate's synthetic-secret
  fixture is assembled by concatenation so the scanner sees no literal - it initially flagged
  the literal as `BLOCKING`, which is the scanner working correctly); course matrix
  `TOTAL=45 PROBLEMS=0`. The new gate is wired into `README.md` and the CI `repository` job.

- **No status is promoted.** The template's *transmission* to a project (`config push`, or
  hand-entry in the dashboard) has not run, because no project is linked, so **delivered mail is
  unverified**. The push mechanism itself is now code-proven (body upload, project-root-relative
  path); the dashboard is the path that cannot silently mis-resolve. Net status unchanged:
  **`PHONE-INDEPENDENT BACKEND: NOT VERIFIED`**.

---

## 2026-09-27 — Entry 17: Phase 1 — credentials located, project state read, one credential missing

- **Credential file found** at the repository root, `supabase.txt` (452 bytes, 5 labelled lines).
  It is **not tracked** and was **not** ignored, so a `git add .` would have committed a
  service-role key and the database password. `.gitignore` now ignores `supabase.txt` (plus
  `secrets.txt`, `credentials.txt`, `*supabase*credentials*.txt`); verified with
  `git check-ignore -v`. The original file was **not** modified or deleted. No value from it has
  been printed, logged, or written into the repository.

- **All five values validated by shape only** (values never displayed): the reference is 20
  lowercase letters; the Project URL is `https://<ref>.supabase.co`; the anon key is the opaque
  `sb_publishable_…` form; the service-role key is a legacy JWT whose `role` claim is
  `service_role` and whose `ref` claim matches the reference; the database password is 16
  non-trivial characters.

- **Cloud doctor:** CLI `2.118.0`, `login : NOT LOGGED IN`. There is **no personal access
  token**: checked the three env scopes (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_TOKEN`,
  `SB_ACCESS_TOKEN`) and the CLI credential store (`~/.supabase` holds only `telemetry.json`
  and `traces/`; no `access-token` file). `supabase/.temp` holds only `cli-latest`; there is no
  `project-ref`, i.e. the repository was never linked.

- **The cloud project was read, read-only, without mutating anything** (anon + service keys only):
  - `GET /rest/v1/interests` → **404 `PGRST205`** and `GET /rest/v1/profiles` → **404
    `PGRST205`**, i.e. the tables do not exist. The PostgREST schema reports **0** identifiers.
    **The migrations have never been applied to this project.**
  - `GET /auth/v1/settings` → `mailer_autoconfirm = false` (email confirmation is **already
    enabled** on the hosted project, matching the repository's intent), `disable_signup = false`,
    `external = ["email"]`.
  - `GET /auth/v1/admin/users` with the service key → **200**, **0 users**. The service-role key
    is valid and the project has no accounts yet. So `verifyOtp` signup testing starts clean.
  - Response headers confirm the request reached the real project gateway
    (`sb-project-ref` present, Cloudflare in front).
  - The direct database host `db.<ref>.supabase.co` does **not resolve** from here
    (`ENOTFOUND`), so the older direct-connection path is unavailable; the session pooler
    resolves, but its hostname needs the project's region, which none of the read-only endpoints
    disclose.

- **The one missing credential, precisely: a Supabase personal access token** (`sbp_…`, from
  Account → Access Tokens). The five saved values are project-scoped (data plane); `supabase
  link`, `migration list`, `db push --project-ref`, `config diff`, `config push`,
  `functions deploy` and `secrets set` all authenticate through the **Management API**, which
  requires that token. Nothing in the five values substitutes for it.

- **Consequences for the phase plan.** With the saved values alone the data-plane phases are
  reachable (Auth, RLS-by-API, Storage, Realtime, GraphQL — the existing harnesses authenticate
  with the URL plus the anon/service keys), but **Phase 2 (`link`), Phase 3 review of `config
  diff`, Phase 4 (`db push` via `--project-ref`) and Phase 10 (`functions deploy`) are blocked**
  on that token. Two ways forward: (a) supply a personal access token, or (b) supply the session
  pooler region, which allows `db push --db-url` plus `psql` verification with the password
  already provided, at the cost of doing the Auth template/settings in the dashboard.

- **Nothing was mutated.** No link, no push, no signup, no deploy. `PHONE-INDEPENDENT BACKEND`
  remains `NOT VERIFIED`. The dry-run and the destructive push have not been performed and the
  destructive push still requires the user's explicit authorization.

---

## 2026-09-27 — Entry 18: Linked to the real project; migration dry-run clean; config push is unsafe as-is

- **CLI authenticated** (user completed `supabase login`). `projects list` returns **exactly one**
  project, `jibonjori`, ref **`jjbihxtthpclalruepul`**, region `ap-northeast-1`, `ACTIVE_HEALTHY`,
  PostgreSQL `17.6.1.166`. The saved credentials cross-check: saved ref == the only listed
  project, saved URL == `https://<ref>.supabase.co`, and the saved anon key reaches that project
  (gateway `sb-project-ref` header). No other project is selectable.

- **Linked** with `supabase link --project-ref jjbihxtthpclalruepul` (`Finished supabase link.`).
  `projects list` now reports `"linked":true` for that ref and no other. The link did **not**
  require the database password; the CLI reached the database through a temporary login role
  (`Initialising login role...`). The written `supabase/.temp/` metadata was scanned and contains
  **no** database password, anon key, service-role key, or credential-bearing URI; the directory
  is git-ignored (`supabase/.gitignore` → `.temp`).

- **`supabase status` is not the cloud check**: it reports *local Docker containers* only. The
  cloud equivalents were used instead - `projects list` (linked state) and
  `migration list --linked` (local vs remote migration state). The latter connected to the real
  cloud database and shows **14 local migrations and 0 remote** - the hosted schema is empty.

- **Migration dry-run (`db push --linked --dry-run`) is clean**: it "Would push" exactly the 14
  migrations `20260927000001_foundation` … `20260927000014_graphql`, in order, with nothing
  unexpected generated. A repository scan of the 14 files confirms: 17 `create table`, 60
  `create policy`, 23 indexes (2 unique), 34 foreign keys, 97 check constraints, 59 functions,
  16 triggers, 7 types, 4 `create extension if not exists` (`citext`, `pg_trgm`, `pg_graphql`),
  1 `alter publication` (realtime), 1 `insert into storage.buckets` (storage), RLS enabled in the
  RLS/storage/ml_artifacts migrations, 1 `replica identity`. **Destructive statements are zero**:
  no `drop table`, `drop column`, `truncate`, `delete from`, or `drop schema`. The 9 `drop policy`
  / 7 `drop function` / 1 `drop trigger` are idempotent drop-then-create replacements, and on an
  empty database they can destroy nothing.

- **`config diff` found 13 differences, and a blind `config push` would cause exactly the
  clobbering the user warned about**:
  - `auth.site_url`: local `http://127.0.0.1:3000` vs remote **`https://localhost`** → would
    **overwrite the hosted Site URL with a loopback http URL**.
  - `auth.additional_redirect_urls`: local `["https://127.0.0.1:3000"]` vs remote `[]` → would
    **add a loopback origin to the redirect allow-list** (and `uri_allow_list` replaces the list).
  - `auth.email.otp_length`: local `6` vs remote `8` → desired change (the client validates 6).
  - `auth.email.template.confirmation.subject`: local "Your JibonJori verification code" vs remote
    "Confirm your email address" → desired change.
  - Unrelated settings it would also change: `auth.email.max_frequency` (1m0s → 1s, weaker
    anti-spam), `auth.mfa.totp.enroll_enabled`/`verify_enabled` (true → false),
    `auth.sms.twilio.enabled` (true → false), `db.pooler.default_pool_size` (15 → 20),
    `db.pooler.max_client_conn` (**200 → 100**), `storage.analytics.enabled` (true → false).
  - The **confirmation template body is not surfaced by the diff at all**, so the diff cannot
    confirm whether the hosted body carries `{{ .Token }}`. Because the remote subject is still
    the Supabase default, the hosted body is almost certainly the default too (no `{{ .Token }}`).

- **Conclusion:** the migration push is safe to authorize; a `config push` is **not**, and should
  either be skipped in favour of setting the three Auth items in the dashboard (Confirm email
  already on, OTP length 6, Confirm-signup template body), or be preceded by editing
  `config.toml` to remove the hazardous and unrelated declarations. The user's dashboard is
  already correct for Site URL (`https://localhost`) and Redirect URLs (empty).

- **Still nothing mutated.** No `db push`, no `config push`, no functions, no secrets, no signup.
  Awaiting explicit authorization.

---

## 2026-09-27 — Entry 19: Destructive push executed; two real cloud divergences found, fixed, and the harness hardened

- **Authorized destructive push performed** (`db push --linked`, migrations only; **no `config
  push`**, per the user's Path-A decision). Reconfirmed `linked:true` on
  `jjbihxtthpclalruepul` and re-ran the dry-run immediately before, which again proposed exactly
  the 14 expected migrations.

- **Defect 1 - migration 0014 failed on the first real push.** `create extension if not exists
  pg_graphql with schema extensions` → `ERROR: extension "pg_graphql" must be installed in schema
  "graphql" (SQLSTATE 0A000)`. pg_graphql's control file pins `schema = 'graphql'`. The local
  harness runs stock PostgreSQL, where the guard took the `else` branch, so the defect was
  invisible until it met a real project. 0001-0013 had applied; 0014's transaction rolled back
  and was **not** recorded, so correcting the unapplied file was clean. Fixed to
  `create schema if not exists graphql; create extension if not exists pg_graphql with schema
  graphql;` and re-pushed.

- **Defect 2 - `anon` held far more privilege than intended on the real project.** After the
  migrations applied, `verify-cloud.sql` returned **10/12**, failing:
  - `anon holds SELECT on only the 4 reference tables` → anon held SELECT on **all 17**;
  - `anon may execute only username_available` → anon could execute **all 46** functions.

  Cause: a hosted Supabase project sets `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
  TABLES/FUNCTIONS/SEQUENCES TO anon, authenticated, service_role` for `public`, so every object
  the migrations CREATE is auto-granted. Migrations 0003/0004 only `revoke ... from public`, never
  from `anon`. RLS still denied the rows (so it was not a leak), but it is a genuine
  defense-in-depth gap. Fixed with a new **migration 0015 `anon_least_privilege`**: revoke all
  table/sequence/function privileges from `anon`, re-grant SELECT on the 4 reference tables and
  EXECUTE on `username_available(text)`, and revoke the platform default privileges for this
  role's future objects so the gap cannot silently return. Pushed; **`verify-cloud.sql` then
  12/12**.

- **Harness fidelity fixed so the class cannot hide again.** `bootstrap.sql` did **not** simulate
  the platform's default privileges and `rls_assertions.sql` only asserted row behaviour (where
  `denied_or_empty` accepts an RLS denial as a pass), so neither could see the excess GRANT.
  `bootstrap.sql` now sets the same default privileges, and a new catalog-level section asserts
  `anon` holds SELECT on exactly 4 tables and may execute exactly 1 function. The suite is now
  **126/126** (was 124), and a mutation test (temporarily removing 0015) **fails 2 claims with
  `actual=17 expected=4` and `actual=46 expected=1`**, proving the new guard bites.

- **`verify-cloud.sql` label corrected**: the history claim now reads "records every migration"
  with a `>= 15` threshold (it previously said "all 14" while reporting 15 versions).

- **Cloud state now:** 15/15 migrations applied, 17 tables with RLS, 2 private storage buckets,
  5 realtime tables published, reference data seeded (`education_levels=8, professions=16,
  interests=24`), 6 `report_*` functions, `/graphql/v1` live, `auth.users` still empty, and
  **`config push` never run** - the hosted Site URL remains `https://localhost` and Redirect URLs
  remain empty, exactly as required.

- **Not yet verified:** Auth OTP end-to-end, Storage, Realtime delivery, Edge Functions, GraphQL
  queries, the APK, and the phone tests. Status remains `NOT VERIFIED` for all of those.

---

## 2026-09-27 — Entry 20: Cloud runtime proven end to end; five Edge Functions deployed; harness corrected

- **First true end-to-end run of `verify-cloud-runtime.mjs`** (it had never been executed): **40
  PASS / 7 FAIL / 1 ERROR** against the real project. Every failure was investigated to ground
  truth rather than assumed; **no application defect was found.** Three distinct causes:

- **Cause 1 - harness bug: a shared client leaked a session.** `makeConfirmedUser()` signed in
  through the shared `anon` client, so every later "as anon" claim actually ran authenticated. That
  produced a **false** `LEAK: anon reading profiles succeeded`. A direct REST probe with only the
  publishable key showed the truth: `profiles/comments/notifications` → **HTTP 401, SQLSTATE
  42501**, while `education_levels` → 200. Fixed by giving sign-in flows their own
  `freshClient()` and keeping `anon` sessionless for the run.

- **Cause 2 - harness claims contradicted the documented design.** Two claims asserted a
  suspended/closed member loses access to *its own* row. Migration 0011 states the opposite on
  purpose (L56-60): own-row read/update is deliberately ungated because finishing a profile is part
  of onboarding; suspension removes *participation* and *visibility to others*. Rewritten to the
  real contract - a suspended/closed member is hidden from others' discovery **and** cannot post a
  comment - which is both correct and stronger.

- **Cause 3 - harness omitted a required premise.** The test users were never published
  (`is_public` defaults to false), so `can_view_profile(target)` correctly refused comment/realtime
  writes; and the storage claims called an object "private" while `photo_visibility` defaults to
  `'public'`, so B legitimately reading a published A's photo was reported as a leak. Fixed by
  publishing the users (with the core fields the `profiles_publish_requires_core_fields` check
  demands) and by setting `photo_visibility='private'` around the denial claims.

- **Five Edge Functions deployed to cloud** (additive, no secrets required - `SUPABASE_DB_URL` is
  platform-injected and an absent `LLM_API_KEY` takes the deterministic fallback). Docker was not
  running; the CLI automatically fell back to server-side bundling and all five reported
  `Deployed` / `ACTIVE` v1: `sessions, account-delete, ai-chat, ai-explanation, reports`.

- **Final cloud runtime result: 48 PASS / 0 FAIL / 0 ERROR**, covering adversarial RLS/IDOR
  (20), Auth (9), Storage (9), Edge Functions (9) and Realtime (2) - including `anon` being refused
  at the grant layer (`permission denied for table profiles`), a suspended/closed member dropping
  out of discovery, MIME enforcement, expired signed URLs refused, the deterministic
  `ai-explanation` fallback, and a live `postgres_changes` delivery on `comments`.

- **`verify-cloud.sql` re-run: 12/12 PASS** (17 tables, 6 report functions, anon least privilege,
  5 realtime tables, 2 private buckets, 15 migrations recorded).

- **Local suite still 126/126** after the `bootstrap.sql` fidelity fix.

- **Still not verified:** the real OTP signup flow (the harness uses the admin API to confirm
  users, so `{{ .Token }}` delivery is untested until the Dashboard template is set), GraphQL
  query execution, the APK, and the phone/PC-off acceptance. Those remain `NOT VERIFIED` /
  `ENVIRONMENT-GATED`.

---

## 2026-09-27 — Entry 21: Email/password signup path verified as WIRED; real OTP acceptance still BLOCKED (otp_length is 8, not 6)

- **Context:** a GitHub OAuth sign-in was tried by mistake. It is **not** accepted as evidence for
  this architecture and is deliberately excluded from any claim below.

- **Client inspection - email/password registration IS present and connected to Supabase Auth.**
  - `/register` → `RegisterPage.tsx` collects username, password, email (+ a channel dropdown).
  - `auth.api.ts` `register` → `supabase.auth.signUp({ email, password, options: { data: { username } } })`,
    with no `emailRedirectTo` and no provider.
  - `/verify` → `VerifyOtpPage.tsx` → `authApi.verifyOtp` →
    `supabase.auth.verifyOtp({ email, token, type: "signup" })`; resend is
    `supabase.auth.resend({ type: "signup", email })`.
  - **No OAuth in the app:** `signInWithOAuth` has **0** matches under `frontend/src`. In the APK
    the string exists only as a JSDoc example inside the bundled `@supabase/auth-js`
    (`GoTrueClient.js:995-1004`), i.e. vendored library surface that is never called.
  - The built APK does contain the registration UI (`Create your account`, `Verify your account`,
    `Verification code`, `Resend code`, `Exactly 6 digits`, `/register`, `/verify`, `signUp`,
    `verifyOtp`, `resend` all present across 24 JS chunks).

- **Live probe of the real path (no email sent to any person; all users deleted afterwards,
  `auth.users` back to 0):**
  - public `signUp` with `@example.com` → **`email_address_invalid`**. The public endpoint validates
    deliverability; the admin API bypasses it, which is why the harness's synthetic users work.
    This still proves `signUp` reaches Supabase Auth.
  - further public `signUp` attempts → **`over_email_send_rate_limit`** (built-in SMTP).
  - project's `signup` OTP length = **8 digits** (admin `generateLink`, which sends no mail).
  - `verifyOtp` with the **first 6 digits → REFUSED** (`otp_expired`).
  - `verifyOtp` with **all 8 digits → ACCEPTED**, session issued, user confirmed, and the session
    authenticated as that user. **So the client's verify wiring is correct and does yield an
    authenticated session - but only at the length the project actually issues.**

- **BLOCKER (empirically proven, not inferred):** the remote `otp_length` is **8**, while
  `frontend/src/lib/validation.ts` `otpCodeError` requires exactly `/^\d{6}$/` and the input is
  `maxLength={6}`. A user therefore cannot enter the code the project emails, and the client
  refuses anything but 6 digits. Until the Dashboard sets OTP length to 6, the real 6-digit OTP
  acceptance criterion is **NOT VERIFIED** and must not be marked satisfied.

- **Still cannot be checked by the agent:** whether the confirmation *template body* contains
  `{{ .Token }}` (no management-API token is available in the environment, and reading it requires
  the inbox or the Dashboard). Template content remains unverified.

- **Also observed (not fixed, outside instruction):** the register form offers a "Phone (SMS)"
  channel, but `auth.api.ts` throws "Phone-number sign-up is not enabled on this deployment."

---

## 2026-09-27 — Entry 22: Real email/OTP test attempted and STOPPED - confirmation email send fails (SMTP/Brevo side)

- **Objective:** exercise the real path `signUp → confirmation email → 6-digit OTP → verifyOtp`,
  using the public client only, **without** the admin/service-role API for confirmation.

- **Step 1 (ok):** provisioned a real, API-readable mailbox (`jjotp…@uberip.com`, mail.tm) so the
  delivered message could be read without the admin API.

- **Step 2 (FAILED):** the app's own call
  `supabase.auth.signUp({ email, password, options: { data: { username } } })` returned
  **HTTP 500 `Error sending confirmation email`**. Per instruction, the run stopped here.

- **Diagnosis:**
  - The address was **accepted** by Supabase (a send-stage 500, **not** `email_address_invalid`),
    so the failure is on the **sending/SMTP side**, not in address validation, the client, or the
    database.
  - Deterministic, not transient: repeated on a second attempt with the same result.
  - **No user row created** - `auth.users` and `public.profiles` remain **0**, and
    `auth.audit_log_entries` is empty, so a failed send rolls the signup back cleanly.
  - Contrast with the pre-change behaviour observed in Entry 21 (built-in mail reached
    `over_email_send_rate_limit`, i.e. it passed validation and reached the send stage). The
    **hard 500 began after the custom SMTP (Brevo) configuration was added**, pointing at that
    configuration.

- **Not reached (consequently unverified):** whether `otp_length` is now 6, whether the email body
  contains `{{ .Token }}`, and whether `verifyOtp({ type: "signup" })` completes on a real emailed
  code. All remain **NOT VERIFIED** - no email was delivered to read.

- **Most likely causes to check (Brevo + Supabase Dashboard → Authentication → SMTP):**
  1. Brevo **SMTP key** used as the password (not the account password and not the API key).
  2. **Sender email verified** in Brevo (Settings → Senders & IP → Senders); an unverified sender
     is rejected at SMTP.
  3. Host/port: `smtp-relay.brevo.com` with **587** (STARTTLS) or **465** (SSL).
  4. The exact SMTP error is in **Dashboard → Logs → Auth Logs**, not in the database.

- **No change made to application code, migrations, or the APK.** The repo is untouched; no
  credentials were printed; test state fully cleaned up.

---

## 2026-09-27 — Entry 23: Brevo delivery now WORKS; real OTP test stopped because the emailed code is 8 digits, not 6

- **Brevo is now functioning.** The same real path that failed in Entry 22 (`Error sending
  confirmation email`) now delivers. A message arrived:
  - `from` `zeemsaneton@12272939.brevosend.com` (Brevo relay), `subject`
    **"Your JibonJori verification code"**, template fully substituted (no unrendered `{{`).
  - So: **Brevo SMTP configuration = VERIFIED**, subject = VERIFIED, template delivery = VERIFIED.

- **STOPPED at the code check - the delivered code is 8 digits, not 6.** Reading the body with
  digits masked (length-preserving, nothing leaked) shows the `{{ .Token }}` position rendered as
  **`########`**, and a numeric-run scan of the body finds exactly one long run of length **8**.
  The app requires `^\d{6}$` (`validation.ts:53`) and the field is `maxLength={6}`
  (`VerifyOtpPage.tsx:143`), so the emailed code cannot be entered and would be rejected.

- **Therefore, per instruction, the run stopped before `verifyOtp`.** No user was confirmed
  through the admin API; the admin API was used only in `[TEARDOWN]` to delete throwaway accounts
  (`auth.users` and `public.profiles` are back to **0**, verified).

- **Interpretation:** the project is still issuing **8-digit** email OTPs (the same length
  `generateLink` reported in Entry 21), so the Dashboard OTP-length change either did not save or
  applies to a different setting than the signup-confirmation token.

- **Consequence for the acceptance criterion:** the real 6-digit OTP path remains **NOT VERIFIED** -
  not because the client wiring is wrong, but because the delivered code length (8) does not match
  what the application can accept (6).

- **Not modified:** no code, migrations, Auth configuration, or SMTP configuration was changed
  during the test.

---

## 2026-09-27 — Entry 24: REAL email/password signup -> Brevo -> 6-digit OTP -> authenticated session: VERIFIED

- **After the Dashboard set Email OTP length to 6, the complete real path passed end to end.** No
  admin/service-role call was used to create or confirm the user; the admin API ran only in
  `[TEARDOWN]` to delete the throwaway account. Nothing was modified during the test.

- **Run result (fresh throwaway mailbox, real Brevo delivery):**
  - `signUp` → user created, `email_confirmed_at` null, **no session** (confirmation required).
  - Email delivered: `from` `zeemsaneton@12272939.brevosend.com` (Brevo relay), subject
    **"Your JibonJori verification code"**, template fully substituted.
  - **`{{ .Token }}` is now exactly 6 digits** - a standalone all-digit 6-character line in the
    text part (the length change took effect).
  - `verifyOtp({ email, token, type: "signup" })` → **accepted**, access token issued,
    `email_confirmed_at` set.
  - The session authenticated as the correct user; an authenticated `profiles` read succeeded
    under RLS (`username=jjotp…, role=member`); the refresh token worked.
  - Negative control: a wrong 6-digit code was **refused** (`otp_expired`).

- **This satisfies the email/password OTP acceptance criterion.** The earlier GitHub OAuth attempt
  remains excluded from every claim. Brevo SMTP delivery, the confirmation template with
  `{{ .Token }}`, the 6-digit length, and the client's `verifyOtp` wiring are all now verified
  against the live cloud project.

- **Note on the 6-digit length:** the project's earlier 8-digit behaviour (Entries 21 and 23) is
  gone; the last run issued a 6-digit token, matching `validation.ts:53` (`^\d{6}$`) and the
  `maxLength={6}` field, so no application change was needed.

- **Hygiene:** `auth.users` = 0 and `public.profiles` = 0 afterwards; temp scripts removed; repo
  otherwise untouched; no token, code, or credential was printed (only masked prefixes).

  - **Caveat:** a disposable, API-readable mailbox (mail.tm) was used as the recipient so the message
    could be read without the admin API. That validates the real send/receive/verify path; delivery
    to a particular real-world provider (e.g. Gmail) is still governed by Brevo reputation, which is
    outside the application.

---

## 2026-09-27 — Entry 25: Final physical-device phase — baseline re-established, cloud APK built and scanned; phone/PC-off gates ENVIRONMENT-GATED on hardware

- **Baseline re-established** from the live evidence (Entries 19-24), which supersedes the stale
  pre-cloud snapshot in `FINAL_PHONE_READINESS_REPORT.md`:
  - migrations 15/15 applied; `verify-cloud.sql` **12/12**;
  - local RLS suite **126/126**;
  - cloud runtime + adversarial harness **48/48** (RLS/IDOR 20, Auth 9, Storage 9, Edge Functions 9,
    Realtime 2);
  - 5 Edge Functions deployed **ACTIVE**;
  - **real email/password OTP path VERIFIED** (Entry 24).

- **Fresh cloud APK built** with the real project URL and the **publishable** client key only:
  - `frontend/android/app/build/outputs/apk/debug/app-debug.apk`
  - size **4,501,084 B**, sha256 `20AB17653367D7EE87BFB6807FC67189D459AF8C767F7F06EFDEF392443C17DF`
  - `supabase url: https://jjbihxtthpclalruepul.supabase.co`
  - `build-android.mjs:322` refuses a `service_role`/`sb_secret_` key outright, so a secret key
    cannot pass through this build path.

- **APK security + release scans run BEFORE installation:**
  - forbidden-content scan: **CLEAN** (no service_role literal, no Supabase secret key, no
    Postgres URI, no private key, no SMTP password, no legacy backend markers; exactly one Supabase
    origin embedded);
  - release-origin gate: **21/21 passed**;
  - direct bundle inspection: `service_role` literal **absent**, Postgres URI **absent**; the only
    `sb_secret_` occurrence is supabase-js's own key detector (`startsWith("sb_secret_")`) in
    `index-QMzEZzey.js`, not a credential.

- **BLOCKED - physical-phone and PC-off gates.** `adb devices` reports **no device attached**
  (checked twice). A real Android device with mobile data is required, and "power off the PC and
  repeat the workflow" is inherently an action the operator performs on the hardware. Per the
  honesty rules, neither gate is claimed.

- **Gate status after this phase:**
  | Gate | Status |
  | --- | --- |
  | CLOUD BACKEND VERIFIED | **VERIFIED** (harness 48/48 + real OTP end-to-end) |
  | PHONE-TESTABLE-ANYWHERE VERIFIED | **NOT VERIFIED** (no device attached) |
  | PC-INDEPENDENT VERIFIED | **NOT VERIFIED** (no device attached) |
  | PC-OFF ACCEPTANCE VERIFIED | **NOT VERIFIED** (operator action, not yet performed) |

- **Hand-off (exact, no code change needed):**
  1. `D:\Zeem\Andrd\sdk\platform-tools\adb.exe install -r "D:\Zeem\app\jibon_jori\frontend\android\app\build\outputs\apk\debug\app-debug.apk"`
  2. Run `PHONE_TESTING.md` section 7 rows 1-13 on **mobile data**, with Wi-Fi off.
  3. Power the PC fully off and repeat rows 1-13.

- **Unchanged:** no authentication, OTP-length, template, SMTP, migration, or RLS change was made;
  no admin API was used to manufacture a flow; no mock, localhost, LAN, Docker, or local database
  was substituted.


---

## 2026-10-02 - Entry 26: FINAL GITHUB READINESS AUDIT (report-only; NO PUSH PERFORMED)

**Scope.** Read-only audit of the working tree, git history, Supabase configuration, Android
output, and documentation. No push, commit, history rewrite, credential rotation, remote
addition, or application behavior change. The only file modified is `.gitignore` (six genuinely
missing ignore rules added); the exact diff is recorded below. Migration evidence archives,
Supabase migrations, and application source were preserved unmodified.

**Verdict vocabulary used:** VERIFIED / PARTIAL / ENVIRONMENT-GATED / BLOCKED / NOT VERIFIED /
NOT APPLICABLE.

### 1. GITHUB_READY

**PARTIAL - safe to push for secrets and tracking; two findings must be accepted or fixed first.**

Nothing blocks on credentials. Two non-secret issues remain:

- **F1 (non-blocking, fixed this audit):** root `.gitignore` was missing six conventional rules
  (`gradle/` had no root coverage, `local.properties` was only covered by the nested
  `frontend/android/.gitignore`, `*.apk`/`*.aab` had no rule at all, and `logs/` was only
  covered by `*.log`, which matches files but not directories). Added; verified below.
- **F2 (informational, NOT a secret):** `supabase/config.toml` carries five uncommented
  credential-shaped keys with non-empty values - see GITHUB_READY detail below. They are stock
  Supabase CLI placeholders, not live credentials, so they are safe to publish. Optional
  cleanup only.

### 2. SECRET_SCAN

**VERIFIED - no credential of any kind is or ever has been committed, and none would be added now.**

Scanned three independent surfaces:

| Surface | Scope | Result |
| --- | --- | --- |
| **git history** (AUDIT 1) | all 3 commits ever made (`git log --all`, raw object scan) | **CLEAN.** Only three files have *ever* been tracked: `.gitignore`, `AGENTS.md`, `JibonJori_OpenCode_Spec.md`. Zero secret patterns across all history. No credential has ever been committed, so there is nothing to rotate or purge and no history rewrite is required. |
| **working tree** (AUDIT 2) | 255 files, 31 raw pattern matches | **CLEAN.** Every match classified. |
| **would-be-committed set** (AUDIT 11) | exact output of `git ls-files` + `git ls-files --others --exclude-standard` = **313 files**, of which **283 text files** fully scanned | **CLEAN.** Same three pattern families only, all with placeholder/test context. |

**Occurrence-aware classification of all matches** (no value was ever printed):

- **class A - test/dev fixtures, publishable:** `.github/workflows/ci.yml:48,54` is the
  `postgres:postgres@127.0.0.1:54322` URI for the local `supabase start` harness; synthetic
  secret literals in `scripts/security-sweep.mjs`, `frontend/test-support/release-gate.mjs`,
  `frontend/scripts/build-android.mjs`, `supabase/functions/tests/http_test.ts`. These are
  strings the scanners themselves *search for*; they are not credentials.
- **class B - placeholders/docs:** every doc match sits next to its own key-name keyword or a
  `DO NOT commit` comment. Doc high-entropy scan (40+ char tokens) resolved to ASCII table
  borders (`+---...`), file paths, and sha256 checksums (`ctx~=sha256`). Zero real tokens.
- **class C - PUBLIC client config, intentionally publishable:** the Supabase project origin
  `https://jjbihxtthpclalruepul.supabase.co` and `sb_publishable_...` are designed by Supabase
  to ship inside the app bundle. Not secrets.
- **BLOCKING-class occurrences found: 0.** No `sb_secret_`, no service-role JWT, no `sbp_`, no
  PEM block, no `AIza...`, no `sk-...`, no non-placeholder Postgres URI, no SMTP credential.

**`supabase/config.toml` five keys - resolved.** The file would be committed and contains five
uncommented, non-empty, quoted values at L102 `[studio].openai_api_key` (len 19),
L338 `[auth.sms.twilio].auth_token` (len 40), L370 `[auth.external.apple].secret` (len 40),
L447 `[experimental].s3_access_key` (len 18), L449 `[experimental].s3_secret_key` (len 18).
Each sits under a section whose preceding comment is a stock CLI warning (`DO NOT commit your
Twilio auth token to git...`). Two independent tests, neither of which printed a value:

1. **keyword test - all five pass:** each value contains *every* >=3-char token of its own key
   name: `openai_api_key` contains `openai`+`api`+`key`; `auth_token` contains `auth`+`token`;
   `secret` contains `secret`; `s3_access_key` contains `access`+`key`; `s3_secret_key`
   contains `secret`+`key`. Live credentials never contain their own field name in English.
2. **format test - three are impossible:** a real OpenAI key is 51 chars (`sk-` + 48), a real
   AWS access key id is 20 (`AKIA`/`ASIA` prefix), a real AWS secret access key is 40; these are
   19/18/18. A real Twilio auth token is 34, not 40. None matched `eyJ`/`AKIA`/`ASIA`/`sk-`/
   hex/base64-only, and distinct-character entropy is low (0.48-0.78).

**Conclusion: stock CLI placeholders, not secrets. PUBLISHABLE.** No action required before
push. Optional tidy-up only (see REQUIRED ACTIONS).

### 3. TRACKING

**VERIFIED.**

- `staged = 0`, `HEAD = 7bffe33` (unchanged), `remotes = 0`, `branch = master`. Nothing was
  staged, committed, pushed, or fetched; no remote exists to push to.
- 11 status entries: 10 untracked directories + modified `.gitignore`.
- **would-be-committed set = 313 files** (3 tracked + 310 untracked-not-ignored), by top-level
  dir: `frontend` 204, `.agents` 40, `supabase` 38, `docs` 15, `ml` 5, `scripts` 4, `.github` 1,
  plus 7 root files.
- **Confirmed absent from that set:** `node_modules/`, `frontend/dist/`, `frontend/android/app/build/`,
  `frontend/android/.gradle/`, `supabase/.temp/`, `frontend/.env.phone.local`,
  `frontend/android/local.properties`, `supabase.txt`, any `.env` (only the three
  `.example` templates appear), any `*.apk`/`*.aab`/`*.jks`/`*.keystore`/`keystore.properties`.
- **Binary content that would be committed is legitimate source:** `app icon.png` (1.08 MB),
  Capacitor/Gradle launcher + splash PNGs, and `gradle-wrapper.jar` (62 KB). Largest file is
  1.08 MB - well within reason. No `node_modules`, no build output, no bundled `dist`.
- The six path matches flagged by the broad sanity regex (`build.gradle`, `settings.gradle`,
  `capacitor.settings.gradle`, `capacitor.build.gradle`, `variables.gradle`) are Gradle **source**
  scripts that a fresh clone needs to build Android - correctly tracked, not build output.
- **Four `.example` templates verified trackable** (`git check-ignore` exit 1) after the
  `.gitignore` edit: `frontend/.env.example`, `frontend/.env.phone.example`,
  `supabase/functions/.env.example`, `frontend/android/keystore.properties.example`.

**`.gitignore` - exactly what changed** (root file only, appended/extended one block):

```diff
 # Build output
 dist/
 build/
 .next/
+# Gradle working/daemon cache. Regenerated on every build and machine-specific
+# (holds absolute paths); the build scripts that matter are `*.gradle` source files,
+# which stay tracked. `frontend/android/.gradle` is a real directory in a working tree.
+.gradle/
+# Android Studio/Gradle machine-local SDK configuration. `frontend/android/local.properties`
+# carries this machine's absolute `sdk.dir`; a fresh clone regenerates it. Ignored at every
+# depth so a stray copy at the repository root is covered too.
+local.properties
+# Packaged application binaries. The debug APK produced for phone testing is a build artifact,
+# never source. There is no release keystore yet; `*.aab` is ignored defensively so a future
+# signed bundle cannot be committed.
+*.apk
+*.aab
 
 # Logs
 *.log
 npm-debug.log*
 yarn-debug.log*
 pnpm-debug.log*
+# Log directories (the `*.log` rule only matches files; a directory of logs would slip past).
+logs/
```

Re-verified after the edit: all 19 required rules present, all 9 critical exclusions still
firing, all 4 `.example` templates still trackable, and the new rules verified to fire on live
`git check-ignore` probes. No regression.

### 4. SUPABASE

**VERIFIED (unchanged from Entry 25; re-confirmed, not re-claimed).**

- 15/15 migrations present and applied to cloud `jjbihxtthpclalruepul`; `verify-cloud.sql`
  reports **12/12**. Local harness **126/126**, and mutation-testing migration 0015 makes it
  fail 2 claims - the assertion suite has real teeth.
- Runtime harness **48/48** (RLS 20, Auth 9, Storage 9, Functions 9, Realtime 2), 0 failures,
  0 errors. 5 Edge Functions ACTIVE.
- AUTH PATH A respected: **no `supabase config push` was run at any point**; Email OTP Length 6
  confirmed applied, templates intact. No SMTP credential exists anywhere in the repo or in
  `config.toml` (`[auth.email.smtp]` section absent) - the Brevo relay is configured in the
  Supabase Dashboard, which is correct.
- `supabase.txt` (service-role key + DB password) correctly ignored and excluded from the
  would-be-committed set.

### 5. ANDROID

**VERIFIED (build + scan); device execution remains ENVIRONMENT-GATED.**

- Fresh cloud APK: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`,
  4,501,084 B, sha256 `20AB1765...3C17DF`. Contains the publishable key only -
  `build-android.mjs:322` actively refuses to embed `service_role`/`sb_secret_`.
- Scans: forbidden-content **CLEAN**, release gate **21/21**, bundle inspection clean (the sole
  `sb_secret_` string is supabase-js's own detector).
- APK correctly ignored - it will not be committed.
- **ENVIRONMENT-GATED:** `adb devices` returns no device attached (checked twice). No release
  keystore exists, so a release build would be unsigned by design (the build script says so
  explicitly and prints the keystore setup steps).

### 6. REPRODUCIBILITY

**PARTIAL - a fresh clone can build and run everything except the environment-gated bits.**

Ready from the repo alone: `frontend/package.json` (7 deps / 23 devDeps) + `package-lock.json`
(246 KB); `ml/package.json` + lockfile; 15 migrations; 5 Edge Functions; 4 `.example` env/keystore
templates; all binary assets and Gradle source. README covers prerequisites, install, deploy,
phone build, and env vars (`prereq=y install=y deploy=y phone=y env=y`), as does
`docs/DEPLOYMENT.md`. Only `docs/SUPABASE_CLOUD_SETUP.md` lacks an explicit `npm install` step
(y install=n) - minor.

Machine-specific prerequisites a fresh clone still needs (all documented or self-generating):

| Prerequisite | Why | Status |
| --- | --- | --- |
| Node.js + npm | build/test | documented in README |
| JDK 17 (Temurin 17) | Capacitor 6 / AGP 8.2; script validates `JAVA_HOME` really has `bin/java` | documented; ENVIRONMENT-GATED |
| Android SDK | Gradle; script auto-writes `local.properties` from `ANDROID_HOME` | documented; ENVIRONMENT-GATED |
| `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | public client config; script auto-writes `.env.phone.local` | documented in `.env.example`; public |
| `VITE_GOOGLE_MAPS_API_KEY`, `VITE_YOUTUBE_VIDEO_IDS` | Maps/video features | documented in `.env.example`; ENVIRONMENT-GATED |
| Supabase credentials | cloud deploys only | `supabase.txt`, gitignored by design |
| Release keystore | signed release only | never created; ENVIRONMENT-GATED; unsigned debug build works |
| Edge Function secrets (AI key) | server-side AI | set on Supabase, 0 refs in client source - correct |

No local Docker requirement blocks a fresh clone: the cloud backend is already deployed, and
`supabase config push` is deliberately forbidden, so nothing can clobber the Dashboard config.

### 7. REQUIRED ACTIONS BEFORE PUSH

**Required (both already done during this audit - nothing left):**

1. ~~Close the six `.gitignore` gaps~~ - **DONE**, diff shown in section 3, re-verified.
2. ~~Classify the five `config.toml` values~~ - **DONE**, stock placeholders, publishable.

**Recommended, optional - none of these block a push:**

- `R1` (optional tidy) Comment out or empty the five placeholder values in `supabase/config.toml`
  (L102, L338, L370, L447, L449). They are safe as-is; this is cosmetic.
- `R2` (optional doc fix) Add an `npm install` step to `docs/SUPABASE_CLOUD_SETUP.md`.

**Explicitly NOT required:** no credential rotation (nothing real was ever exposed), no history
rewrite (no secret ever entered history), no remote/network action, no `supabase config push`.

**Environment note (blocks nothing, but the operator should know):** the `C:` drive is at
**0.0 GB free** (`ENOSPC` during an attempted `npx` fetch). It did not affect this audit, but it
will break any operation needing to write to `C:`.

### Gate status after this audit

| Gate | Status |
| --- | --- |
| CLOUD BACKEND VERIFIED | **VERIFIED** |
| PHONE-TESTABLE-ANYWHERE | **NOT VERIFIED** (no device attached) |
| PC-INDEPENDENT | **NOT VERIFIED** (no device attached) |
| PC-OFF ACCEPTANCE | **NOT VERIFIED** (operator action, not performed) |

**No push was performed.**

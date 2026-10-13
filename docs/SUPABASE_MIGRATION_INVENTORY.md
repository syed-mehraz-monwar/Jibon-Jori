# JibonJori — Supabase Migration Inventory (Phase 1)

> **Status of this document.** This is the Phase 1 inventory of the destructive migration
> from the old Node/Express + Prisma + local PostgreSQL + Socket.IO architecture to a
> Supabase-first BaaS architecture. It records **what the old system was** (recovered from
> the preserved archive, which is the authoritative source specification), **what now
> exists**, and **what is verified versus not**. It does not claim any behaviour is verified
> that has not been executed.
>
> Authority: the owner's decision that the migration is destructive and that the old
> implementation is a *specification*, not a target architecture.
>
> Evidence archive: `D:\Zeem\app\jibon_jori_migration_evidence\jibonjori_pre_supabase_backup.zip`
> (3,641,558 bytes, sha256 `EDE098428A56F3072735D4747BAB2D48D2D672E91ACF35ABC3ED4EC519206912`,
> 460 entries). Extracted reference copies of the specification documents used below live in
> `…\jibon_jori_migration_evidence\extracted\`.

---

## 1. Current repository state (measured)

| Path | Files | Note |
|---|---|---|
| `supabase/` | 24 | 9 migrations, 4 test-harness files, 8 Edge Function files, `config.toml`, `.gitignore` |
| `frontend/` | 239 | React 18 + TS + Vite + Capacitor; data layer still targets the deleted backend |
| `ml/` | 5 | training pipeline, repointed to JSON + Supabase publish |
| `.github/` | 1 | `ci.yml` is entirely tied to the deleted backend — **broken** |
| deleted | — | `backend/` (197 files) and `render.yaml` |

Tracked by git: only `.gitignore`, `AGENTS.md`, `JibonJori_OpenCode_Spec.md`. Everything else
is untracked, which is why the archive was taken before deletion.

---

## 2. Old architecture (source specification)

```
ANDROID / WEB  --HTTP(S) + Socket.IO-->  NODE/EXPRESS  --Prisma-->  PostgreSQL
                                              |
                                              +--> media provider seam (Firebase-shaped, unactivated)
                                              +--> OTP delivery seam (SMTP/Brevo, unactivated)
```

- **Auth**: custom. `users` + `otp_verifications` + `sessions` tables; password hashing;
  OTP stored as HMAC-SHA256; access/refresh JWTs issued by the API; sessions revocable.
- **`users.status`** ∈ `pending | active | suspended | deleted` gated login **and** socket
  establishment. Registration produced `status = pending`; with no OTP provider the account
  could never become `active`, so **login was impossible** — the documented blocker.
- **Realtime**: Socket.IO, per-user rooms only, no broadcast.
- **Media**: metadata in PostgreSQL (`firebasePath` — actually a storage *key*), bytes were to
  go to a private bucket via a provider seam. Never activated: uploads answered
  `503 STORAGE_NOT_CONFIGURED` and a metadata-only fallback existed.
- **Reports**: 6 admin-gated JSON datasets for Crystal Reports.
- **AI/ML**: deterministic compatibility in the service layer; an MLP distilled from it,
  executed **on-device**; an LLM explanation and chatbot, both behind provider seams.

### 2.1 Data model — 19 models, 10 enums

`User`, `OtpVerification`, `Session`, `Profile`, `PartnerPreference`, `Interest`,
`ProfileInterest`, `EducationLevel`, `Profession`, `Media`, `Interaction`, `Rating`,
`Comment`, `CompatibilityScore`, `Notification`, `ChatConversation`, `ChatMessage`,
`AuditLog`, `CuratedVideo`.

Enums: `Role(member,admin)`, `UserStatus(pending,active,suspended,deleted)`,
`OtpChannel(email,phone)`, `OtpPurpose(register,login,reset)`, `Gender(male,female,other)`,
`MaritalStatus(never_married,divorced,widowed,annulled)`,
`PhotoVisibility(public,members,private)`, `MediaKind(photo,document)`,
`NotificationType(like,comment,rating,match,security,system)`,
`ChatRole(user,assistant,system)`.

Documented object counts: 20 base tables, 60 indexes, 22 FKs, 20 CHECK constraints,
4 partial indexes, extensions `citext,pg_trgm,pgcrypto`.

### 2.2 Old REST surface (16 groups)

`/api/auth`, `/api/profile`, `/api/partner-preferences`, `/api/search`, `/api/matches`,
`/api/compatibility`, `/api/ml-prior`, `/api/llm-explanation`, `/api/interactions`,
`/api/ratings`, `/api/comments`, `/api/notifications`, `/api/media`, `/api/chat`,
`/api/curated-videos`, `/api/reports`, `/api/graphql`, `/api/health`.

### 2.3 Old Socket.IO events

Server → client: `notification:new`, `like:new`, `comment:new`, `rating:new`,
`username:available`. Client → server: `username:check` (with ack), `profile:watch`,
`profile:unwatch`. Plus `connect` / `disconnect`.

### 2.4 Old authorization model (from `AUTHORIZATION_REVIEW.md`)

| Surface | Identity source | Ownership check |
|---|---|---|
| Media | `session.userId` | query scoped by `{ id, profileId }` → **404** |
| Search | `session.userId` | `isPublic + NOT self + active`, DTO allow-list |
| Interactions / Ratings | `session.userId` | composite key includes caller; target public+active |
| Comments | `session.userId` | delete = author only; cross-owner delete → **403** (deliberate, documented) |
| Notifications | `session.userId` | scoped by `profileId`; foreign id indistinguishable from unknown → **404** |
| Compatibility / ML prior / LLM | `session.userId` | self rejected; target public+active |
| Chat | `session.userId` | owner-scoped `findFirst` before read **and** write |
| Reports (6 kinds) | `session.userId` | `assertAdmin` re-reads `role` from DB |
| Curated videos | read: any member; write: admin | — |
| `ml-prior/model` | `requireAuth` | fixed non-user artifact |

### 2.5 Old validation contract (from `API_DOCUMENTATION.md`)

Constraints the new schema must preserve, several of which the current migrations **do not**
enforce yet (§7):

- `username` 3–32, `^[a-zA-Z0-9_]+$`, **not reserved**
- `password` 8–128
- `phone` E.164 `^\+[1-9][0-9]{7,14}$`
- `displayName` trimmed 2–80
- `dob` — must be a real date and **at least 18 years ago** (`profiles_adult_only`)
- `heightCm` 100–250; `maritalStatus` enum
- `religion`, `casteCommunity` ≤100; `educationDetail`, `professionDetail` ≤255; `incomeBand` ≤50
- `city` 1–100; `district`, `country` ≤100
- `lat`/`lng` finite and in range, **must be supplied together** (`profiles_lat_lng_conull`)
- `about` ≤2000
- `interestIds` ≤20 UUIDs, all must exist, **full replacement set**
- `ageMin`/`ageMax` 18–100 with `ageMin ≤ ageMax`; `genders` ≤3; `educationIds` ≤50
- comment body ≤1000 (per `REALTIME_DOCUMENTATION.md` / `VALIDATION_REVIEW.md`)

### 2.6 Old reports contract (6 kinds — Crystal Reports)

`users`, `matchmaking`, `compatibility` (+`targetProfileId`), `ratings`,
`ratings-summary` (+`targetProfileId`), `admin`. Exact column lists are in
`CRYSTAL_REPORTS_DATASET_BINDING.md` §2. Validation: unknown kind → `VALIDATION_ERROR`;
missing `targetProfileId` on the two that require it → `400`; non-admin → `403`.

### 2.7 Superseded plan

`backend/SUPABASE_MIGRATION_PLAN.md` described a **non-destructive** migration (keep
Node + Prisma + Socket.IO; point `DATABASE_URL` at Supabase PostgreSQL). The owner's decision
supersedes it: that plan is retained as evidence only and is **not** being executed.

---

## 3. Data model mapping (old → new)

| Old | New | Disposition |
|---|---|---|
| `User` | `auth.users` + `public.profiles` | **Replaced by Supabase Auth**; `profiles.id = auth.users.id` |
| `OtpVerification` | — | **Dropped** — Supabase Auth owns email verification |
| `Session` | `auth.sessions` | **Replaced** — refresh rotation native; listing via `sessions` Edge Function |
| `Profile` | `profiles` | Ported (see §7 for gaps) |
| `PartnerPreference` | `partner_preferences` | Ported |
| `Interest`, `EducationLevel`, `Profession` | `interests`, `education_levels`, `professions` | Ported + seeded (8/16/24 rows) |
| `ProfileInterest` | `profile_interests` | Ported |
| `Media` | `media` | Ported; `firebasePath` → `storage_path` with an ownership CHECK |
| `Interaction` | `interactions` | Ported (−1/1/2, no self) |
| `Rating` | `ratings` | Ported (1–5, no self) |
| `Comment` | `comments` | Ported |
| `CompatibilityScore` | `compatibility_scores` | Ported; canonical `a < b`, definer-written only |
| `Notification` | `notifications` | Ported; trigger-written only |
| `ChatConversation`, `ChatMessage` | same names | Ported; client may write `user` turns only |
| `AuditLog` | `audit_logs` | Ported; admin-read only |
| `CuratedVideo` | `curated_videos` | Ported |
| — | `ml_artifacts` | **New** — host for the on-device MLP that previously lived as a TS module |

Enums retained: `user_role`, `gender`, `marital_status`, `photo_visibility`, `media_kind`,
`notification_type`, `chat_role`. Dropped as superseded: `user_status`, `otp_channel`,
`otp_purpose`.

---

## 4. What the new implementation provides

| Concern | Mechanism | Status |
|---|---|---|
| Identity, credentials, verification, sessions | Supabase Auth | Config ready; **unverified** (no stack) |
| Relational data + constraints | 9 SQL migrations | Applies cleanly on PG16; **verified** |
| Authorization | RLS policies + definer guards | 88 adversarial claims pass on PG16; **unverified on Supabase** |
| Media | Storage, 2 private buckets, path-ownership policies | Written; **unverified** |
| Realtime | `supabase_realtime` publication, 5 tables | Written; **unverified** |
| Discoverability/search/recommendations | `search_profiles`, `recommendations` RPC | Written; **unverified** |
| Compatibility | `compute_compatibility`, `compatibility_for` (SQL) | Written; **unverified** |
| Username availability | `username_available` RPC (anon-callable) | Written; **unverified** |
| ML prior | `ml_artifacts` + on-device runtime | Artifact reproducible; **unverified end-to-end** |
| LLM chat / explanation | `ai-chat`, `ai-explanation` Edge Functions | Written; **never executed** |
| Account closure | `account-delete` Edge Function | Written; **never executed** |
| Session management | `sessions` Edge Function over `auth.sessions` | Written; **never executed** |
| Reports | `reports` Edge Function + `report_*` SQL | Written; **4 of the 6 required kinds** (§7) |

---

## 5. Course requirements — how the target satisfies them

| Requirement | Target mechanism |
|---|---|
| React | unchanged client |
| Sass **and** Tailwind | unchanged |
| GSAP / animation | unchanged |
| REST API | **PostgREST** (Supabase-native) |
| GraphQL | **`pg_graphql`** (Supabase-native) — no separate server |
| Real-time commenting / likes | **Supabase Realtime** on `comments` / `interactions` |
| Username availability | `username_available` RPC |
| Email verification | **Supabase Auth** |
| Pagination | `search_profiles` / `recommendations` window counts |
| Rating system | `ratings` + `rating_summary` |
| Embedded audio/video | `curated_videos` (id-only iframe) |
| Google Maps | unchanged client-side key |
| Session management | Supabase Auth sessions + `sessions` function |
| TensorFlow Lite / on-device ML | `ml_artifacts` + `ml/train.mjs` forward pass on device |
| Image/file upload, cloud storage | Supabase Storage |
| Date picker | unchanged `DatePicker` |
| Multiple textboxes/dropdowns | unchanged forms |
| Crystal Reports | `reports` Edge Function datasets (6 kinds required) |
| Docker | Supabase local stack / containerised web image |
| Git/GitHub | unchanged |
| LLM integration | `ai-chat`, `ai-explanation` (keys server-side) |
| AI matchmaking | deterministic SQL scorer + ML surrogate |

---

## 6. What is verified vs not

**VERIFIED (executed)**
- All **14** migrations apply cleanly to real **PostgreSQL 18.6**, all `ON_ERROR_STOP`, on a host
  server inside the machine's Ubuntu WSL distribution (Docker is unusable — ledger Entry 6).
- RLS suite: **124/124** adversarial claims pass on PG18.
- Suite is mutation-tested: three deliberate policy defects are all detected (ledger Entry 4), so
  the suite is not vacuous. Runner exit codes and cleanup verified.
- Deterministic scoring is pinned by value, not just by range: alice↔bob overall **38** and a
  controlled pair overall **67** (ledger Entry 9).
- ML pipeline: byte-identical artifact across two runs; 8×16→16×8→8×1; holdout max |error|
  0.00753 under the 0.02 gate; publisher refuses to run without credentials.
- Frontend suite (new — the client was still the old backend client at inventory time):
  `typecheck` 0, `lint` 0, `build` 0, `test` **142/142** (18 files), `test:deploy` **16/16**.
  This is the rewritten Supabase data layer exercised against an in-memory Supabase double, not
  against a live project.
- Security sweep against the verified test database (ledger Entry 11): 17/17 tables have RLS,
  `audit_logs` has no client write policy, no ambiguous function overloads, `anon` holds only the
  four reference-table `SELECT`s and `username_available`, and no credential literal exists in the
  tree.

**NOT VERIFIED**
- All 5 Edge Functions — never executed.
- Storage policies, Realtime delivery, Auth flows, `pg_graphql` — never run on Supabase.
- The frontend data layer against a **live** Supabase project (it is verified only against the
  in-memory double).

**BLOCKED**
- Everything requiring `supabase start` / `supabase db reset` (Auth, Storage, Realtime, Edge
  Function execution) and the PC-off phone test. Root cause: Docker's data disk is read-only
  (C: full) and the daemon is hung.
- **Partial mitigation:** the SQL/RLS layer is verified on a host PostgreSQL (§10, ledger Entry
  9) and can be re-run without Docker, so the blocker now covers only the Supabase services that
  genuinely need the local stack and the external credentials in §9.

---

## 7. Divergences and gaps to close

These are requirement differences found during this inventory. None is a guess; each cites
the old contract.

1. **Reports: 4 kinds implemented, 6 required.** Need `compatibility` and `ratings-summary`
   (both `+targetProfileId`), plus the documented column lists for all six.
2. **Adult-only not enforced.** Old had `profiles_adult_only` (dob ≥ 18 years ago). The new
   `profiles` has no such CHECK.
3. **lat/lng pairing not enforced.** Old had `profiles_lat_lng_conull` (both or neither).
4. **Field-length CHECKs missing** for `display_name` (2–80), `about` (currently ≤4000, old
   was ≤2000), `city`, `district`, `country`, `religion`, `caste_community`,
   `education_detail`, `profession_detail`, `income_band`.
5. **`interestIds` ≤20** and **`educationIds` ≤50**, **`genders` ≤3** not enforced.
6. **`ageMin`/`ageMax`** are 18–99; old was 18–100.
7. **Reserved usernames** not rejected.
8. **Comment body length** is 1–2000; old documentation says 1–1000 (verify intent).
9. **Pending-account semantics.** Old blocked login *and* sockets for `status='pending'`
   (email unverified). `is_active_member()` currently checks only `deleted_at` /
   `is_suspended`, so **verified-email gating depends on Supabase Auth configuration**.
   This must be enforced deliberately and tested, or an unverified account could act.
10. **`display_name` nullability.** Old required `displayName` on the profile; the new row is
    created at signup before it is known. Publishing already requires it via CHECK, so the
    divergence is bounded, but it is recorded as deliberate.
11. **`is_public` default.** Old defaulted `true`; new defaults `false` (opt-in publishing,
    which also avoids the publish-CHECK rejecting a fresh row). Recorded as deliberate.

## 8. Obsolete references — all resolved

This table was the inventory of backend-era leftovers. Every row has since been closed; the
column on the right records where the fix landed. It is kept as the audit trail, not as a
list of open issues.

| File | Issue at inventory time | Resolution |
|---|---|---|
| `.github/workflows/ci.yml` | Entirely Prisma/PostgreSQL-based; non-functional | Rewritten; backend job deleted, database gate uses the `supabase` CLI |
| `README.md`, `frontend/README.md` | Described the Node/Express/Socket.IO architecture | Rewritten for the Supabase deployment |
| `frontend/package.json` | Depended on `socket.io-client` | `@supabase/supabase-js` added, `socket.io-client` removed |
| `frontend/nginx.conf`, `vite.config.ts` | `/socket.io/` proxy + CSP | Proxies removed; CSP allows `*.supabase.co` / `wss://*.supabase.co`; `test:deploy` asserts no backend-era `VITE_` variable remains |
| `frontend/scripts/build-android.mjs` | `VITE_SOCKET_URL`, LAN-IP injection | Rewritten for the Supabase variables |
| `frontend/test-support/deployment-config.mjs` | Asserted the socket.io proxy | Now asserts the removed variables cannot reappear |
| `frontend/src/lib/{http,graphql,socket,storage,otp}.ts` | Old transports | `socket.ts`/`storage.ts` deleted; `http.ts` reduced to the error contract; `graphql.ts` re-added as a Supabase transport; `otp.ts` unchanged (Supabase Auth) |
| `frontend/src/api/*.ts` (19) | All called the deleted REST backend | All rewritten on `supabase-js`; every export signature preserved |
| `frontend/src/context/SocketContext.tsx`, `hooks/{useRealtime,useProfileRoom,useUsernameAvailability}.ts` | Socket.IO | Reimplemented over Supabase Realtime, value shapes preserved |
| `frontend/src/__tests__/contract-parity.test.ts` | Read `backend/prisma/schema.prisma` | Updated: bans `lib/socket`/`lib/storage`, allows `lib/graphql.ts`, asserts `/graphql/v1` |
| `frontend/src/__tests__/{fake-socket.ts,setup.ts}` | Socket.IO mocks | Replaced by `fake-supabase.ts` |

---

## 9. External prerequisites (hard stops)

1. **Docker usable**, with its data disk relocated to `D:\Docker\data` (currently blocked:
   C: full → read-only store → hung daemon; UI + elevation required). Only needed for the local
   Supabase stack (Auth/Storage/Realtime/Edge Functions) — the SQL/RLS layer is verified without
   it (§10).
2. **For any public/PC-off verification**: a real Supabase project URL + **anon/publishable**
   key, and a **service-role key** (server-side only) to apply migrations and set secrets.
3. **LLM provider key** (`LLM_API_KEY`) for live AI; without it the functions degrade to
   deterministic fallbacks.
4. **Google Maps browser key** for map features.
5. **Android release keystore** for a signed release APK.
6. **Verified sender/domain** in Supabase Auth if email confirmation is to reach real inboxes
   (documented as an activation prerequisite; Brevo is not reintroduced).

No credential is fabricated, and none is printed in this document.

---

## 10. Gap closure (Phase 1 → Phase 3)

Each §7 gap, its resolution, and where it is enforced. All are now covered by the RLS suite
(124/124 on PG18). See ledger Entries 8–10 for the reasoning.

| # | Gap | Resolution | Where |
|---|---|---|---|
| 1 | Reports 4 of 6 kinds | All six: `users`, `matchmaking`, `compatibility`, `ratings`, `ratings-summary`, `admin`, with the documented columns; `matchmaking`/`ratings` are the caller's own rows | `0013`, `functions/reports` |
| 2 | Adult-only not enforced | `profiles_adult_only` CHECK (dob ≤ 18 years ago) | `0010` |
| 3 | lat/lng pairing | `profiles_lat_lng_conull` CHECK | `0010` |
| 4 | Field-length CHECKs | Added for `display_name`, `about` (≤2000), `city`, `district`, `country`, `religion`, `caste_community`, `education_detail`, `profession_detail`, `income_band` | `0010` |
| 5 | Cardinalities | `interestIds` ≤20 (trigger), `educationIds`/`professionIds` ≤50, `genders` ≤3, `locations` ≤100 | `0010` |
| 6 | `ageMin`/`ageMax` 18–99 | Corrected to 18–100 with ordering | `0010` |
| 7 | Reserved usernames | Full archived list (74 handles) with the exact normalisation; enforced by CHECK and rejected at signup | `0010` |
| 8 | Comment body 1–2000 | Corrected to 1–1000 (the archived bound) | `0010` |
| 9 | Pending-account semantics | `is_active_member()` now requires verified email/phone; `is_active_profile()` gates the candidate side; `account_state()` derives the old status. Verified in both directions with a dedicated unverified identity | `0011` |
| 10 | `display_name` nullability | Bounded divergence: nullable at signup, but publishing requires it via CHECK. Recorded as deliberate | `0001`, `0010` |
| 11 | `is_public` default | Deliberate: defaults `false` (opt-in publishing) | `0001` |

Additional parity work discovered while closing the above (not in the original §7 list):
scoring weights/factors (`0012`), `rating_summary` average scale and visibility gate (`0013`),
and the strict `lifestyle` / preference-rule JSON shapes (`0010`).

Found later, in the Edge Function review (ledger Entry 11), and fixed:

| # | Defect | Resolution | Where |
|---|---|---|---|
| 12 | `account-delete` hard-deleted the auth user and relied on the profile cascade | Soft-close per archived spec B-72: stamp `profiles.deleted_at`, revoke all sessions, one transaction, idempotent; returns `{ closed: true }`. Makes the schema's designed `'deleted'` state reachable and stops the cascade from destroying other members' rows | `supabase/functions/account-delete` |
| 13 | `sessions` decoded the JWT payload with `atob` on unpadded base64url; the `catch` returned `null`, which dropped the "keep the current session" guard and let `revokeOthers` log the caller out | Padding restored; `revokeOthers` refuses with 409 `CURRENT_SESSION_UNKNOWN` when the current session cannot be identified | `supabase/functions/sessions` |
| 14 | `supabase/config.toml` committed `enable_confirmations = false`, quietly removing the first of the two pending-account gates | Set to `true` | `supabase/config.toml` |

Documentation added: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`,
`docs/AUTHENTICATION.md`, `docs/AI_MATCHMAKING.md`, `docs/REALTIME.md`, `docs/DEPLOYMENT.md`
(all previously referenced by `README.md` but absent).

---

## 9. Re-check 2026-09-27 (append-only)

Re-verified the inventory against the actual tree:

| Item | Expected | Found |
| --- | --- | --- |
| migrations | 14 | 14, all present |
| Edge Functions | `_shared` + 5 | all present |
| legacy `backend/` tree | removed | absent |
| `render.yaml` | removed | absent |
| `server/`, `api/`, `prisma/`, any Dockerfile / compose file | absent | absent |
| evidence archive | intact | 3,641,558 B, sha256 `EDE09842…206912` |
| tracked secret files | none | none |
| HEAD | `7bffe33` | unchanged |

No cloud credential exists, so §6's not-verified list is unchanged: cloud migrations, cloud
schema/RLS through the API, Auth, Storage, Realtime delivery, all 5 Edge Functions, live
`pg_graphql`, the real-project client build, the signed release APK, and the phone + PC-off
tests all remain `NOT VERIFIED` / `BLOCKED` pending a Supabase project. No entry above was
rewritten and no obsolete reference was reintroduced.

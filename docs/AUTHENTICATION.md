# Authentication

Identity, credentials, email verification and session refresh are owned by Supabase
Auth. The migrated schema has no `users`, `otp_verifications` or `sessions` tables;
`public.profiles.id` is the Supabase Auth user id
(`supabase/migrations/20260927000001_foundation.sql:6-9`, `:81`).

Status vocabulary: VERIFIED, PARTIAL, ENVIRONMENT-GATED, BLOCKED, NOT VERIFIED,
NOT APPLICABLE.

> Evidence note: the database gate below is asserted by the SQL test suite as
> recorded in the existing migration documents. The Supabase Auth service itself was
> never exercised here (no hosted project). No gate was run while writing this
> document.

---

## 1. Client auth surface

All auth calls go through the one Supabase client
(`frontend/src/lib/supabase.ts:23-42`) and are wrapped in
`frontend/src/api/auth.api.ts`.

| Flow | Call | Where |
| --- | --- | --- |
| Register | `auth.signUp({ email, password, options: { data: { username } } })` | `auth.api.ts:109-113` |
| Resend confirmation | `auth.resend({ type: "signup", email })` | `auth.api.ts:145` |
| Verify OTP | `auth.verifyOtp({ email, token, type: "signup" })` | `auth.api.ts:162` |
| Login | `auth.signInWithPassword({ email, password })` | `auth.api.ts:180-183` |
| Refresh | `auth.refreshSession({ refresh_token })` | `auth.api.ts:192` |
| Current user | `auth.getUser()` | `auth.api.ts:204`, `supabase.ts:51` |
| Sign out | `auth.signOut()` | `auth.api.ts:198` |

### 1.1 Signup and username metadata

`register` requires an email and sends `username` (lower-cased) as signup metadata
(`auth.api.ts:100-113`). Phone sign-up is refused on the client
(`auth.api.ts:105-107`). The row in `public.profiles` is created by the
`on_auth_user_created` trigger calling `handle_new_user()`
(`0010:327-353`): a well-formed explicit username is used verbatim, a reserved one
fails the CHECK, and a duplicate fails the unique index — signup fails loudly rather
than silently renaming. Only when no usable username was supplied does
`derive_username` mint one.

Register returns `needsConfirmation = !data.session` (`auth.api.ts:125-136`). The
email is stashed in `sessionStorage` under `jibonjori.pendingEmail`
(`auth.api.ts:241-258`) so the OTP step can read it back.

### 1.2 Email confirmation / OTP

The OTP step uses Supabase Auth's signup OTP: `verifyOtp({ email, token, type:
"signup" })` (`auth.api.ts:157-168`). A `LoginResult` is returned only when both
`data.user` and `data.session` are present; otherwise the client raises
`400 INVALID_OTP` (`auth.api.ts:163-165`).

Because the code is typed by hand rather than clicked, the **confirmation email must
contain the code**. This is not automatic: the Supabase default template carries only
`{{ .ConfirmationURL }}`, so a default-configured project would send an email with
nothing to type and signup could never complete. The repository therefore ships and
pins the whole chain:

| Part | Where | Role |
| --- | --- | --- |
| Template body | `supabase/templates/confirmation.html` | contains `{{ .Token }}`, the code `verifyOtp` expects, and tells the member to enter it in the app |
| Config wiring | `supabase/config.toml` → `[auth.email.template.confirmation]` | `subject` + `content_path` pointing at the template above |
| Code length | `supabase/config.toml` → `[auth.email] otp_length` | `6`, the length the client's input validates |
| Client | `frontend/src/api/auth.api.ts:157-168` | `verifyOtp` with `type: "signup"`; `resend` at `:145` uses the same type |
| Gate | `scripts/check-auth-config.mjs` | fails the build if the template, the config and the client call disagree |

The template deliberately omits `{{ .ConfirmationURL }}`. Supabase documents that URL
as built from `{{ .TokenHash }}`, "a hashed version of `{{ .Token }}`" - the link and
the typed code are the same single-use token. A mail scanner that prefetches links
(Outlook Safe Links, for example) would open it, consume the token, and leave the
member with an already-expired code. The app also has no web origin for a link to
reach, so the link would be dead even where it was not harmful.

This template is a **deployment artifact, not a local one**: it must reach the hosted
project before the OTP flow works end to end. There are two supported ways, and both
were confirmed against the CLI's source rather than assumed:

| Path | What it does |
| --- | --- |
| `supabase config push` | uploads the template **body** (mapped to `mailer_templates_confirmation_content`), not just the path - so the file, not merely its name, is what lands on the project |
| Authentication → *Email Templates* → **Confirm signup** | the dashboard equivalent; Supabase's own docs recommend the dashboard for hosted projects |

`config push` sends **one** `updateAuthServiceConfig` call covering every declared
`[auth.*]` property, not just the template. In this repository that also means the local
defaults `auth.site_url` and `auth.additional_redirect_urls` become the hosted Site URL and
Redirect URLs on the first push (`uri_allow_list` is sent as one comma-separated string, so the
remote list is replaced). Run `supabase config diff` first, or use the dashboard, so the Site
URL / Redirect URLs are not changed by accident. `docs/SUPABASE_CLOUD_SETUP.md` §2.2 has the
detail.

`content_path` is resolved relative to the **project root** - the directory that
contains `supabase/`, not the directory holding `config.toml` - so
`./supabase/templates/confirmation.html` is correct. The CLI joins the content path onto
the project root and applies no `supabase/` fallback for templates (notifications differ).

What remains **unverified is the push itself**, because no project is linked: neither
command has been executed here, so the chain above is verified as repository
configuration, not as delivered mail. Status in §3.3 is `ENVIRONMENT-GATED` accordingly.

### 1.3 Session persistence and refresh

The client is configured with `persistSession: true`, `autoRefreshToken: true`,
`detectSessionInUrl: true` and `storageKey: "jibonjori.auth"`
(`supabase.ts:32-39`), so supabase-js owns token storage and the refresh cycle. The
app no longer stores tokens itself.

`AuthContext` mirrors the Supabase session into React:

- on first load it rehydrates from `auth.getSession()` and then `authApi.me()`
  (`AuthContext.tsx:60-85`);
- it subscribes to `onAuthStateChange` and clears local state on `SIGNED_OUT`
  (`AuthContext.tsx:88-94`);
- it clears local state when the Supabase layer reports an unauthorized session
  (`onUnauthorized`, `AuthContext.tsx:96-97`, `http.ts:40-50`).

### 1.4 Sign-out

`authApi.logout` calls `auth.signOut()` (`auth.api.ts:197-201`). `AuthContext.logout`
always clears local state even if the call fails, and only rethrows a genuine
(non-401) error (`AuthContext.tsx:108-117`). `clearSession` also calls
`disconnectRealtime()` (`AuthContext.tsx:50-54`).

---

## 2. Login by identifier — documented limitation

`LoginInput` accepts an `identifier`, but `signInWithPassword` is only given an
email (`auth.api.ts:170-189`). The comment at `auth.api.ts:174-179` states the
reason: `profiles` is not readable before sign-in (RLS grants it only to
`authenticated`), so a username cannot be resolved to its email client-side. The
identifier is passed straight through as the email, so an email address works and a
username only works if it happens to be the address. This is a documented limitation
of the pure-client architecture, not a bug that was hidden.

The login form's client-side validation message is "Enter your email address."
(`auth.api.ts:172`), consistent with that limitation.

---

## 3. The pending-account gate

The archived application refused a `pending` account twice over: it could not log in
and it could not open an authenticated socket. In the Supabase architecture
verification lives on `auth.users` (`email_confirmed_at` / `phone_confirmed_at`) and
moderation lives on `profiles` (`is_suspended`, `deleted_at`)
(`20260927000011_pending_account_gating.sql:1-28`). The gate is deliberately
**two layers**:

### 3.1 Gate 1 — Supabase Auth configuration

Supabase Auth's `enable_confirmations` setting is described as the first gate: no
session is issued before confirmation
(`0011:11-16`). It is an **Auth project setting**, not a migration.

The committed `supabase/config.toml` has `enable_confirmations = true`
(`config.toml:233`, in `[auth.email]`), with `otp_length = 6` (`config.toml:239`) and a
one-hour `otp_expiry` (`config.toml:241`), so the repository's stated intent matches the
requirement. Note that the separate `[auth.sms]` block has `enable_confirmations = false`
(`config.toml:293`); that is the SMS gate, not email, and does not affect the email path.
Being present in `config.toml` only declares the intent - it takes effect on the hosted
project once pushed (`supabase config push`), or set by hand in the dashboard. Until it is
applied there, Gate 1 is declared but not in force.

### 3.2 Gate 2 — database enforcement

Gate 2 is enforced by migration 0011 and does not depend on the Auth setting:

| Function | Meaning | Source |
| --- | --- | --- |
| `has_verified_contact(p_id)` | the account has a confirmed email or phone | `0011:33-46` |
| `is_active_member()` | the **caller** is verified and in good standing | `0011:62-78` |
| `is_active_profile(p_id)` | the **target** profile belongs to such a user | `0011:85-100` |
| `account_state(p_id)` | derives `deleted` / `suspended` / `pending` / `active` | `0011:106-122` |

`is_active_member()` is a redefinition of the 0004 function: it now requires
`has_verified_contact(auth.uid())` in addition to `deleted_at is null` and
`not is_suspended`. Because every policy already called `is_active_member()`, they
all gained the gate without being individually rewritten
(`0011:48-61`).

Two distinct checks are needed because discoverability requires the *candidate* to
be active, not merely the viewer: the `profiles_select_discoverable` policy was
replaced to add `is_active_profile(id)` (`0011:170-180`), and `can_view_profile` /
`can_view_photos` were redefined to check the target side too
(`0011:130-168`).

What an unverified caller can still do: read and update their **own** `profiles`
row, because those policies use `id = auth.uid()` and do not consult
`is_active_member()` — completing the profile is part of onboarding. What they
cannot do: discover others, appear in discovery, interact, comment, rate, upload, or
open a chat (`0011:52-60`).

`deriveUserStatus` reproduces the same four-state status on the client from the auth
user plus the profile row (`frontend/src/lib/mappers.ts:461-471`), matching
`account_state` semantics.

### 3.3 Gate verification

| Claim | Status |
| --- | --- |
| `is_active_member` is false while unverified | VERIFIED (SQL) — `rls_assertions.sql:473` |
| `has_verified_contact` is false while unverified | VERIFIED (SQL) — `rls_assertions.sql:474-475` |
| `account_state` reports `pending` | VERIFIED (SQL) — `rls_assertions.sql:476-477` |
| a pending member sees only their own profile | VERIFIED (SQL) — `rls_assertions.sql:463-465` |
| a pending member cannot view another public profile | VERIFIED (SQL) — `rls_assertions.sql:467-468` |
| a pending member discovers nobody | VERIFIED (SQL) — `rls_assertions.sql:470-471` |
| a pending profile is not discoverable by a member | VERIFIED (SQL) — `rls_assertions.sql:487-495` |
| Supabase Auth signup / confirmation / refresh / sign-out | **NOT VERIFIED** — requires a hosted project |
| `enable_confirmations` in force | **ENVIRONMENT-GATED** — declared `true` in `supabase/config.toml:233`, applied only on push to a hosted project |
| Confirmation email carries the typed code | **ENVIRONMENT-GATED** — `supabase/templates/confirmation.html` has `{{ .Token }}` and `scripts/check-auth-config.mjs` passes; delivered mail is unverified until a project is configured |

---

## 4. Mapping a Supabase user to the app `User`

`toUser(supaUser, profile)` in `frontend/src/api/auth.api.ts:43-61`:

| App `User` field | Source |
| --- | --- |
| `id` | `supaUser.id` (= `profiles.id`) |
| `username` | `profile.username` → signup metadata → email local-part |
| `email` / `phone` | `supaUser.email` / `supaUser.phone` |
| `role` | `profile.role` (default `member`) |
| `status` | `deriveUserStatus({ is_suspended, deleted_at, email_confirmed_at, phone_confirmed_at })` |
| `emailVerifiedAt` / `phoneVerifiedAt` | `supaUser.email_confirmed_at` / `phone_confirmed_at` |
| `createdAt` | `profile.created_at` → `supaUser.created_at` |

The profile snapshot is read with
`select username, role, is_suspended, deleted_at, created_at` (`auth.api.ts:40`,
`:63-70`). `AuthContext` exposes `isAdmin: user?.role === "admin"`
(`AuthContext.tsx:103`).

---

## 5. Identity safety properties

- The write helpers take the actor id from `requireUserId()`
  (`frontend/src/lib/supabase.ts:50-61`), which reads the verified Supabase user, so
  a forged actor cannot be written.
- The client holds only the public anon key; `env.ts:1-8` documents that no secret
  may go in a `VITE_` variable, and the Android build script rejects a
  `service_role` key before building (`frontend/scripts/build-android.mjs:286-300`).
- The `profiles.role` column is protected by
  `guard_profile_privileged_columns`, so a member cannot promote themselves
  (`0003:40-76`).
- `account-delete` **closes** the account rather than deleting it (archived spec B-72):
  it stamps `profiles.deleted_at` and revokes every session in one transaction, so
  the row is retained for referential integrity while the account stops being
  active (`supabase/functions/account-delete/index.ts`, `docs/API.md` §4.3).

---

## 6. Status summary

| Item | Status |
| --- | --- |
| Client auth wiring (signup, OTP, login, refresh, logout, context) | Written; typechecked/built/tested as part of `npm run verify` per existing migration docs |
| Pending-account DB gate (0011) | VERIFIED (SQL) |
| Pending-account Auth-config gate | ENVIRONMENT-GATED (disabled in committed config) |
| Supabase Auth service behaviour end-to-end | **NOT VERIFIED** (no project credentials) |
| Login by username | PARTIAL / documented limitation: email only in practice |

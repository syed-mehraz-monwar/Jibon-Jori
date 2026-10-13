# Supabase Cloud Setup

This is the activation checklist for a hosted Supabase project. Everything here is manual
dashboard work that no script can do for you, because the values only exist inside your
Supabase account.

Nothing in this document is a real credential. Every value below is a blank or a
placeholder. When you have the values, put them where each section says - never in a file
that is committed.

**Reading order:** §1 (what to copy) → §2 (what to configure) → §5 (the checklist).
§3 and §4 explain what must never leak and what is safe to ship.

---

## 1. Values to copy from the Supabase Dashboard

Open your project at `https://supabase.com/dashboard/project/_`. The section names below
are the dashboard's; exact labels shift occasionally, so the "Where" column also names the
panel it lives in.

### 1.1 Required

| Value | Where | What it looks like | Used by |
| --- | --- | --- | --- |
| **Project URL** | Settings → API → *Project URL* | `https://<project-ref>.supabase.co` | The client (`VITE_SUPABASE_URL`) and every build target |
| **anon / publishable key** | Settings → API → *Project API keys* → the key labelled `anon` `public` (newer projects: *publishable key*) | legacy: a JWT `eyJ...`; newer: `sb_publishable_...` | The client (`VITE_SUPABASE_ANON_KEY`) |
| **service-role key** | Settings → API → *Project API keys* → the key labelled `service_role` `secret` (newer projects: *secret key*) | legacy: a JWT `eyJ...`; newer: `sb_secret_...` | Only you, only on the command line, only for applying migrations and deploying functions. **Never the client.** |
| **project reference ID** | Settings → General → *Reference ID* - or read it straight out of the Project URL (`https://<project-ref>.supabase.co`) | `abcdefghijklmnop` (20 chars) | `supabase link --project-ref`, `supabase functions deploy --project-ref` |
| **database password** | Set when the project was created (Settings → Database → *Database password* to reset) | - | `supabase link` / `supabase db push` when the CLI asks for it, and any direct `psql` verification |

### 1.2 Database connection information - when it is actually needed

You do **not** need to hand-manage connection strings for the normal path. The Supabase CLI
resolves the connection itself once the project is linked, and the hosted platform injects
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` into
every Edge Function automatically (see `supabase/functions/.env.example`).

You need a connection string only for the **read-only cloud verification** in §2.7, which
runs one SQL file directly. Copy it from Settings → Database → *Connection string* →
the **Session pooler** (or *Direct connection*) URI, and put it in
`SUPABASE_DB_URL` for that command only. It contains the database password, so treat it
exactly like the service-role key: shell environment only, never a committed file.

### 1.3 Optional

| Value | Where | Effect if absent |
| --- | --- | --- |
| **Google Maps JavaScript API key** | Google Cloud console (not Supabase) | The location map renders its explicit "not configured" state. Nothing else breaks. Restrict the key by HTTP referrer; a Capacitor WebView sends an origin of `https://localhost`. |
| **LLM provider key** | Your LLM provider (not Supabase) | `ai-chat` and `ai-explanation` fall back to their deterministic templates and report `fallback: true`. They never invent an answer. |

---

## 2. Dashboard configuration

### 2.1 Authentication - email confirmation (required)

Authentication → *Sign In / Providers* → Email:

- **Confirm email** must be **enabled**. The database's pending-account gate
  (`is_active_member()` in `supabase/migrations/20260927000011_pending_account_gating.sql`)
  treats an account as pending until `email_confirmed_at` (or `phone_confirmed_at`) is set,
  and `supabase/config.toml` sets `enable_confirmations = true` to match. These are the two
  halves of one gate: with confirmation off, a new account is verified the moment it signs
  up and the first gate disappears.
- Leave **Allow new users to sign up** on, since registration is a core feature.
- The default Supabase SMTP sender is heavily rate-limited and unsuitable for real use.
  Before real users register, configure a custom SMTP sender (Settings → Auth → *SMTP
  Settings*) on a verified domain. This replaces the old Brevo dependency - no third-party
  auth service is involved, only SMTP delivery of Supabase Auth's own emails.

### 2.2 Authentication - email template, Site URL and Redirect URLs (required)

This app confirms signup with a **typed 6-digit code**, not by opening a link. The client
calls `auth.verifyOtp({ email, token, type: "signup" })` in `frontend/src/api/auth.api.ts`,
so the confirmation **email must carry the code**. The Supabase default template carries only
`{{ .ConfirmationURL }}`, which arrives with nothing to type. The repository therefore ships a
confirmation template containing `{{ .Token }}` and points `config.toml` at it:

- `supabase/templates/confirmation.html` - the template body;
- `supabase/config.toml` → `[auth.email.template.confirmation]` - `subject` + `content_path`;
- `supabase/config.toml` → `[auth.email] otp_length = 6` - the length the client validates.

`supabase config push` (or the equivalent Management API call) deploys these to the hosted
project; entering the same values by hand in the dashboard under
Authentication → *Email Templates* → **Confirm signup** does the same thing. See
`docs/AUTHENTICATION.md` for the full chain and `scripts/check-auth-config.mjs` for the gate
that keeps the template, the config and the client call in agreement.

The template deliberately does **not** include `{{ .ConfirmationURL }}`. That URL is built
from `{{ .TokenHash }}`, which Supabase documents as "a hashed version of `{{ .Token }}`" -
the link and the typed code are the same single-use token. A mail scanner that prefetches
links (Outlook Safe Links, for instance) would open it, consume the token, and leave the
member holding an already-expired code.

Authentication → *URL Configuration*:

| Field | Set it to | Why |
| --- | --- | --- |
| **Site URL** | a valid URL you control, or the value already present | Required by the dashboard, but **never used by this app**: because the template uses `{{ .Token }}` and not `{{ .SiteURL }}` or `{{ .ConfirmationURL }}`, this value does not appear anywhere in the mail the app sends. It is **not** an Android auth callback. |
| **Redirect URLs** | **leave empty** | The app never starts a redirect flow. It has no web origin and no deep link (see below), so there is nothing legitimate to allow-list. This list only widens the allow-list for redirects, so an empty list is the tighter setting. |

The old guidance in this document suggested a placeholder web domain here and told you to
add `https://localhost`. Both were wrong for this app: there is no web deployment, and
`https://localhost` is the **Capacitor WebView origin** - the origin its HTTP requests come
*from*, which matters for CORS (see `capacitorOrigins` in `frontend/src/lib/http.ts`) - and
not a target the user's browser would ever be redirected *to*. Adding it to Redirect URLs
would grant a redirect permission the app never uses.

`supabase/config.toml` ships `site_url = "http://127.0.0.1:3000"` and
`additional_redirect_urls = ["https://127.0.0.1:3000"]`; those are the **local CLI defaults**,
used by `supabase start` on your machine. They are not meant for the hosted project - and this
matters, because `supabase config push` sends the Auth properties this file *declares*, from
one `updateAuthServiceConfig` call, so a first push would:

- set the hosted **Site URL** to `http://127.0.0.1:3000` (`auth.site_url` → `site_url`);
- **replace** the hosted **Redirect URLs** with `https://127.0.0.1:3000` (`auth.additional_redirect_urls` → `uri_allow_list`, joined into one comma-separated string - the CLI sends the whole list, so anything already configured and absent locally is dropped);
- set `enable_confirmations = true` (sent as `mailer_autoconfirm = false`, an inversion), `otp_length`/`otp_expiry` → `mailer_otp_length`/`mailer_otp_exp`;
- upload the confirmation template body → `mailer_templates_confirmation_content`.

The push is drift-gated (only keys that differ from remote are sent), but that does not help
on the first run, when everything differs. So **do not run `supabase config push` blind**:

- either set *Confirm signup* and the URL fields by hand in the dashboard and skip the CLI, or
- run `supabase config diff --project-ref <ref>` first and read exactly what it would change, or
- adjust `auth.site_url` / `auth.additional_redirect_urls` in `config.toml` to values you are happy to have on the project before pushing.

#### Why the app needs no link or deep link

- `frontend/android/app/src/main/AndroidManifest.xml` declares only a `MAIN`/`LAUNCHER`
  intent filter - no `VIEW`/`BROWSABLE` filter and no custom scheme.
- `frontend/capacitor.config.ts` sets no `server` block and no `androidScheme`.
- `signUp()` passes no `emailRedirectTo`, because there is no destination to redirect to.

Confirmation therefore happens entirely inside the app, by typing the code from the email.

### 2.3 Storage buckets and policies (required)

Both buckets are created by `supabase/migrations/20260927000005_storage.sql`, so
`supabase db push` (§3) creates them for you. You do not create them by hand. Verify them
afterwards in Storage → *Buckets*:

| Bucket | Public | Size limit | Allowed MIME types | Rows in |
| --- | --- | --- | --- | --- |
| `profile-photos` | **no** (private) | 5 MiB | `image/jpeg`, `image/png`, `image/webp` | `media` |
| `profile-documents` | **no** (private) | 10 MiB | `application/pdf`, `image/jpeg`, `image/png` | `media` |

Neither bucket is public, so every read is a **signed URL** minted through RLS. The
policies (`jibonjori_photos_select`, `jibonjori_documents_select_own`, and the matching
insert/update/delete-own policies) live on `storage.objects` and are created by the same
migration. Do not add a permissive bucket-level policy in the dashboard: it would sit
alongside the migration's policies and, because policies are additive, widen access beyond
what the migrations intend.

### 2.4 Realtime (required)

Realtime → *Settings*: ensure Realtime is enabled. The publication itself is created by
`supabase/migrations/20260927000006_realtime.sql`, which adds exactly five tables to
`supabase_realtime`:

`comments`, `interactions`, `ratings`, `notifications`, `chat_messages`

`profiles` is deliberately **not** published - username availability is answered by the
`username_available` RPC, and publishing profiles would stream other members' edits for no
feature. The migration also sets `replica identity full` on `interactions`.

Realtime enforces RLS on a `postgres_changes` subscription, so a subscriber only receives
rows the `SELECT` policies already allow. The policies, not the publication, are the
security boundary.

### 2.5 Edge Function secrets (required for the AI functions)

Settings → Edge Functions → *Secrets* (or `supabase secrets set`, §3). The platform
injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_DB_URL` automatically - do not set those by hand.

You must set:

| Secret | Required? | Effect |
| --- | --- | --- |
| `LLM_API_KEY` | optional | Absent → `ai-chat`/`ai-explanation` use deterministic fallbacks and say so |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_MS` | optional | Defaults are in `supabase/functions/_shared/llm.ts` |
| `CORS_ALLOWED_ORIGINS` | **recommended** | Comma-separated exact origins allowed to call the functions from a browser. The Capacitor origins (`https://localhost`, etc.) are always allowed and need not be listed. If empty, only Capacitor origins are permitted. |

### 2.6 Where an allow-list of origins is needed

Three separate lists exist, and they are not interchangeable:

1. **Auth → Redirect URLs** (§2.2) - where a confirmation link may send the browser.
2. **`CORS_ALLOWED_ORIGINS`** (§2.5) - which web origins may call the Edge Functions.
3. **Google Maps key HTTP-referrer restrictions** (§1.3) - which origins may use the map key.

### 2.7 Read-only cloud verification (after activation)

`supabase/scripts/verify-cloud.sql` asserts the cloud state matches the migrations: the 17
tables and their RLS flags, the two buckets, the five published tables, the six `report_*`
functions, the four `anon` table grants, and the `username_available` grant. It only
`select`s. Run it with the `verify` subcommand in §3.

**Do not point `supabase/tests/rls_assertions.sql` at the cloud project.** That suite is an
adversarial harness: `bootstrap.sql` creates a synthetic `auth.users` stand-in and
`fixtures.sql` inserts fake identities. Against a real project, `auth.users` already exists
and belongs to the platform, so running it is both impossible as written and destructive if
forced. To run the adversarial suite in the cloud, create a throwaway project or
`supabase branches` preview branch and run it there.

### 2.8 Adversarial verification through the real API (required for any RLS claim)

`verify-cloud.sql` proves the policies exist. It does **not** prove a real token is denied, so
neither file on its own justifies saying "RLS is verified" about a deployment.

`supabase/scripts/verify-cloud-runtime.mjs` closes that gap. It creates two genuinely confirmed
users, signs in, and attacks from a deliberately weak client: A tries to modify, delete, or
escalate B's profile, forge a rating or comment as B, read B's media, notifications, chat or
`audit_logs`; `anon` tries to read profiles; a suspended, closed and pending account all try to
act; a non-admin calls an admin report. It also covers Auth, Storage (upload, MIME rejection,
signed URL, expiry, cross-user access, ownership deletion), Edge Functions and Realtime.

```
$env:SUPABASE_URL='https://<ref>.supabase.co'
$env:SUPABASE_ANON_KEY='<anon/publishable key>'
$env:SUPABASE_SERVICE_ROLE_KEY='<service_role key>'
node supabase/scripts/cloud.mjs runtime                 # or: -- --only auth|rls|storage|functions|realtime
```

It **writes throwaway test data** (two users, a profile edit, an upload, a comment) and removes
it afterwards; `--keep` leaves it in place. Use a throwaway project or a preview branch, never
production with real members. Every claim it prints is an observation from that run: with no
credentials it exits without reporting anything, and an `ERROR` is never counted as a pass.

---

## 3. Applying everything

`supabase/scripts/cloud.mjs` wraps the CLI with the guards this project needs: it refuses to
mutate without an explicit project ref and `--confirm`, never offers `db reset` against a
cloud project, and supports `--dry-run` to print commands without running them. Run it from
the repository root:

```
node supabase/scripts/cloud.mjs help
node supabase/scripts/cloud.mjs doctor                                   # is the CLI available? (no mutation)
node supabase/scripts/cloud.mjs link --project-ref <project-ref>
node supabase/scripts/cloud.mjs push --project-ref <ref> --dry-run        # show what would be applied
node supabase/scripts/cloud.mjs push --project-ref <ref> --confirm        # apply migrations
node supabase/scripts/cloud.mjs status --project-ref <ref>                # which migrations are applied
node supabase/scripts/cloud.mjs functions --project-ref <ref> --confirm   # deploy all 5 Edge Functions
node supabase/scripts/cloud.mjs secrets --env-file supabase/.env --confirm
node supabase/scripts/cloud.mjs verify                                   # read-only cloud assertions
node supabase/scripts/cloud.mjs runtime                                  # adversarial runtime suite (writes throwaway data)
```

The script resolves the CLI itself: a local devDependency if present, otherwise a pinned
`npx --yes supabase@2.118.0`. Run `doctor` first - it reports whether the CLI is reachable and
whether you are logged in (`npx supabase login`) without touching any project.

`supabase db push` also runs migration `20260927000008_seed_reference_data.sql`, which
inserts the reference data (education levels, professions, interests, curated videos) with
`on conflict do nothing`. Reference data therefore needs no separate seeding step, and
re-running `push` is safe.

Auth configuration (email confirmation, OTP length, and the confirmation template) is a
**separate** push: `supabase db push` does not carry `[auth.*]`. Use
`supabase config push` for it, after `supabase config diff` has shown you what it would
change - see §2.2 for the Site URL / Redirect URLs values it would otherwise overwrite.

---

## 4. What must never be compiled into the APK

An APK is a zip file. Anything in it can be read out with standard tools. Treat every value
in this table as public the moment the APK leaves your machine, and never let the build
script embed any of them.

| Never in the client | Why |
| --- | --- |
| **service-role key** (`service_role`, or `sb_secret_...`) | It **bypasses row level security entirely**. Anyone who unzips the APK would read and write every row. `scripts/build-android.mjs` refuses to build if it detects one - for debug *and* release. |
| **database password** | Direct, unmediated access to the database, past every policy |
| **`SUPABASE_DB_URL` / any Postgres URI** | Contains the database password |
| **JWT secret / `JWT_SECRET`** | Lets anyone forge a token for any user, including an admin |
| **SMTP password, API keys for email delivery** | Sends mail as your domain |
| **LLM provider key** | Bills to your account; it belongs only in Edge Function secrets |
| **Google Maps *server* / *web service* key** | A server key has no referrer restriction and can be abused off-site. Only a *browser* key restricted by HTTP referrer may ship. |
| **Android signing keystore and its passwords** | A leaked release key lets anyone publish an update to your installed app. `*.jks`, `*.keystore` and `keystore.properties` are git-ignored; the template is `frontend/android/keystore.properties.example`. |

Vite only exposes `VITE_`-prefixed variables, and the deployment-config gate
(`npm run test:deploy`) asserts that the client's template, the Dockerfile and `nginx.conf`
declare no variable outside the supported set and contain no credential literal.

---

## 5. Safe to ship in the APK

These are designed to be public. They are baked in at build time, so changing them means
rebuilding the APK.

| Value | Variable | Notes |
| --- | --- | --- |
| Supabase Project URL | `VITE_SUPABASE_URL` | Public HTTPS origin; must not be `localhost`, a private IP or `http://` in a release build |
| Supabase anon / publishable key | `VITE_SUPABASE_ANON_KEY` | Public by design. Access is decided by row level security, not by hiding this key. |
| Google Maps **browser** key | `VITE_GOOGLE_MAPS_API_KEY` | Only if restricted by HTTP referrer. Leave empty to get the explicit "not configured" state. |
| YouTube video ids | `VITE_YOUTUBE_VIDEO_IDS` | Public identifiers |

`frontend/.env.example` is the committed contract for these; `frontend/.env.phone.example`
is the phone-build template. The machine-specific `frontend/.env.phone.local` is
git-ignored.

---

## 6. Checklist

```
SUPABASE PROJECT REQUIRED
[ ] Project URL                       Settings -> API -> Project URL
[ ] anon / publishable key            Settings -> API -> Project API keys -> anon (public)
[ ] service-role key                  Settings -> API -> Project API keys -> service_role (secret)   [server-side only]
[ ] project reference                 Settings -> General -> Reference ID
[ ] database password                 Settings -> Database   (needed by `supabase link` / direct psql)
[ ] required Edge Function secrets    Settings -> Edge Functions -> Secrets
        [ ] CORS_ALLOWED_ORIGINS      (recommended)
        [ ] LLM_API_KEY               (optional; absent => deterministic fallback)

DASHBOARD CONFIGURATION REQUIRED
[ ] Auth: Confirm email               enabled
[ ] Auth: Confirm signup template      body carries {{ .Token }} (dashboard, or `config diff` then push)
[ ] Auth: Site URL                     any valid value (unused by this app; NOT an Android callback)
[ ] Auth: Redirect URLs                leave EMPTY (the app starts no redirect flow; see 2.2)
[ ] Auth: custom SMTP                 configured before real users register
[ ] Realtime: enabled                 (publication created by migration 0006)
[ ] Storage: buckets + policies       created by migration 0005 - verify, do not recreate by hand

AFTER `node supabase/scripts/cloud.mjs push --project-ref <ref> --confirm`
[ ] `... status --project-ref <ref>`          all 14 migrations applied
[ ] `... verify`                              read-only assertions pass
[ ] `... runtime`                             adversarial runtime suite passes
[ ] `... functions --project-ref <ref> --confirm`
[ ] build the APK with the real Project URL + anon key
```

---

## 7. Status of this document

This document describes configuration that has **not** been performed, because no Supabase
project existed when it was written. Nothing here is verified. The SQL layer it references
is verified locally against PostgreSQL 18.6 (RLS suite 124/124); the cloud side -
Auth, Storage, Realtime, Edge Function execution, `pg_graphql`, and cloud migrations - is
**NOT VERIFIED** until 6 has actually been completed against a real project. See
`docs/FINAL_PHONE_READINESS_REPORT.md`.

---

## 8. Re-check log (2026-09-27, appended)

The boundary in §7 was re-checked. Nothing changed, so nothing below is verified:

- No Supabase credential exists in this environment: the six environment variables, every
  `.env` file, and `supabase/.temp/project-ref` are all absent. `cloud.mjs doctor` reports the CLI
  healthy (`2.118.0`) but `login : NOT LOGGED IN`.
- One difference from the first check: the Supabase CLI **is** now reachable
  (`npx-cli.js` route), so `doctor`, `link`, `push`, `status`, `functions`, `secrets`, `verify`
  and `runtime` will all work the moment a project is supplied. Nothing else is in the way.

### What to provide, and nothing more

Six values and two dashboard settings. Nothing else is needed, and no other value should be sent.

| # | Value | Where it is in the Dashboard |
| --- | --- | --- |
| 1 | project reference | Settings → General → *Reference ID* |
| 2 | Project URL | Settings → API → *Project URL* |
| 3 | anon / publishable key | Settings → API → *Project API keys* → the `anon` `public` key |
| 4 | service-role key | Settings → API → *Project API keys* → the `service_role` `secret` key |
| 5 | database password | Settings → Database (or the value chosen at project creation) |
| 6 | Dashboard → Authentication: **Confirm email = enabled**, **Site URL** = your real app origin, and **Redirect URLs** = that origin **plus** `https://localhost` | Authentication → *Sign In / Providers* and *URL Configuration* |

Then the activation is four commands:

```
node supabase/scripts/cloud.mjs link      --project-ref <REF>
node supabase/scripts/cloud.mjs push      --project-ref <REF> --confirm
node supabase/scripts/cloud.mjs functions --project-ref <REF> --confirm
node supabase/scripts/cloud.mjs verify
```

and the access-control proof (throwaway project or preview branch, because it writes test data):

```
$env:SUPABASE_URL='https://<REF>.supabase.co'
$env:SUPABASE_ANON_KEY='<anon key>'
$env:SUPABASE_SERVICE_ROLE_KEY='<service_role key>'
node supabase/scripts/cloud.mjs runtime
```

Provide values 1-5 directly; do not write them into a committed file. Values 3-5 map onto the
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` the phone build needs, and the service-role key
is used only by the CLI and the harness, never by the client.

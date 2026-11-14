# TEACHER EVALUATION — NEW FEATURES GUIDE (DATE PICKER, STYLING, RATING, VIDEO, MAPS, GRAPHQL, ANIMATIONS)

**Project:** JibonJori — AI-assisted matrimony platform
**Supabase project:** `jjbihxtthpclalruepul` — `https://jjbihxtthpclalruepul.supabase.co`
**Android package:** `com.jibonjori.app`
**Teacher-ready APK:** `D:\Zeem\JibonJori-Teacher-Ready.apk`
**Report date:** 2026-11-10

This guide covers the six teacher-evaluation features that were implemented and demonstrated
in the latest batch. The earlier authentication / realtime / upload demonstration sequence is
documented in `docs/TEACHER_EVALUATION_DEMO_GUIDE.md`.

---

## Scope of this batch

| # | Teacher requirement | Implementation | Status in this batch |
|---|---|---|---|
| 1 | Datepicker | Accessible native `<input type="date">` + DOB validation / 18+ bounds | Implemented |
| 2 | Styling | Tailwind CSS design tokens (no new framework) | Implemented |
| 3 | Star rating / feedback | Private app-experience rating (`public.feedback`, migration `20261110000017_feedback.sql`) | Implemented |
| 4 | Embedded video | Curated YouTube catalogue + click-to-load `youtube-nocookie` embed | Implemented |
| 5 | Maps | Google Maps JS API with key-gated loading, geolocation and manual fallback | Implemented |
| 6 | GraphQL | Supabase-native `pg_graphql` via `lib/graphql.ts`, teacher lab screen | Implemented |
| — | Animations | GSAP + `prefers-reduced-motion` support | Implemented (pre-existing, verified) |

---

## Feature 1 — Datepicker

- **Purpose:** collect a date of birth with an accessible calendar popup, bounds, validation and
  the 18+ matchmaking rule, and never show the exact date publicly.
- **Where to find it:** authenticated app → **Profile** (`/app/profile`) → **Edit profile** →
  **Date of birth** field. The native control renders a platform calendar popup (month / year
  navigation included) and is keyboard and screen-reader operable; no third-party date-picker
  dependency was added.
- **Teacher demonstration steps:**
  1. Open the profile editor.
  2. Focus the **Date of birth** field and open the calendar.
  3. Navigate months / years, pick a date at least 18 years before today (the control's `max` is
     `latestAdultDob()`, derived from the current date).
  4. Submit — the field shows `dobError` copy for empty / malformed / impossible / under-18 input.
  5. Open a public profile card / detail view and confirm only the **age** is displayed, not the
     date of birth.
- **Technologies / libraries:** React native `<input type="date">` (browser / Android WebView),
  `frontend/src/lib/validation.ts` (`DOB_EARLIEST = "1950-01-01"`, `DOB_MAX_AGE = 100`,
  `latestAdultDob()`, `ageFromDob()`, `dobError()`).
- **Automated test evidence:** `frontend/src/__tests__/validation.test.ts` (16 tests covering
  valid, empty, malformed, impossible-date, under-18, future/age boundaries) — all green in the
  latest `npm run verify` (191/191 total).
- **Known limitations:** the backend remains authoritative for the concrete date; the picker is a
  UX bound. The exact DOB is stored (as before) but never rendered publicly.

## Feature 2 — Styling

- **Purpose:** one consistent design language across buttons, forms, inputs, cards, modals,
  loading and error states.
- **Where:** application-wide Tailwind utility classes (`frontend/tailwind.config.js`,
  `frontend/postcss.config.js`, `frontend/src/styles/globals.scss`).
- **Teacher demonstration steps:** open each surface (auth, profile, feedback, about, map) and show
  the same button, input, card and state styling; check responsive behaviour at a narrow viewport.
- **Technologies / libraries:** **Tailwind CSS** (already installed; no new dependency, no Sass
  migration — the codebase uses Tailwind utilities plus a small Sass layer for the design tokens).
- **Automated test evidence:** part of the full `npm run verify` chain (typecheck + lint + build +
  tests all PASS).
- **Known limitations:** no separate component-library theming layer; consistency is by convention.

## Feature 3 — Star rating / private feedback

- **Purpose:** members rate the **JibonJori experience** itself with a 1–5 star score plus optional
  bounded text; the rating is private and owned by the rater.
- **Where to find it:** authenticated app → drawer → **Rate the app** (`/app/feedback`).
- **Backend:** new migration `supabase/migrations/20261110000017_feedback.sql`
  (`public.feedback` table: one row per rater via unique constraint on `rater_profile_id`, DB
  `CHECK (score between 1 and 5)`, optional `feedback` text bounded at 2000 chars, owner-only RLS
  select/insert/update/delete, unverified members excluded via `is_active_member()`).
- **Frontend:** `frontend/src/api/feedback.api.ts` (getMine / submit / remove, upsert on the single
  unique column), `frontend/src/pages/FeedbackPage.tsx`, reusable `frontend/src/components/ui/RatingStars.tsx`
  (radio-group semantics, keyboard arrows, read-only display, labels like “Rate 4 out of 5”).
- **Teacher demonstration steps:**
  1. Open **Rate the app**.
  2. Pick a star (touch / mouse / keyboard).
  3. Optionally write feedback (≤ 2000 chars) and submit.
  4. Re-open: own rating is shown read-only; **Change rating** updates it; **Delete feedback**
     removes it. Another member cannot see it (no public read policy).
- **Automated test evidence:** new `frontend/src/__tests__/feedback-page.test.tsx` (4 tests: anonymous
  redirect, submit flow, update flow, submit-disabled-without-score) + database assertions added in
  `supabase/tests/rls_assertions.sql` (owner-only read/write, one-rating-per-member upsert,
  out-of-range score rejected, unverified member rejected, anon cannot read).
- **Known limitations:** no public aggregate rating endpoint was added (kept private); the optional
  aggregate remains a deliberate scope decision rather than an unauthenticated mean.

## Feature 4 — Embedded video

- **Purpose:** play real curated relationship/marriage videos without loading third-party code
  before the user chooses to watch.
- **Where to find it:** authenticated app → **About** (`/app/about`) → **Watch and learn** card.
- **Teacher demonstration steps:** open About, press **Play** on a curated video, confirm the
  `youtube-nocookie.com/embed/...` frame loads only after the press, and that playback is
  user-initiated (no autoplay before interaction).
- **Technologies / libraries:** existing `frontend/src/components/media/AudioVideoEmbed.tsx`;
  curated catalogue via `frontend/src/api/curated.api.ts`; YouTube only (key-free `youtube-nocookie`
  embed endpoint).
- **Automated test evidence:** `frontend/src/__tests__/components.test.tsx` (AudioVideoEmbed: no
  iframe before play, nocookie embed after play, hostile-id encoding) — green.
- **Known limitations:** only admin-curated rows are playable; arbitrary user-supplied embed URLs
  are not accepted (validated/curated catalogue).

## Feature 5 — Maps

- **Purpose:** location display and selection with privacy consent and a keyless fallback.
- **Where to find it:** authenticated app → **Profile** → location section
  (`LocationPicker` / `LocationMap`).
- **Teacher demonstration steps:** consent + “Use my current location” (permission prompt), or
  manual coordinate entry; confirm reverse-geocoding only happens with a configured Maps key; confirm
  approximate coordinates are what is stored/displayed.
- **Technologies / libraries:** Google Maps JS API via `frontend/src/lib/google-maps.ts`
  (key-gated script load), Capacitor Geolocation with browser fallback (`frontend/src/lib/geolocation.ts`).
- **Automated test evidence:** `frontend/src/__tests__/google-maps.test.tsx`,
  `frontend/src/__tests__/geolocation.test.tsx` — green.
- **Known limitations:** live reverse geocoding requires a Google Maps key + Geocoding API; without a
  key the picker degrades to manual entry (no fabricated reverse geocode).

## Feature 6 — GraphQL (teacher lab)

- **Purpose:** demonstrate a real Supabase-native GraphQL query through `pg_graphql`.
- **Where to find it:** authenticated app → drawer → **Developer · GraphQL** (`/app/developer/graphql`).
- **Endpoint / query:** `POST {SUPABASE_URL}/graphql/v1` with the caller's access token
  (anon key for anonymous callers) and
  `REFERENCE_DATA_QUERY`:
  ```graphql
  query ReferenceData {
    educationLevelsCollection(orderBy: { tier: AscNullsLast }) { edges { node { id slug label tier } } }
    professionsCollection(orderBy: { tier: AscNullsLast }) { edges { node { id slug label tier } } }
  }
  ```
- **Teacher demonstration steps:** open the lab, run the live query, read returned rows, then run the
  built-in failing query to show the error branch; confirm retry.
- **Technologies / libraries:** Supabase `pg_graphql` (extension migration
  `supabase/migrations/20260927000014_graphql.sql`), `frontend/src/lib/graphql.ts`,
  `frontend/src/api/reference.api.ts` (GraphQL with PostgREST fallback).
- **Automated test evidence:** `frontend/src/__tests__/teacher-graphql.test.tsx` (3 tests: live query
  result, error branch, retry recovery) + transport tests in `frontend/src/__tests__/graphql.test.ts`.
- **Known limitations:** the live cloud endpoint execution is **NOT VERIFIED** in this pass (the
  extension is a Supabase built-in absent from local PostgreSQL); the transport contract is
  unit-tested and the fallback to PostgREST keeps the app working.

## Animations

- **Purpose:** smooth, restrained motion for page/modal/like/rating/toast/empty-state transitions.
- **Implementation:** `frontend/src/lib/animations.ts` (GSAP + ScrollTrigger), `frontend/src/components/ui/Reveal.tsx`,
  `frontend/src/lib/prefers-reduced-motion.ts` (reduced-motion support).
- **Teacher demonstration steps:** trigger a like / rating / modal; confirm motion is skipped when the
  OS prefers reduced motion.
- **Automated test evidence:** `frontend/src/__tests__/animations.test.ts` — green.

---

## Manual configuration still required for live demonstration

| Item | Required for | Status |
|---|---|---|
| Google Maps key | Interactive map + reverse geocoding | **Pending** (`VITE_GOOGLE_MAPS_API_KEY`) |
| SMS provider (Supabase Phone + Twilio) | Real phone OTP delivery | **Pending** (see `docs/PHONE_VERIFICATION_SETUP.md`) |
| Real LLM key | Assistant explanations | **Pending** |
| Brevo / email inbox | Live OTP observation | **Pending** |
| Supabase migration `20261110000017_feedback.sql` | Live feedback feature | **Written this pass — pending `supabase db push`** |

## Test evidence summary (latest execution)

- `npm run verify` (frontend): **PASS** — typecheck, lint, build, **191/191 tests** (24 files), deploy
  **16/16**, release-gate **21/21**, APK scan **CLEAN**.
- New automated suites this batch: feedback page (4), teacher GraphQL lab (3).
- Database assertions this batch: feedback RLS/ownership/range/unverified (added to
  `supabase/tests/rls_assertions.sql`).
- Android: fresh debug APK built — `D:/Zeem/JibonJori-Teacher-Ready.apk` — **7,606,256 bytes**,
  SHA-256 **`363721CFAD9B9F01355284D593D967C321744E9BE2F9962EE6CD5601FEF34FDF`**, package
  `com.jibonjori.app`, forbidden-content scan **CLEAN**. Physical-device acceptance: **NOT RUN**
  (no emulator/device attached).

## Known limitations / honest gaps

1. Live `pg_graphql` execution against the hosted project — **NOT VERIFIED** (extension absent from
   local PostgreSQL; transport unit-tested).
2. Real SMS / email OTP delivery — **BLOCKED** pending provider configuration.
3. Google Maps reverse geocoding — **BLOCKED** pending key.
4. Physical-device acceptance — **NOT RUN**.
5. Migration `20261110000017_feedback.sql` — written and locally asserted in the RLS harness; not yet
   pushed to the hosted project.
6. Public app-experience rating aggregate — deliberately not exposed (privacy-first decision).

---

## Teacher demonstration sequence (new features, approx. 8 minutes)

1. Datepicker — 2 min (profile editor → pick 18+ DOB → submit → age-only public display).
2. Styling — 1 min (walk one form + one card + one state across auth/profile).
3. Star feedback — 2 min (Rate the app → submit → update → delete).
4. Embedded video — 1 min (About → play curated video).
5. Maps — 1 min (profile location consent / manual / geolocation fallback).
6. GraphQL — 1 min (Developer · GraphQL → live query → failing query).
7. Animations — 30 s (like / rating / reduced-motion check).
8. Buffer — 30 s.

**Total: ≈8 minutes** of teacher-facing demonstration.

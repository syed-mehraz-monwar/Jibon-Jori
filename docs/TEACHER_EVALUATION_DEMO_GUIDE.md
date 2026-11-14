# TEACHER EVALUATION DEMO GUIDE — JibonJori

**Project:** JibonJori — AI-assisted matrimony platform
**Supabase project:** `jjbihxtthpclalruepul` — `https://jjbihxtthpclalruepul.supabase.co`
**Android package:** `com.jibonjori.app`
**Teacher-ready APK:** `D:/Zeem/JibonJori-Teacher-Ready.apk`
**Report date:** 2026-11-03 (original sequence) · **2026-11-10** (latest batch additions)

This guide is for the teacher demonstration of the evaluated features.

---

## Recommended demonstration sequence (approx. 10 minutes)

1. **Session / JWT** — sign in and open a protected screen. (1 min)
2. **Unique username** — run the availability check during registration or profile edit. (2 min)
3. **Email verification** — request an OTP, read it, enter it, confirm verified. (2 min)
4. **Phone verification (SMS OTP)** — choose Phone at registration, receive the SMS OTP, enter it, confirm verified. (2 min; live demo requires the SMS provider to be configured — see `docs/PHONE_VERIFICATION_SETUP.md`).
5. **Cloud upload** — upload / replace a profile picture. (1 min)
6. **Real-time commenting** — open two sessions on the same profile and post from one. (2 min)
7. **Like / dislike live count** — like from one session, watch the other. (1 min)
8. **Datepicker** — profile editor → pick a date of birth at least 18 years old. (1 min)
9. **App-experience star rating** — open **Rate the app**, submit / update / delete a 1–5 rating. (1 min)
10. **Embedded video** — open **About** → play a curated video. (1 min)
11. **Maps** — open profile location controls and try consent / manual / geolocation. (1 min)
12. **GraphQL teacher lab** — open **Developer · GraphQL**, run the live query and the failing query. (1 min)

---

## Feature 1 — Session / JWT Authentication

- **Screen:** `/login`, `/register`, `/verify`, authenticated shell `/app`.
- **Action:** Register or log in; verify email; open a protected page.
- **Input:** credentials / OTP.
- **What the teacher should observe:** an authenticated Supabase session is created; protected screens load; token refresh happens automatically; after logout protected access is refused; after re-login the app works.
- **What proves it works:** an access token + refresh token exist (Supabase session), protected API calls succeed, unauthenticated calls are rejected.
- **Two-session / device test:** not required for this feature itself; a single session plus a logout/protected-access check is sufficient for the demo.
- **If it fails:** check Supabase Auth state; do not fall back to local token invention.

## Feature 2 — Real-Time Unique Username Verification

- **Screen:** `/register` (username field) and profile edit.
- **Action:** type a username; observe debounced availability check (checking / available / taken / invalid).
- **Input:** new or existing username.
- **What the teacher should observe:** debounced check; clear states; DB-level uniqueness (`profiles.username` unique + `username_available` RPC + reserved-name guard + shape constraints).
- **What proves it works:** a new username is available; an existing username shows taken; a duplicate at DB level is rejected even under simultaneous submission.
- **Two-session / device test:** for the DB uniqueness proof, two concurrent submissions with the same username must yield one success and one failure.

## Feature 3 — Email Verification (Brevo OTP)

- **Screen:** `/register` → `/verify`.
- **Action:** request a six-digit OTP; read the email; enter the code; confirm.
- **Input:** email address, six-digit code.
- **What the teacher should observe:** an actual OTP email is sent through the configured provider; invalid code rejected; expired code rejected; resend supported.
- **What proves it works:** OTP delivered to a real inbox, verified, and the account becomes usable.
- **Two-session / device test:** not required.

## Feature 4 — Phone Verification (SMS OTP)

- **Screen:** `/register` → phone channel → `/verify` → authenticated `/app`.
- **Action:** choose Phone (SMS) at registration, receive a six-digit OTP via Supabase SMS OTP,
  enter it, confirm.
- **Input:** Bangladesh mobile number (national / `880` / `+880` forms normalized to `+880…`),
  six-digit SMS code.
- **What the teacher should observe:** an actual SMS OTP is sent through the configured SMS
  provider (Twilio) after Supabase phone provider configuration; invalid code rejected; resend
  cooldown respected; verified status applied only after successful verification.
- **What proves it works:** real SMS delivery to a test phone, valid OTP accepted, account
  becomes verified and usable.
- **Two-session / device test:** not required.
- **Status:** **IMPLEMENTED** — automated suites pass. **BLOCKED** for live demonstration —
  SMS provider (Supabase Phone provider + Twilio) configuration and a real test number are still
  pending manual setup; see `docs/PHONE_VERIFICATION_SETUP.md`.

## Feature 5 — Cloud Storage Image Upload

- **Screen:** profile edit (`/app/profile` photo manager).
- **Action:** upload a profile picture; confirm display; optionally replace/remove.
- **Input:** supported image type, within size limit.
- **What the teacher should observe:** upload goes to Supabase Storage; metadata/profile path updated; image displays; persists after restart and re-login.
- **What proves it works:** Storage object exists, DB reference correct, signed/visible URL works, persistence across restart.
- **Two-session / device test:** not required (single-user persistence).

## Feature 6 — Real-Time Commenting

- **Screen:** profile view with comment thread.
- **Action:** post a comment; observe it appear; post from a second session and observe live arrival without refresh.
- **Input:** comment body (max length enforced).
- **What the teacher should observe:** optimistic append from POST response + live `comment:new` push with id-based dedupe; persistence after refresh; pagination (5 per page).
- **What proves it works:** comment persisted in DB, appears in the other session via realtime without refresh, survives refresh, no duplicates.
- **Two-session / device test:** **required** — Session A and Session B on the same profile; post in A; confirm B updates live.

## Feature 7 — Like / Dislike with Live Count

- **Screen:** profile reactions (like / dislike / favourite).
- **Action:** like or dislike; watch live count; switch reaction.
- **Input:** reaction value.
- **What the teacher should observe:** count changes live via realtime (`like:new`); persisted in DB; accurate after refresh; one reaction per user.
- **What proves it works:** two independent sessions see live count updates; refresh keeps correct counts.
- **Two-session / device test:** **required** — Session A reacts; Session B sees live count change without refresh.

## Feature 8 — Datepicker (new in the latest batch)

- **Screen:** `/app/profile` → profile editor → **Date of birth** (native accessible calendar).
- **Action:** open the calendar, navigate, pick a date at least 18 years old, submit.
- **Input:** birth date (`yyyy-mm-dd`, bounded by `DOB_EARLIEST` … `latestAdultDob()`, validated by `dobError`).
- **What the teacher should observe:** month/year navigation works; under-18 / invalid / future dates are rejected; public views show the age only.
- **What proves it works:** validation suites green (`validation.test.ts`); backend re-validates the 18+ rule.
- **Tech:** native `<input type="date">` (no new dependency); accessible calendar popup on Android WebView.

## Feature 9 — Private App Star Rating (new in the latest batch)

- **Screen:** `/app/feedback` (**Rate the app**).
- **Action:** pick 1–5 stars, optional text, submit / update / delete.
- **Input:** integer score 1–5, optional ≤2000-char text; backend enforces one active rating per member and owner-only access.
- **What the teacher should observe:** own rating round-trips; other members cannot read it; invalid scores are rejected.
- **What proves it works:** new feedback suites + DB assertions green.
- **Tech:** `public.feedback` migration `20261110000017_feedback.sql`, `feedbackApi`, `RatingStars`.

## Feature 10 — Embedded Video (new in the latest batch)

- **Screen:** `/app/about` → **Watch and learn**.
- **Action:** press play; confirm click-to-load `youtube-nocookie.com` embed.
- **What the teacher should observe:** no third-party frame before play; user-initiated playback; curated catalogue only.
- **Tech:** `AudioVideoEmbed` + curated videos API.

## Feature 11 — Maps (new in the latest batch)

- **Screen:** `/app/profile` → location controls (`LocationPicker` / `LocationMap`).
- **Action:** consent → current location (or manual coordinates).
- **What the teacher should observe:** geolocation permission prompt, fallback to manual entry, approximate coordinates only.
- **Tech:** Google Maps JS API (key-gated) + Capacitor Geolocation / browser fallback.

## Feature 12 — GraphQL Teacher Lab (new in the latest batch)

- **Screen:** `/app/developer/graphql` (**Developer · GraphQL**).
- **Action:** run the live `ReferenceData` query; run the failing query to show the error state.
- **What the teacher should observe:** real POST to Supabase `/graphql/v1` with the member token; returned rows; error branch.
- **Tech:** `pg_graphql` via `lib/graphql.ts` + teacher lab page; live execution pending cloud verification.

## Feature 13 — Animations (new in the latest batch)

- **Screen:** application-wide (likes, ratings, modals, toasts, reveals).
- **Action:** trigger an animated interaction; check reduced-motion preference.
- **Tech:** GSAP + ScrollTrigger, `prefers-reduced-motion`.

---

## Troubleshooting quick reference (teacher demo)

- No realtime update: check SocketContext connection, `comment:new` / `like:new` / `rating:new` subscriptions, enabled flags.
- OTP not arriving: check provider delivery state, resend, rate limits; do not fake delivery.
- Upload failure: check MIME/size validation and Storage policies.
- Username taken: expected DB behavior; reserved names blocked.
- Feedback rejected: check score range (1–5) and member verification state on the backend.
- Map not configured: set `VITE_GOOGLE_MAPS_API_KEY`; without it the picker falls back to manual coordinates.

---

## Timing plan

| Step | Duration |
|---|---|
| Session | 1 min |
| Username | 2 min |
| Email OTP | 2 min |
| Phone OTP | 2 min |
| Upload | 1 min |
| Comments (2 sessions) | 2 min |
| Reactions (2 sessions) | 2 min |
| Datepicker | 1 min |
| Star feedback | 1 min |
| Video | 1 min |
| Maps | 1 min |
| GraphQL | 1 min |
| Animations | 0.5 min |
| Buffer / explanation | 2 min |
| **Total** | **≈20 min** |

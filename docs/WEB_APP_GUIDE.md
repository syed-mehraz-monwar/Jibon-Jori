# JibonJori Web Application Guide

This guide describes the cloud-hosted web application that exposes the existing
JibonJori product through a browser, and how to run, verify and demonstrate it.

The web app is the same React + TypeScript + Vite client that ships to the Android
app through Capacitor; only the hosting target differs.

## 1. Architecture

```
Browser (Chrome / Edge / Firefox / Safari, desktop or mobile)
        │  HTTPS (PostgREST + pg_graphql + Realtime + Auth + Storage)
        ▼
Supabase Cloud project  (https://jjbihxtthpclalruepul.supabase.co)
        │  service-role only (Edge Functions: ai-chat, ai-explanation, sessions,
        │  resolve-login-email, reports, demo-reset, account-delete, tests)
        ▼
PostgreSQL (profiles, interactions, comments, ratings, feedback, media, ...)
```

- There is no first-party backend of our own. The browser talks to Supabase
  directly; the only server-side logic lives in Supabase Edge Functions.
- Android and web therefore share one database, one authentication store, one
  storage bucket namespace and one Realtime channel - no duplicated backend.

## 2. Local development

```bash
cd frontend
npm run dev          # Vite dev server on http://localhost:5173
```

Environment contract (see `frontend/.env.example`):

| Variable | Purpose | Secret? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL | No (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (RLS-protected) | No (public) |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps JS key (optional) | No (public) |
| `VITE_YOUTUBE_VIDEO_IDS` | Curated YouTube ids (optional) | No (public) |
| `VITE_DEVELOPER_NAME` / `VITE_DEVELOPER_ID` / `VITE_INSTITUTION` / `VITE_COURSE_NAME` | Attribution shown on the About page | No |

Only `VITE_`-prefixed variables reach the bundle; anything else must never be
added to the browser environment.

## 3. Routes

Public: `/`, `/login`, `/register`, `/verify`, `/forgot-password`, `/reset-password`.

Authenticated (`/app/*`, guarded by the app shell): `/app`, `/app/profile`,
`/app/preferences`, `/app/search`, `/app/recommendations`, `/app/profiles/:profileId`,
`/app/notifications`, `/app/sessions`, `/app/chat`, `/app/reports`, `/app/about`,
`/app/feedback`, `/app/developer`, `/app/developer/graphql`, `/app/demo`.

Teacher evaluation hub: `/app/developer`. GraphQL teacher lab: `/app/developer/graphql`.
Demo mode: `/app/demo`.

## 4. Feature areas covered by the web app

- Landing, registration, email OTP, phone OTP, login, password recovery,
  session restore, logout - the real Supabase Auth flows.
- Dashboard with profile completeness, live activity and quick navigation.
- Discovery, recommendations, profile view, comments, likes/dislikes, ratings.
- Profile editing, image upload through Supabase Storage.
- App-experience star feedback (`public.feedback`).
- Curated embedded video (`public.curated_videos`).
- Maps/geolocation with consent and manual fallback.
- GraphQL teacher lab against `pg_graphql`.
- Teacher evaluation hub at `/app/developer` (14 feature cards).
- Demo mode at `/app/demo` (checklist, fictional personas, admin-scoped reset).

## 5. Demo Mode

`/app/demo` provides:

1. A walkthrough checklist of the teacher features with links into the real screens.
2. Six fictional adult Bangladeshi demo personas (presentation only, not real members).
3. An administrator-only, marker-scoped demo reset backed by the `demo-reset` Edge Function.

## 6. Known limitations

- Live cloud operations (OTP delivery, GraphQL execution, live maps) require
  configured providers; the UI states this honestly instead of faking success.
- Feedback database migration `20261110000017_feedback.sql` must be applied to the
  hosted project before live feedback submission works.
- Physical device behaviour is covered by the Android build; the browser build is
  verified in Chrome/Edge.

See `docs/WEB_DEPLOYMENT_GUIDE.md`, `docs/TEACHER_WEB_DEMO_GUIDE.md`,
`docs/WEB_APP_TEST_REPORT.md` and `docs/WEB_RELEASE_REPORT.md`.

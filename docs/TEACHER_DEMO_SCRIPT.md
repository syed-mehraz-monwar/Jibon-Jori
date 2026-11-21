# JibonJori Teacher Demo Script

**Date:** 2026-11-21
**Production URL:** `https://jibon-jori-a88n.vercel.app/`
**Supabase project:** `jjbihxtthpclalruepul`

## Purpose

A practical ~10–15 minute demonstration script for presenting the JibonJori web
application to a teacher, using the six dedicated demo accounts and the live
production deployment.

## Pre-presentation checklist

- [ ] Production URL openable from any laptop: `https://jibon-jori-a88n.vercel.app/`
- [ ] Demo account credentials available from local file
      `D:\Zeem\JibonJori-Demo-Accounts.txt` (never commit or expose).
- [ ] Supabase Auth production redirect settings confirmed for
      `https://jibon-jori-a88n.vercel.app` (Site URL / allowed redirects).
- [ ] Feedback migration applied before demonstrating `/app/feedback` (currently
      pending; see `docs/PRODUCTION_ACCEPTANCE_REPORT.md`).
- [ ] Demo-reset Edge Function deployed before demonstrating `/app/demo` reset.
- [ ] Internet connectivity available for live Supabase operations.

## Demo flow

### 1. Introduction (1–2 min)

- Explain JibonJori: AI-assisted matrimony platform (React + TypeScript + Vite web,
  Capacitor Android, Supabase Auth/PostgREST/pg_graphql/Realtime/Storage, PostgreSQL,
  Vercel hosting).
- State the honest scope: some teacher-facing features are implemented and verified;
  teacher demo content uses six fictional adult accounts.

### 2. Authentication (2 min)

- Open `/login`, log in with a demo account (password login; OTP not required for
  admin-confirmed demo accounts).
- Confirm authenticated state renders (`/app`).
- Logout, then log in again with another demo account.

### 3. Profile (2 min)

- Open `/app/profile`, show profile data (fictional Bangladesh-based persona,
  education/profession, completeness).

### 4. Discover (2 min)

- Open discover, show the six demo personas with public visibility.

### 5. Interaction (2 min)

- Like a demo profile (verified live: HTTP 201).
- Switch to the second demo account and like back (verified live: HTTP 201).

### 6. Comments (2 min)

- Post/see demo comments (verified live: HTTP 201/201).

### 7. Feature demonstrations (2 min)

- Feedback: pending migration — do not demonstrate until applied.
- Image upload: verified live (Storage `profile-photos` upload succeeded with real
  demo auth).
- Maps, video, animations, datepicker, GraphQL: present per actual implementation.

### 8. Architecture (1 min)

- React SPA → Supabase Auth/REST/GraphQL/Realtime/Storage → PostgreSQL; Vercel static
  hosting; Android shares the same backend.

### 9. Closing (1 min)

- Honest summary of implemented vs pending items.

## Preparation checklist

- [ ] Demo accounts provisioned and login-verified.
- [ ] Production URL reachable.
- [ ] Feedback migration status resolved.
- [ ] Demo reset function deployment status resolved.

## Fallback plan

- If login fails: use the local credentials file; re-check controlled Gmail mailbox
  state; if OTP is required by configuration, use the approved flow without printing codes.
- If a feature is not functional: skip it and continue; never fake results.

# Teacher Web Demo Guide

This guide is for demonstrating the JibonJori web application to a teacher or
evaluator. All demonstrations run in the browser against the real Supabase Cloud
backend configured for the current deployment.

## 1. Entry points

| Requirement | Web location |
| --- | --- |
| Teacher evaluation hub (14 feature cards) | `/app/developer` |
| GraphQL teacher lab | `/app/developer/graphql` |
| Demo mode | `/app/demo` |
| App-experience star rating | `/app/feedback` |
| Curated video | `/app/about` |
| Dashboard | `/app` |

## 2. Demonstration sequence (around 20 minutes)

1. **Landing** (`/`): branding, feature summary, animated hero, CTA.
2. **Authentication** (`/app/developer` → session card): watch the live session
   posture; sign-in screen for anonymous visitors.
3. **Username availability**: Developer hub → run the availability check.
4. **Email verification**: Developer hub → open the verification flow; register
   or verify with the real OTP.
5. **Phone verification**: Developer hub → open the phone step; use the real SMS
   OTP flow.
6. **Cloud image upload**: Developer hub → open the profile editor; upload path.
7. **Realtime comments**: Developer hub → open discovery → open a profile → comment.
8. **Likes and dislikes**: Developer hub → open discovery → react.
9. **Datepicker**: Developer hub → open the profile editor → DOB validation.
10. **Tailwind design system**: Developer hub → design tokens demo card.
11. **Star rating**: `/app/feedback` → submit / update / delete a rating.
12. **Embedded video**: `/app/about` → play a curated clip (click-to-load).
13. **Maps**: Developer hub → open the profile editor → location control.
14. **Animations**: Developer hub → play the entrance animation demo.
15. **GraphQL**: `/app/developer/graphql` → run the live query, then the failing query.

## 3. Demo mode

`/app/demo` provides the guided walkthrough: checklist, six fictional demo
personas, session posture, and an administrator-only demo reset.

The demo reset:

- is restricted to administrators,
- requires an explicit second confirmation,
- resolves content through the `demo_` username marker,
- never touches real members or their content.

## 4. Truthful status wording

Use only these statuses when describing a feature during evaluation:

- **Implemented** — code exists.
- **Automated tests passed** — unit/component/mocked suites pass (`npm run verify`).
- **Live cloud verified** — an actual hosted operation was executed and succeeded.
- **External configuration required** — a provider/key is not configured.
- **Physical-device test pending** — not run on hardware.

Never present a mocked test as a live verification.

## 5. Timing per feature

| Feature | Minutes |
| --- | --- |
| Session/JWT | 1 |
| Username availability | 1 |
| Email verification | 2 |
| Phone verification | 2 |
| Cloud image upload | 2 |
| Realtime comments | 2 |
| Likes/dislikes | 1 |
| Datepicker | 1 |
| Tailwind styling | 1 |
| Star rating | 2 |
| Embedded video | 1 |
| Maps | 2 |
| Animations | 1 |
| GraphQL | 2 |
| Total | ~24 |

## 6. Current validation status (2026-11-15)

Recorded against this release batch; do not present older numbers as current:

- Browser smoke (`frontend/test-support/browser-smoke.mjs`): **16/17 checks passed**
  on Chrome and Edge against the local Vite dev server; the one skipped/failing
  check is the live Supabase reachability probe, which could not be completed
  from the sandbox (egress-restricted).
- Production browser smoke (2026-11-19, against `https://jibon-jori-a88n.vercel.app/`):
  **17/17 passed**, including the Supabase reachability check (resolved with HTTP 401).
- Demo reset transport and server-side admin logging were repaired during this
  batch; the automated demo API, demo mode and developer suites pass
  (`npm run verify`: **203/203 tests**, release gate **21/21**, deployment checks
  **16/16**, security sweep **PASS**, production build **PASS**).
- Android debug APK rebuilt successfully (`frontend/android/app/build/outputs/apk/debug/app-debug.apk`,
  **7,606,439 bytes**) and delivered as a new artifact at `D:\Zeem\JibonJori-Web-v1.apk`.
- Production web URL: **not yet assigned** (Vercel authorization pending).

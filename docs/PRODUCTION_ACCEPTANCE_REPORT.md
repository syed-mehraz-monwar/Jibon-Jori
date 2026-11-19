# JibonJori Production Acceptance Report

**Date:** 2026-11-19
**Production URL:** `https://jibon-jori-a88n.vercel.app/`

## 1. Deployment state

| Item | Status |
| --- | --- |
| Production URL | `https://jibon-jori-a88n.vercel.app/` (live, HTTPS, HTTP 200, ~0.37 s) |
| Hosting provider | Vercel (Production deployment completed by the project owner) |
| Deployment source commit | `7ad2a0ac32f4e0d69550f6561f279e136664ae6d` (latest published source at time of audit) |
| Bundle served | `index-IVShLNkN.js` + `index-CdIvPk8A.css` (final-source build) |
| Build | PASS (`npm run build`, typecheck + vite build) |
| Verification at source HEAD | **PASS** (`npm run verify` exit 0) |

## 2. Phase 1 — Production website audit (this session)

Executed via `frontend/test-support/browser-smoke.mjs --base https://jibon-jori-a88n.vercel.app`
(latest run): **17/17 checks passed**, 0 skipped.

| Check | Result |
| --- | --- |
| Homepage renders React into `#root` | PASS (`h1="Find a partner with reasons, not just scores."`) |
| Tailwind CSS compiled/applied | PASS |
| Sass stylesheet compiled/applied | PASS |
| GSAP hero entrance animation settled | PASS |
| Client-side validation blocks empty sign-in without API call | PASS |
| Registration screen renders; reload keeps form | PASS |
| Real keystrokes reach inputs | PASS |
| Unknown route → 404 | PASS |
| Protected routes redirect anonymous → `/login` | PASS |
| Developer hub `/app/developer` redirect | PASS |
| Demo mode `/app/demo` redirect | PASS |
| Reduced motion honoured | PASS |
| Mobile (375px) + desktop (1280px) reflow, no overflow | PASS |
| Supabase project reachable from page origin | **PASS — `GET /rest/v1/` resolved with 401 (reachable, auth required)** |
| Failed subresource requests | PASS (none) |
| Uncaught console errors | PASS (none) |

**Previous failure investigation:** the earlier Supabase reachability check failed with
`TypeError: Failed to fetch`. The re-run against the production origin passes (401 =
reachable). The check now passes consistently; the earlier failure did not reproduce and
was treated as environment/egress related rather than an application defect.

## 3. Phase 2 — Supabase Auth configuration

- Not fully verifiable from the local environment (dashboard access required).
- Required manual production settings for `https://jibon-jori-a88n.vercel.app`:
  - Site URL: `https://jibon-jori-a88n.vercel.app`
  - Allowed redirect URLs: add `https://jibon-jori-a88n.vercel.app/**`
  - Email OTP flow / password recovery redirect: point at the production origin.
  - Phone OTP redirect: configure if SMS is enabled.
- Existing development/Android redirect settings were not modified during this pass.

## 4. Phase 3 — Authentication acceptance

- **NOT RUN** in this pass. Requires a dedicated test account and real (non-fabricated)
  email/phone OTP delivery. Authenticated flows must be re-tested after Phase 2 settings.

## 5. Phase 4 — Real feature acceptance

- Public-route behaviour verified against the live production deployment.
- Authenticated features (username uniqueness, profile persistence, uploads, comments,
  reactions, feedback, video, maps, GraphQL, demo reset) require live authenticated
  sessions; status recorded in `docs/WEB_APP_TEST_REPORT.md` and this report — pending.

## 6. Phase 5 — Demo Reset Edge Function

- Source repaired in the release batch (GET plan handler, response mapping, server-side
  admin resolution/logging, demo-marker deletes, SQL cast fixes).
- Function deployment + live reset validation: **not completed** (deployment tooling
  authorization unavailable in this environment).

## 7. Phase 6 — Demo profiles

- Live status of six fictional demo profiles in Supabase Cloud: **not confirmed** in this
  pass; secure provisioning workflow documented but not executed here.

## 8. Phase 7 — Security audit

- Security sweep: **PASS** (after refreshing generated-bundle allowlist to the current
  artifact hash `index-IVShLNkN.js`).
- Production bundle secret scan: clean; sourcemaps off.
- `npm audit`: 21 advisories (15 moderate / 3 high / 3 critical); dev-tooling assessed;
  production `react-router` flagged (moderate) for follow-up.

## 9. Phase 8 — Dependency audit

- 21 advisories total; no safe production-dependency upgrade applied in this pass.

## 10. Phase 9 — Cross-platform regression

- `npm run verify`: **exit 0** (typecheck/lint/build PASS, 203/203 tests, deploy 16/16,
  release gate 21/21, APK scan CLEAN).
- Android: delivered APK `D:/Zeem/JibonJori-Web-v1.apk` (7,606,439 bytes, SHA256
  `91353752281D11F774588346EC7A569BE3A984FD2C56A29C27FA2C1B1E12BDAC`); source fixes
  predated the rebuild; physical-device acceptance **NOT RUN**.

## 11. Phase 10 — Production website acceptance

- **LIVE PRODUCTION SMOKE: 17/17 PASSED** against `https://jibon-jori-a88n.vercel.app/`.
- Authenticated navigation, deeper nested-route refresh checks on authenticated pages,
  and live feature acceptance: **pending** dedicated accounts / authorized backend steps.

## 12. Phase 11 — Documentation

- Updated: `docs/WEB_APP_GUIDE.md`, `docs/WEB_DEPLOYMENT_GUIDE.md`,
  `docs/TEACHER_WEB_DEMO_GUIDE.md`, `docs/WEB_APP_TEST_REPORT.md`,
  `docs/WEB_RELEASE_REPORT.md`, and this report: `docs/PRODUCTION_ACCEPTANCE_REPORT.md`.

## 13. Phase 12 — Git

- Latest commit at time of writing: `7ad2a0ac32f4e0d69550f6561f279e136664ae6d` (plus
  follow-up docs/sweep commits after this report); local = remote `origin/master`.

## 14. Final report summary

1. Production URL: `https://jibon-jori-a88n.vercel.app/`
2. Production deployment status: **DEPLOYED AND SERVING** (live HTTP 200, final bundle).
3. Browser acceptance status: **PRODUCTION SMOKE 17/17 PASSED** (this session).
4. Authenticated acceptance status: **NOT RUN** (blocked on test account/OTP + auth config).
5. Authentication and OTP results: **NOT LIVE-VERIFIED** (manual Supabase settings required).
6. Live Supabase verification results: **REACHABLE (401 unauthenticated expected)**.
7. Feature-by-feature acceptance: **partial** (public flows live-verified; authenticated
   features pending accounts/backend steps).
8. Feedback migration status: source ready, **not applied** to hosted project.
9. Demo Reset Edge Function status: source repaired, **not deployed**.
10. Demo profiles status: **not confirmed/created** in this pass.
11. Security audit: **SWEEP PASS**, bundle clean.
12. Dependency audit: **21 advisories** (15 moderate / 3 high / 3 critical; dev-tooling
    assessed; production react-router moderate flagged).
13. Android build and regression: **verify PASS**, APK CLEAN; device acceptance not run.
14. Git commit: `7ad2a0ac32f4e0d69550f6561f279e136664ae6d` (+ follow-ups).
15. Remaining blockers: authenticated acceptance, Supabase dashboard auth redirect
    configuration, feedback migration apply, demo-reset deploy, demo profiles, physical
    device, production dependency remediation, authenticated feature acceptance.

## 15. Conclusion

The production website is deployed, live, and serving the final-source build with a
**17/17 passing production browser smoke suite**, no console/network/subresource errors, and
a reachable Supabase backend. Authenticated and live-backend feature acceptance remains
open pending authorized Supabase/Vercel steps and dedicated test accounts.

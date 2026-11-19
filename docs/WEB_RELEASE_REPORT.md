# JibonJori Web Release Report

This report records the release state of the JibonJori web application as of
2026-11-15.

## Part 1 — Objective and scope

- Objective: validate and release the existing JibonJori web client as a
  responsive, permanently hosted HTTPS deployment with truthful feature
  demonstrations and a safe Demo Mode, while preserving the existing Android
  (Capacitor) functionality and the shared Supabase backend.
- Scope of this release batch: teacher evaluation hub (`/app/developer`),
  GraphQL teacher lab, teacher feedback (`/app/feedback`), Demo Mode
  (`/app/demo`), browser smoke coverage, demo reset backend repair, Vercel
  hosting configuration, and release documentation.

## Part 2 — Delivery state

| Item | Status |
| --- | --- |
| Production web URL | **Not yet assigned** — deployment pending provider authorization |
| Hosting provider | Vercel (selected) |
| Source HEAD | `386ee7d05892832e05301e58005163e26bc643ea` (docs refresh on top of task batch `8841cd92015d0a24b547d6f71dcd4cf108b5ee94`) |
| Production build | PASS (`npm run build`) — bundle `dist/assets/index-CB8zvpYc.js` (601.86 kB / gzip 188.33 kB), sourcemaps off, no secret matches, inert `@supabase` library defaults only |
| Full verification gate | **PASS** (`npm run verify`, exit 0) |
| Tests | **203/203 passed (27 files)** |
| Deployment checks | **16/16** |
| Release gate | **21/21** |
| APK forbidden-content scan | **CLEAN** |
| Security sweep | **PASS** after refreshing the generated-bundle allowlist key to the current build artifact |
| Dependency audit | 21 advisories (15 moderate / 3 high / 3 critical), assessed as dev-tooling-only; none confirmed in production dependencies |

## Part 3 — What the web app delivers

- Public landing, registration, email OTP, phone OTP, login, password recovery,
  session restore and logout against the existing Supabase Cloud backend.
- Authenticated dashboard, discovery, recommendations, profile view, comments,
  likes/dislikes, ratings, profile editing, media upload, feedback, video, maps,
  GraphQL lab.
- Teacher evaluation hub at `/app/developer` (14 feature cards with truthful
  statuses and working demonstrations).
- Demo mode at `/app/demo` (checklist, fictional personas, admin-scoped reset).

## Part 4 — Verification results: automated gate

- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- `npm run build` — PASS.
- `npm test` — **PASS — 203/203 tests (27 files)** (includes the new
  `demo-api.test.ts` plus the teacher/demo suites).
- `npm run test:deploy` — **16/16** PASS.
- `npm run test:release-gate` — **21/21** PASS.
- `npm run test:apk` — **CLEAN**.
- Full `npm run verify` — **exit 0**.

## Part 5 — Browser smoke results (Chrome / Edge, local Vite)

- Local Vite dev server started with explicit IPv4 bind
  (`npx vite --host 127.0.0.1 --port 5173).
- Browser smoke executed on Chrome and Edge: **16/17 checks passed** per run, one
  check skipped/failed (live Supabase reachability probe).
- Harness issues corrected during the batch: stale sign-in validation copy,
  registration render/reload coverage, developer/demo protected redirects, failed
  subresource checks, console-error capture.
- The live Supabase probe could not complete from the sandbox (network egress
  restriction); the same failure reproduced from Node.js, so it was treated as an
  environment limitation, not an application defect. Live-cloud checks must be
  re-run from a network that can reach the project.

## Part 6 — Security sweep, secret and bundle content scan

- Security sweep re-run after all source edits: **SECURITY SWEEP PASSED**
  (runtime findings: occurrences=132, allowlisted=87, reported=45, BLOCKING=0;
  prose findings: reported=0, BLOCKING=0).
- Production bundle scan: no secret-shaped values; only inert `@supabase` library
  defaults present; sourcemaps disabled.
- Secrets: no credentials in source; public Supabase URL and publishable anon key
  only, used as designed.

## Part 7 — Dependency audit

- `npm audit`: **21 advisories** (15 moderate / 3 high / 3 critical).
- Assessed as dev-tooling-only at the time of reporting; none in production
  dependencies were confirmed. The raw report previously surfaced production
  `react-router` / `react-router-dom` entries, so a separate production-dependency
  audit and remediation assessment was recommended before final sign-off.

## Part 8 — Production build

- `npm run build` passed; produced `dist/assets/index-CB8zvpYc.js`
  (601.86 kB / gzip 188.33 kB) and `dist/assets/index-CdIvPk8A.css`.
- Build warnings: chunk-size guidance only; no errors.

## Part 9 — Android delivery artifact

- Rebuilt Android debug APK delivered as new artifact:
  `D:/Zeem/JibonJori-Web-v1.apk` — **7,606,439 bytes**,
  SHA256 `91353752281D11F774588346EC7A569BE3A984FD2C56A29C27FA2C1B1E12BDAC`,
  package `com.jibonjori.app`, built against the hosted Supabase URL with a public
  publishable key; debug-signed for manual testing (not a production release).
- Preserved APK artifacts were left untouched:
  `D:/Zeem/JibonJori-Final.apk` and `D:/Zeem/JibonJori-Teacher-Ready.apk`.
- Physical-device acceptance: **NOT RUN** — build and scan are not device-test
  evidence.

## Part 10 — Teacher hub and demo mode delivery state

- Teacher hub (`/app/developer`): implemented with 14 feature cards; automated
  suites pass (developer hub suite: redirect, 14 cards, demo links, live username
  availability, live session posture).
- Demo Mode (`/app/demo`): checklist and six fictional demo personas; admin-only
  reset requiring explicit confirmation; content resolved through the `demo_`
  username marker and deleted only when the caller is the admin.
- Demo reset backend repairs in source: admin resolution via server-side helper,
  GET handler returning `{ profiles }` with snake_case→camelCase mapping, invalid
  SQL casts (`any(${demoIds})::uuid`) removed, server-side logging of admin action.
- New automated coverage: `demo-api.test.ts` (2 tests), `demo-mode.test.tsx` (4
  tests), `developer-page.test.tsx` (5 tests).
- Demo reset function deployment and a live reset run: **NOT COMPLETED** — must be
  done before the demo reset can be demonstrated; no demo data was fabricated.

## Part 11 — Hosting, live-cloud and database state

- Vercel: CLI reported **logged out**; security headers added to
  `frontend/vercel.json`; no deployment attempted or claimed; production URL not
  assigned; exact authorization steps required.
- Supabase: hosted feedback migration `20261110000017_feedback.sql` was **not**
  applied to the hosted project during this batch; source reviewed and found
  coherent, but application requires provider authorization and target-checked
  forward migration only.
- Live-cloud operations (OTP delivery, GraphQL execution, demo reset, maps) were
  not executed during this batch; sandbox egress restrictions prevented current
  live checks.

## Part 12 — Conclusion and remaining blockers

- The web application source is complete, type-checked, linted, built, tested and
  scanned, and passes the full repository verification gate (203/203 tests, deploy
  16/16, release gate 21/21, APK scan CLEAN, security sweep PASS).
- Remaining blockers before any production release claim:
  1. Vercel account/project authorization and deployment.
  2. Production environment variables and permanent HTTPS URL.
  3. Supabase hosted migration application and live-cloud validation.
  4. Demo reset function deployment and live reset verification.
  5. Physical-device acceptance for the delivered APK.
  6. Authenticated browser-flow and accumulated-failure validation.
  7. Production dependency audit follow-up.
- No deployment has been claimed without the above being completed.

# JibonJori Web App Test Report

This report records the automated verification performed on the JibonJori web
application (the React + TypeScript + Vite client) as of 2026-11-15.

## 1. Commands and results

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm test` (unit + component) | **PASS — 203/203 tests (27 files)** |
| `npm run test:deploy` | PASS — 16/16 |
| `npm run test:release-gate` | PASS — 21/21 |
| `npm run test:apk` | PASS — CLEAN |
| `npm run verify` | **PASS (exit 0)** |

The full `npm run verify` gate therefore passes on the web application source.

### Coverage added in this batch

- `src/__tests__/developer-page.test.tsx` — 5 tests (redirect, 14 cards, demo
  links, live username availability, live session posture).
- `src/__tests__/demo-mode.test.tsx` — 4 tests (redirect, checklist/personas,
  admin-only reset, armed/confirm reset flow).
- `src/__tests__/demo-api.test.ts` — 2 tests (admin-gated GET plan handler with
  `{ profiles }` response mapping, and confirm-only reset invocation).

## 2. Browser smoke

`npm run test:browser` drives a real Chrome instance through the DevTools
protocol (no new dependency) and runs route rendering, navigation, keyboard and
computed-style checks.

### 2.1 Production smoke (2026-11-19)

Run against the deployed Vercel production URL:

`node test-support/browser-smoke.mjs --base https://jibon-jori-a88n.vercel.app --supabase-url https://jjbihxtthpclalruepul.supabase.co`

Result: **17/17 passed, 0 skipped**.

- All public-route checks passed (landing, validation, registration, 404, protected
  redirects, reduced motion, responsive reflow, subresources, console errors).
- Supabase reachability check passed: `GET /rest/v1/` resolved with **401** (reachable,
  auth required) — the earlier `TypeError: Failed to fetch` failure did not reproduce and
  is now resolved.

### 2.2 Local smoke (2026-11-15)

Status: **run against the local Vite dev server** (this batch); results recorded
below.

The local dev server had to be started with an explicit IPv4 bind
(`npx vite --host 127.0.0.1 --port 5173`). With the default bind the server
listened on IPv6 loopback only and the first smoke run failed every page-load
check with `ERR_CONNECTION_REFUSED`; after the bind fix the suite ran clean.

Checks executed this batch (suite extended):

- Landing renders React into `#root`; Tailwind, Sass and GSAP applied.
- Empty sign-in client validation blocks without an API call (stale harness
  assertion `"Enter your username"` corrected to the current copy
  `"Enter your email address or phone number."`).
- Registration screen renders; registration reload keeps the form mounted.
- Real keystrokes reach controlled inputs.
- Unknown route renders 404 copy.
- Protected routes redirect anonymous visitors to `/login`: `/app/search`,
  `/app/developer`, `/app/demo`.
- Reduced motion honoured end to end; mobile (375px) + desktop (1280px) layout
  reflows with no horizontal overflow.

Results:

| Run | Browser | Result |
| --- | --- | --- |
| 1 | Chrome, local dev server, default checks | **16/17 passed**, 1 skipped |
| 2 | Edge, local dev server, default checks | **16/17 passed**, 1 skipped |
| 3 | Chrome, local dev server, `--supabase-url https://jjbihxtthpclalruepul.supabase.co` | **16/17 passed**, 1 failed |

The single failing check was the live Supabase reachability probe, which failed
with `TypeError: Failed to fetch`. The identical failure was reproduced from
Node.js, so it is a sandbox network egress restriction rather than an
application defect; live Supabase checks should be re-run from a network that can
reach the project before they are recorded as passed.


## 3. Automated vs live evidence

- All automated tests run against the in-memory Supabase fake - they are mocked
  evidence, not live-cloud proof.
- Live cloud operations (OTP delivery, GraphQL execution, demo reset) require the
  configured providers and the applied migrations; they are tracked separately.

## 4. Known gaps

- Feedback migration `20261110000017_feedback.sql` was repaired in source but has
  not been applied to the hosted project (see `docs/WEB_DEPLOYMENT_GUIDE.md`).
- Live OTP, GraphQL and maps operations were not executed in this batch.
- Physical-device behaviour is covered by the Android build, not the browser.

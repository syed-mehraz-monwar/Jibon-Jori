# JibonJori Web Release Report

This report records the release state of the JibonJori web application as of
2026-11-14.

## 1. Delivery state

| Item | Status |
| --- | --- |
| Production web URL | **Not yet assigned** — deployment pending provider authorization |
| Hosting provider | Vercel (selected) |
| Production build | PASS (`npm run build`) — bundle `dist/assets/index-CB8zvpYc.js` (601.86 kB / gzip 188.33 kB), sourcemaps off, no secret matches, inert `@supabase` library defaults only |
| Full verification gate | **PASS** (`npm run verify`) |
| Tests | **201/201 passed (26 files)** |
| Deployment checks | **16/16** |
| Release gate | **21/21** |
| APK forbidden-content scan | **CLEAN** |
| Security sweep | **PASS** after refreshing the generated-bundle allowlist key to the current build artifact (`frontend/android/app/src/main/assets/public/assets/index-BqKOLtEJ.js`) |
| Dependency audit | 21 advisories (15 moderate / 3 high / 3 critical), all via dev tooling (`vitest`, `vite`, `@capacitor/cli`, `tar`, `tinypool`, `source-map-js`); none in production dependencies |
| Git HEAD (source) | `1dfc47b…` published baseline for the teacher batch; web work adds commits on top |

## 2. What the web app delivers

- Public landing, registration, email OTP, phone OTP, login, password recovery,
  session restore and logout against the existing Supabase Cloud backend.
- Authenticated dashboard, discovery, recommendations, profile view, comments,
  likes/dislikes, ratings, profile editing, media upload, feedback, video, maps,
  GraphQL lab.
- Teacher evaluation hub at `/app/developer` (14 feature cards with truthful
  statuses and working demonstrations).
- Demo mode at `/app/demo` (checklist, fictional personas, admin-scoped reset).

## 3. Outstanding deployment steps (user action required)

1. Authorize/enable the Vercel account and create/import the project.
2. Set the production environment variables (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, optional Maps/Youtube values).
3. Deploy `master`; the SPA rewrite in `frontend/vercel.json` handles deep links.
4. Confirm the Supabase Site URL / redirect configuration for the production origin.
5. Run the browser smoke suite against the production URL and record results here.

## 4. Not yet completed (honest gaps)

- Live production deployment and browser smoke on the public HTTPS URL.
- Live OTP delivery, live GraphQL execution, live demo reset against the hosted
  project.
- Feedback migration applied to the hosted database.

## 5. Conclusion

The web application source is complete, type-checked, linted, built, tested and
scanned, and passes the full repository verification gate. The remaining blocker
is the external hosting authorization/credential step; no deployment has been
claimed without it.

## 6. Latest validation batch (2026-11-14)

- Browser smoke suite executed twice (Chrome and Edge) against the local Vite dev
  server at `http://127.0.0.1:5173`: **16/17 checks passed** per run (the remaining
  check is the live Supabase reachability probe). One harness assertion was stale
  and corrected; new checks added (registration render/reload, protected redirects
  for the developer hub and demo mode, failed-subresource, console-error).
- Production build (`npm run build`) passed; produced
  `dist/assets/index-CB8zvpYc.js` (601.86 kB / gzip 188.33 kB) and
  `dist/assets/index-CdIvPk8A.css`.
- Production bundle scan: no secret-shaped values; only inert `@supabase`
  library defaults (`http://localhost:9999`, host-validation list) present.
- Security sweep: first re-run after the latest build reported 5 BLOCKING findings
  in the generated Android asset bundle `index-BqKOLtEJ.js`; the allowlist key had
  gone stale (`index-BDDR_15d.js`). Refreshed the allowlist key to the current
  artifact; the sweep then **passed**.
- `npm audit`: 21 advisories, all via dev tooling; no production dependency
  affected.
- Vercel config (`frontend/vercel.json`): added security headers (HSTS, nosniff,
  frame denial, referrer/permissions/COOP, CSP mirroring `nginx.conf`).
- Vercel CLI authorization: **not available** (`vercel whoami` → logged out), so
  no deployment was attempted or claimed.

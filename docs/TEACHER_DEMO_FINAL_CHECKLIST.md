# JibonJori Teacher Demo Final Checklist

**Date:** 2026-11-19
**Production URL:** `https://jibon-jori-a88n.vercel.app/`

## Purpose

This checklist is the final presentation workflow for a university teacher
demonstration of the JibonJori web application. It is intentionally limited to
functionality that is implemented, locally verified, or live-verified; anything
pending an authorized backend step is marked honestly.

## Presentation workflow (16 steps)

| # | Step | Route / action | Status at time of writing |
| --- | --- | --- | --- |
| 1 | Open the website | `https://jibon-jori-a88n.vercel.app/` | ✅ LIVE (HTTP 200, smoke 17/17) |
| 2 | Login to demo account | `/login` → demo credentials | ⛔ Demo account not yet provisioned/verified |
| 3 | Show dashboard | `/app` | ⛔ Authenticated session required |
| 4 | Show profile | `/app/profile` | ⛔ Authenticated session required |
| 5 | Show Discover | `/app/search` (discover) | ⛔ Authenticated session required; public route checks passed |
| 6 | Show username availability | developer hub / profile editor | ⛔ Live backend check pending authenticated session |
| 7 | Show image upload | profile editor / media | ⛔ Live upload pending authenticated session |
| 8 | Show comments | discovery → profile | ⛔ Live interaction pending two-account test |
| 9 | Show likes/dislikes | discovery → profile | ⛔ Live reaction pending two-account test |
| 10 | Show feedback rating | `/app/feedback` | ⛔ Migration not applied; live test pending |
| 11 | Show datepicker | profile editor / forms | ⛔ Authenticated path pending session |
| 12 | Show video | `/app/about` / curated video | ⛔ Live embed pending |
| 13 | Show Maps | developer hub / profile editor | ⛔ Live map pending API key/session |
| 14 | Show GraphQL | `/app/developer/graphql` | ⛔ Live GraphQL pending authenticated session |
| 15 | Show Demo Mode | `/app/demo` | ⛔ Protected; admin-gated reset not deployed |
| 16 | Show logout/login | `/login` | ✅ Public flow smoke-checked; authenticated logout pending |

## Honest status summary for the teacher demo

- **Working now (verified this session):** production URL live; production browser
  smoke **17/17 passed** (Chrome, production origin, incl. Supabase reachability);
  full automated gate **PASS** (203/203 tests, deploy 16/16, release gate 21/21, APK
  CLEAN, security sweep PASS); production build final-source bundle served.
- **Pending before confident live demonstration:** dedicated demo accounts with real
  (non-fabricated) verification; Supabase production auth redirect configuration;
  authenticated browser flows; live feature acceptance with two accounts; feedback
  migration apply; demo-reset function deploy; demo-profile provisioning.

## Readiness verdict

**Teacher-demo ready for public/unauthenticated demonstration content: NOT YET.**

**Teacher-demo ready for authenticated live demonstration: BLOCKED** on the pending
items above and must not be claimed.

The production website is deployed, live, and serving over HTTPS, but authenticated
teacher-demo delivery requires the outstanding authorized backend and account steps
recorded in `docs/PRODUCTION_ACCEPTANCE_REPORT.md`.

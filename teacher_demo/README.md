# Teacher demo package — JibonJori

Six requirements, six proofs. Start at `DEMO_SCRIPT.md` and follow it top to
bottom (5–10 minutes).

| # | Requirement | Proof | File |
|---|---|---|---|
| 1 | ERD | Simplified + complete diagrams (SVG+Mermaid) traced to the SQL migrations | `ERD/` |
| 2 | Git / workflow | Real commits, clean status, CI/lint/test tooling | `GIT_DEMO.md` |
| 3 | Modern frontend | React 18 + TypeScript app, running locally | `FRONTEND_DEMO.md` |
| 4 | RESTful API | Live GET → 200 + JSON; no-key → 401 | `REST_API_DEMO.md` |
| 5 | Text boxes + dropdowns | Profile form: 10+ inputs, 7 dropdowns, validation | `FORM_DEMO.md` |
| 6 | Pagination | Search: 12/page, Previous/Next, server-side | `PAGINATION_DEMO.md` |

Also: `REQUIREMENT_CHECKLIST.md` (evidence table), `ERD/README.md` (entity guide).

Rules respected: no fake data, no invented schema, no secrets in docs, no push,
no deploy, no database changes. Anything not runnable offline is labeled with
its honest fallback in each document.

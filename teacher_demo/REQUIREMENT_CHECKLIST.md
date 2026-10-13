# REQUIREMENT_CHECKLIST.md (populated with real evidence, 2026-10-14)

| Requirement | Implemented? | Verified? | Demo location | Notes |
|---|---|---|---|---|
| ERD | Yes | Yes — every table/FK traced to `supabase/migrations/*.sql` | `teacher_demo/ERD/` (SVG + MMD + entity guide) | Simplified (12 tables) + complete (17) |
| Git | Yes | Yes — `master`, 3 genuine commits, clean status, no remote | `teacher_demo/GIT_DEMO.md` | Proved no secrets in history; push needs owner approval |
| React frontend | Yes | Yes — typecheck 0, lint 0, build 0, tests 142/142 | `teacher_demo/FRONTEND_DEMO.md`, `http://localhost:5173` | React 18.3.1 + TS 5.6.2 + Vite 5 |
| REST API | Yes | Yes — live GET 200 (8 rows) + 401 without key, 2026-10-14 | `teacher_demo/REST_API_DEMO.md` | PostgREST, anon key from local config, RLS enforced |
| Forms | Yes | Yes — code + tests; live submit needs login + internet | `teacher_demo/FORM_DEMO.md`, `/app/profile` | 10+ inputs, 7 dropdowns, date picker, 2-layer validation |
| Pagination | Yes | Yes — code + math tests; 2nd page needs 13+ public profiles | `teacher_demo/PAGINATION_DEMO.md`, `/app/search` | Server-side `p_limit`/`p_offset` + total |

## Pre-demo actions for the owner

1. `cd frontend; npm install` (once).
2. Register + verify one demo account; stay logged in (session persists).
3. Optional: register a few more members and set profiles public so page 2 exists.
4. Keep phone/laptop internet on for sections 4–6; offline fallbacks are in each doc.
